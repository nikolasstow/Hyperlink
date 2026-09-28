/**
 * The worktree picker: a glass pill naming the worktree a page shows, which
 * opens the native menu of the repo's worktrees. Choosing one makes it the
 * repo's primary worktree (primaryWorktree.ts), so every worktree page follows.
 *
 * One component for wherever it fits: the NPM page puts it in place of its
 * title; Files puts it at the top right. The pill is a SwiftUI `Menu` whose
 * label carries SwiftUI's own glass, so it is real Liquid Glass and opens the
 * system menu.
 *
 * @internal
 */
import { Host, HStack, Image, Menu, Text as UIText, Toggle } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, glassEffect, lineLimit, menuIndicator, menuStyle, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { colors } from "./colors";
import { setPrimaryWorktree, usePrimaryWorktree } from "./primaryWorktree";
import type { ScannedWorktree } from "./repoScan";

/** What a worktree is called in the picker: the main checkout is "main". */
export const worktreeName = (worktree: ScannedWorktree): string => (worktree.isMain ? "main" : worktree.name);

/** Pill height, its padding, and the most room it takes. Its text is shown
 * whole up to the most room, then truncated at the end. */
const HEIGHT = 34;
const PADDING = 14;
const CHEVRON = 11;
const GAP = 6;
const MAX_WIDTH = 260;
const FONT_SIZE = 15;

export const WorktreePicker = (props: {
  readonly repo: string;
  /** The folder to name while the repo is not known as a scanned repo. */
  readonly fallback: string;
}): React.ReactElement | null => {
  const { primary, worktrees } = usePrimaryWorktree(props.repo, props.fallback);
  // The text's real width, measured off screen: a Host sized to its contents
  // across can settle at zero (HomeTargetPickers), and a guess cut the text to
  // an ellipsis.
  const [textWidth, setTextWidth] = React.useState<number | undefined>(undefined);
  if (primary === undefined) return null;
  const label = worktreeName(primary);
  const width = textWidth === undefined ? undefined : Math.min(MAX_WIDTH, Math.ceil(textWidth) + PADDING * 2 + GAP + CHEVRON + 4);
  return (
    <View>
      {/* In a wide box of its own, so its width is the text's, not a squeezed one. */}
      <View style={styles.measureBox} pointerEvents="none">
        <RNText style={styles.measure} numberOfLines={1} onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}>
          {label}
        </RNText>
      </View>
      {width === undefined ? null : (
        <Host matchContents={{ vertical: true }} style={{ width, height: HEIGHT }}>
          <Menu
            label={
              <HStack spacing={GAP} alignment="center" modifiers={[padding({ horizontal: PADDING, vertical: 8 }), glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" })]}>
                <UIText modifiers={[font({ size: FONT_SIZE, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1), truncationMode("tail")]}>{label}</UIText>
                <Image systemName="chevron.down" size={CHEVRON} color={colors.secondaryLabel} />
              </HStack>
            }
            modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
          >
            {worktrees.map((worktree) => (
              <Toggle
                key={worktree.path}
                label={worktreeName(worktree)}
                isOn={worktree.path === primary.path}
                onIsOnChange={(on) => {
                  if (on) setPrimaryWorktree(props.repo, worktree.path);
                }}
              />
            ))}
          </Menu>
        </Host>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Off screen, in the pill's font, to be measured.
  measureBox: {
    position: "absolute",
    left: -10000,
    width: 1000,
  },
  measure: {
    alignSelf: "flex-start",
    fontSize: FONT_SIZE,
    fontWeight: "600",
  },
});
