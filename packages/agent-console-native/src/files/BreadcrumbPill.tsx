/**
 * The file page's top pill: where you are in the file, as VS Code's
 * breadcrumbs (breadcrumbs.ts) — the path from the worktree, then the scopes
 * the current line is in, `›` between. It fills the room the top bar gives it
 * and shows the end that fits, cut at the front.
 *
 * Glass as its neighbours (the back and more buttons); the text is SwiftUI,
 * laid out in the box the bar sets — nothing measured.
 *
 * @internal
 */
import { Host, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, lineLimit, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { useTextColors } from "../theme";

/** Room between the text and the pill's ends. */
const PAD_H = 16;
/** SwiftUI's `.infinity`, for a frame that fills the box. */
const FILL = 100000;

export const BreadcrumbPill = (props: { readonly crumbs: ReadonlyArray<string> }): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={styles.shadow} accessibilityRole="header" accessibilityLabel={props.crumbs.join(", ")}>
      <GlassView style={styles.glass} glassEffectStyle="regular" colorScheme={scheme} />
      <Host
        style={StyleSheet.absoluteFill}
        // Ignores the safe area: otherwise SwiftUI pads it as it slides under
        // the status bar, and it stays behind.
        ignoreSafeArea="all"
      >
        <UIText
          modifiers={[
            font({ size: 15, weight: "medium" }),
            foregroundStyle(textColors.label),
            lineLimit(1),
            truncationMode("head"),
            padding({ horizontal: PAD_H }),
            frame({ maxWidth: FILL, maxHeight: FILL, alignment: "leading" }),
          ]}
        >
          {props.crumbs.flatMap((crumb, index) => [
            ...(index === 0
              ? []
              : [
                  <UIText key={`${index}›`} modifiers={[foregroundStyle(textColors.tertiaryLabel)]}>
                    {" › "}
                  </UIText>,
                ]),
            <UIText key={`${index}`}>{crumb}</UIText>,
          ])}
        </UIText>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  shadow: {
    flex: 1,
    height: HOME_HEADER_HEIGHT,
    borderRadius: HOME_HEADER_HEIGHT / 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  glass: {
    ...StyleSheet.absoluteFill,
    borderRadius: HOME_HEADER_HEIGHT / 2,
  },
});
