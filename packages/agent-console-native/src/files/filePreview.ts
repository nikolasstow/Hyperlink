/**
 * A file as its editor shows it, as an image the editor draws of itself
 * (native `renderPreview`): the text the file opens with, its theme and
 * colours, the code font and size, the same insets and sticky scroll, rested
 * where the file was left. Being the editor's own drawing, a tab's preview
 * matches the open file to the pixel, and zooms into it without a seam.
 *
 * Drawn when a preview is first shown and again whenever anything it shows
 * changes; each drawing is kept (by everything that went into it), and a file
 * shows its last one meanwhile.
 *
 * @internal
 */
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { canRenderPreviews, renderPreview } from "../../modules/code-editor";
import { useBarCover } from "../dubz/useBarWindow";
import { useInstalledCodeFonts } from "../fonts/useCodeFonts";
import { codeFontSizeOf } from "../settings";
import { langFromFilename, tokenizeCode } from "../shikiHighlighter";
import { useTheme } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import { editorThemeOf, tokensJsonOf } from "./CodeEditor";
import { EDITOR_BOTTOM_ROOM, EDITOR_TOP_MARGIN, shownTextOf } from "./editorLayout";
import { pinnable, stickyRanges } from "./stickyRanges";
import { useLiveFile } from "./useLiveFiles";
import { useScrollOffset } from "./useFileScrolls";

/** Drawings by key (everything that went into one), and each file's last. */
const drawn = new Map<string, string>();
const lastOf = new Map<string, string>();

/** FNV-1a, for a short name from long inputs. */
const hashOf = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * The image of `path` as its editor shows it under a header `topInset` tall;
 * undefined until first drawn (and on a build that cannot draw). `fetched` is
 * its text read from the server, for a file never opened here.
 */
export const useFilePreview = (path: string, name: string, topInset: number, fetched: string | undefined): string | undefined => {
  const live = useLiveFile(path);
  const text = live?.text ?? shownTextOf(path) ?? fetched;
  const offset = useScrollOffset(path);
  const theme = useCodeTheme();
  const { theme: appTheme } = useTheme();
  const installed = useInstalledCodeFonts();
  const { width, height, scale } = useWindowDimensions();
  const top = topInset + EDITOR_TOP_MARGIN;
  const bottom = useBarCover() + EDITOR_BOTTOM_ROOM;
  const fontFamily = appTheme.codeFont;
  const fontSize = codeFontSizeOf(appTheme);
  const themeName = typeof theme === "string" ? theme : (theme.name ?? "custom");
  const key =
    text === undefined
      ? undefined
      : `preview-${hashOf(
          [path, text.length, hashOf(text), themeName, fontFamily, installed.has(fontFamily), fontSize, width, height, top, bottom, Math.round(offset.x), Math.round(offset.y), scale].join("\u0000"),
        )}`;
  const [uri, setUri] = React.useState<string | undefined>(() => (key === undefined ? undefined : drawn.get(key)) ?? lastOf.get(path));

  React.useEffect(() => {
    if (key === undefined || text === undefined || !canRenderPreviews) return undefined;
    const ready = drawn.get(key);
    if (ready !== undefined) {
      setUri(ready);
      return undefined;
    }
    let alive = true;
    const lang = langFromFilename(name);
    Promise.all([tokenizeCode({ code: text, lang, theme }), stickyRanges(text, lang)])
      .then(([highlight, ranges]) =>
        renderPreview({
          key,
          text,
          tokensJson: tokensJsonOf(text, highlight),
          stickyRangesJson: JSON.stringify(pinnable(ranges)),
          theme: editorThemeOf(theme, highlight),
          fontFamily,
          fontSize,
          width,
          height,
          topInset: top,
          bottomInset: bottom,
          stickyFill: top,
          offset: offset.y,
          offsetX: offset.x,
          scale,
        }),
      )
      .then((image) => {
        if (image === undefined) return;
        drawn.set(key, image);
        lastOf.set(path, image);
        if (alive) setUri(image);
      })
      .catch((error: unknown) => console.error(`[files] drawing the preview of ${path} failed`, error));
    return () => {
      alive = false;
    };
  }, [key, path, name, text, theme, fontFamily, fontSize, width, height, top, bottom, offset, scale]);
  return uri;
};
