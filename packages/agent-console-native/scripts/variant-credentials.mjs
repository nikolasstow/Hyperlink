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
 *
 *   node scripts/variant-credentials.mjs   # this worktree's resolved bundle id
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** The bundle id the package at `dir` builds — resolved through its app.config.js
 * itself, so it can never disagree with what EAS evaluates. */
export const resolveBundleIdentifier = (dir = pkgDir) => {
  const appJson = JSON.parse(readFileSync(path.join(dir, "app.json"), "utf8"));
  const config = require(path.join(dir, "app.config.js"))({ config: structuredClone(appJson.expo) });
  return {
    bundleIdentifier: config.ios.bundleIdentifier,
    baseBundleIdentifier: appJson.expo.ios.bundleIdentifier,
    projectId: appJson.expo.extra.eas.projectId,
  };
};

// ── EAS GraphQL ────────────────────────────────────────────────────────────────

const easAuthHeader = () => {
  const token = process.env.EXPO_TOKEN;
  if (typeof token === "string" && token.length > 0) return { authorization: `Bearer ${token}` };
  const statePath = path.join(os.homedir(), ".expo", "state.json");
  const secret = JSON.parse(readFileSync(statePath, "utf8")).auth?.sessionSecret;
  if (typeof secret !== "string") throw new Error(`Not logged in to EAS (no EXPO_TOKEN, no session in ${statePath}).`);
  return { "expo-session": secret };
};

const eas = async (query, variables = {}) => {
  const response = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", ...easAuthHeader() },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors !== undefined) {
    throw new Error(`EAS GraphQL failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
};

const CREDENTIALS_FIELDS = `
  id
  appleAppIdentifier { id bundleIdentifier }
  appleTeam { id appleTeamIdentifier }
  appStoreConnectApiKeyForSubmissions { id }
  pushKey { id }
  iosAppBuildCredentialsList {
    iosDistributionType
    distributionCertificate { id serialNumber }
  }
`;

const loadApp = (projectId) =>
  eas(
    `query ($id: String!) { app { byId(appId: $id) {
      id
      ownerAccount { id name }
      iosAppCredentials { ${CREDENTIALS_FIELDS} }
    } } }`,
    { id: projectId },
  ).then((d) => d.app.byId);

// ── App Store Connect API ──────────────────────────────────────────────────────

const ascClient = ({ keyIdentifier, issuerIdentifier, keyP8 }) => {
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const key = createPrivateKey(keyP8);
  let token;
  let expiresAt = 0;
  const bearer = () => {
    const now = Math.floor(Date.now() / 1000);
    if (now < expiresAt - 60) return token;
    expiresAt = now + 1200;
    const unsigned = `${b64url({ alg: "ES256", kid: keyIdentifier, typ: "JWT" })}.${b64url({
      iss: issuerIdentifier,
      iat: now,
      exp: expiresAt,
      aud: "appstoreconnect-v1",
    })}`;
    const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    token = `${unsigned}.${signature}`;
    return token;
  };
  return async (method, route, body) => {
    const response = await fetch(`https://api.appstoreconnect.apple.com${route}`, {
      method,
      headers: { authorization: `Bearer ${bearer()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`App Store Connect ${method} ${route} failed (${response.status}): ${JSON.stringify(json.errors ?? json)}`);
    return json;
  };
};

const ensureAscBundleId = async (asc, bundleIdentifier) => {
  const found = await asc("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleIdentifier)}&include=bundleIdCapabilities`);
  // filter[identifier] is a prefix match — pick the exact one.
  const existing = found.data.find((b) => b.attributes.identifier === bundleIdentifier);
  if (existing !== undefined) {
    const capabilities = (found.included ?? [])
      .filter((c) => c.type === "bundleIdCapabilities" && c.id.startsWith(`${existing.id}_`))
      .map((c) => c.attributes.capabilityType);
    return { id: existing.id, capabilities };
  }
  const created = await asc("POST", "/v1/bundleIds", {
    data: {
      type: "bundleIds",
      attributes: {
        identifier: bundleIdentifier,
        name: `DoubleAgent ${bundleIdentifier.split(".").pop().replace(/[^A-Za-z0-9]+/g, " ")}`.trim(),
        platform: "IOS",
      },
    },
  });
  console.log(`[variant-credentials] App Store Connect: registered bundle id ${bundleIdentifier}`);
  return { id: created.data.id, capabilities: [] };
};

const ensurePushCapability = async (asc, bundleId) => {
  if (bundleId.capabilities.includes("PUSH_NOTIFICATIONS")) return;
  await asc("POST", "/v1/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundleId.id } } },
    },
  });
  console.log("[variant-credentials] App Store Connect: enabled Push Notifications");
};

// ── Orchestration ──────────────────────────────────────────────────────────────

/** Make sure `bundleIdentifier` has AD_HOC build credentials on EAS. No prompts. */
export const ensureVariantCredentials = async ({ bundleIdentifier, baseBundleIdentifier, projectId }) => {
  const app = await loadApp(projectId);
  const forBundle = (id) => app.iosAppCredentials.find((c) => c.appleAppIdentifier.bundleIdentifier === id);
  const adHoc = (credentials) =>
    credentials?.iosAppBuildCredentialsList.find((b) => b.iosDistributionType === "AD_HOC" && b.distributionCertificate !== null);

  const current = forBundle(bundleIdentifier);
  if (adHoc(current) !== undefined) return false;

  // Everything is reused from the base app (the bundle id with no variant suffix).
  const base = forBundle(baseBundleIdentifier);
  const baseAdHoc = adHoc(base);
  if (base === undefined || baseAdHoc === undefined) {
    throw new Error(`Base app ${baseBundleIdentifier} has no AD_HOC credentials on EAS to reuse — build the base app once first.`);
  }
  if (base.appStoreConnectApiKeyForSubmissions === null) {
    throw new Error(`Base app ${baseBundleIdentifier} has no App Store Connect API key on EAS to reuse.`);
  }
  const team = base.appleTeam;
  const cert = baseAdHoc.distributionCertificate;
  console.log(`[variant-credentials] setting up signing for ${bundleIdentifier} (team ${team.appleTeamIdentifier})`);

  // The EAS-held ASC key, in memory only.
  const ascKey = (
    await eas(`query ($id: ID!) { appStoreConnectApiKey { byId(id: $id) { keyIdentifier issuerIdentifier keyP8 } } }`, {
      id: base.appStoreConnectApiKeyForSubmissions.id,
    })
  ).appStoreConnectApiKey.byId;
  const asc = ascClient(ascKey);

  // 1. Bundle id + capability.
  const bundleId = await ensureAscBundleId(asc, bundleIdentifier);
  await ensurePushCapability(asc, bundleId);

  // 2. Ad-hoc profile: the base distribution cert + every EAS-registered device.
  const ascCert = (await asc("GET", `/v1/certificates?filter[serialNumber]=${cert.serialNumber}`)).data[0];
  if (ascCert === undefined) throw new Error(`Distribution certificate ${cert.serialNumber} not found on App Store Connect.`);
  const easDevices = (
    await eas(
      `query ($account: String!, $team: String!) { account { byName(accountName: $account) {
        appleTeamsPaginated(first: 1, filter: { appleTeamIdentifier: $team }) { edges { node { appleDevices(limit: 1000) { identifier enabled } } } }
      } } }`,
      { account: app.ownerAccount.name, team: team.appleTeamIdentifier },
    )
  ).account.byName.appleTeamsPaginated.edges[0].node.appleDevices.filter((d) => d.enabled !== false);
  const ascDevices = (await asc("GET", "/v1/devices?filter[platform]=IOS&filter[status]=ENABLED&limit=200")).data;
  const deviceIds = easDevices.map((d) => {
    const match = ascDevices.find((a) => a.attributes.udid === d.identifier);
    if (match === undefined) throw new Error(`EAS device ${d.identifier} is not an enabled iOS device on App Store Connect.`);
    return match.id;
  });
  if (deviceIds.length === 0) throw new Error("No devices registered with EAS for this team (eas device:create).");
  const profile = (
    await asc("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name: `*[expo] ${bundleIdentifier} AdHoc ${Date.now()}`, profileType: "IOS_APP_ADHOC" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundleId.id } },
          certificates: { data: [{ type: "certificates", id: ascCert.id }] },
          devices: { data: deviceIds.map((id) => ({ type: "devices", id })) },
        },
      },
    })
  ).data;
  console.log(`[variant-credentials] App Store Connect: created ad-hoc profile ${profile.id} (${deviceIds.length} device(s))`);

  // 3. EAS records.
  const appIdentifierId =
    current?.appleAppIdentifier.id ??
    (
      await eas(
        `query ($account: String!, $bundle: String!) { account { byName(accountName: $account) { appleAppIdentifiers(bundleIdentifier: $bundle) { id } } } }`,
        { account: app.ownerAccount.name, bundle: bundleIdentifier },
      )
    ).account.byName.appleAppIdentifiers[0]?.id ??
    (
      await eas(
        `mutation ($input: AppleAppIdentifierInput!, $account: ID!) { appleAppIdentifier { createAppleAppIdentifier(appleAppIdentifierInput: $input, accountId: $account) { id } } }`,
        { input: { bundleIdentifier, appleTeamId: team.id }, account: app.ownerAccount.id },
      )
    ).appleAppIdentifier.createAppleAppIdentifier.id;

  const easProfileId = (
    await eas(
      `mutation ($input: AppleProvisioningProfileInput!, $account: ID!, $appId: ID!) { appleProvisioningProfile {
        createAppleProvisioningProfile(appleProvisioningProfileInput: $input, accountId: $account, appleAppIdentifierId: $appId) { id }
      } }`,
      {
        input: { appleProvisioningProfile: profile.attributes.profileContent, developerPortalIdentifier: profile.id },
        account: app.ownerAccount.id,
        appId: appIdentifierId,
      },
    )
  ).appleProvisioningProfile.createAppleProvisioningProfile.id;

  const credentialsId =
    current?.id ??
    (
      await eas(
        `mutation ($input: IosAppCredentialsInput!, $app: ID!, $appId: ID!) { iosAppCredentials {
          createIosAppCredentials(iosAppCredentialsInput: $input, appId: $app, appleAppIdentifierId: $appId) { id }
        } }`,
        {
          input: {
            appleTeamId: team.id,
            appStoreConnectApiKeyForSubmissionsId: base.appStoreConnectApiKeyForSubmissions.id,
            pushKeyId: base.pushKey?.id,
          },
          app: app.id,
          appId: appIdentifierId,
        },
      )
    ).iosAppCredentials.createIosAppCredentials.id;

  await eas(
    `mutation ($input: IosAppBuildCredentialsInput!, $credentials: ID!) { iosAppBuildCredentials {
      createIosAppBuildCredentials(iosAppBuildCredentialsInput: $input, iosAppCredentialsId: $credentials) { id }
    } }`,
    {
      input: { iosDistributionType: "AD_HOC", distributionCertificateId: cert.id, provisioningProfileId: easProfileId },
      credentials: credentialsId,
    },
  );
  console.log(`[variant-credentials] EAS: AD_HOC build credentials ready for ${bundleIdentifier}`);
  return true;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = resolveBundleIdentifier();
  const created = await ensureVariantCredentials(target);
  if (!created) console.log(`[variant-credentials] ${target.bundleIdentifier} already has AD_HOC credentials — nothing to do.`);
}
