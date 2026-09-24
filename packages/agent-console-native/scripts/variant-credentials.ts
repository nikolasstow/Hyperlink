/**
 * Headless iOS signing credentials for an app variant — the step `eas build` can
 * only do interactively for a brand-new bundle id. Idempotent: a bundle id that
 * already has ad-hoc build credentials on EAS is left untouched.
 *
 * Everything is reused from the BASE app's EAS credentials (same Apple team):
 *   - the ad-hoc distribution certificate,
 *   - the App Store Connect API key (Admin, EAS-held — its .p8 is fetched from EAS
 *     into memory only, never written to disk),
 *   - the APNs push key.
 *
 * Steps for a new variant bundle id:
 *   1. App Store Connect: register the bundle id + enable Push Notifications
 *      (the variant's only entitlement is `aps-environment`).
 *   2. App Store Connect: create an ad-hoc profile for it — distribution cert +
 *      every device registered with EAS for the team.
 *   3. EAS: register the app identifier, the profile, the app credentials (ASC key
 *      + push key) and the AD_HOC build credentials.
 * After that, `eas build --non-interactive` signs the variant with no prompts.
 * Ad-hoc covers both internal-distribution profiles (development + preview).
 *
 * Auth: `EXPO_TOKEN` if set, else the eas-cli login session in ~/.expo/state.json.
 */
import { sign } from "node:crypto";
import { Clock, Config, Data, Effect, Encoding, FileSystem, Option, Path, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { runString } from "./command";

// ── Errors ─────────────────────────────────────────────────────────────────────

export class EasGraphqlError extends Data.TaggedError("EasGraphqlError")<{
  readonly errors: string;
}> {}

export class AppStoreConnectError extends Data.TaggedError("AppStoreConnectError")<{
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly body: string;
}> {}

export class JwtSignError extends Data.TaggedError("JwtSignError")<{
  readonly cause: unknown;
}> {}

/** The base app, a device, or a certificate the variant must reuse is missing. */
export class MissingPrerequisiteError extends Data.TaggedError("MissingPrerequisiteError")<{
  readonly message: string;
}> {}

// ── Target ─────────────────────────────────────────────────────────────────────

const expoPublicConfig = Schema.Struct({
  ios: Schema.Struct({
    bundleIdentifier: Schema.String,
  }),
  extra: Schema.Struct({
    eas: Schema.Struct({
      projectId: Schema.String,
    }),
  }),
});

const appJson = Schema.Struct({
  expo: Schema.Struct({
    ios: Schema.Struct({
      bundleIdentifier: Schema.String,
    }),
  }),
});

export interface VariantTarget {
  readonly bundleIdentifier: string;
  readonly baseBundleIdentifier: string;
  readonly projectId: string;
}

/** The bundle id the package at `pkgDir` builds — asked of `expo config` itself,
 * the same evaluation EAS runs, so the two can never disagree. */
export const resolveVariantTarget = (pkgDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolved = yield* runString({
      command: "npx",
      args: ["expo", "config", "--json", "--type", "public"],
      cwd: pkgDir,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(expoPublicConfig))));
    const base = yield* fs
      .readFileString(path.join(pkgDir, "app.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(appJson))));
    const target: VariantTarget = {
      bundleIdentifier: resolved.ios.bundleIdentifier,
      baseBundleIdentifier: base.expo.ios.bundleIdentifier,
      projectId: resolved.extra.eas.projectId,
    };
    return target;
  });

// ── EAS GraphQL ────────────────────────────────────────────────────────────────

const expoState = Schema.Struct({
  auth: Schema.Struct({
    sessionSecret: Schema.String,
  }),
});

/** `EXPO_TOKEN` (robot / CI) if set, else the eas-cli login session. */
const easAuthHeaders = Effect.gen(function* () {
  const token = yield* Config.option(Config.string("EXPO_TOKEN"));
  if (Option.isSome(token)) {
    return {
      authorization: `Bearer ${token.value}`,
    };
  }
  const home = yield* Config.string("HOME");
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = yield* fs
    .readFileString(path.join(home, ".expo", "state.json"))
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(expoState))));
  return {
    "expo-session": state.auth.sessionSecret,
  };
});

const graphqlEnvelope = Schema.Struct({
  data: Schema.optionalKey(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const eas = <S extends Schema.Top>(query: string, variables: Record<string, unknown>, data: S) =>
  Effect.gen(function* () {
    const headers = yield* easAuthHeaders;
    const request = yield* HttpClientRequest.post("https://api.expo.dev/graphql").pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJson({
        query,
        variables,
      }),
    );
    const envelope = yield* HttpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(graphqlEnvelope)),
    );
    if (envelope.errors !== undefined) {
      return yield* new EasGraphqlError({
        errors: JSON.stringify(envelope.errors),
      });
    }
    return yield* Schema.decodeUnknownEffect(data)(envelope.data);
  });

const idOnly = Schema.Struct({
  id: Schema.String,
});

const buildCredentials = Schema.Struct({
  iosDistributionType: Schema.String,
  distributionCertificate: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      serialNumber: Schema.String,
    }),
  ),
});

const appCredentials = Schema.Struct({
  id: Schema.String,
  appleAppIdentifier: Schema.Struct({
    id: Schema.String,
    bundleIdentifier: Schema.String,
  }),
  appleTeam: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      appleTeamIdentifier: Schema.String,
    }),
  ),
  appStoreConnectApiKeyForSubmissions: Schema.NullOr(idOnly),
  pushKey: Schema.NullOr(idOnly),
  iosAppBuildCredentialsList: Schema.Array(buildCredentials),
});

type AppCredentials = typeof appCredentials.Type;

const loadApp = (projectId: string) =>
  eas(
    `query ($id: String!) { app { byId(appId: $id) {
      id
      ownerAccount { id name }
      iosAppCredentials {
        id
        appleAppIdentifier { id bundleIdentifier }
        appleTeam { id appleTeamIdentifier }
        appStoreConnectApiKeyForSubmissions { id }
        pushKey { id }
        iosAppBuildCredentialsList { iosDistributionType distributionCertificate { id serialNumber } }
      }
    } } }`,
    {
      id: projectId,
    },
    Schema.Struct({
      app: Schema.Struct({
        byId: Schema.Struct({
          id: Schema.String,
          ownerAccount: Schema.Struct({
            id: Schema.String,
            name: Schema.String,
          }),
          iosAppCredentials: Schema.Array(appCredentials),
        }),
      }),
    }),
  ).pipe(Effect.map((d) => d.app.byId));

// ── App Store Connect API ──────────────────────────────────────────────────────

interface AscKey {
  readonly keyIdentifier: string;
  readonly issuerIdentifier: string;
  readonly keyP8: string;
}

const base64url = (value: unknown) => Encoding.encodeBase64Url(JSON.stringify(value));

/** ES256 JWT for the App Store Connect API. Effect ships no signing primitive, so
 * node:crypto is isolated here. Minted per request (20-minute expiry). */
const ascJwt = (key: AscKey) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((millis) => {
      const now = Math.floor(millis / 1000);
      const unsigned = [
        base64url({
          alg: "ES256",
          kid: key.keyIdentifier,
          typ: "JWT",
        }),
        base64url({
          iss: key.issuerIdentifier,
          iat: now,
          exp: now + 1200,
          aud: "appstoreconnect-v1",
        }),
      ].join(".");
      return Effect.try({
        try: () =>
          Encoding.encodeBase64Url(
            sign("sha256", new TextEncoder().encode(unsigned), {
              key: key.keyP8,
              dsaEncoding: "ieee-p1363",
            }),
          ),
        catch: (cause) => new JwtSignError({ cause }),
      }).pipe(Effect.map((signature) => `${unsigned}.${signature}`));
    }),
  );

const ascRequest = <S extends Schema.Top>(key: AscKey, method: "GET" | "POST", route: string, body: unknown, response: S) =>
  Effect.gen(function* () {
    const jwt = yield* ascJwt(key);
    const url = `https://api.appstoreconnect.apple.com${route}`;
    const base = (method === "GET" ? HttpClientRequest.get(url) : HttpClientRequest.post(url)).pipe(
      HttpClientRequest.bearerToken(jwt),
    );
    const request = body === undefined ? base : yield* HttpClientRequest.bodyJson(base, body);
    const res = yield* HttpClient.execute(request);
    if (res.status < 200 || res.status >= 300) {
      const text = yield* res.text;
      return yield* new AppStoreConnectError({
        method,
        route,
        status: res.status,
        body: text,
      });
    }
    return yield* HttpClientResponse.schemaBodyJson(response)(res);
  });

const bundleIdsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attributes: Schema.Struct({
        identifier: Schema.String,
      }),
    }),
  ),
  included: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        attributes: Schema.Struct({
          capabilityType: Schema.optionalKey(Schema.String),
        }),
      }),
    ),
  ),
});

const createdResponse = Schema.Struct({
  data: idOnly,
});

interface AscBundleId {
  readonly id: string;
  readonly capabilities: ReadonlyArray<string>;
}

const ensureAscBundleId = (key: AscKey, bundleIdentifier: string) =>
  Effect.gen(function* () {
    const found = yield* ascRequest(
      key,
      "GET",
      `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleIdentifier)}&include=bundleIdCapabilities`,
      undefined,
      bundleIdsResponse,
    );
    // filter[identifier] is a prefix match — pick the exact one.
    const existing = found.data.find((b) => b.attributes.identifier === bundleIdentifier);
    if (existing !== undefined) {
      const bundleId: AscBundleId = {
        id: existing.id,
        capabilities: (found.included ?? []).flatMap((c) =>
          c.type === "bundleIdCapabilities" && c.id.startsWith(`${existing.id}_`) && c.attributes.capabilityType !== undefined
            ? [c.attributes.capabilityType]
            : [],
        ),
      };
      return bundleId;
    }
    const created = yield* ascRequest(
      key,
      "POST",
      "/v1/bundleIds",
      {
        data: {
          type: "bundleIds",
          attributes: {
            identifier: bundleIdentifier,
            name: `DoubleAgent ${bundleIdentifier.split(".").at(-1) ?? ""}`.replace(/[^A-Za-z0-9 ]+/g, " ").trim(),
            platform: "IOS",
          },
        },
      },
      createdResponse,
    );
    yield* Effect.log(`App Store Connect: registered bundle id ${bundleIdentifier}`);
    const bundleId: AscBundleId = {
      id: created.data.id,
      capabilities: [],
    };
    return bundleId;
  });

const ensurePushCapability = (key: AscKey, bundleId: AscBundleId) =>
  bundleId.capabilities.includes("PUSH_NOTIFICATIONS")
    ? Effect.void
    : ascRequest(
        key,
        "POST",
        "/v1/bundleIdCapabilities",
        {
          data: {
            type: "bundleIdCapabilities",
            attributes: {
              capabilityType: "PUSH_NOTIFICATIONS",
            },
            relationships: {
              bundleId: {
                data: {
                  type: "bundleIds",
                  id: bundleId.id,
                },
              },
            },
          },
        },
        createdResponse,
      ).pipe(Effect.andThen(Effect.log("App Store Connect: enabled Push Notifications")));

const ascIdList = Schema.Struct({
  data: Schema.Array(idOnly),
});

const ascDevices = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attributes: Schema.Struct({
        udid: Schema.String,
      }),
    }),
  ),
});

const ascProfile = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    attributes: Schema.Struct({
      profileContent: Schema.String,
    }),
  }),
});

// ── Orchestration ──────────────────────────────────────────────────────────────

const adHoc = (credentials: AppCredentials | undefined) =>
  credentials?.iosAppBuildCredentialsList.find((b) => b.iosDistributionType === "AD_HOC" && b.distributionCertificate !== null);

const missing = (message: string) => new MissingPrerequisiteError({ message });

/** Make sure the target bundle id has AD_HOC build credentials on EAS. No prompts.
 * Succeeds with whether anything was created. */
export const ensureVariantCredentials = (target: VariantTarget) =>
  Effect.gen(function* () {
    const app = yield* loadApp(target.projectId);
    const forBundle = (id: string) => app.iosAppCredentials.find((c) => c.appleAppIdentifier.bundleIdentifier === id);

    const current = forBundle(target.bundleIdentifier);
    if (adHoc(current) !== undefined) return false;

    // Everything is reused from the base app (the bundle id with no variant suffix).
    const base = forBundle(target.baseBundleIdentifier);
    const cert = adHoc(base)?.distributionCertificate;
    if (base === undefined || cert === undefined || cert === null) {
      return yield* missing(`Base app ${target.baseBundleIdentifier} has no AD_HOC credentials on EAS to reuse — build the base app once first.`);
    }
    const team = base.appleTeam;
    const ascKeyRef = base.appStoreConnectApiKeyForSubmissions;
    if (team === null || ascKeyRef === null) {
      return yield* missing(`Base app ${target.baseBundleIdentifier} has no Apple team / App Store Connect API key on EAS to reuse.`);
    }
    yield* Effect.log(`Setting up signing for ${target.bundleIdentifier} (team ${team.appleTeamIdentifier})`);

    // The EAS-held ASC key, in memory only.
    const key = yield* eas(
      `query ($id: String!) { appStoreConnectApiKey { byId(id: $id) { keyIdentifier issuerIdentifier keyP8 } } }`,
      {
        id: ascKeyRef.id,
      },
      Schema.Struct({
        appStoreConnectApiKey: Schema.Struct({
          byId: Schema.Struct({
            keyIdentifier: Schema.String,
            issuerIdentifier: Schema.String,
            keyP8: Schema.String,
          }),
        }),
      }),
    ).pipe(Effect.map((d) => d.appStoreConnectApiKey.byId));

    // 1. Bundle id + capability.
    const bundleId = yield* ensureAscBundleId(key, target.bundleIdentifier);
    yield* ensurePushCapability(key, bundleId);

    // 2. Ad-hoc profile: the base distribution cert + every EAS-registered device.
    const ascCert = yield* ascRequest(key, "GET", `/v1/certificates?filter[serialNumber]=${cert.serialNumber}`, undefined, ascIdList).pipe(
      Effect.flatMap((r) =>
        Option.match(Option.fromUndefinedOr(r.data.at(0)), {
          onNone: () => Effect.fail(missing(`Distribution certificate ${cert.serialNumber} not found on App Store Connect.`)),
          onSome: Effect.succeed,
        }),
      ),
    );
    const easDevices = yield* eas(
      `query ($account: String!, $team: String!) { account { byName(accountName: $account) {
        appleTeamsPaginated(first: 1, filter: { appleTeamIdentifier: $team }) {
          edges { node { appleDevices(limit: 1000) { identifier enabled } } }
        }
      } } }`,
      {
        account: app.ownerAccount.name,
        team: team.appleTeamIdentifier,
      },
      Schema.Struct({
        account: Schema.Struct({
          byName: Schema.Struct({
            appleTeamsPaginated: Schema.Struct({
              edges: Schema.Array(
                Schema.Struct({
                  node: Schema.Struct({
                    appleDevices: Schema.Array(
                      Schema.Struct({
                        identifier: Schema.String,
                        enabled: Schema.NullOr(Schema.Boolean),
                      }),
                    ),
                  }),
                }),
              ),
            }),
          }),
        }),
      }),
    ).pipe(
      Effect.map((d) => (d.account.byName.appleTeamsPaginated.edges.at(0)?.node.appleDevices ?? []).filter((device) => device.enabled !== false)),
    );
    if (easDevices.length === 0) {
      return yield* missing("No devices registered with EAS for this team (eas device:create).");
    }
    const enabledAscDevices = yield* ascRequest(key, "GET", "/v1/devices?filter[platform]=IOS&filter[status]=ENABLED&limit=200", undefined, ascDevices);
    const deviceIds = yield* Effect.forEach(easDevices, (device) =>
      Option.match(Option.fromUndefinedOr(enabledAscDevices.data.find((a) => a.attributes.udid === device.identifier)), {
        onNone: () => Effect.fail(missing(`EAS device ${device.identifier} is not an enabled iOS device on App Store Connect.`)),
        onSome: (match) => Effect.succeed(match.id),
      }),
    );
    const millis = yield* Clock.currentTimeMillis;
    const profile = yield* ascRequest(
      key,
      "POST",
      "/v1/profiles",
      {
        data: {
          type: "profiles",
          attributes: {
            name: `*[expo] ${target.bundleIdentifier} AdHoc ${millis}`,
            profileType: "IOS_APP_ADHOC",
          },
          relationships: {
            bundleId: {
              data: {
                type: "bundleIds",
                id: bundleId.id,
              },
            },
            certificates: {
              data: [
                {
                  type: "certificates",
                  id: ascCert.id,
                },
              ],
            },
            devices: {
              data: deviceIds.map((id) => ({
                type: "devices",
                id,
              })),
            },
          },
        },
      },
      ascProfile,
    ).pipe(Effect.map((r) => r.data));
    yield* Effect.log(`App Store Connect: created ad-hoc profile ${profile.id} (${deviceIds.length} device(s))`);

    // 3. EAS records.
    const appIdentifierId = yield* ensureEasAppIdentifier({
      existing: current?.appleAppIdentifier.id,
      accountName: app.ownerAccount.name,
      accountId: app.ownerAccount.id,
      bundleIdentifier: target.bundleIdentifier,
      appleTeamId: team.id,
    });
    const easProfileId = yield* eas(
      `mutation ($input: AppleProvisioningProfileInput!, $account: ID!, $appId: ID!) { appleProvisioningProfile {
        createAppleProvisioningProfile(appleProvisioningProfileInput: $input, accountId: $account, appleAppIdentifierId: $appId) { id }
      } }`,
      {
        input: {
          appleProvisioningProfile: profile.attributes.profileContent,
          developerPortalIdentifier: profile.id,
        },
        account: app.ownerAccount.id,
        appId: appIdentifierId,
      },
      Schema.Struct({
        appleProvisioningProfile: Schema.Struct({
          createAppleProvisioningProfile: idOnly,
        }),
      }),
    ).pipe(Effect.map((d) => d.appleProvisioningProfile.createAppleProvisioningProfile.id));
    const credentialsId =
      current === undefined
        ? yield* eas(
            `mutation ($input: IosAppCredentialsInput!, $app: ID!, $appId: ID!) { iosAppCredentials {
              createIosAppCredentials(iosAppCredentialsInput: $input, appId: $app, appleAppIdentifierId: $appId) { id }
            } }`,
            {
              input: {
                appleTeamId: team.id,
                appStoreConnectApiKeyForSubmissionsId: ascKeyRef.id,
                pushKeyId: base.pushKey?.id,
              },
              app: app.id,
              appId: appIdentifierId,
            },
            Schema.Struct({
              iosAppCredentials: Schema.Struct({
                createIosAppCredentials: idOnly,
              }),
            }),
          ).pipe(Effect.map((d) => d.iosAppCredentials.createIosAppCredentials.id))
        : current.id;
    yield* eas(
      `mutation ($input: IosAppBuildCredentialsInput!, $credentials: ID!) { iosAppBuildCredentials {
        createIosAppBuildCredentials(iosAppBuildCredentialsInput: $input, iosAppCredentialsId: $credentials) { id }
      } }`,
      {
        input: {
          iosDistributionType: "AD_HOC",
          distributionCertificateId: cert.id,
          provisioningProfileId: easProfileId,
        },
        credentials: credentialsId,
      },
      Schema.Struct({
        iosAppBuildCredentials: Schema.Struct({
          createIosAppBuildCredentials: idOnly,
        }),
      }),
    );
    yield* Effect.log(`EAS: AD_HOC build credentials ready for ${target.bundleIdentifier}`);
    return true;
  });

interface EasAppIdentifierInput {
  readonly existing: string | undefined;
  readonly accountName: string;
  readonly accountId: string;
  readonly bundleIdentifier: string;
  readonly appleTeamId: string;
}

/** The EAS AppleAppIdentifier for the bundle id — reused if present, else created. */
const ensureEasAppIdentifier = (input: EasAppIdentifierInput) =>
  input.existing !== undefined
    ? Effect.succeed(input.existing)
    : eas(
        `query ($account: String!, $bundle: String!) { account { byName(accountName: $account) {
          appleAppIdentifiers(bundleIdentifier: $bundle) { id }
        } } }`,
        {
          account: input.accountName,
          bundle: input.bundleIdentifier,
        },
        Schema.Struct({
          account: Schema.Struct({
            byName: Schema.Struct({
              appleAppIdentifiers: Schema.Array(idOnly),
            }),
          }),
        }),
      ).pipe(
        Effect.flatMap((d) =>
          Option.match(Option.fromUndefinedOr(d.account.byName.appleAppIdentifiers.at(0)), {
            onSome: (found) => Effect.succeed(found.id),
            onNone: () =>
              eas(
                `mutation ($input: AppleAppIdentifierInput!, $account: ID!) { appleAppIdentifier {
                  createAppleAppIdentifier(appleAppIdentifierInput: $input, accountId: $account) { id }
                } }`,
                {
                  input: {
                    bundleIdentifier: input.bundleIdentifier,
                    appleTeamId: input.appleTeamId,
                  },
                  account: input.accountId,
                },
                Schema.Struct({
                  appleAppIdentifier: Schema.Struct({
                    createAppleAppIdentifier: idOnly,
                  }),
                }),
              ).pipe(Effect.map((d) => d.appleAppIdentifier.createAppleAppIdentifier.id)),
          }),
        ),
      );
