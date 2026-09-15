/**
 * The app's standard header title for a NATIVE nav bar: the title text in a
 * Liquid Glass capsule, rendered into a `headerTitle` slot (chat, session list,
 * file explorer). The custom-header counterpart is `TitlePill` — both share the
 * design tokens in titlePillStyle.ts.
 *
 * The capsule fits its content natively: `Host matchContents` sizes the Host to
 * its SwiftUI content, and the HStack carries only a height `frame` (no width),
 * so the capsule hugs the text (plus the optional dot). An over-long title
 * truncates (`lineLimit(1)`) within whatever width the nav bar leaves between
 * its items.
 *
 * @internal
 */
import { HStack, Host, Image, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { colors } from "./colors";
import { PILL_DOT_GAP, PILL_DOT_SIZE, PILL_FONT_SIZE, PILL_HEIGHT, PILL_PAD_H } from "./titlePillStyle";

export const HeaderTitlePill = (props: {
  readonly title: string;
  /** Trailing status dot: omit for no dot. */
  readonly dot?: "connected" | "disconnected";
}): React.ReactElement => {
  const hasDot = props.dot !== undefined;
  return (
    <Host matchContents style={{ height: PILL_HEIGHT }}>
      <HStack
        alignment="center"
        spacing={PILL_DOT_GAP}
        modifiers={[
          frame({ height: PILL_HEIGHT }),
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
