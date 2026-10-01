/**
 * Message body markdown — `react-native-marked` via `useMarkdown` so we can
 * render into the chat FlatList without nesting another list. HTML tokens and
 * mostly-HTML payloads go through `react-native-render-html`. Code is
 * monospaced, not Shiki — same scoped cut as ToolCallBubble's dropped
 * highlighting.
 *
 * @internal
 */
import * as React from "react";
import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type ColorValue,
  type TextStyle,
} from "react-native";
import {
  Renderer,
  useMarkdown,
  type MarkedStyles,
  type RendererInterface,
} from "react-native-marked";
import RenderHTML from "react-native-render-html";
import { colors } from "./colors";
import { useTextColors, type TextColors } from "./theme";

/** The space between a message's blocks (paragraphs, lists, code). */
const BLOCK_GAP = 8;

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;

function isMostlyHtml(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<")) return false;
  return HTML_TAG_RE.test(trimmed);
}

/** The markdown styles, their text in the colours for the background.
 * Blocks carry no vertical margin or padding of their own (the library's
 * defaults pad every paragraph 8 above and below): the root spaces them by
 * BLOCK_GAP, so a message is exactly as tall as its text, with nothing extra
 * after its last paragraph. */
const makeMarkdownStyles = (text: TextColors): MarkedStyles => ({
  text: {
    color: text.label,
    fontSize: 16,
    lineHeight: 22,
  },
  paragraph: {
    paddingVertical: 0,
    marginVertical: 0,
  },
  strong: {
    color: text.label,
    fontWeight: "600",
  },
  em: {
    color: text.label,
    fontStyle: "italic",
  },
  link: {
    color: colors.tint,
  },
  h1: {
    color: text.label,
    fontSize: 22,
    fontWeight: "700",
    marginVertical: 0,
  },
  h2: {
    color: text.label,
    fontSize: 20,
    fontWeight: "700",
    marginVertical: 0,
  },
  h3: {
    color: text.label,
    fontSize: 18,
    fontWeight: "600",
    marginVertical: 0,
  },
  h4: {
    color: text.label,
    fontSize: 16,
    fontWeight: "600",
    marginVertical: 0,
  },
  h5: {
    color: text.label,
    fontSize: 15,
    fontWeight: "600",
    marginVertical: 0,
  },
  h6: {
    color: text.secondaryLabel,
    fontSize: 14,
    fontWeight: "600",
    marginVertical: 0,
  },
  codespan: {
    color: text.label,
    fontFamily: "Menlo",
    fontSize: 14,
    backgroundColor: colors.fillBackground,
  },
  code: {
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
    padding: 10,
    marginVertical: 0,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.separator,
    paddingLeft: 10,
    marginVertical: 0,
  },
  list: {
    marginVertical: 0,
  },
  li: {
    color: text.label,
    fontSize: 16,
    lineHeight: 22,
  },
  hr: {
    backgroundColor: colors.separator,
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  table: {
    borderColor: colors.separator,
    marginVertical: 0,
  },
  tableRow: {
    borderColor: colors.separator,
  },
  tableCell: {
    borderColor: colors.separator,
  },
});

const htmlTagsStyles = {
  a: { color: colors.tint },
  code: {
    fontFamily: "Menlo",
    backgroundColor: colors.fillBackground,
  },
  pre: {
    fontFamily: "Menlo",
    backgroundColor: colors.fillBackground,
  },
};

class HtmlAwareRenderer extends Renderer implements RendererInterface {
  #contentWidth: number;
  #textColor: ColorValue;

  constructor(contentWidth: number, textColor: ColorValue) {
    super();
    this.#contentWidth = contentWidth;
    this.#textColor = textColor;
  }

  override html(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (typeof text !== "string") {
      return super.html(text, styles);
    }
    const html = text.trim();
    if (!html || !HTML_TAG_RE.test(html)) {
      return (
        <Text key={this.getKey()} style={styles}>
          {text}
        </Text>
      );
    }
    return (
      <RenderHTML
        key={this.getKey()}
        contentWidth={this.#contentWidth}
        source={{ html }}
        baseStyle={{
          color: this.#textColor,
          fontSize: 16,
          lineHeight: 22,
        }}
        tagsStyles={htmlTagsStyles}
      />
    );
  }
}

export const Markdown = (props: {
  readonly text: string;
  /** The width the text lays out in (its bubble's inside), for HTML. */
  readonly width: number;
}): React.ReactElement | null => {
  const colorScheme = useColorScheme();
  const contentWidth = props.width;
  // Text in the colours for the background (light on a darkish one).
  const textColors = useTextColors();
  const markdownStyles = React.useMemo(() => makeMarkdownStyles(textColors), [textColors]);

  const renderer = React.useMemo(
    () => new HtmlAwareRenderer(contentWidth, textColors.label),
    [contentWidth, textColors.label],
  );

  const elements = useMarkdown(props.text, {
    colorScheme: colorScheme ?? "light",
    styles: markdownStyles,
    renderer,
  });

  if (!props.text.trim()) return null;

  if (isMostlyHtml(props.text)) {
    return (
      <View style={styles.root}>
        <RenderHTML
          contentWidth={contentWidth}
          source={{ html: props.text.trim() }}
          baseStyle={{
            color: textColors.label,
            fontSize: 16,
            lineHeight: 22,
          }}
          tagsStyles={htmlTagsStyles}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {elements.filter(Boolean).map((element, index) => (
        <React.Fragment key={`md-${index}`}>{element}</React.Fragment>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    gap: BLOCK_GAP,
  },
});
