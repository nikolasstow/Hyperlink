/**
 * The tab view's repo menu, at its top right: a glass button naming the repo
 * whose tabs are shown (and its worktree), or All Repos. Tapping it lists All
 * Repos, then every repo with tabs open: a tap on a repo shows its tabs (a
 * filter); its dropdown (held) switches its worktree, its tabs moving to the
 * same files there.
 *
 * Its label is plain React Native, sized by its own text (nothing measured),
 * hosted in the native menu (as the repo page's 3-dot menu).
 *
 * @internal
 */
import { Button, Divider, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { buttonStyle, menuIndicator, menuStyle } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { primaryWorktreeOf, worktreesOf } from "../primaryWorktree";
import { type TextColors, useThemedStyles } from "../theme";
import { PILL_HEIGHT } from "../titlePillStyle";
import { worktreeName } from "../WorktreePicker";

/** Whose tabs the tab view shows: every repo's, or one's. */
export type RepoFilter = { readonly kind: "all" } | { readonly kind: "repo"; readonly repo: string };

export const RepoMenuButton = (props: {
  readonly filter: RepoFilter;
  /** The repos with tabs open, in the order listed. */
  readonly repos: ReadonlyArray<string>;
  readonly onFilter: (filter: RepoFilter) => void;
  /** A repo's worktree chosen (its path). */
  readonly onWorktree: (repo: string, path: string) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { filter } = props;
  const shown = filter.kind === "repo" ? primaryWorktreeOf(filter.repo) : undefined;
  return (
    <Host
      matchContents
      // Ignores the safe area: otherwise SwiftUI pads it as it slides under
      // the status bar, and it stays behind.
      ignoreSafeArea="all"
    >
      <Menu
        label={
          <RNHostView matchContents>
            <View style={styles.shadow}>
              <GlassView style={styles.glass} glassEffectStyle="regular" colorScheme={scheme}>
                <Text style={styles.title} numberOfLines={1}>
                  {filter.kind === "all" ? "All Repos" : filter.repo}
                </Text>
                {shown === undefined ? null : (
                  <Text style={styles.worktree} numberOfLines={1}>
                    {worktreeName(shown)}
                  </Text>
                )}
              </GlassView>
            </View>
          </RNHostView>
        }
        modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
      >
        <Button
          label="All Repos"
          systemImage={filter.kind === "all" ? "checkmark" : "square.stack"}
          onPress={() => props.onFilter({ kind: "all" })}
        />
        <Divider />
        {props.repos.map((repo) => {
          const selected = filter.kind === "repo" && filter.repo === repo;
          const worktrees = worktreesOf(repo);
          const primary = primaryWorktreeOf(repo);
          const show = (): void => props.onFilter({ kind: "repo", repo });
          // Its worktrees, a dropdown (held); a repo that is not a scanned
          // checkout has none, so it is a plain row.
          return worktrees.length === 0 ? (
            <Button
              key={repo}
              label={repo}
              systemImage={selected ? "checkmark" : "folder"}
              onPress={show}
            />
          ) : (
            <Menu
              key={repo}
              label={primary === undefined ? repo : `${repo} · ${worktreeName(primary)}`}
              systemImage={selected ? "checkmark" : "shippingbox"}
              onPrimaryAction={show}
            >
              {worktrees.map((worktree) => (
                <Button
                  key={worktree.path}
                  label={worktreeName(worktree)}
                  systemImage={worktree.path === primary?.path ? "checkmark" : "arrow.triangle.branch"}
                  onPress={() => props.onWorktree(repo, worktree.path)}
                />
              ))}
            </Menu>
          );
        })}
      </Menu>
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
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
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
