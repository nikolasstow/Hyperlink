/**
 * Permission asks, per session.
 *
 * The server can pause a run to ask before a tool acts: it emits
 * `permission.asked` and waits for a reply. Unanswered, the run stops
 * mid-turn, looking identical to a slow model (sessions/SessionWatch.ts
 * answers or shows them).
 *
 * Default is `full`: asks are answered `once` automatically, so an agent has
 * full control and never stalls. `ask` hands each request to the UI instead.
 * Set per session on its Session Settings page.
 *
 * `once` rather than `always` even on auto-approve — `always` writes a saved
 * rule server-side that outlives this session and applies beyond it, which is
 * not what a per-session toggle should silently do.
 *
 * Both the per-session choice and the default for new sessions persist across
 * launches, so a session set to ask stays that way and one set to allow all
 * does not have to be re-approved every launch.
 *
 * @internal
 */
import { setSessionPermissionModes } from "./settings";

export type PermissionMode = "full" | "ask";

const modes = new Map<string, PermissionMode>();

/** What a session with no explicit choice uses. Held here rather than read
 * from storage on demand because the event handler that needs it runs inside
 * the stream loop, where an async read would race the reply. App.tsx primes
 * it at boot from `settings.getDefaultPermissionMode`. */
let defaultMode: PermissionMode = "full";

export const primeDefaultPermissionMode = (mode: PermissionMode): void => {
  defaultMode = mode;
};

export const getDefaultPermissionModeSync = (): PermissionMode => defaultMode;

export const getPermissionMode = (sessionID: string): PermissionMode => modes.get(sessionID) ?? defaultMode;

export const setPermissionMode = (sessionID: string, mode: PermissionMode): void => {
  modes.set(sessionID, mode);
  // Write-through, fire and forget: the in-memory map is the source of truth
  // for this launch, and a failed write only costs the choice on next launch.
  void setSessionPermissionModes(Object.fromEntries(modes));
};

/** Restores saved per-session choices. Called once at boot, before any
 * session opens — see App.tsx. */
export const primeSessionPermissionModes = (saved: Record<string, PermissionMode>): void => {
  for (const [sessionID, mode] of Object.entries(saved)) modes.set(sessionID, mode);
};
