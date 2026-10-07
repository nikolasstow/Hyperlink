/**
 * The tab view's repo menu, at its top right: one glass holding search,
 * history, and a button naming the repo whose tabs are shown (and its
 * worktree), or All Repos. Tapping it opens a
 * native popover listing All Repos, then every repo with tabs open. A repo's
 * row is two controls: its name shows its tabs (a filter); its chevron opens
 * its worktrees as a menu of their own, one tapped switching it (its tabs
 * moving to the same files there). A native menu cannot hold a row that does
 * both, so the list is SwiftUI's popover.
 *
 * Its label is plain React Native, sized by its own text (nothing measured),
 * hosted in the popover's trigger.
 *
 * @internal
 */
import { Button, Divider, Host, HStack, Image, Menu, Popover, RNHostView, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, menuIndicator, menuStyle, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { colors } from "../colors";
import { primaryWorktreeOf, worktreesOf } from "../primaryWorktree";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { PILL_HEIGHT } from "../titlePillStyle";
import { worktreeName } from "../WorktreePicker";

/** Whose tabs the tab view shows: every repo's, or one's. */
export type RepoFilter = { readonly kind: "all" } | { readonly kind: "repo"; readonly repo: string };

/** The popover's rows: their width, and their room. */
const ROW_WIDTH = 260;
const ROW_PAD_H = 16;
const ROW_PAD_V = 11;
/** Search and history's tap targets in the button: their width. */
const ICON_TARGET = 40;
/** The chevron's tap target: a row's height, square. */
const CHEVRON_TARGET = 52;

/** A row: its symbol (a checkmark when chosen), its name, and what is under
 * it (a repo's worktree). */
const RowContent = (props: { readonly symbol: React.ComponentProps<typeof Image>["systemName"]; readonly chosen: boolean; readonly title: string; readonly detail?: string }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <HStack spacing={10} alignment="center">
      <Image systemName={props.symbol} size={15} color={props.chosen ? colors.tint : textColors.secondaryLabel} />
      <VStack alignment="leading" spacing={1}>
        <UIText modifiers={[font({ size: 16, weight: props.chosen ? "semibold" : "regular" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.title}</UIText>
        {props.detail === undefined ? null : (
          <UIText modifiers={[font({ size: 12 }), foregroundStyle(textColors.secondaryLabel), lineLimit(1)]}>{props.detail}</UIText>
        )}
      </VStack>
      <Spacer />
    </HStack>
  );
};

export const RepoMenuButton = (props: {
  readonly filter: RepoFilter;
  /** The repos with tabs open, in the order listed. */
  readonly repos: ReadonlyArray<string>;
  readonly onFilter: (filter: RepoFilter) => void;
  /** A repo's worktree chosen (its path). */
  readonly onWorktree: (repo: string, path: string) => void;
  /** Search (what it searches: not decided yet). */
  readonly onSearch: () => void;
  /** History: everything opened in this repo's Files. */
  readonly onHistory: () => void;
  /** The widest it may be (the top bar shared with the back button), its
   * names cut short to stay within it. */
  readonly maxWidth: number;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const textColors = useTextColors();
  const [open, setOpen] = React.useState(false);
  const { filter } = props;
  const shown = filter.kind === "repo" ? primaryWorktreeOf(filter.repo) : undefined;
  const choose = (next: RepoFilter): void => {
    setOpen(false);
    props.onFilter(next);
  };
  return (
    <Host
      matchContents
      // Ignores the safe area: otherwise SwiftUI pads it as it slides under
      // the status bar, and it stays behind.
      ignoreSafeArea="all"
    >
      <Popover
        isPresented={open}
        onIsPresentedChange={setOpen}
        attachmentAnchor="bottom"
        arrowEdge="top"
      >
        <Popover.Trigger>
          <RNHostView matchContents>
            {/* One glass: search and history, then the repo filter. */}
            <View style={[styles.shadow, { maxWidth: props.maxWidth }]}>
              <GlassView style={styles.glass} glassEffectStyle="regular" colorScheme={scheme}>
                <Pressable style={styles.icon} accessibilityRole="button" accessibilityLabel="Search" onPress={props.onSearch}>
                  <SystemIcon name="magnifyingglass" size={17} weight="medium" color={textColors.label} />
                </Pressable>
                <Pressable style={styles.icon} accessibilityRole="button" accessibilityLabel="History" onPress={props.onHistory}>
                  <SystemIcon name="clock" size={17} weight="medium" color={textColors.label} />
                </Pressable>
                <Pressable style={styles.filter} accessibilityRole="button" accessibilityLabel="Repos" onPress={() => setOpen(true)}>
                  <View style={styles.names}>
                    <Text style={styles.title} numberOfLines={1}>
                      {filter.kind === "all" ? "All Repos" : filter.repo}
                    </Text>
                    {shown === undefined ? null : (
                      <Text style={styles.worktree} numberOfLines={1}>
                        {worktreeName(shown)}
                      </Text>
                    )}
                  </View>
                  {/* It opens a list. */}
                  <SystemIcon name="chevron.down" size={12} weight="semibold" color={textColors.secondaryLabel} />
                </Pressable>
              </GlassView>
            </View>
          </RNHostView>
        </Popover.Trigger>
        <Popover.Content>
          <VStack alignment="leading" spacing={0} modifiers={[padding({ vertical: 6 })]}>
            <Button onPress={() => choose({ kind: "all" })} modifiers={[buttonStyle("plain"), padding({ horizontal: ROW_PAD_H, vertical: ROW_PAD_V }), frame({ width: ROW_WIDTH, alignment: "leading" })]}>
              <RowContent symbol={filter.kind === "all" ? "checkmark" : "square.stack"} chosen={filter.kind === "all"} title="All Repos" />
            </Button>
            <Divider />
            {props.repos.map((repo) => {
              const chosen = filter.kind === "repo" && filter.repo === repo;
              const worktrees = worktreesOf(repo);
              const primary = primaryWorktreeOf(repo);
              const row = (
                <RowContent symbol={chosen ? "checkmark" : "shippingbox"} chosen={chosen} title={repo} detail={primary === undefined ? undefined : worktreeName(primary)} />
              );
              // A repo that is not a scanned checkout has no worktrees: a
              // plain row.
              if (worktrees.length === 0) {
                return (
                  <Button key={repo} onPress={() => choose({ kind: "repo", repo })} modifiers={[buttonStyle("plain"), padding({ horizontal: ROW_PAD_H, vertical: ROW_PAD_V }), frame({ width: ROW_WIDTH, alignment: "leading" })]}>
                    {row}
                  </Button>
                );
              }
              return (
                <HStack key={repo} spacing={0} alignment="center" modifiers={[frame({ width: ROW_WIDTH, alignment: "leading" })]}>
                  {/* The name: its tabs. */}
                  <Button onPress={() => choose({ kind: "repo", repo })} modifiers={[buttonStyle("plain"), padding({ leading: ROW_PAD_H, vertical: ROW_PAD_V })]}>
                    {row}
                  </Button>
                  {/* The chevron: its worktrees, a menu of their own. */}
                  <Menu
                    label={
                      // A full row's height, and as wide: the whole of it
                      // takes the tap, not only the glyph.
                      <VStack modifiers={[frame({ width: CHEVRON_TARGET, height: CHEVRON_TARGET }), contentShape(shapes.rectangle())]}>
                        <Image systemName="chevron.up.chevron.down" size={13} color={textColors.secondaryLabel} />
                      </VStack>
                    }
                    modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden"), padding({ trailing: 4 })]}
                  >
                    {worktrees.map((worktree) => (
                      <Button
                        key={worktree.path}
                        label={worktreeName(worktree)}
                        systemImage={worktree.path === primary?.path ? "checkmark" : "arrow.triangle.branch"}
                        onPress={() => {
                          setOpen(false);
                          props.onWorktree(repo, worktree.path);
                        }}
                      />
                    ))}
                  </Menu>
                </HStack>
              );
            })}
          </VStack>
        </Popover.Content>
      </Popover>
    </Host>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    shadow: {
      borderRadius: PILL_HEIGHT / 2,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    glass: {
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
      paddingLeft: 4,
      flexDirection: "row",
      alignItems: "center",
    },
    // Search and history: a circle's width each, the bar's height.
    icon: {
      width: ICON_TARGET,
      height: PILL_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    filter: {
      flexShrink: 1,
      height: PILL_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingLeft: 8,
      paddingRight: 18,
    },
    names: {
      flexShrink: 1,
      alignItems: "center",
    },
    title: {
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
    worktree: {
      color: text.secondaryLabel,
      fontSize: 12,
    },
  });
