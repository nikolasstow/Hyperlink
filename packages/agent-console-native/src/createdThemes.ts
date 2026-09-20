/**
 * Themes made on the device, as opposed to the ones extracted from an
 * installed extension.
 *
 * The distinction is the whole reason this module exists: an installed theme is
 * a file inside the server's extension store and is read-only, while a created
 * theme is a document this app owns and can rewrite. Both are the same VS Code
 * format, so everything downstream treats them alike once loaded.
 *
 * Storage is on-device, following the same best-effort AsyncStorage pattern as
 * `sessionCache.ts` and `settings.ts`. Mirroring these to the server's synced
 * `config` document so they follow you between devices is the natural next
 * step and is not built here.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseVsCodeTheme, toThemeDocument, type VsCodeTheme } from "./vscodeTheme";

const STORAGE_KEY = "agent-console-native:createdThemes";

/** A created theme plus the identity the list and routes address it by. */
export interface CreatedTheme {
  readonly id: string;
  readonly theme: VsCodeTheme;
  /** Epoch milliseconds, for ordering the list newest first. */
  readonly updatedAt: number;
}

/**
 * Ids are minted here rather than derived from the name, so renaming a theme
 * does not orphan the route pointing at it.
 */
export const newThemeId = (): string => `theme_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toCreatedTheme = (value: unknown): CreatedTheme | undefined => {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" ? value.id : undefined;
  if (id === undefined) return undefined;
  const theme = parseVsCodeTheme(value.theme, "Untitled");
  if (theme === undefined) return undefined;
  return {
    id,
    theme,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
};

/**
 * Every created theme, newest first. A read that fails or finds nothing is an
 * empty list, which is the truth on a fresh install; a theme row that will not
 * parse is dropped rather than taking the whole list with it.
 */
export const listCreatedThemes = async (): Promise<ReadonlyArray<CreatedTheme>> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  if (raw === null) return [];
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!Array.isArray(parsed)) return [];
  const themes: Array<CreatedTheme> = [];
  for (const entry of parsed) {
    const created = toCreatedTheme(entry);
    if (created !== undefined) themes.push(created);
  }
  return themes.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getCreatedTheme = async (id: string): Promise<CreatedTheme | undefined> =>
  (await listCreatedThemes()).find((created) => created.id === id);

const write = async (themes: ReadonlyArray<CreatedTheme>): Promise<void> => {
  const payload = themes.map((created) => ({
    id: created.id,
    updatedAt: created.updatedAt,
    theme: toThemeDocument(created.theme),
  }));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
};

/** Inserts or replaces one theme, stamping the time the list orders by. */
export const saveCreatedTheme = async (id: string, theme: VsCodeTheme): Promise<CreatedTheme> => {
  const existing = await listCreatedThemes();
  const saved: CreatedTheme = {
    id,
    theme,
    updatedAt: Date.now(),
  };
  await write([saved, ...existing.filter((created) => created.id !== id)]);
  return saved;
};

export const deleteCreatedTheme = async (id: string): Promise<void> => {
  const existing = await listCreatedThemes();
  await write(existing.filter((created) => created.id !== id));
};
