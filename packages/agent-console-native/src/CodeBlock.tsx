/**
 * Renders a block of code highlighted on-device by Shiki (shikiHighlighter.ts),
 * themed by a VS Code theme. Tokenization is cached (codeCache.ts) — memory +
 * AsyncStorage — so reopening a file or the app, and fast scrolling, render from
 * cache rather than re-tokenizing.
 *
 * Long lines scroll horizontally (no wrap), matching an editor. While the first
 * tokenization resolves, the raw code shows in monospace so nothing flashes.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { tokenizeCode, type HighlightResult } from "./shikiHighlighter";

export const CodeBlock = (props: {
  readonly code: string;
  readonly lang: string;
  /** A bundled theme name or a raw VS Code theme object. */
  readonly theme: string | ThemeRegistrationRaw;
}): React.ReactElement => {
  const [result, setResult] = React.useState<HighlightResult | undefined>(undefined);

  // Re-tokenize only when the inputs actually change; a stable themeName keeps
  // this from firing on unrelated re-renders.
  const themeName = typeof props.theme === "string" ? props.theme : (props.theme.name ?? "custom");
  React.useEffect(() => {
    let cancelled = false;
    void tokenizeCode({ code: props.code, lang: props.lang, theme: props.theme })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [props.code, props.lang, themeName]); // eslint-disable-line react-hooks/exhaustive-deps -- theme keyed by name

  const background = result?.background ?? colors.fillBackground;
  const foreground = result?.foreground ?? colors.label;

  return (
    <View style={[styles.wrap, { backgroundColor: background }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View>
          {result === undefined ? (
            <Text style={[styles.line, { color: foreground }]}>{props.code}</Text>
          ) : (
            result.lines.map((line, i) => (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- lines are positional
              <Text key={i} style={styles.line}>
                {line.length === 0
                  ? " "
                  : line.map((token, j) => (
                      <Text
                        // eslint-disable-next-line @eslint-react/no-array-index-key -- tokens are positional within a line
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
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  scrollContent: {
    padding: 12,
  },
  line: {
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 19,
  },
});
