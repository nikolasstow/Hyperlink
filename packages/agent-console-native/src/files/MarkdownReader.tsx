/**
 * A Markdown file, rendered (its read mode; markdownMode.ts). Drawn a section
 * at a time (markdownSections.ts), so as it scrolls it knows the heading at
 * the top and reports the scopes there for the breadcrumbs, as the editor
 * does in write mode.
 *
 * @internal
 */
import * as React from "react";
import { type ColorValue, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Markdown } from "../Markdown";
import { scopesAt } from "./breadcrumbs";
import { lineAtTop, markdownSections } from "./markdownSections";
import { type ScopeSymbol, type StickyRange, stickyRanges } from "./stickyRanges";

/** Its side margins. */
const SIDE = 16;

export const MarkdownReader = (props: {
  readonly text: string;
  /** Room above the text (the header); a section is at the top once it
   * reaches the header's bottom. */
  readonly topInset: number;
  readonly bottomInset: number;
  readonly background: ColorValue;
  readonly onScopes?: (scopes: ReadonlyArray<ScopeSymbol>, onward: boolean) => void;
}): React.ReactElement => {
  const { width } = useWindowDimensions();
  const { text, topInset, onScopes } = props;
  const [ranges, setRanges] = React.useState<ReadonlyArray<StickyRange>>([]);
  React.useEffect(() => {
    let cancelled = false;
    stickyRanges(text, "markdown").then(
      (next) => {
        if (!cancelled) setRanges(next);
      },
      (error: unknown) => console.error("[markdown] reading the headings failed", error),
    );
    return () => {
      cancelled = true;
    };
  }, [text]);
  const sections = React.useMemo(() => markdownSections(text, ranges), [text, ranges]);

  // Each section's top in the content, as laid out; the scroll offset; and
  // what was last reported, so only a change is.
  const tops = React.useRef<Array<number | undefined>>([]);
  const offset = React.useRef(0);
  const reported = React.useRef<{ readonly key: string; readonly line: number } | undefined>(undefined);
  const report = React.useCallback(() => {
    const line = lineAtTop(sections, tops.current, offset.current + topInset);
    const scopes = scopesAt(ranges, line);
    const key = scopes.map((scope) => `${scope.kind} ${scope.name}`).join("\n");
    if (key === reported.current?.key) return;
    const onward = line >= (reported.current?.line ?? 0);
    reported.current = { key, line };
    onScopes?.(scopes, onward);
  }, [sections, ranges, topInset, onScopes]);
  React.useEffect(() => {
    tops.current = [];
  }, [sections]);

  return (
    <ScrollView
      style={[StyleSheet.absoluteFill, { backgroundColor: props.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topInset, paddingBottom: props.bottomInset }]}
      scrollEventThrottle={32}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y;
        report();
      }}
    >
      {sections.map((section, index) => (
        <View
          key={`${section.line}:${index}`}
          onLayout={(event) => {
            tops.current[index] = event.nativeEvent.layout.y;
            report();
          }}
        >
          <Markdown text={section.text} width={width - SIDE * 2} />
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SIDE,
  },
});
