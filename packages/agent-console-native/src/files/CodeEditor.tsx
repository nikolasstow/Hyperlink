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
import { CodeEditorNativeView, type EditorTheme, type LineToken } from "../../modules/code-editor";
import { type HighlightResult, langFromFilename, tokenizeCode } from "../shikiHighlighter";
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

export const CodeEditor = (props: {
  readonly path: string;
  readonly name: string;
  readonly text: string;
  readonly editable: boolean;
  readonly onChangeText?: (text: string) => void;
  /** Room above it (the transparent header). */
  readonly topInset: number;
  /** Room below it (the bottom bar + safe area), so the last lines aren't hidden under it. */
  readonly bottomInset: number;
}): React.ReactElement | null => {
  const theme = useCodeTheme();
  const lang = React.useMemo(() => langFromFilename(props.name), [props.name]);
  const [tokensJson, setTokensJson] = React.useState<string>("[]");
  const [stickyJson, setStickyJson] = React.useState<string>("[]");
  const [editorTheme, setEditorTheme] = React.useState<EditorTheme>({});
  const { text } = props;

  React.useEffect(() => {
    let alive = true;
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
    }, RETOKENIZE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [text, lang, theme]);

  if (CodeEditorNativeView === undefined) return null;
  return (
    <View style={[styles.fill, { paddingTop: props.topInset }]}>
      <CodeEditorNativeView
        style={styles.fill}
        text={props.text}
        editable={props.editable}
        tokensJson={tokensJson}
        stickyRangesJson={stickyJson}
        theme={editorTheme}
        fontSize={FONT_SIZE}
        showLineNumbers
        wrapLines={false}
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
