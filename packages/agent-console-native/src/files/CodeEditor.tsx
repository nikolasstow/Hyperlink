/**
 * A file on the native code editor: a forked Runestone `TextView` fed Shiki
 * tokens. One renderer for viewing and editing — the viewer is just this with
 * `editable={false}`. Tokenising and theme resolution are the same `useCodeTheme`
 * + `tokenizeCode` the chat blocks and previews use, so a file resolves the same
 * colours everywhere.
 *
 * Returns null where the build has no native editor (an older binary); the
 * caller falls back to the web surface. `isCodeEditorNative` says which.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { canApplyChanges, CodeEditorNativeView, type CodeEditorHandle, type EditorTheme, type LineToken } from "../../modules/code-editor";
import type { EditorUpdate, TextRange } from "./liveFile";
import { cachedHighlightSync, type HighlightResult, langFromFilename, tokenizeCode } from "../shikiHighlighter";
import { stickyRanges } from "./stickyRanges";
import { useCodeTheme } from "../useCodeTheme";

/** Matches the chat code blocks and the file previews, so every surface scales alike. */
const FONT_SIZE = 12.5;

/** Re-tokenise no more than this often while typing. */
const RETOKENIZE_MS = 150;

/** Each line's coloured runs as offset ranges (what the native view wants) from
 * Shiki's per-line content tokens. UTF-16 lengths, since JS string length is UTF-16. */
const toLineTokens = (result: HighlightResult): ReadonlyArray<ReadonlyArray<LineToken>> =>
  result.lines.map((line) => {
    let start = 0;
    const out: Array<LineToken> = [];
    for (const token of line) {
      const length = token.content.length;
      if (length > 0) out.push({ start, length, color: token.color, bold: token.bold, italic: token.italic });
      start += length;
    }
    return out;
  });

/** The editor's base colours from the active VS Code theme, with the token
 * background/foreground Shiki already resolved taking precedence. */
const editorThemeOf = (theme: string | ThemeRegistrationRaw, highlight: HighlightResult | undefined): EditorTheme => {
  const colors = typeof theme === "string" ? undefined : theme.colors;
  const background = highlight?.background ?? colors?.["editor.background"];
  const foreground = highlight?.foreground ?? colors?.["editor.foreground"];
  return {
    background,
    foreground,
    gutterBackground: colors?.["editorGutter.background"] ?? background,
    gutterForeground: colors?.["editorLineNumber.foreground"] ?? colors?.["editorLineNumber.activeForeground"],
    currentLine: colors?.["editor.lineHighlightBackground"],
    selection: colors?.["editor.selectionBackground"],
    caret: colors?.["editorCursor.foreground"] ?? foreground,
  };
};

/** What a ref on the editor offers. */
export interface CodeEditorApi {
  /** Take a change made outside (an agent's): applied in place where the
   * build can, else as a whole new text. */
  readonly apply: (update: EditorUpdate) => void;
}

export const CodeEditor = (props: {
  readonly path: string;
  readonly name: string;
  readonly text: string;
  readonly editable: boolean;
  readonly onChangeText?: (text: string) => void;
  /** Lines in conflict, lit until settled. */
  readonly conflicts?: ReadonlyArray<TextRange>;
  readonly ref?: React.Ref<CodeEditorApi>;
  /** Room above it (the transparent header). */
  readonly topInset: number;
  /** Room below it (the bottom bar + safe area), so the last lines aren't hidden under it. */
  readonly bottomInset: number;
  /** How far down the top sticky block fills (header rests here; lines above fill
   * up through the status bar). */
  readonly stickyFill: number;
}): React.ReactElement | null => {
  const theme = useCodeTheme();
  const lang = React.useMemo(() => langFromFilename(props.name), [props.name]);
  // A cached file renders already-coloured on the first frame: peek the in-memory
  // token cache synchronously (warm from a previous open or preload) so there's
  // no flash of uncoloured text before the async tokenise returns.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- first frame only, by design
  const initialHighlight = React.useMemo(() => cachedHighlightSync({ code: props.text, lang, theme }), []);
  const [tokensJson, setTokensJson] = React.useState<string>(() => (initialHighlight === undefined ? "[]" : JSON.stringify(toLineTokens(initialHighlight))));
  const [stickyJson, setStickyJson] = React.useState<string>("[]");
  // Base colours resolve synchronously from the theme (and the cached highlight's
  // exact bg/fg when present) so the editor paints right on the first frame; the
  // async tokenise below only refines them.
  const [editorTheme, setEditorTheme] = React.useState<EditorTheme>(() => editorThemeOf(theme, initialHighlight));
  // The text handed to the native view (it owns the text once mounted), and
  // the text tokenised. Both follow `props.text`; an outside change moves the
  // tokenised text, and the native one only where the build cannot apply a
  // change in place.
  const [nativeText, setNativeText] = React.useState(props.text);
  const [text, setText] = React.useState(props.text);
  React.useEffect(() => {
    setNativeText(props.text);
    setText(props.text);
  }, [props.text]);
  const native = React.useRef<CodeEditorHandle>(null);
  React.useImperativeHandle(
    props.ref,
    () => ({
      apply: (update) => {
        setText(update.text);
        if (canApplyChanges && native.current !== null) {
          void native.current.applyChanges(JSON.stringify(update.changes), update.text.length, JSON.stringify(update.highlights));
          return;
        }
        setNativeText(update.text);
      },
    }),
    [],
  );
  const conflictsJson = React.useMemo(() => JSON.stringify(props.conflicts ?? []), [props.conflicts]);
  // The first tokenise is immediate (no flash); only re-tokenising while typing
  // is debounced.
  const firstRun = React.useRef(true);

  React.useEffect(() => {
    setEditorTheme(editorThemeOf(theme, undefined));
  }, [theme]);

  React.useEffect(() => {
    let alive = true;
    const delay = firstRun.current ? 0 : RETOKENIZE_MS;
    firstRun.current = false;
    const handle = setTimeout(() => {
      void tokenizeCode({ code: text, lang, theme })
        .then((highlight) => {
          if (!alive) return;
          setTokensJson(JSON.stringify(toLineTokens(highlight)));
          setEditorTheme(editorThemeOf(theme, highlight));
        })
        .catch(() => undefined);
      void stickyRanges(text, lang)
        .then((ranges) => {
          if (!alive) return;
          console.log(`[sticky] ${lang}: ${ranges.length} ranges`);
          setStickyJson(JSON.stringify(ranges));
        })
        .catch((error: unknown) => console.warn(`[sticky] ${lang} structure failed`, error));
    }, delay);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [text, lang, theme]);

  if (CodeEditorNativeView === undefined) return null;
  return (
    // Paint the container with the editor background too, so there's no wrong-
    // coloured gap behind the native view before it draws its own.
    <View style={[styles.fill, editorTheme.background === undefined ? null : { backgroundColor: editorTheme.background }]}>
      <CodeEditorNativeView
        ref={native}
        style={styles.fill}
        text={nativeText}
        conflictRangesJson={conflictsJson}
        editable={props.editable}
        tokensJson={tokensJson}
        stickyRangesJson={stickyJson}
        theme={editorTheme}
        topInset={props.topInset}
        bottomInset={props.bottomInset}
        stickyFill={props.stickyFill}
        fontSize={FONT_SIZE}
        showLineNumbers
        wrapLines={false}
        onStickyDebug={(event) => console.log("[sticky-native]", event.nativeEvent)}
        {...(props.onChangeText === undefined ? {} : { onTextChange: (event) => props.onChangeText?.(event.nativeEvent.text) })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
