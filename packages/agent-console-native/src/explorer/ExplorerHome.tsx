/**
 * An explorer home: what a file source shows first. Its sections are the
 * source's storage areas as tabs, its recent files, and the files of the
 * chosen area. For the printer: Printer, USB drive, and Home server; then the
 * recent prints; then the files.
 *
 * The sections come in an order the host gives, so a later edit mode can
 * move and hide them (docs/handoffs/plugin-devices-files-editors.md §6). A
 * section the source cannot fill (no roots, no recent files) is left out.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { runFs } from "../effect/runtime";
import { useTextColors, useTheme, withAlpha } from "../theme";
import { Explorer, ExplorerRow, flatRow, useRowColors } from "./Explorer";
import type { FileSource, FileSourceEntry, FileSourceRoot } from "./FileSource";
import type { SourceRow } from "./sourceRows";

export type ExplorerHomeSection = "Roots" | "Recent" | "Files";

export const defaultHomeSections: ReadonlyArray<ExplorerHomeSection> = ["Roots", "Recent", "Files"];

/** How many recent files the home lists. */
const RECENT_ROWS = 5;

/** The source's storage areas, loaded once per source (and again on `reloadKey`). */
const useRoots = (source: FileSource, reloadKey: number | undefined): ReadonlyArray<FileSourceRoot> | undefined => {
  const [roots, setRoots] = React.useState<ReadonlyArray<FileSourceRoot> | undefined>(undefined);
  React.useEffect(() => {
    const load = source.roots;
    if (load === undefined) return;
    let alive = true;
    runFs(load)
      .then((next) => {
        if (alive) setRoots(next);
      })
      .catch((error: unknown) => console.error("[explorer] loading the storage areas failed", error));
    return () => {
      alive = false;
    };
  }, [source, reloadKey]);
  return roots;
};

/** The source's recent files: undefined while they load, empty when it has none. */
const useRecent = (source: FileSource, reloadKey: number | undefined): ReadonlyArray<FileSourceEntry> | undefined => {
  const [recent, setRecent] = React.useState<ReadonlyArray<FileSourceEntry> | undefined>(undefined);
  React.useEffect(() => {
    const recentFiles = source.recent;
    if (recentFiles === undefined) return;
    let alive = true;
    runFs(recentFiles.load)
      .then((next) => {
        if (alive) setRecent(next);
      })
      .catch((error: unknown) => {
        console.error("[explorer] loading the recent files failed", error);
        if (alive) setRecent([]);
      });
    return () => {
      alive = false;
    };
  }, [source, reloadKey]);
  return recent;
};

/** The storage areas as a segmented control. An area that cannot open says why. */
const RootTabs = (props: { readonly roots: ReadonlyArray<FileSourceRoot>; readonly selected: string; readonly onSelect: (root: FileSourceRoot) => void }): React.ReactElement => {
  const text = useTextColors();
  const theme = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: withAlpha(theme.colors.primary, 0.1) }]} accessibilityRole="tablist">
      {props.roots.map((root) => {
        const on = root.path === props.selected;
        return (
          <Pressable
            key={root.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: !root.available }}
            onPress={() => (root.available ? props.onSelect(root) : Alert.alert(root.title, root.reason ?? "This storage cannot be opened now."))}
            style={[styles.segmentItem, on ? { backgroundColor: withAlpha(theme.colors.primary, 0.22) } : null, root.available ? null : styles.segmentOff]}
          >
            <Text style={[styles.segmentText, { color: on ? text.label : text.secondaryLabel }]} numberOfLines={1}>
              {root.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

export const ExplorerHome = (props: {
  readonly source: FileSource;
  readonly onOpen: (row: SourceRow) => void;
  /** What a tap on a folder's name does (see Explorer). */
  readonly folderTap?: "open" | "expand";
  readonly sections?: ReadonlyArray<ExplorerHomeSection>;
  /** The storage area to open first, by path; else the first one that can open. */
  readonly initialRoot?: string;
  /** Called with the area the owner chose (to upload into it, say). */
  readonly onRoot?: (root: FileSourceRoot) => void;
  readonly reloadKey?: number;
  readonly emptyText?: string;
}): React.ReactElement => {
  const text = useTextColors();
  const rowColors = useRowColors("clear");
  const roots = useRoots(props.source, props.reloadKey);
  const recent = useRecent(props.source, props.reloadKey);
  const [chosen, setChosen] = React.useState<string | undefined>(props.initialRoot);
  const firstOpen = roots?.find((root) => root.available)?.path;
  const root = chosen ?? firstOpen;
  const { onRoot } = props;
  const current = roots?.find((each) => each.path === root);
  React.useEffect(() => {
    if (current !== undefined) onRoot?.(current);
  }, [current, onRoot]);

  const section = (name: ExplorerHomeSection): React.ReactNode => {
    switch (name) {
      case "Roots":
        return roots === undefined || roots.length < 2 || root === undefined ? null : <RootTabs key={name} roots={roots} selected={root} onSelect={(next) => setChosen(next.path)} />;
      case "Recent": {
        const title = props.source.recent?.title;
        if (title === undefined || (recent !== undefined && recent.length === 0)) return null;
        const rows = (recent ?? []).slice(0, RECENT_ROWS);
        return (
          <View key={name} style={styles.block}>
            <Text style={[styles.heading, { color: text.secondaryLabel }]}>{title.toUpperCase()}</Text>
            {recent === undefined ? (
              <ActivityIndicator style={styles.spinner} />
            ) : (
              rows.map((entry, index) => <ExplorerRow key={entry.path} row={flatRow(entry)} last={index === rows.length - 1} colors={rowColors} marks={null} picking={false} selected={false} onToggle={() => undefined} onOpen={props.onOpen} />)
            )}
          </View>
        );
      }
      case "Files":
        return root === undefined ? (
          props.source.roots === undefined || roots !== undefined ? null : <ActivityIndicator key={name} style={styles.spinner} />
        ) : (
          <View key={name} style={styles.block}>
            {props.source.recent !== undefined ? <Text style={[styles.heading, { color: text.secondaryLabel }]}>{(current?.title ?? "Files").toUpperCase()}</Text> : null}
            <Explorer source={props.source} root={root} onOpen={props.onOpen} folderTap={props.folderTap ?? "open"} surface="clear" reloadKey={props.reloadKey} {...(props.emptyText === undefined ? {} : { emptyText: props.emptyText })} />
          </View>
        );
    }
  };

  return <View>{(props.sections ?? defaultHomeSections).map(section)}</View>;
};

const styles = StyleSheet.create({
  segment: { flexDirection: "row", padding: 3, borderRadius: 11, marginBottom: 6 },
  segmentItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  segmentOff: { opacity: 0.4 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  block: { marginTop: 14 },
  heading: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginBottom: 2 },
  spinner: { paddingVertical: 16 },
});
