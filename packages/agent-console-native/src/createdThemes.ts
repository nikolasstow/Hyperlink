/**
 * Themes made on the device, as opposed to the ones extracted from an
 * installed extension.
 *
 * The distinction is the whole reason this module exists: an installed theme is
 * a file inside the server's extension store and is read-only, while a created
 * theme is a document this app owns and can rewrite. Both are the same VS Code
 * format, so everything downstream treats them alike once loaded.
 *
 * Storage is on-device, through AsyncStorage. Two rules keep a save from
 * costing someone their work, and both are the reason this is not the
 * best-effort pattern `sessionCache.ts` uses:
 *
 * 1. A row that will not parse is carried through a write untouched. Dropping
 *    it from the list would erase it the next time any other theme was saved.
 * 2. Writes run one at a time. Every write is a read, a change, and a write
 *    back, so two saves in flight would otherwise end with the later read
 *    overwriting the earlier save.
 *
 * A failed write raises rather than resolving quietly, because the caller is a
 * Save button and the person pressing it needs to know.
 *
 * Mirroring these to the server's synced `config` document so they follow you
 * between devices is the natural next step and is not built here.
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
 * What storage holds: the themes this build understands, and the rows it does
 * not. Keeping the second half is what stops a write from deleting a theme
 * written by a build that knew something this one does not.
 */
interface StoredThemes {
  readonly themes: ReadonlyArray<CreatedTheme>;
  readonly unreadable: ReadonlyArray<unknown>;
}

const EMPTY_STORE: StoredThemes = { themes: [], unreadable: [] };

const read = async (): Promise<StoredThemes> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  if (raw === null) return EMPTY_STORE;
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!Array.isArray(parsed)) return EMPTY_STORE;
  const themes: Array<CreatedTheme> = [];
  const unreadable: Array<unknown> = [];
  for (const entry of parsed) {
    const created = toCreatedTheme(entry);
    if (created === undefined) unreadable.push(entry);
    else themes.push(created);
  }
  themes.sort((a, b) => b.updatedAt - a.updatedAt);
  return { themes, unreadable };
};

/**
 * Every created theme, newest first. A read that fails or finds nothing is an
 * empty list, which is the truth on a fresh install.
 */
export const listCreatedThemes = async (): Promise<ReadonlyArray<CreatedTheme>> => (await read()).themes;

export const getCreatedTheme = async (id: string): Promise<CreatedTheme | undefined> =>
  (await listCreatedThemes()).find((created) => created.id === id);

const write = async (stored: StoredThemes): Promise<void> => {
  const payload = [
    ...stored.themes.map((created) => ({
      id: created.id,
      updatedAt: created.updatedAt,
      theme: toThemeDocument(created.theme),
    })),
    ...stored.unreadable,
  ];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

/**
 * One write at a time. Each operation reads the whole list, changes one entry
 * and writes it back, so overlapping operations would lose whichever save
 * landed first. A rejected operation does not stall the ones behind it.
 */
let pending: Promise<unknown> = Promise.resolve();

const serialize = <A>(operation: () => Promise<A>): Promise<A> => {
  const next = pending.then(operation, operation);
  pending = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

/**
 * Inserts or replaces one theme, stamping the time the list orders by. Raises
 * if the write fails, so a Save button can say so instead of implying it
 * worked.
 */
export const saveCreatedTheme = (id: string, theme: VsCodeTheme): Promise<CreatedTheme> =>
  serialize(async () => {
    const stored = await read();
    const saved: CreatedTheme = { id, theme, updatedAt: Date.now() };
    await write({
      themes: [saved, ...stored.themes.filter((created) => created.id !== id)],
      unreadable: stored.unreadable,
    });
    return saved;
  });

export const deleteCreatedTheme = (id: string): Promise<void> =>
  serialize(async () => {
    const stored = await read();
    await write({
      themes: stored.themes.filter((created) => created.id !== id),
      unreadable: stored.unreadable,
    });
  });
