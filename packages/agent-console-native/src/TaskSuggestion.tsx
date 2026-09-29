/**
 * The tasks suggestion: a full-width block, no border or background. On the
 * left, left-aligned, a tinted glass pill per kind of task with its count
 * (every kind, zero included); on the right, right-aligned, the repo (its name,
 * or a dropdown where the page is not about one repo) with New Task under it.
 *
 * One native region: a single SwiftUI tree in one Host, laid out by SwiftUI
 * (natural sizes, native glass, native menu). React Native only gives the Host
 * its box: its container's full width and a set height. Nothing is measured.
 *
 * Tasks are the repo's GitHub issues (taskCounts.ts). The repos and counts come
 * from stores loaded as the app starts, so it is whole the instant it renders.
 *
 * @internal
 */
import { Button, Host, HStack, Image, Menu, Spacer, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, frame, glassEffect, lineLimit, monospacedDigit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet } from "react-native";
import { showToast } from "./AppToast";
import { colors } from "./colors";
import type { GitHubRepo } from "./repoScan";
import { useWorkspaceRepos } from "./repoScanCache";
import { KINDS, useTaskCounts } from "./taskCounts";

const PILL_HEIGHT = 30;
const PILL_SPACING = 8;
/** Always the three kinds, so always this tall: the Host's set height. */
const BLOCK_HEIGHT = PILL_HEIGHT * KINDS.length + PILL_SPACING * (KINDS.length - 1);

/** Each kind's glass tint; a kind the app does not know is gray. */
const KIND_TINT: Readonly<Record<string, string>> = {
  Bug: "rgba(255,59,48,0.45)",
  Feature: "rgba(175,82,222,0.45)",
  Task: "rgba(0,122,255,0.45)",
};
const OTHER_TINT = "rgba(142,142,147,0.45)";

// The repo last picked here, so the block opens on it again.
let pickedRepo: string | undefined;

const plural = (kind: string, count: number): string => (count === 1 ? kind : `${kind}s`);

export const TaskSuggestion = (props: {
  /** The repo, when the page is about one; otherwise the block picks. */
  readonly repo: string | undefined;
  readonly apiBase: string;
}): React.ReactElement | null => {
  const workspace = useWorkspaceRepos();
  const repos = React.useMemo(() => (workspace ?? []).filter((repo) => repo.github !== undefined), [workspace]);
  const [picked, setPicked] = React.useState(pickedRepo);
  const repoName = props.repo ?? picked ?? repos[0]?.repo;
  const github: GitHubRepo | undefined = repos.find((repo) => repo.repo === repoName)?.github;
  const counts = useTaskCounts(props.apiBase, github);

  // Only in the app's first moments, before the saved scan has loaded.
  if (workspace === undefined) return null;

  const pick = (name: string): void => {
    pickedRepo = name;
    setPicked(name);
  };

  // Nothing to show tasks for: say why, rather than show nothing.
  const unavailable =
    repoName === undefined
      ? "No GitHub repos found yet. Pull to refresh on Home to scan."
      : github === undefined
        ? `${repoName} isn’t on GitHub, so it has no tasks.`
        : undefined;

  return (
    <Host style={styles.host} ignoreSafeArea="all">
      {unavailable !== undefined || repoName === undefined ? (
        <HStack alignment="top">
          <Text modifiers={[font({ size: 13 }), foregroundStyle(colors.secondaryLabel)]}>{unavailable ?? ""}</Text>
          <Spacer />
        </HStack>
      ) : (
        <HStack alignment="top" spacing={16}>
          <VStack alignment="leading" spacing={PILL_SPACING}>
            {KINDS.map((kind) => {
              const count = counts.counts?.find((each) => each.kind === kind)?.count;
              return (
                <HStack
                  key={kind}
                  spacing={6}
                  modifiers={[
                    padding({ horizontal: 12 }),
                    frame({ height: PILL_HEIGHT }),
                    glassEffect({ glass: { variant: "regular", tint: KIND_TINT[kind] ?? OTHER_TINT }, shape: "capsule" }),
                  ]}
                >
                  <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(colors.label)]}>{plural(kind, count ?? 0)}</Text>
                  <Text modifiers={[font({ size: 14, weight: "bold" }), monospacedDigit(), foregroundStyle(colors.label)]}>
                    {count === undefined ? "–" : String(count)}
                  </Text>
                </HStack>
              );
            })}
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={10}>
            {props.repo !== undefined ? (
              <Text modifiers={[font({ size: 20, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{repoName}</Text>
            ) : (
              <Menu
                label={
                  <HStack spacing={6}>
                    <Text modifiers={[font({ size: 20, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{repoName}</Text>
                    <Image systemName="chevron.down" size={12} color={colors.secondaryLabel} />
                  </HStack>
                }
              >
                {repos.map((repo) => (
                  <Toggle
                    key={repo.repo}
                    label={repo.repo}
                    isOn={repo.repo === repoName}
                    onIsOnChange={(on) => {
                      if (on) pick(repo.repo);
                    }}
                  />
                ))}
              </Menu>
            )}
            <Button
              label="New Task"
              systemImage="plus.circle.fill"
              onPress={() => showToast({ message: "New Task: the form comes next" })}
              modifiers={[buttonStyle("plain"), font({ size: 16, weight: "semibold" }), foregroundStyle(colors.tint)]}
            />
            {counts.error !== undefined ? (
              <Text modifiers={[font({ size: 13 }), foregroundStyle(colors.secondaryLabel), lineLimit(2)]}>{`Couldn’t load tasks: ${counts.error}`}</Text>
            ) : null}
          </VStack>
        </HStack>
      )}
    </Host>
  );
};

const styles = StyleSheet.create({
  // The region's box: its container's full width, a set height.
  host: {
    width: "100%",
    height: BLOCK_HEIGHT,
  },
});
