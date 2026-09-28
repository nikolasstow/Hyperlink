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
import { buttonStyle, font, foregroundStyle, glassEffect, lineLimit, menuIndicator, menuStyle, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { colors } from "./colors";
import { setPrimaryWorktree, usePrimaryWorktree } from "./primaryWorktree";
import type { ScannedWorktree } from "./repoScan";

/** What a worktree is called in the picker: the main checkout is "main". */
export const worktreeName = (worktree: ScannedWorktree): string => (worktree.isMain ? "main" : worktree.name);

/** Pill height, and the widths its text is fitted within. */
const HEIGHT = 34;
const MIN_WIDTH = 96;
const MAX_WIDTH = 220;

/**
 * The Host's width, from its text: a Host sized to its contents across can
 * settle at zero (HomeTargetPickers), so it is given one to match the pill.
 */
const widthFor = (text: string): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(text.length * 8.4) + 62));

export const WorktreePicker = (props: {
  readonly repo: string;
  /** The folder to name while the repo is not known as a scanned repo. */
  readonly fallback: string;
}): React.ReactElement | null => {
  const { primary, worktrees } = usePrimaryWorktree(props.repo, props.fallback);
  if (primary === undefined) return null;
  const label = worktreeName(primary);
  return (
    <Host matchContents={{ vertical: true }} style={{ width: widthFor(label), height: HEIGHT }}>
      <Menu
        label={
          <HStack spacing={6} alignment="center" modifiers={[padding({ horizontal: 14, vertical: 8 }), glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" })]}>
            <Image systemName={primary.isMain ? "externaldrive" : "square.on.square"} size={13} color={colors.secondaryLabel} />
            <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{label}</UIText>
            <Image systemName="chevron.down" size={11} color={colors.secondaryLabel} />
          </HStack>
        }
        modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
      >
        {worktrees.map((worktree) => (
          <Toggle
            key={worktree.path}
            label={worktreeName(worktree)}
            systemImage={worktree.isMain ? "externaldrive" : "square.on.square"}
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
