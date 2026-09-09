/**
 * Live Activity control.
 *
 * iOS only, and only on a build that contains the native module — every entry
 * point degrades to a no-op rather than throwing, so a session behaves
 * normally on a binary without it.
 *
 * Loaded with `requireOptionalNativeModule`, not a static import: a missing
 * native module must not take down the bundle, and a dynamic `import()` in
 * React Native fetches an async chunk and fails with
 * "Expected HMRClient.setup() call at startup" regardless of whether the
 * module exists.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LiveActivityNative = {
  readonly isSupported: () => boolean;
  readonly start: (
    sessionID: string,
    repo: string,
    worktree: string,
    title: string,
    action: string,
  ) => Promise<string | null>;
  readonly update: (sessionID: string, status: string, action: string, messageCount: number) => Promise<boolean>;
  readonly end: (sessionID: string, status: string) => Promise<boolean>;
  readonly endAll: () => Promise<number>;
  readonly setServerConfig: (url: string, password: string | null) => boolean;
  readonly addListener: (
    event: "onLiveActivityPushToken",
    listener: (payload: { readonly sessionID: string; readonly token: string }) => void,
  ) => { readonly remove: () => void };
};

const native =
  Platform.OS === "ios" ? requireOptionalNativeModule<LiveActivityNative>("LiveActivity") : null;

export const liveActivitySupported = (): boolean => {
  if (native === null) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
};

/**
 * Publishes the opencode server address to the app group so the app's
 * extensions — the Live Activity's Stop button and the Intents reply handler —
 * can reach it without launching the app. Best-effort and a no-op on a binary
 * without the native module. `url` must be the opencode base (what
 * `/session/{id}/…` is relative to).
 */
export const setExtensionServerConfig = (url: string): void => {
  if (native === null) return;
  try {
    native.setServerConfig(url, null);
  } catch {
    // Extensions degrade to no-ops without it; not worth surfacing.
  }
};

export const startLiveActivity = async (input: {
  readonly sessionID: string;
  readonly repo: string;
  readonly worktree: string;
  readonly title: string;
  readonly action: string;
}): Promise<void> => {
  if (native === null) return;
  await native
    .start(input.sessionID, input.repo, input.worktree, input.title, input.action)
    .catch(() => null);
};

export const updateLiveActivity = async (input: {
  readonly sessionID: string;
  readonly status: "working" | "done" | "error";
  readonly action: string;
  readonly messageCount: number;
}): Promise<void> => {
  if (native === null) return;
  await native.update(input.sessionID, input.status, input.action, input.messageCount).catch(() => false);
};

export const endLiveActivity = async (sessionID: string, status: "done" | "error"): Promise<void> => {
  if (native === null) return;
  await native.end(sessionID, status).catch(() => false);
};

export const endAllLiveActivities = async (): Promise<void> => {
  if (native === null) return;
  await native.endAll().catch(() => 0);
};

/**
 * Subscribe to ActivityKit push tokens (fired when a Live Activity starts, and
 * on rotation). The app forwards these to the server, which then updates/ends
 * the activity via raw APNs while the phone is locked. Returns an unsubscribe.
 */
export const subscribeActivityPushTokens = (handler: (sessionID: string, token: string) => void): (() => void) => {
  if (native === null) return () => {};
  const subscription = native.addListener("onLiveActivityPushToken", (payload) => handler(payload.sessionID, payload.token));
  return () => subscription.remove();
};
