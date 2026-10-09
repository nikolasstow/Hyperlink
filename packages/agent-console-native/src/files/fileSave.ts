/**
 * A tiny registry of the open file views' "save now" callbacks, keyed by path,
 * so a screen's menu (the Files 3-dot) can trigger a manual/permanent save
 * without owning the editor's state — the FileView for that path registers its
 * save here while mounted.
 *
 * @internal
 */
const saves = new Map<string, () => void>();

export const registerSave = (path: string, save: () => void): void => {
  saves.set(path, save);
};

export const unregisterSave = (path: string, save: () => void): void => {
  if (saves.get(path) === save) saves.delete(path);
};

/** Trigger a manual save of the file at `path`, if a view for it is open. */
export const saveFileNow = (path: string): void => {
  saves.get(path)?.();
};
