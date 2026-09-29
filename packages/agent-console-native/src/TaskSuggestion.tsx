/**
 * The tasks suggestion: a full-width block, no border or background. On the
 * left, a tinted glass pill per kind of task with its count (every kind, zero
 * included); on the right, the repo (its name, or a dropdown where the page is
 * not about one repo) with New Task under it. Left column left-aligned, right
 * column right-aligned; nothing is sized from its text.
 *
 * Tasks are the repo's GitHub issues (taskCounts.ts).
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
import type { GitHubRepo, ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import { KINDS, loadTaskCounts, type TaskCount } from "./taskCounts";

const PILL_HEIGHT = 30;
const REPO_SIZE = 20;
const REPO_HEIGHT = 28;

/** Each kind's tint; a kind the app does not know is gray. */
const KIND_TINT: Readonly<Record<string, string>> = {
  Bug: "rgba(255,59,48,0.45)",
  Feature: "rgba(175,82,222,0.45)",
  Task: "rgba(0,122,255,0.45)",
};
const OTHER_TINT = "rgba(142,142,147,0.45)";

type Counts =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly counts: ReadonlyArray<TaskCount> }
  | { readonly kind: "failed"; readonly message: string };

// The repo last picked here, so the block opens on it again.
let pickedRepo: string | undefined;

const plural = (kind: string, count: number): string => (count === 1 ? kind : `${kind}s`);

export const TaskSuggestion = (props: {
  /** The repo, when the page is about one; otherwise the block picks. */
  readonly repo: string | undefined;
  readonly apiBase: string;
}): React.ReactElement | null => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [repos, setRepos] = React.useState<ReadonlyArray<ScannedRepo> | undefined>(undefined);
  const [picked, setPicked] = React.useState(pickedRepo);
  const [counts, setCounts] = React.useState<Counts>({ kind: "loading" });

  React.useEffect(() => {
    readWorkspace().then(
      (scanned) => setRepos((scanned ?? []).filter((repo) => repo.github !== undefined)),
      (error: unknown) => {
        console.error("[tasks] reading the repos failed", error);
        setRepos([]);
      },
    );
  }, []);

  const repoName = props.repo ?? picked ?? repos?.[0]?.repo;
  const github: GitHubRepo | undefined = repos?.find((repo) => repo.repo === repoName)?.github;

  React.useEffect(() => {
    if (github === undefined) return undefined;
    let cancelled = false;
    loadTaskCounts(props.apiBase, github).then(
      (next) => {
        if (!cancelled) setCounts({ kind: "ready", counts: next });
      },
      (error: unknown) => {
        if (!cancelled) setCounts({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.apiBase, github]);

  // Still reading the repos.
  if (repos === undefined) return null;
  // Nothing to show tasks for: say why, rather than show nothing.
  if (repoName === undefined || github === undefined) {
    return (
      <Text style={styles.note}>
        {repoName === undefined ? "No GitHub repos found yet. Pull to refresh on Home to scan." : `${repoName} isn’t on GitHub, so it has no tasks.`}
      </Text>
    );
  }

  const pick = (name: string): void => {
    pickedRepo = name;
    setPicked(name);
  };

  // Every kind, always; while loading, each count a dash.
  const shown: ReadonlyArray<{ readonly kind: string; readonly count: number | undefined }> =
    counts.kind === "ready" ? counts.counts : KINDS.map((kind) => ({ kind, count: undefined }));

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
            <Text style={styles.pillText}>
              {plural(count.kind, count.count ?? 0)} <Text style={styles.pillCount}>{count.count ?? "–"}</Text>
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
        {counts.kind === "failed" ? (
          <Text style={styles.failed} numberOfLines={2}>
            Couldn’t load tasks: {counts.message}
          </Text>
        ) : null}
        <Pressable style={styles.newTask} hitSlop={8} accessibilityRole="button" onPress={() => showToast({ message: "New Task: the form comes next" })}>
          <Ionicons name="add-circle" size={20} color={colors.tint} />
          <Text style={styles.newTaskText}>New Task</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  left: {
    alignItems: "flex-start",
    gap: 8,
  },
  right: {
    flex: 1,
    alignItems: "flex-end",
    gap: 10,
  },
  pill: {
    height: PILL_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  pillGlass: {
    borderRadius: PILL_HEIGHT / 2,
  },
  pillText: {
    color: colors.label,
    fontSize: 14,
    fontWeight: "500",
  },
  pillCount: {
    fontWeight: "700",
  },
  note: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  failed: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textAlign: "right",
  },
  repo: {
    color: colors.label,
    fontSize: REPO_SIZE,
    fontWeight: "600",
  },
  repoMenu: {
    alignSelf: "stretch",
    height: REPO_HEIGHT,
  },
  newTask: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  newTaskText: {
    color: colors.tint,
    fontSize: 16,
    fontWeight: "600",
  },
});
