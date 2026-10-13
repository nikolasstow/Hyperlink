/**
 * The file page's top pill: where you are in the file, as VS Code's
 * breadcrumbs (breadcrumbs.ts) — the path from the worktree, then the scopes
 * the current line is in, each with its kind's icon in the theme's colour
 * (symbolLooks.ts), chevrons between. It fills the room the top bar gives it;
 * longer than that, it scrolls, resting at the end (where you are).
 *
 * Glass as its neighbours (the back and more buttons); the crumbs are one
 * SwiftUI region, laid out in the box the bar sets — nothing measured.
 *
 * @internal
 */
import { Host, HStack, Image, ScrollView, Text as UIText } from "@expo/ui/swift-ui";
import { clipShape, defaultScrollAnchorForRole, font, foregroundStyle, frame, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { useTextColors } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import type { ScopeSymbol } from "./stickyRanges";
import { crumbColorOf, symbolLookOf } from "./symbolLooks";

/** Room between the crumbs and the pill's ends. */
const PAD_H = 16;
/** SwiftUI's `.infinity`, for a frame that fills the box. */
const FILL = 100000;
const TEXT_SIZE = 15;
const ICON_SIZE = 13;
const CHEVRON_SIZE = 10;

export const BreadcrumbPill = (props: { readonly path: ReadonlyArray<string>; readonly symbols: ReadonlyArray<ScopeSymbol> }): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = useCodeTheme();
  const colors = typeof theme === "string" ? undefined : theme.colors;
  const text = crumbColorOf(colors, textColors.label);
  const crumbs = [
    ...props.path.map((name) => ({ name, look: undefined })),
    ...props.symbols.map((symbol) => ({ name: symbol.name, look: symbolLookOf(symbol.kind, colors, textColors.label) })),
  ];
  return (
    <View style={styles.shadow} accessibilityRole="header" accessibilityLabel={crumbs.map((crumb) => crumb.name).join(", ")}>
      <GlassView style={styles.glass} glassEffectStyle="regular" colorScheme={scheme} />
      <Host
        style={StyleSheet.absoluteFill}
        // Ignores the safe area: otherwise SwiftUI pads it as it slides under
        // the status bar, and it stays behind.
        ignoreSafeArea="all"
      >
        <ScrollView
          axes="horizontal"
          showsIndicators={false}
          // Opens at the end and stays there as it grows; shorter than the
          // pill, it sits at the start.
          modifiers={[defaultScrollAnchorForRole("trailing", "initialOffset"), defaultScrollAnchorForRole("trailing", "sizeChanges"), frame({ maxWidth: FILL, maxHeight: FILL }), clipShape("capsule")]}
        >
          <HStack spacing={5} modifiers={[padding({ horizontal: PAD_H }), frame({ maxHeight: FILL })]}>
            {crumbs.flatMap((crumb, index) => [
              ...(index === 0 ? [] : [<Image key={`${index}›`} systemName="chevron.right" size={CHEVRON_SIZE} color={text} />]),
              ...(crumb.look === undefined ? [] : [<Image key={`${index}icon`} systemName={crumb.look.icon} size={ICON_SIZE} color={crumb.look.color} />]),
              <UIText key={`${index}`} modifiers={[font({ size: TEXT_SIZE, weight: "medium" }), foregroundStyle(text), lineLimit(1)]}>
                {crumb.name}
              </UIText>,
            ])}
          </HStack>
        </ScrollView>
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
