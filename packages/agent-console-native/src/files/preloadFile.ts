/**
 * Warm the text + token caches for a file so a later tap opens it instantly and
 * already coloured — the "preload at open/foreground, tap only renders" rule.
 * Best-effort: a failure just means that open pays the usual cost.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";
import { runFs } from "../effect/runtime";
import { fsReadText } from "../fsClient";
import { langFromFilename, tokenizeCode } from "../shikiHighlighter";
import { getFileTextSync, setFileText } from "./fileTextCache";

export const preloadFile = async (backend: string, path: string, name: string, theme: string | ThemeRegistrationRaw): Promise<void> => {
  try {
    const text = getFileTextSync(path) ?? (await runFs(fsReadText(backend, path)));
    if (text === undefined) return;
    setFileText(path, text);
    // Warms the in-memory token cache so the editor's synchronous peek hits.
    await tokenizeCode({ code: text, lang: langFromFilename(name), theme });
  } catch {
    // Best-effort — the open will fetch/tokenise normally if this didn't finish.
  }
};
