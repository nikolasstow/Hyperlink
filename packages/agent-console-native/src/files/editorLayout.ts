/**
 * Where a file's editor sits on its page, and the text it opens with: one
 * place for the open editor (FileView) and the pictures of it (filePreview),
 * so a preview is drawn exactly as the file opens.
 *
 * @internal
 */
import { getFileEditSync } from "./fileEdits";
import { getFileTextSync } from "./fileTextCache";
import { liveFileNow } from "./useLiveFiles";

/** Room between the header and the code's first line. */
export const EDITOR_TOP_MARGIN = 24;
/** Room between the code's last line and what covers the page's bottom. */
export const EDITOR_BOTTOM_ROOM = 20;

/** The text a file opens with, offline-first: the hub's live text, else a
 * pending local edit, else the cached disk text. */
export const shownTextOf = (path: string): string | undefined => liveFileNow(path)?.text ?? getFileEditSync(path) ?? getFileTextSync(path);
