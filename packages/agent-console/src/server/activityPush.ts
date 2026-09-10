/**
 * ActivityKit (Live Activity) push updates over raw APNs.
 *
 * A Live Activity can only be updated/ended while the app is suspended via an
 * ActivityKit push — Expo's push service can't do this (it targets device
 * tokens, not the per-activity push token), so this talks to APNs directly:
 * HTTP/2 (`node:http2`, which APNs requires) + a token-based JWT (ES256, signed
 * with the account's `.p8` APNs auth key via `node:crypto`).
 *
 * The auth key is auto-discovered: drop the `AuthKey_<KeyID>.p8` Apple gives you
 * into `.agent-console/` and the Key ID is read from the filename. If it's
 * absent, everything here no-ops (regular notifications are unaffected).
 *
 * ON-DEVICE VERIFICATION (can't be tested off-device):
 * - Host: a dev/EAS-development build uses the APNs SANDBOX; a production build
 *   uses production. Defaults to sandbox; override with AGENT_CONSOLE_APNS_HOST.
 * - `content-state.startedAt` is a Swift `Date`, decoded by ActivityKit as
 *   seconds since 2001-01-01 (Foundation reference date) — encoded here as
 *   `unixMs/1000 - 978307200`. The JSON keys must match SessionActivityAttributes
 *   .ContentState exactly (status, action, messageCount, startedAt).
 *
 * @internal
 */
import { createSign } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { connect as http2Connect } from "node:http2";
import { resolve } from "node:path";

const TEAM_ID = "669Y72A3D7";
const BUNDLE = "com.nikolasstow.agentconsolenative";
const SANDBOX_HOST = "api.sandbox.push.apple.com";
const PROD_HOST = "api.push.apple.com";
/** The ActivityKit push token's environment follows the app's `aps-environment`
 * entitlement. EAS internal/ad-hoc builds sign with a distribution profile, so
 * the token is a PRODUCTION token — hence production is tried first. A wrong
 * environment surfaces two ways, depending on which side mismatches: a
 * `400 BadDeviceToken` (token is for the other env) or a
 * `403 BadEnvironmentKeyInToken` (the .p8 auth key is scoped to the other env);
 * either makes us fall back to the other host, and the one that works is then
 * remembered. Pin explicitly with `AGENT_CONSOLE_APNS_HOST` to skip the probe. */
const HOST_OVERRIDE = process.env.AGENT_CONSOLE_APNS_HOST;
let workingHost: string | undefined = HOST_OVERRIDE;
const hostsToTry = (): ReadonlyArray<string> =>
  workingHost !== undefined ? [workingHost] : [PROD_HOST, SANDBOX_HOST];
/** An APNs response that means "wrong environment", so try the other host. */
const isWrongEnvironment = (status: number, body: string): boolean =>
  (status === 400 && body.includes("BadDeviceToken")) || (status === 403 && body.includes("BadEnvironmentKeyInToken"));
const APNS_TOPIC = `${BUNDLE}.push-type.liveactivity`;
/** Foundation reference date (2001-01-01) in unix seconds — Swift `Date`s in the
 * content-state are encoded relative to this. */
const REFERENCE_DATE = 978_307_200;
/** JWT is valid ~1h; refresh well inside that. */
const JWT_TTL_MS = 50 * 60 * 1000;

const base64url = (input: Buffer | string): string =>
  (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");

type AuthKey = { readonly keyId: string; readonly pem: string };

let authKey: AuthKey | null | undefined;

/** Find and load the `.p8` once. `null` = none present (feature off). */
const loadAuthKey = (): AuthKey | null => {
  if (authKey !== undefined) return authKey;
  try {
    const dir = resolve(process.env.AGENT_CONSOLE_FILES_ROOT ?? process.cwd(), ".agent-console");
    const file = readdirSync(dir).find((name) => /^AuthKey_.+\.p8$/.test(name));
    const keyId = file === undefined ? undefined : /^AuthKey_(.+)\.p8$/.exec(file)?.[1];
    if (file === undefined || keyId === undefined) {
      authKey = null;
    } else {
      authKey = { keyId, pem: readFileSync(resolve(dir, file), "utf8") };
    }
  } catch {
    authKey = null;
  }
  return authKey;
};

export const activityPushConfigured = (): boolean => loadAuthKey() !== null;

let cachedJwt: { readonly token: string; readonly at: number } | undefined;

const signJwt = (key: AuthKey): string => {
  if (cachedJwt !== undefined && Date.now() - cachedJwt.at < JWT_TTL_MS) return cachedJwt.token;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: key.keyId }));
  const payload = base64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${payload}`;
  // ES256 needs the raw r||s signature (JOSE), not DER — `dsaEncoding` gives that.
  const signature = createSign("SHA256").update(signingInput).sign({ key: key.pem, dsaEncoding: "ieee-p1363" });
  const token = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token, at: Date.now() };
  return token;
};

/** sessionID → the activity's current APNs push token. */
const activityTokens = new Map<string, string>();

export const registerActivityToken = (sessionID: string, token: string): void => {
  activityTokens.set(sessionID, token);
};

export const removeActivityToken = (sessionID: string): void => {
  activityTokens.delete(sessionID);
};

export type ActivityState = {
  readonly status: "working" | "done" | "error";
  readonly action: string;
  readonly messageCount: number;
  /** Run start (unix ms); kept stable across updates so the on-device timer
   * doesn't reset. */
  readonly startedAtMs: number;
};

const contentState = (state: ActivityState): Record<string, unknown> => ({
  status: state.status,
  action: state.action,
  messageCount: state.messageCount,
  startedAt: state.startedAtMs / 1000 - REFERENCE_DATE,
});

type PostResult = { readonly status: number; readonly body: string };

const postToHost = (host: string, key: AuthKey, token: string, body: string): Promise<PostResult> =>
  new Promise<PostResult>((resolvePromise) => {
    const clientSession = http2Connect(`https://${host}`);
    clientSession.on("error", () => {
      clientSession.close();
      resolvePromise({ status: 0, body: "connection error" });
    });
    const req = clientSession.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${signJwt(key)}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let responseBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      clientSession.close();
      resolvePromise({ status, body: responseBody });
    });
    req.on("error", () => {
      clientSession.close();
      resolvePromise({ status: 0, body: "request error" });
    });
    req.end(body);
  });

/** Drops a token that APNs has rejected as dead, from every session holding it. */
const dropToken = (token: string): void => {
  for (const [sid, tok] of activityTokens) if (tok === token) activityTokens.delete(sid);
};

const post = async (token: string, payload: Record<string, unknown>): Promise<void> => {
  const key = loadAuthKey();
  if (key === null) return;
  const body = JSON.stringify(payload);

  const hosts = hostsToTry();
  for (let i = 0; i < hosts.length; i += 1) {
    const host = hosts[i];
    const { status, body: responseBody } = await postToHost(host, key, token, body);
    if (status === 200) {
      // Lock onto the environment this device's tokens actually belong to, so
      // subsequent sends skip the probe.
      workingHost = host;
      console.info("[activity-push] ok", host);
      return;
    }
    // A wrong-environment rejection (token OR key) just means the other host is
    // the right one — try it before giving up.
    if (isWrongEnvironment(status, responseBody) && i < hosts.length - 1) {
      console.warn("[activity-push]", status, responseBody, `(${host}) — retrying other environment`);
      continue;
    }
    console.warn("[activity-push]", status, responseBody, `(${host})`);
    // Drop only a genuinely dead TOKEN (gone / bad device token). A
    // BadEnvironmentKeyInToken is a key problem, not a dead token, so keep it.
    if (status === 410 || responseBody.includes("BadDeviceToken")) dropToken(token);
    return;
  }
};

/** Update a session's Live Activity (no-op if it has no registered token). */
export const sendActivityUpdate = async (sessionID: string, state: ActivityState): Promise<void> => {
  const token = activityTokens.get(sessionID);
  if (token === undefined) return;
  await post(token, {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "update",
      "content-state": contentState(state),
      "stale-date": Math.floor(Date.now() / 1000) + 15 * 60,
    },
  });
};

/** End a session's Live Activity (left on screen briefly), then forget it. */
export const sendActivityEnd = async (sessionID: string, state: ActivityState): Promise<void> => {
  const token = activityTokens.get(sessionID);
  if (token === undefined) return;
  await post(token, {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "end",
      "content-state": contentState(state),
      "dismissal-date": Math.floor(Date.now() / 1000) + 30,
    },
  });
  activityTokens.delete(sessionID);
};
