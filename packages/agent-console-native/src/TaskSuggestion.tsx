/**
 * The tasks suggestion: a full-width block, no border or background. On the
 * left, a tinted glass pill per kind of task with its count (every kind, zero
 * included); on the right, the repo (its name, or a dropdown where the page is
 * not about one repo) with New Task under it. Left column left-aligned, right
 * column right-aligned. Every size is set (the block, each pill, each line);
 * nothing is measured or sized from its text, so nothing moves when data
 * comes.
 *
 * Tasks are the repo's GitHub issues (taskCounts.ts). The repos and counts
 * are read from stores loaded as the app starts, so the block is whole the
 * instant it renders; nothing in it loads late.
 *
 * @internal
 */
import { Host, HStack, Image, Menu, Spacer, Text as UIText, Toggle } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit } from "@expo/ui/swift-ui/modifiers";
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { showToast } from "./AppToast";
import { colors } from "./colors";
import type { GitHubRepo } from "./repoScan";
import { useWorkspaceRepos } from "./repoScanCache";
import { KINDS, useTaskCounts } from "./taskCounts";

const PILL_WIDTH = 120;
const PILL_HEIGHT = 30;
const PILL_GAP = 8;
/** Always the three kinds, so always this tall. */
const BLOCK_HEIGHT = PILL_HEIGHT * KINDS.length + PILL_GAP * (KINDS.length - 1);
const REPO_SIZE = 20;
const LINE_HEIGHT = 28;
const NEW_TASK_WIDTH = 110;

/** Each kind's tint; a kind the app does not know is gray. */
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
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const workspace = useWorkspaceRepos();
  const repos = React.useMemo(() => (workspace ?? []).filter((repo) => repo.github !== undefined), [workspace]);
  const [picked, setPicked] = React.useState(pickedRepo);
  const repoName = props.repo ?? picked ?? repos[0]?.repo;
  const github: GitHubRepo | undefined = repos.find((repo) => repo.repo === repoName)?.github;
  const counts = useTaskCounts(props.apiBase, github);

  // Only in the app's first moments, before the saved scan has loaded.
  if (workspace === undefined) return null;
  // Nothing to show tasks for: say why, rather than show nothing.
  if (repoName === undefined || github === undefined) {
    return (
      <Text style={styles.note} numberOfLines={3}>
        {repoName === undefined ? "No GitHub repos found yet. Pull to refresh on Home to scan." : `${repoName} isn’t on GitHub, so it has no tasks.`}
      </Text>
    );
  }

  const pick = (name: string): void => {
    pickedRepo = name;
    setPicked(name);
  };

  // The three kinds, always; before the first load ever, each count a dash.
  const shown = KINDS.map((kind) => ({
    kind,
    count: counts.counts?.find((count) => count.kind === kind)?.count,
  }));

  return (
    <View style={styles.block}>
      <View style={styles.left}>
        {shown.map((count) => (
          <View key={count.kind} style={styles.pill}>
            {/* Tinted glass, rounded on itself; nothing around it rounds it. */}
            <GlassView
              style={[StyleSheet.absoluteFill, styles.pillGlass]}
              glassEffectStyle="regular"
              tintColor={KIND_TINT[count.kind] ?? OTHER_TINT}
              colorScheme={scheme}
            />
            <Text style={styles.pillText} numberOfLines={1}>
              {plural(count.kind, count.count ?? 0)}
            </Text>
            <Text style={styles.pillCount} numberOfLines={1}>
              {count.count ?? "–"}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.right}>
        {props.repo !== undefined ? (
          <Text style={styles.repo} numberOfLines={1}>
            {repoName}
          </Text>
        ) : (
          // Fills the right column; the Spacer puts the name at its right.
          <Host style={styles.repoMenu}>
            <Menu
              label={
                <HStack spacing={6}>
                  <Spacer />
                  <UIText modifiers={[font({ size: REPO_SIZE, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{repoName}</UIText>
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
          </Host>
        )}
        <Pressable style={styles.newTask} hitSlop={8} accessibilityRole="button" onPress={() => showToast({ message: "New Task: the form comes next" })}>
          <Ionicons name="add-circle" size={20} color={colors.tint} />
          <Text style={styles.newTaskText}>New Task</Text>
        </Pressable>
        {/* Last, so nothing above it moves when it shows. */}
        {counts.error !== undefined ? (
          <Text style={styles.failed} numberOfLines={2}>
            Couldn’t load tasks: {counts.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    height: BLOCK_HEIGHT,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  left: {
    width: PILL_WIDTH,
    gap: PILL_GAP,
  },
  // The rest of the (fixed) window width; every line in it a set height.
  right: {
    flex: 1,
    alignItems: "flex-end",
    gap: 10,
  },
  pill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  pillGlass: {
    borderRadius: PILL_HEIGHT / 2,
  },
  pillText: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontWeight: "500",
  },
  pillCount: {
    width: 28,
    textAlign: "right",
    color: colors.label,
    fontSize: 14,
    fontWeight: "700",
  },
  note: {
    height: BLOCK_HEIGHT,
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  failed: {
    width: "100%",
    height: 32,
    color: colors.secondaryLabel,
    fontSize: 13,
    textAlign: "right",
  },
  repo: {
    width: "100%",
    height: LINE_HEIGHT,
    color: colors.label,
    fontSize: REPO_SIZE,
    fontWeight: "600",
    textAlign: "right",
  },
  repoMenu: {
    width: "100%",
    height: LINE_HEIGHT,
  },
  newTask: {
    width: NEW_TASK_WIDTH,
    height: LINE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  newTaskText: {
    color: colors.tint,
    fontSize: 16,
    fontWeight: "600",
  },
});
