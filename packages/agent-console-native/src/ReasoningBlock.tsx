/**
 * The agent's reasoning, inline in the transcript.
 *
 * Open/closed is not decided here: `useCollapsible` gives the transcript a
 * single auto-expanded item, the newest one, so a finished chain of thought
 * folds away when the next tool call or reasoning block starts. A tap pins it.
 *
 * Styled as secondary text rather than in `ToolCallBubble`'s filled card:
 * reasoning is prose, and a tinted box around a paragraph reads as a code
 * block. The left rule carries the "this is an aside" signal instead.
 *
 * @internal
 */
import * as React from "react";
import { GlassView } from "expo-glass-effect";
import { StyleSheet, Text, TouchableOpacity, useColorScheme } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { ChatReasoning } from "./chat/model";
import { colors } from "./colors";
import { useCollapsible } from "./CollapsibleParts";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

/** Matches the composer's expand timing — fast enough not to feel like
 * waiting, slow enough to read as motion. */
const COLLAPSE_MS = 180;
/** Shorter on the way out: a panel that lingers while closing feels stuck. */
const EXIT_MS = 120;

/** Seconds, rounded — sub-second precision is noise at this size. */
const durationLabel = (time: ChatReasoning["time"]): string | undefined => {
  if (time?.end === undefined) return undefined;
  const seconds = Math.max(0, Math.round((time.end - time.start) / 1000));
  return seconds < 1 ? "Thought for a moment" : `Thought for ${seconds}s`;
};

export const ReasoningBlock = (props: { readonly part: ChatReasoning }): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { part } = props;
  const { open, toggle } = useCollapsible(part.id);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  // Nothing to show for an empty block — reasoning parts can be created
  // before any text arrives.
  if (part.text.trim() === "") return null;

  const label = durationLabel(part.time) ?? "Thinking…";

  return (
    <Animated.View style={styles.root} layout={LinearTransition.duration(COLLAPSE_MS)}>
      {/* A glass card, as the tool calls are: rounded on itself behind the
       * content; nothing clips it. */}
      <GlassView style={[StyleSheet.absoluteFill, styles.glass]} glassEffectStyle="regular" colorScheme={scheme} />
      <TouchableOpacity style={styles.header} activeOpacity={0.6} onPress={toggle}>
        <SystemIcon name="brain" size={13} color={textColors.secondaryLabel} />
        <Text style={styles.label}>{label}</Text>
        <SystemIcon name={open ? "chevron.up" : "chevron.down"} size={12} color={textColors.secondaryLabel} />
      </TouchableOpacity>
      {open ? (
        <Animated.View
          style={styles.body}
          entering={FadeIn.duration(COLLAPSE_MS)}
          exiting={FadeOut.duration(EXIT_MS)}
        >
          <Text style={styles.text} selectable>
            {part.text}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    marginTop: 8,
  },
  glass: {
    borderRadius: 10,
  },
  // The tool call card's padding, so the two read as one kind of card.
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    flex: 1,
    color: text.secondaryLabel,
    fontSize: 13,
    fontWeight: "500",
  },
  body: {
    borderLeftWidth: 2,
    borderLeftColor: colors.separator,
    paddingLeft: 10,
    paddingVertical: 2,
    marginHorizontal: 10,
    marginBottom: 10,
  },
  text: {
    color: text.secondaryLabel,
    fontSize: 14,
    lineHeight: 20,
  },
});
