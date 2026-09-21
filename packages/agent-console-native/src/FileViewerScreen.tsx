/**
 * A read-only file view, syntax-highlighted on-device by Shiki
 * (shikiHighlighter.ts) with the app's enabled code theme and font, and a
 * line-number gutter. The file text comes from OUR backend (`/fs/read`).
 *
 * Highlighting is the same tokenizer + cache the chat code blocks and the
 * Appearance preview use, so reopening a file renders from cache. Very large
 * files skip highlighting (a size cap) and render as plain monospace so opening
 * one never blocks. The next phase is twoslash + LSP hovers and tap-to-open
 * from chat — see the file-viewer requirements — and, beyond that, editing.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { runFs } from "./effect/runtime";
import { fsReadText } from "./fsClient";
import type { RootStackParamList } from "./RootNavigator";
import { langFromFilename, tokenizeCode, type HighlightResult } from "./shikiHighlighter";
import { useTheme } from "./theme";
import { useCodeTheme } from "./useCodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "FileViewer">;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

/** Metrics shared by the gutter and the code so their lines stay aligned. */
const FONT_SIZE = 12.5;
const LINE_HEIGHT = 18;

/** Above this, highlighting is skipped — tokenizing a very large file would
 * block the first paint — and the file renders as plain monospace. */
const MAX_HIGHLIGHT_CHARS = 200_000;

const HighlightedFile = (props: {
  readonly text: string;
  readonly lang: string;
  readonly fontFamily: string;
}): React.ReactElement => {
  const theme = useCodeTheme();
  const themeName = typeof theme === "string" ? theme : (theme.name ?? "custom");
  const tooBig = props.text.length > MAX_HIGHLIGHT_CHARS;

  const plainLines = React.useMemo(() => props.text.split("\n"), [props.text]);
  const [result, setResult] = React.useState<HighlightResult | undefined>(undefined);

  React.useEffect(() => {
    if (tooBig) {
      setResult(undefined);
      return;
    }
    let cancelled = false;
    void tokenizeCode({ code: props.text, lang: props.lang, theme })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [props.text, props.lang, themeName, tooBig]); // eslint-disable-line react-hooks/exhaustive-deps -- theme keyed by name

  const foreground = result?.foreground ?? colors.label;
  const lineCount = result?.lines.length ?? plainLines.length;
  // Enough room for the widest line number, plus breathing space each side.
  const gutterWidth = Math.ceil(String(lineCount).length * FONT_SIZE * 0.62) + 20;

  return (
    <View style={styles.row}>
      <View style={[styles.gutter, { width: gutterWidth }]}>
        {Array.from({ length: lineCount }, (_, i) => (
          <Text key={i} style={[styles.gutterText, { fontFamily: props.fontFamily }]}>
            {i + 1}
          </Text>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeContent}>
        <View>
          {result === undefined
            ? plainLines.map((line, i) => (
                <Text key={i} selectable style={[styles.codeLine, { color: foreground, fontFamily: props.fontFamily }]}>
                  {line.length === 0 ? " " : line}
                </Text>
              ))
            : result.lines.map((line, i) => (
                <Text key={i} selectable style={[styles.codeLine, { fontFamily: props.fontFamily }]}>
                  {line.length === 0
                    ? " "
                    : line.map((token, j) => (
                        <Text
                          key={j}
                          style={{
                            color: token.color ?? foreground,
                            fontStyle: token.italic ? "italic" : "normal",
                            fontWeight: token.bold ? "700" : "400",
                          }}
                        >
                          {token.content}
                        </Text>
                      ))}
                </Text>
              ))}
        </View>
      </ScrollView>
    </View>
  );
};

export const FileViewerScreen = (props: Props): React.ReactElement => {
  const { path, name } = props.route.params;
  const { backend } = useAppContext();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const lang = React.useMemo(() => langFromFilename(name), [name]);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void runFs(fsReadText(backend, path))
      .then((text) => {
        if (!alive) return;
        setState(text === undefined ? { kind: "missing" } : { kind: "text", text });
      })
      .catch(() => {
        if (alive) setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [backend, path]);

  return (
    <View style={styles.root}>
      {state.kind === "loading" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : state.kind === "text" ? (
        <ScrollViewMarker style={styles.fill} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
          <ScrollView contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40, paddingHorizontal: 12 }}>
            <HighlightedFile text={state.text} lang={lang} fontFamily={theme.codeFont} />
          </ScrollView>
        </ScrollViewMarker>
      ) : (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>{state.kind === "missing" ? "File not found." : "Couldn't read this file."}</Text>
        </View>
      )}
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: 10,
  },
  gutterText: {
    color: colors.tertiaryLabel,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  },
  codeContent: {
    paddingRight: 16,
  },
  codeLine: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
