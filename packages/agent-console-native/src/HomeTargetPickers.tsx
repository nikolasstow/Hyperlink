/**
 * Home composer top section — native SwiftUI `Menu` selectors for repo,
 * branch, and worktree. Repo + branch hug on the leading edge; worktree
 * sits alone on the trailing edge. Trigger chrome is an RN pill
 * (`RNHostView` label) so fill + label color are under our control;
 * SwiftUI `tint` on `bordered` kept resolving to the same light system gray.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import {
  Button,
  Divider,
  Host,
  Menu,
  RNHostView,
  Section,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled as disabledModifier,
  menuActionDismissBehavior,
  menuIndicator,
  menuStyle,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Alert, DynamicColorIOS, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useAppContext } from "./AppContext";
import { listLocalBranches, readCurrentBranch } from "./branchScan";
import { runFs } from "./effect/runtime";
import type { ScannedRepo, ScannedWorktree } from "./repoScan";
import { randomSlug } from "./slug";
import { createWorkspaceFolder } from "./repoCreate";
import { NewRepoSheet } from "./NewRepoSheet";
import {
  getDefaultWorktreePreference,
  getLastWorktreeByRepo,
  getRepoMenuSort,
  setLastWorktreeForRepo,
  setRepoMenuSort,
  type RepoMenuSort,
} from "./settings";
import { createWorktree } from "./worktree";

export type FolderTarget = {
  readonly kind: "folder";
  readonly name: string;
  readonly path: string;
};

export type RepoTarget = {
  readonly kind: "repo";
  readonly repo: string;
  readonly worktree: ScannedWorktree;
  readonly branch: string;
};

export type SessionTarget = FolderTarget | RepoTarget;

export const sessionDirectory = (target: SessionTarget): string =>
  target.kind === "folder" ? target.path : target.worktree.path;

export const worktreeLabel = (wt: ScannedWorktree): string => (wt.isMain ? "main" : wt.name);

type Props = {
  readonly scanned: ReadonlyArray<ScannedRepo>;
  readonly otherFolders: ReadonlyArray<FolderTarget>;
  /** Most-recent session time per repo / folder name — drives "Recent" sort. */
  readonly activityByName: ReadonlyMap<string, number>;
  readonly target: SessionTarget | undefined;
  readonly onChange: (target: SessionTarget) => void;
  /** Rescan repos after create/clone/mkdir/worktree. */
  readonly onWorkspaceChanged: () => Promise<void>;
  /** When set, the repo is FIXED to this one (the repo/workspace pages): the
   * repo dropdown becomes static text and target selection locks to it. The
   * worktree + branch pickers stay live. */
  readonly lockedRepo?: {
    readonly name: string;
    readonly dir: string;
    readonly isRepo: boolean;
  };
};

const PILL_FG = DynamicColorIOS({ light: "#3C3C43", dark: "#EBEBF5" });
const PILL_CHEVRON = { light: "#8E8E93", dark: "#8E8E93" } as const;

/** Custom label as the whole trigger — no SwiftUI button chrome. */
const MENU_MODIFIERS = [
  menuStyle("button"),
  buttonStyle("plain"),
  menuIndicator("hidden"),
] as const;

const PILL_HEIGHT = 32;
const PILL_MAX_WIDTH = 160;
const PILL_MIN_WIDTH = 56;

/**
 * Host `matchContents` (horizontal) races RNHostView Yoga measurement and
 * can settle at width 0 — that emptied the worktree trigger. Size the Host
 * from the label string instead (same idea as SystemIcon’s explicit box).
 */
const pillHostWidth = (text: string, hasIcon = false): number =>
  Math.min(PILL_MAX_WIDTH, Math.max(PILL_MIN_WIDTH, Math.ceil(text.length * 8.6) + 44 + (hasIcon ? 22 : 0)));

const PillLabel = (props: {
  readonly text: string;
  readonly dimmed?: boolean;
  /** Optional leading glyph, e.g. a branch / worktree icon. */
  readonly icon?: React.ComponentProps<typeof Feather>["name"];
}): React.ReactElement => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <RNHostView matchContents>
      <View style={[styles.pill, props.dimmed === true && styles.pillDimmed]}>
        {props.icon !== undefined ? <Feather name={props.icon} size={14} color={PILL_FG} /> : null}
        <Text style={styles.pillText} numberOfLines={1} ellipsizeMode="head">
          {props.text}
        </Text>
        <Feather name="chevron-down" size={12} color={PILL_CHEVRON[scheme]} />
      </View>
    </RNHostView>
  );
};

export const HomeTargetPickers = (props: Props): React.ReactElement => {
  const { client, backend, rootDir } = useAppContext();
  const [branches, setBranches] = React.useState<ReadonlyArray<string>>([]);
  const [newRepoOpen, setNewRepoOpen] = React.useState(false);
  const [sort, setSort] = React.useState<RepoMenuSort>("recent");

  React.useEffect(() => {
    void getRepoMenuSort().then(setSort);
  }, []);

  const toggleSort = (): void => {
    const next: RepoMenuSort = sort === "recent" ? "alphabetical" : "recent";
    setSort(next);
    void setRepoMenuSort(next);
  };

  const sortedRepos = React.useMemo((): ReadonlyArray<ScannedRepo> => {
    const list = [...props.scanned];
    if (sort === "alphabetical") {
      return list.sort((a, b) => a.repo.localeCompare(b.repo));
    }
    return list.sort(
      (a, b) => (props.activityByName.get(b.repo) ?? 0) - (props.activityByName.get(a.repo) ?? 0),
    );
  }, [props.scanned, props.activityByName, sort]);

  const sortedFolders = React.useMemo((): ReadonlyArray<FolderTarget> => {
    const list = [...props.otherFolders];
    if (sort === "alphabetical") {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list.sort(
      (a, b) => (props.activityByName.get(b.name) ?? 0) - (props.activityByName.get(a.name) ?? 0),
    );
  }, [props.otherFolders, props.activityByName, sort]);

  // Default to first known repo once scan lands (respects default-worktree pref).
  // When a repo is locked (repo/workspace pages) select IT instead — a workspace
  // becomes a folder target, a git repo its main (or last-used) worktree.
  React.useEffect(() => {
    if (props.target !== undefined) return;
    const locked = props.lockedRepo;
    if (locked !== undefined) {
      if (!locked.isRepo) {
        props.onChange({ kind: "folder", name: locked.name, path: locked.dir });
        return;
      }
      const found = props.scanned.find((r) => r.repo === locked.name);
      const worktree =
        found?.worktrees.find((w) => w.isMain) ??
        found?.worktrees[0] ??
        // Fall back to the dir the page was opened with, so the composer works
        // even before the scan lands.
        { name: "main", path: locked.dir, isMain: true };
      void (async () => {
        const branch = (await runFs(readCurrentBranch(backend, worktree.path))) ?? "main";
        props.onChange({ kind: "repo", repo: locked.name, worktree, branch });
      })();
      return;
    }
    if (sortedRepos.length === 0) return;
    const repo = sortedRepos[0]!;
    void (async () => {
      const preference = await getDefaultWorktreePreference();
      const lastByRepo = preference === "last" ? await getLastWorktreeByRepo() : {};
      const lastKey = lastByRepo[repo.repo];
      const fromLast =
        lastKey !== undefined
          ? repo.worktrees.find((w) => worktreeLabel(w) === lastKey || w.name === lastKey)
          : undefined;
      const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
      const chosen = fromLast ?? main;
      if (chosen === undefined) return;
      const branch = (await runFs(readCurrentBranch(backend, chosen.path))) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: chosen, branch });
    })();
  }, [sortedRepos, props.target, props.onChange, backend, props.lockedRepo, props.scanned]);

  // Keep branch label in sync when the worktree changes.
  React.useEffect(() => {
    if (props.target?.kind !== "repo") return;
    const snapshot = props.target;
    let cancelled = false;
    void (async () => {
      const current = await runFs(readCurrentBranch(backend, snapshot.worktree.path));
      if (cancelled || current === undefined || current === snapshot.branch) return;
      props.onChange({ ...snapshot, branch: current });
    })();
    return () => {
      cancelled = true;
    };
  }, [props.target?.kind === "repo" ? props.target.worktree.path : "", backend]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch branches for the active repo so the menu opens ready.
  React.useEffect(() => {
    if (props.target?.kind !== "repo") {
      setBranches([]);
      return;
    }
    const target = props.target;
    const main =
      props.scanned.find((r) => r.repo === target.repo)?.worktrees.find((w) => w.isMain) ??
      target.worktree;
    let cancelled = false;
    void runFs(listLocalBranches(backend, main.path)).then((names) => {
      if (cancelled) return;
      const ordered =
        target.branch.length > 0 && !names.includes(target.branch)
          ? [target.branch, ...names]
          : names;
      setBranches(ordered);
    });
    return () => {
      cancelled = true;
    };
  }, [props.target, props.scanned, backend]);

  const pickRepo = (repo: ScannedRepo): void => {
    void (async () => {
      const preference = await getDefaultWorktreePreference();
      const lastByRepo = preference === "last" ? await getLastWorktreeByRepo() : {};
      const lastKey = lastByRepo[repo.repo];
      const fromLast =
        lastKey !== undefined
          ? repo.worktrees.find((w) => worktreeLabel(w) === lastKey || w.name === lastKey)
          : undefined;
      const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
      const chosen = fromLast ?? main;
      if (chosen === undefined) return;
      const branch = (await runFs(readCurrentBranch(backend, chosen.path))) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: chosen, branch });
    })();
  };

  const pickFolder = (folder: FolderTarget): void => {
    props.onChange(folder);
  };

  const pickWorktree = (wt: ScannedWorktree): void => {
    if (props.target?.kind !== "repo") return;
    const previous = props.target;
    void setLastWorktreeForRepo(previous.repo, worktreeLabel(wt));
    void (async () => {
      const branch = (await runFs(readCurrentBranch(backend, wt.path))) ?? previous.branch;
      props.onChange({ kind: "repo", repo: previous.repo, worktree: wt, branch });
    })();
  };

  const pickBranch = (branch: string): void => {
    if (props.target?.kind !== "repo") return;
    props.onChange({ ...props.target, branch });
  };

  const promptNewWorktree = (): void => {
    if (props.target?.kind !== "repo") return;
    const target = props.target;
    const repo = props.scanned.find((r) => r.repo === target.repo);
    const main = repo?.worktrees.find((w) => w.isMain) ?? target.worktree;

    Alert.prompt(
      "New worktree",
      "Leave blank for an auto-generated name.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (value?: string) => {
            void (async () => {
              const name = (value ?? "").trim() || randomSlug();
              try {
                const path = await createWorktree(client, rootDir, target.repo, main.path, name);
                await props.onWorkspaceChanged();
                void setLastWorktreeForRepo(target.repo, name);
                props.onChange({
                  kind: "repo",
                  repo: target.repo,
                  worktree: { name, path, isMain: false },
                  branch: name,
                });
              } catch {
                Alert.alert("Couldn't create worktree", `Failed to create "${name}".`);
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  };

  const promptNewFolder = (): void => {
    Alert.prompt(
      "New workspace folder",
      "A non-git folder under your root.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (value?: string) => {
            void (async () => {
              const name = (value ?? "").trim();
              if (name.length === 0) return;
              try {
                const path = await createWorkspaceFolder(client, rootDir, name);
                await props.onWorkspaceChanged();
                props.onChange({ kind: "folder", name, path });
              } catch {
                Alert.alert("Couldn't create folder", `Failed to create "${name}".`);
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  };

  const onRepoCreated = (repoName: string, mainPath: string): void => {
    void (async () => {
      await props.onWorkspaceChanged();
      const branch = (await runFs(readCurrentBranch(backend, mainPath))) ?? "main";
      props.onChange({
        kind: "repo",
        repo: repoName,
        worktree: { name: "(main)", path: mainPath, isMain: true },
        branch,
      });
    })();
  };

  const repoLabel =
    props.lockedRepo !== undefined
      ? props.lockedRepo.name
      : props.target === undefined
        ? props.scanned.length === 0
          ? "Scanning…"
          : "Repo"
        : props.target.kind === "folder"
          ? props.target.name
          : props.target.repo;
  // Repo-dropdown glyph (Home only) — a box for a git repo, a folder for a
  // workspace. Not shown when the repo is locked (that's static text instead).
  const repoIcon: React.ComponentProps<typeof Feather>["name"] =
    props.target?.kind === "folder" ? "folder" : "box";
  const worktreePill =
    props.target?.kind === "repo"
      ? worktreeLabel(props.target.worktree) || props.target.worktree.name || "Worktree"
      : "Worktree";
  const branchPill =
    props.target?.kind === "repo"
      ? props.target.branch || "Branch"
      : "Branch";

  const worktrees = (() => {
    if (props.target?.kind !== "repo") return [] as ReadonlyArray<ScannedWorktree>;
    const target = props.target;
    return props.scanned.find((r) => r.repo === target.repo)?.worktrees ?? [target.worktree];
  })();

  const repoOnly = props.target?.kind !== "repo";

  return (
    <>
    <View style={styles.row}>
      <View style={styles.leading}>
        {props.lockedRepo !== undefined ? (
          // Repo/workspace pages: the repo is fixed, so its dropdown is replaced
          // by plain static text of the repo name (no menu, no chevron).
          <View style={styles.staticRepo}>
            <Text style={styles.staticRepoText} numberOfLines={1} ellipsizeMode="head">
              {repoLabel}
            </Text>
          </View>
        ) : (
        <Host
          style={[styles.pillHost, { width: pillHostWidth(repoLabel, true) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
          <Menu
            label={<PillLabel text={repoLabel} icon={repoIcon} />}
            modifiers={[...MENU_MODIFIERS]}
          >
            <Button
              label={sort === "recent" ? "Sort: Recent" : "Sort: A–Z"}
              systemImage="arrow.up.arrow.down"
              onPress={toggleSort}
              modifiers={[menuActionDismissBehavior("disabled")]}
            />
            <Section title="Repos">
              {sortedRepos.map((repo) => {
                const active = props.target?.kind === "repo" && props.target.repo === repo.repo;
                return (
                  <Toggle
                    key={repo.repo}
                    label={repo.repo}
                    systemImage="shippingbox"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickRepo(repo);
                    }}
                  />
                );
              })}
              <Button label="New repo…" systemImage="plus" onPress={() => setNewRepoOpen(true)} />
            </Section>
            <Section title="Workspaces">
              {sortedFolders.map((folder) => {
                const active = props.target?.kind === "folder" && props.target.path === folder.path;
                return (
                  <Toggle
                    key={folder.path}
                    label={folder.name}
                    systemImage="folder"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickFolder(folder);
                    }}
                  />
                );
              })}
              <Button label="New workspace…" systemImage="plus" onPress={promptNewFolder} />
            </Section>
          </Menu>
        </Host>
        )}
      </View>

      {/* Branch + worktree grouped together on the right. */}
      <View style={styles.trailing}>
        <Host
          style={[styles.pillHost, { width: pillHostWidth(branchPill, true) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
          <Menu
            label={<PillLabel text={branchPill} dimmed={repoOnly} icon="git-branch" />}
            modifiers={[...MENU_MODIFIERS, ...(repoOnly ? [disabledModifier(true)] : [])]}
          >
            {branches.map((branch) => {
              const active = props.target?.kind === "repo" && props.target.branch === branch;
              return (
                <Toggle
                  key={branch}
                  label={branch}
                  systemImage="arrow.triangle.branch"
                  isOn={active}
                  onIsOnChange={(on) => {
                    if (on) pickBranch(branch);
                  }}
                />
              );
            })}
          </Menu>
        </Host>

        <Host
          style={[styles.pillHost, { width: pillHostWidth(worktreePill, true) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
        <Menu
          label={<PillLabel text={worktreePill} dimmed={repoOnly} icon="hard-drive" />}
          modifiers={[...MENU_MODIFIERS, ...(repoOnly ? [disabledModifier(true)] : [])]}
        >
          {worktrees.map((wt) => {
            const active =
              props.target?.kind === "repo" && props.target.worktree.path === wt.path;
            return (
              <Toggle
                key={wt.path}
                label={worktreeLabel(wt)}
                systemImage={wt.isMain ? "externaldrive" : "square.on.square"}
                isOn={active}
                onIsOnChange={(on) => {
                  if (on) pickWorktree(wt);
                }}
              />
            );
          })}
          <Divider />
          <Button label="Create new…" systemImage="plus" onPress={promptNewWorktree} />
        </Menu>
      </Host>
      </View>
    </View>
    <NewRepoSheet
      visible={newRepoOpen}
      onClose={() => setNewRepoOpen(false)}
      onCreated={onRepoCreated}
    />
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Repo on the left; the branch + worktree group on the right.
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 0,
    flexShrink: 1,
    gap: 8,
    minWidth: 0,
  },
  // Branch + worktree, packed together on the right with a small gap.
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 6,
  },
  pillHost: {
    height: PILL_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
  // No background — just the label + chevron, per design. Kept the row layout
  // and height so the triggers stay tap-sized and aligned.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    // Left-aligned, not centred: the Host is sized a little wider than the label
    // (pillHostWidth), and centring pushed the text in from the left edge. This
    // makes the label hug the left so the leading dropdown lines up flush.
    justifyContent: "flex-start",
    gap: 4,
    height: PILL_HEIGHT,
    width: "100%",
    paddingHorizontal: 2,
  },
  pillDimmed: {
    opacity: 0.4,
  },
  // The locked-repo label: plain static text (no background, no chevron), a
  // little larger than the pickers since it names the page.
  staticRepo: {
    justifyContent: "center",
    height: PILL_HEIGHT,
    paddingHorizontal: 2,
    flexShrink: 1,
    maxWidth: PILL_MAX_WIDTH,
  },
  staticRepoText: {
    flexShrink: 1,
    color: PILL_FG,
    fontSize: 17,
    fontWeight: "500",
  },
  pillText: {
    flexShrink: 1,
    color: PILL_FG,
    fontSize: 15,
    fontWeight: "400",
  },
});
