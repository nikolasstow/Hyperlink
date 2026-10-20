/**
 * A folder's listing in Files: the shared explorer (explorer/Explorer.tsx)
 * over the repo's files (repoSource.ts), with what Files adds to a row: the
 * long-press menu (Open in New Tab, Favorite, Keep On Device) and the marks
 * for unsaved changes and files kept on the device. Opening goes through
 * Files' own navigation (`onOpen`), not the app's stack.
 *
 * @internal
 */
import * as React from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useAppContext } from "../AppContext";
import { Explorer, type ExplorerMenu } from "../explorer/Explorer";
import type { SourceRow } from "../explorer/sourceRows";
import { fileTarget, folderTarget, repoScope, sameTarget } from "../favorites/model";
import { toggleFavorite, useBoard } from "../favorites/useFavorites";
import { SystemIcon } from "../SystemIcon";
import { useCodeTheme } from "../useCodeTheme";
import { useDirtyPaths } from "./fileEdits";
import { keepOnDevice, removeFromDevice, useKeptPaths } from "./fileKeep";
import type { FileNavEntry } from "./FileNav";
import { preloadFile } from "./preloadFile";
import { repoSource } from "./repoSource";

/** Green = unsaved local changes (pending upload); blue = kept on device (downloaded for offline). */
const UPLOAD_COLOR = "#32d74b";
const DOWNLOAD_COLOR = "#0a84ff";

const navEntry = (row: SourceRow): FileNavEntry => ({ path: row.path, name: row.name, kind: row.kind });

export const FileListing = (props: {
  /** The repo/workspace this listing belongs to — the page a file/folder
   * favorite is pinned to (files and folders are locations, not pages). */
  readonly repo: string;
  readonly dir: string;
  /** Room above it (the transparent header) and below it (the bottom bar). */
  readonly topInset: number;
  readonly bottomInset: number;
  readonly onOpen: (entry: FileNavEntry) => void;
  /** A long press on a row, Open in New Tab. */
  readonly onOpenInNewTab: (entry: FileNavEntry) => void;
  /** Its scrolling (the bar hides as it scrolls down). */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}): React.ReactElement => {
  const { backend } = useAppContext();
  const source = React.useMemo(() => repoSource(backend), [backend]);
  const { repo, onOpen, onOpenInNewTab } = props;
  // A file/folder favorites to this repo/workspace's scope.
  const favScope = React.useMemo(() => repoScope(repo), [repo]);
  const favBoard = useBoard(favScope);
  // Files with unsaved local changes, for the upload indicator.
  const dirty = useDirtyPaths();
  const kept = useKeptPaths();
  const theme = useCodeTheme();

  const menu = (row: SourceRow): ExplorerMenu => {
    const target = row.kind === "directory" ? folderTarget(repo, row.path, row.name) : fileTarget(repo, row.path, row.name);
    const isFav = favBoard.some((each) => sameTarget(each, target));
    const isKept = kept.has(row.path);
    return {
      actions: [
        { id: "newTab", title: "Open in New Tab", systemImage: "plus.square.on.square" },
        { id: "favorite", title: isFav ? "Unfavorite" : "Favorite", systemImage: isFav ? "star.slash" : "star" },
        // Keep On Device is for files (a folder isn't a single document).
        ...(row.kind === "directory" ? [] : [{ id: "keep", title: isKept ? "Remove from Device" : "Keep On Device", systemImage: isKept ? "trash" : "arrow.down.circle" }]),
      ],
      onAction: (id) => {
        if (id === "newTab") onOpenInNewTab(navEntry(row));
        else if (id === "favorite") void toggleFavorite(favScope, target);
        else if (id === "keep") {
          if (isKept) removeFromDevice(row.path);
          else {
            keepOnDevice(row.path);
            // Download it now so it's available offline.
            void preloadFile(backend, row.path, row.name, theme);
          }
        }
      },
    };
  };

  const marks = (row: SourceRow): React.ReactNode =>
    row.kind === "directory" ? null : (
      <>
        {kept.has(row.path) ? <SystemIcon name="arrow.down.circle.fill" size={15} color={DOWNLOAD_COLOR} /> : null}
        {dirty.has(row.path) ? <SystemIcon name="arrow.up.circle.fill" size={15} color={UPLOAD_COLOR} /> : null}
      </>
    );

  return (
    <Explorer
      source={source}
      root={props.dir}
      onOpen={(row) => onOpen(navEntry(row))}
      menu={menu}
      marks={marks}
      scroll={{ topInset: props.topInset, bottomInset: props.bottomInset, onScroll: props.onScroll }}
    />
  );
};
