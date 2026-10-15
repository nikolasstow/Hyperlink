/**
 * A file as its editor shows it, as an image the editor draws of itself
 * (native `renderPreview`): the text the file opens with, its theme and
 * colours, the code font and size, the same insets and sticky scroll, rested
 * where the file was left. Being the editor's own drawing, a tab's preview
 * matches the open file to the pixel, and zooms into it without a seam.
 *
 * Drawn when a preview is first shown, and again once anything it shows has
 * changed and then stayed still for a moment (a drawing holds the main thread
 * for a tenth of a second or so: not while you scroll or type). Drawings are
 * made one at a time; a file shows its last one meanwhile, and that one is
 * let go once the next is drawn.
 *
 * @internal
 */
import { File } from "expo-file-system";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { canRenderPreviews, renderPreview } from "../../modules/code-editor";
import { useBarCover } from "../dubz/useBarWindow";
import { useInstalledCodeFonts } from "../fonts/useCodeFonts";
import { codeFontSizeOf } from "../settings";
import { langFromFilename, tokenizeCode } from "../shikiHighlighter";
import { textHash } from "../textHash";
import { useTheme } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import { editorThemeOf, tokensJsonOf } from "./CodeEditor";
import { EDITOR_BOTTOM_ROOM, EDITOR_TOP_MARGIN, shownTextOf } from "./editorLayout";
import { pinnable, stickyRanges } from "./stickyRanges";
import { useLiveFile } from "./useLiveFiles";
import { useScrollOffset } from "./useFileScrolls";

/** Drawings by key (everything that went into one), and the last of each
 * file in each layout (`slotOf`). */
const drawn = new Map<string, string>();
const lastOf = new Map<string, { readonly key: string; readonly uri: string }>();

/** How long what a preview shows stays the same before it is drawn again. */
const SETTLE_MS = 1000;

/** The drawing being made: the next waits for it. */
let drawing: Promise<unknown> = Promise.resolve();
const oneAtATime = <A>(draw: () => Promise<A>): Promise<A> => {
  const next = drawing.then(draw, draw);
  drawing = next.catch(() => undefined);
  return next;
};

/** A file in one layout: previews of it laid out otherwise keep their own. */
const slotOf = (path: string, width: number, height: number, top: number): string => [path, width, height, top].join("\u0000");

/** Keeps a file's new drawing and lets its last in the same layout go. */
const keepDrawing = (path: string, slot: string, key: string, uri: string): void => {
  const last = lastOf.get(slot);
  drawn.set(key, uri);
  lastOf.set(slot, { key, uri });
  if (last === undefined || last.uri === uri) return;
  drawn.delete(last.key);
  try {
    const file = new File(last.uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.error(`[files] letting go of an old preview of ${path} failed`, error);
  }
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
      : `preview-${textHash(
          [path, text.length, textHash(text), themeName, fontFamily, installed.has(fontFamily), fontSize, width, height, top, bottom, Math.round(offset.x), Math.round(offset.y), scale].join("\u0000"),
        )}`;
  const slot = slotOf(path, width, height, top);
  const [uri, setUri] = React.useState<string | undefined>(() => (key === undefined ? undefined : drawn.get(key)) ?? lastOf.get(slot)?.uri);

  React.useEffect(() => {
    if (key === undefined || text === undefined || !canRenderPreviews) return undefined;
    const ready = drawn.get(key);
    if (ready !== undefined) {
      setUri(ready);
      return undefined;
    }
    let alive = true;
    const lang = langFromFilename(name);
    const draw = () =>
      Promise.all([tokenizeCode({ code: text, lang, theme, keep: false }), stickyRanges(text, lang)]).then(([highlight, ranges]) =>
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
      );
    // The first drawing at once (a preview is wanted before it is shown);
    // later ones once it has stayed the same a moment.
    const timer = setTimeout(
      () => {
        if (!alive) return;
        oneAtATime(() => (alive ? draw() : Promise.resolve(undefined)))
          .then((image) => {
            if (image === undefined) return;
            keepDrawing(path, slot, key, image);
            if (alive) setUri(image);
          })
          .catch((error: unknown) => console.error(`[files] drawing the preview of ${path} failed`, error));
      },
      lastOf.has(slot) ? SETTLE_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, slot, path, name, text, theme, fontFamily, fontSize, width, height, top, bottom, offset, scale]);
  return uri;
};
