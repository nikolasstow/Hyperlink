/**
 * Persistent settings — AsyncStorage, not localStorage. Unlike the web app
 * (packages/agent-console), a native app has no "page origin" to resolve a
 * relative API path against (no Vite dev-server proxy either) — it needs an
 * explicit, user-configured server address before it can talk to OpenCode
 * at all. AsyncStorage reads are async (unlike localStorage), so callers
 * need a loading state while this resolves — there's no synchronous
 * equivalent here.
 *
 * Workspace layout prefs:
 * - root folder — discovery base
 * - repo template — where clone/create puts the **main** checkout
 * - worktree template — where “Create new…” puts **linked** worktrees
 * - default worktree — which checkout the composer picks first
 *
 * Existing checkouts are still discovered by scanning; templates only
 * decide where *new* paths are written.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PermissionMode } from "./sessionPermissions";

const SERVER_ADDRESS_KEY = "agent-console-native:serverAddress";
const ROOT_DIR_KEY = "agent-console-native:rootDir";
const REPO_TEMPLATE_KEY = "agent-console-native:repoTemplate";
const WORKTREE_TEMPLATE_KEY = "agent-console-native:worktreeTemplate";
const LAST_MODEL_KEY = "agent-console-native:lastModel";
const DEFAULT_WORKTREE_PREF_KEY = "agent-console-native:defaultWorktreePreference";
const LAST_WORKTREE_BY_REPO_KEY = "agent-console-native:lastWorktreeByRepo";
const REPO_MENU_SORT_KEY = "agent-console-native:repoMenuSort";
const DEFAULT_PERMISSION_MODE_KEY = "agent-console-native:defaultPermissionMode";
const SESSION_PERMISSION_MODES_KEY = "agent-console-native:sessionPermissionModes";
const BACKEND_ADDRESS_KEY = "agent-console-native:backendAddress";
const DUBZ_DETENT_KEY = "agent-console-native:dubzDetent";
/** The vite dev server's port. Same host as opencode in every setup so far,
 * so the backend address is derived rather than asked for — one address to
 * type stays one address to type. */
const DEFAULT_BACKEND_PORT = 5195;

/** Placeholders: `{root}`, `{repo}`. Destination for clone / `git init`
 * (the main checkout). Kept as a *sibling* of linked worktrees under the
 * repo folder — not the repo folder itself — so worktrees never land
 * inside the main working tree. */
export const DEFAULT_REPO_TEMPLATE = "{root}/{repo}/main";

/** Placeholders: `{root}`, `{repo}`, `{name}`. Destination for linked
 * worktrees — sibling of `main`, not nested under it. */
export const DEFAULT_WORKTREE_TEMPLATE = "{root}/{repo}/worktrees/{name}";

/** Which worktree to select when the user picks a repo in the composer. */
export type DefaultWorktreePreference = "main" | "last";

/** Order of repos / other folders inside the Home composer target menu. */
export type RepoMenuSort = "recent" | "alphabetical";

export const resolveRepoPath = (
  rootDir: string,
  repo: string,
  template: string = DEFAULT_REPO_TEMPLATE,
): string => template.replaceAll("{root}", rootDir).replaceAll("{repo}", repo);

export const resolveWorktreePath = (
  rootDir: string,
  repo: string,
  name: string,
  template: string = DEFAULT_WORKTREE_TEMPLATE,
): string =>
  template.replaceAll("{root}", rootDir).replaceAll("{repo}", repo).replaceAll("{name}", name);

export const getServerAddress = async (): Promise<string | undefined> => {
  const value = await AsyncStorage.getItem(SERVER_ADDRESS_KEY);
  return value ?? undefined;
};

export const setServerAddress = (value: string): Promise<void> =>
  AsyncStorage.setItem(SERVER_ADDRESS_KEY, value);

export const clearServerAddress = (): Promise<void> =>
  AsyncStorage.removeItem(SERVER_ADDRESS_KEY);

export const getRootDir = async (): Promise<string | undefined> => {
  const value = await AsyncStorage.getItem(ROOT_DIR_KEY);
  return value ?? undefined;
};

export const setRootDir = (value: string): Promise<void> => AsyncStorage.setItem(ROOT_DIR_KEY, value);

export const getRepoTemplate = async (): Promise<string> => {
  const value = await AsyncStorage.getItem(REPO_TEMPLATE_KEY);
  return value !== null && value.length > 0 ? value : DEFAULT_REPO_TEMPLATE;
};

export const setRepoTemplate = (value: string): Promise<void> =>
  AsyncStorage.setItem(REPO_TEMPLATE_KEY, value.trim().length === 0 ? DEFAULT_REPO_TEMPLATE : value.trim());

export const getWorktreeTemplate = async (): Promise<string> => {
  const value = await AsyncStorage.getItem(WORKTREE_TEMPLATE_KEY);
  return value !== null && value.length > 0 ? value : DEFAULT_WORKTREE_TEMPLATE;
};

export const setWorktreeTemplate = (value: string): Promise<void> =>
  AsyncStorage.setItem(
    WORKTREE_TEMPLATE_KEY,
    value.trim().length === 0 ? DEFAULT_WORKTREE_TEMPLATE : value.trim(),
  );

/** Last model the user picked in a composer — restored on next open. */
export const getLastModel = async (): Promise<{ providerID: string; modelID: string } | undefined> => {
  const raw = await AsyncStorage.getItem(LAST_MODEL_KEY);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const providerID = (parsed as { providerID?: unknown }).providerID;
    const modelID = (parsed as { modelID?: unknown }).modelID;
    if (typeof providerID !== "string" || typeof modelID !== "string") return undefined;
    return { providerID, modelID };
  } catch {
    return undefined;
  }
};

export const setLastModel = (value: { readonly providerID: string; readonly modelID: string }): Promise<void> =>
  AsyncStorage.setItem(LAST_MODEL_KEY, JSON.stringify(value));

/** The Dubz window's last drag detent — a fraction of maxDrag (0 = full, 1 = pill)
 * plus the keyboard height then — so it reopens where it was left, across restarts. */
export const getDubzDetent = async (): Promise<{ frac: number; kbFull: number } | undefined> => {
  const raw = await AsyncStorage.getItem(DUBZ_DETENT_KEY);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const frac = (parsed as { frac?: unknown }).frac;
    const kbFull = (parsed as { kbFull?: unknown }).kbFull;
    if (typeof frac !== "number" || typeof kbFull !== "number") return undefined;
    return { frac, kbFull };
  } catch {
    return undefined;
  }
};

export const setDubzDetent = (value: { readonly frac: number; readonly kbFull: number }): Promise<void> =>
  AsyncStorage.setItem(DUBZ_DETENT_KEY, JSON.stringify(value));

export const getDefaultWorktreePreference = async (): Promise<DefaultWorktreePreference> => {
  const value = await AsyncStorage.getItem(DEFAULT_WORKTREE_PREF_KEY);
  return value === "last" ? "last" : "main";
};

export const setDefaultWorktreePreference = (value: DefaultWorktreePreference): Promise<void> =>
  AsyncStorage.setItem(DEFAULT_WORKTREE_PREF_KEY, value);

export const getRepoMenuSort = async (): Promise<RepoMenuSort> => {
  const value = await AsyncStorage.getItem(REPO_MENU_SORT_KEY);
  return value === "alphabetical" ? "alphabetical" : "recent";
};

export const setRepoMenuSort = (value: RepoMenuSort): Promise<void> =>
  AsyncStorage.setItem(REPO_MENU_SORT_KEY, value);

export const getLastWorktreeByRepo = async (): Promise<Record<string, string>> => {
  const raw = await AsyncStorage.getItem(LAST_WORKTREE_BY_REPO_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
};

export const setLastWorktreeForRepo = async (repo: string, worktreeKey: string): Promise<void> => {
  const current = await getLastWorktreeByRepo();
  await AsyncStorage.setItem(
    LAST_WORKTREE_BY_REPO_KEY,
    JSON.stringify({ ...current, [repo]: worktreeKey }),
  );
};

/** What new sessions start as. "full" unless explicitly changed — an
 * unreadable or unset value falls back to that rather than to the stricter
 * mode, so a storage failure cannot silently start gating every action. */
export const getDefaultPermissionMode = async (): Promise<PermissionMode> => {
  const value = await AsyncStorage.getItem(DEFAULT_PERMISSION_MODE_KEY);
  return value === "ask" ? "ask" : "full";
};

export const setDefaultPermissionMode = (value: PermissionMode): Promise<void> =>
  AsyncStorage.setItem(DEFAULT_PERMISSION_MODE_KEY, value);

/** Per-session overrides, stored as one blob rather than a key each: the
 * whole map is needed at boot anyway, and a single read avoids a multi-get
 * that grows with session count. Unparseable storage yields an empty map —
 * sessions fall back to the default rather than the read throwing at boot. */
export const getSessionPermissionModes = async (): Promise<Record<string, PermissionMode>> => {
  const raw = await AsyncStorage.getItem(SESSION_PERMISSION_MODES_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, PermissionMode] => entry[1] === "full" || entry[1] === "ask"),
    );
  } catch {
    return {};
  }
};

export const setSessionPermissionModes = (value: Record<string, PermissionMode>): Promise<void> =>
  AsyncStorage.setItem(SESSION_PERMISSION_MODES_KEY, JSON.stringify(value));

/** The backend base URL derived from the opencode server address: same host,
 * the dev server's port. Pure — the single source both the sync context value
 * and the async override-aware `getBackendAddress` build on. */
export const deriveBackendAddress = (serverAddress: string): string => {
  try {
    const url = new URL(serverAddress);
    return `${url.protocol}//${url.hostname}:${DEFAULT_BACKEND_PORT}`;
  } catch {
    return serverAddress;
  }
};

/** Backend base URL: an explicit override if set, otherwise the derived host. */
export const getBackendAddress = async (serverAddress: string): Promise<string> => {
  const override = await AsyncStorage.getItem(BACKEND_ADDRESS_KEY);
  if (override !== null && override !== "") return override;
  return deriveBackendAddress(serverAddress);
};

/** The off-vite Effect API server's port (`pnpm serve`), same host as opencode
 * — where extensions + synced config live, distinct from the vite backend. */
const DEFAULT_API_PORT = 5199;

/** Base URL of the Effect API server, derived from the opencode server host. */
export const getApiAddress = (serverAddress: string): string => {
  try {
    const url = new URL(serverAddress);
    return `${url.protocol}//${url.hostname}:${DEFAULT_API_PORT}`;
  } catch {
    return serverAddress;
  }
};

export const setBackendAddress = (value: string): Promise<void> =>
  AsyncStorage.setItem(BACKEND_ADDRESS_KEY, value);

const THEME_KEY = "agent-console-native:theme";

/** The enabled code/IDE theme — an installed VS Code colour theme used for code
 * highlighting. Independent of the app accents: it seeds them when first
 * selected, but changing `primary`/`secondary` afterwards does NOT clear it. */
export type CodeTheme = {
  readonly label: string;
  /** Store-relative theme file, for fetching the full JSON to highlight with.
   * Empty for a device-created theme, which has no file in the extension store
   * and is loaded from local storage by `createdId` instead. */
  readonly file: string;
  /** The accents this theme seeds (for the picker's "theme" anchor). */
  readonly primary: string;
  readonly secondary: string;
  /** Set when the enabled theme is one created on this device — its document is
   * read from `createdThemes` storage rather than fetched from the server. */
  readonly createdId?: string;
};

/** The app's theme. `primary` drives the send button and (as a tint) the user's
 * chat bubble; `secondary` drives accents like the unread dot — both freely
 * editable and INDEPENDENT of `code` (the enabled IDE theme). `codeFont` is the
 * monospace family for code. Persisted on-device and mirrored to the server for
 * multi-device sync. */
export type Theme = {
  readonly primary: string;
  readonly secondary: string;
  readonly code?: CodeTheme;
  readonly codeFont: string;
};

/** Default code font — a guaranteed-present iOS monospace. */
export const DEFAULT_CODE_FONT = "Menlo";

/** Placeholder accent defaults — systemGreen / systemBlue; no code theme (the
 * highlighter falls back to a bundled theme) and the default code font. */
export const DEFAULT_THEME: Theme = {
  primary: "#34C759",
  secondary: "#007AFF",
  codeFont: DEFAULT_CODE_FONT,
};

/** Validate an arbitrary value into a `Theme` (shared by device storage and the
 * server-synced config), or undefined if it isn't one. */
export const parseTheme = (parsed: unknown): Theme | undefined => {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (!("primary" in parsed) || !("secondary" in parsed)) return undefined;
  const { primary, secondary } = parsed;
  if (typeof primary !== "string" || typeof secondary !== "string") return undefined;
  const codeFont = "codeFont" in parsed && typeof parsed.codeFont === "string" ? parsed.codeFont : DEFAULT_CODE_FONT;
  const code = "code" in parsed ? parseCodeTheme(parsed.code) : undefined;
  return { primary, secondary, codeFont, ...(code === undefined ? {} : { code }) };
};

export const getStoredTheme = async (): Promise<Theme | undefined> => {
  const raw = await AsyncStorage.getItem(THEME_KEY);
  if (raw === null || raw === "") return undefined;
  try {
    return parseTheme(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

const parseCodeTheme = (value: unknown): CodeTheme | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("label" in value) || !("file" in value) || !("primary" in value) || !("secondary" in value)) return undefined;
  const { label, file, primary, secondary } = value;
  if (typeof label !== "string" || typeof file !== "string" || typeof primary !== "string" || typeof secondary !== "string") return undefined;
  const createdId = "createdId" in value && typeof value.createdId === "string" ? value.createdId : undefined;
  return { label, file, primary, secondary, ...(createdId === undefined ? {} : { createdId }) };
};

export const setStoredTheme = (value: Theme): Promise<void> =>
  AsyncStorage.setItem(THEME_KEY, JSON.stringify(value));
