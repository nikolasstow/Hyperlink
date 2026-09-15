/**
 * The app's standard header title for a NATIVE nav bar: the title text in a
 * Liquid Glass capsule, rendered into a `headerTitle` slot (chat, session list,
 * file explorer). The custom-header counterpart is `TitlePill` — both share the
 * design tokens in titlePillStyle.ts.
 *
 * The capsule fits its content, but the width is computed synchronously from the
 * (always-known) title via `titlePillWidth` and applied as an explicit `frame`.
 * The native fit path (`Host matchContents` with no width) was tried and is
 * unreliable here — it resolves via an async round-trip that races with layout
 * and frequently renders the title empty. The width is clamped so it can never
 * reach the nav items; an over-long title truncates (`lineLimit(1)`).
 *
 * @internal
 */
import { HStack, Host, Image, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";
import { PILL_DOT_GAP, PILL_DOT_SIZE, PILL_FONT_SIZE, PILL_HEIGHT, PILL_PAD_H, titlePillWidth } from "./titlePillStyle";

const MIN_WIDTH = 56;
const MAX_WIDTH_RATIO = 0.6;

export const HeaderTitlePill = (props: {
  readonly title: string;
  /** Trailing status dot: omit for no dot. */
  readonly dot?: "connected" | "disconnected";
}): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const hasDot = props.dot !== undefined;
  const maxWidth = Math.round(screenWidth * MAX_WIDTH_RATIO);
  const pillWidth = Math.min(Math.max(titlePillWidth(props.title, hasDot), MIN_WIDTH), maxWidth);

  return (
    <Host style={{ width: pillWidth, height: PILL_HEIGHT }}>
      <HStack
        alignment="center"
        spacing={PILL_DOT_GAP}
        modifiers={[
          frame({ width: pillWidth, height: PILL_HEIGHT }),
          padding({ horizontal: PILL_PAD_H }),
          glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        ]}
      >
        <UIText modifiers={[font({ size: PILL_FONT_SIZE, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>
          {props.title}
        </UIText>
        {hasDot ? (
          <Image
            systemName="circle.fill"
            size={PILL_DOT_SIZE}
            color={props.dot === "connected" ? colors.brand : colors.secondaryLabel}
          />
        ) : null}
      </HStack>
    </Host>
  );
};
