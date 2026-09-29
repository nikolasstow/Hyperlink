/**
 * A header title that names the worktree it shows: the page's title (the
 * folder name in Files, "PNPM" on that page), and under it, as its subtitle,
 * the worktree; a chevron to the right of both. Tapping it opens the native menu of the
 * repo's worktrees; choosing one makes it the repo's primary worktree
 * (primaryWorktree.ts), so every worktree page follows.
 *
 * It is the app's header title pill (HeaderTitlePill: the same glass capsule,
 * height and padding) with a second line, and a `Menu` for its tap. One
 * component, for any page's `headerTitle` where the worktree matters.
 *
 * The width is computed from the text, as HeaderTitlePill's is: a Host sized
 * to its contents races and renders empty or truncated.
 *
 * @internal
 */
import { Host, HStack, Image, Menu, Text as UIText, Toggle, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, frame, glassEffect, lineLimit, menuIndicator, menuStyle, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";
import { setPrimaryWorktree, usePrimaryWorktree } from "./primaryWorktree";
import type { ScannedWorktree } from "./repoScan";
import { PILL_FONT_SIZE, PILL_HEIGHT, PILL_PAD_H, titlePillWidth } from "./titlePillStyle";

/** What a worktree is called: the main checkout is "main". */
export const worktreeName = (worktree: ScannedWorktree): string => (worktree.isMain ? "main" : worktree.name);

const SUBTITLE_SIZE = 12;
const CHEVRON_SIZE = 10;
const CHEVRON_GAP = 8;
/** Average glyph advance for the system font, as titlePillStyle estimates
 * it: generous, so the estimate never truncates. */
const AVG_GLYPH_RATIO = 0.62;
const MIN_WIDTH = 56;
const MAX_WIDTH_RATIO = 0.6;

/** The pill's width: the wider of its two lines, then the chevron, padded. */
const widthFor = (title: string, subtitle: string): number => {
  const titleWidth = titlePillWidth(title, false) - PILL_PAD_H * 2;
  const subtitleWidth = Math.ceil(subtitle.length * SUBTITLE_SIZE * AVG_GLYPH_RATIO);
  return Math.max(titleWidth, subtitleWidth) + CHEVRON_GAP + CHEVRON_SIZE + PILL_PAD_H * 2;
};

export const WorktreePicker = (props: {
  readonly repo: string;
  /** The folder to name while the repo is not known as a scanned repo. */
  readonly fallback: string;
  /** The page's title, above the worktree. */
  readonly title: string;
}): React.ReactElement | null => {
  const { primary, worktrees } = usePrimaryWorktree(props.repo, props.fallback);
  const { width: screenWidth } = useWindowDimensions();
  if (primary === undefined) return null;
  const subtitle = worktreeName(primary);
  const width = Math.min(Math.max(widthFor(props.title, subtitle), MIN_WIDTH), Math.round(screenWidth * MAX_WIDTH_RATIO));
  return (
    <Host style={{ width, height: PILL_HEIGHT }}>
      <Menu
        label={
          <HStack
            alignment="center"
            spacing={CHEVRON_GAP}
            modifiers={[frame({ width, height: PILL_HEIGHT }), padding({ horizontal: PILL_PAD_H }), glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" })]}
          >
            <VStack alignment="center" spacing={0}>
              <UIText modifiers={[font({ size: PILL_FONT_SIZE, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1), truncationMode("tail")]}>{props.title}</UIText>
              <UIText modifiers={[font({ size: SUBTITLE_SIZE }), foregroundStyle(colors.secondaryLabel), lineLimit(1), truncationMode("tail")]}>{subtitle}</UIText>
            </VStack>
            <Image systemName="chevron.down" size={CHEVRON_SIZE} color={colors.secondaryLabel} />
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
  );
};
