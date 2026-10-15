/**
 * A tab, shrunk: what it shows (a folder's listing, or a file as its editor
 * shows it, drawn by the editor itself), at the screen's size and scaled
 * down, so it reads as the screen it opens to and the overview's zoom lines
 * up with it. Kept up to date: a folder from the listing cache (refreshed from
 * the server), a file drawn again whenever what it shows changes.
 *
 * Plain views and images only (no glass, no web view), so it can be scaled
 * and many can be on screen.
 *
 * @internal
 */
import * as React from "react";
import { Image, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAppContext } from "../AppContext";
import { runFs } from "../effect/runtime";
import { iconForFile } from "../fileIcon";
import { getCachedListing, loadTree } from "../fileListingCache";
import { type FsEntry, fsReadText } from "../fsClient";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { type TextColors, useScreenBackground, useThemedStyles } from "../theme";
import type { FileNavEntry } from "./FileNav";
import { useCodeTheme } from "../useCodeTheme";
import { editorThemeOf } from "./CodeEditor";
import { useFilePreview } from "./filePreview";
import { notePath } from "./missingPaths";
import { PREVIEW_ASPECT } from "./tabShape";

/** Rows drawn: more than a screen holds, so it is always full. */
const ROWS = 24;

/** Files' text as last read, so a preview paints at once and then refreshes. */
const texts = new Map<string, string>();

/** A folder's entries, or `missing` (not there: another worktree without
 * it, or gone). */
const useFolder = (path: string): ReadonlyArray<FsEntry> | "missing" => {
  const { backend } = useAppContext();
  const [entries, setEntries] = React.useState<ReadonlyArray<FsEntry> | "missing">(() => getCachedListing(path) ?? []);
  React.useEffect(() => {
    let alive = true;
    loadTree(backend, path)
      .then((load) => {
        notePath(path, load !== "missing");
        if (alive) setEntries(load === "missing" ? "missing" : (getCachedListing(path) ?? []));
      })
      .catch((error: unknown) => console.error(`[files] refreshing ${path} for its preview failed`, error));
    return () => {
      alive = false;
    };
  }, [backend, path]);
  return entries;
};

/** A file's text, or `missing` (not there: another worktree without it, or
 * gone). */
const useText = (path: string): string | "missing" => {
  const { backend } = useAppContext();
  const [text, setText] = React.useState<string | "missing">(() => texts.get(path) ?? "");
  React.useEffect(() => {
    let alive = true;
    runFs(fsReadText(backend, path))
      .then((read) => {
        if (read === undefined) texts.delete(path);
        else texts.set(path, read);
        notePath(path, read !== undefined);
        if (alive) setText(read ?? "missing");
      })
      .catch((error: unknown) => {
        // A read can fail because the entry is actually a directory (an older
        // mislabeled tab) or is gone — show the fallback rather than a blank
        // preview, and warn rather than erroring (it's recoverable).
        console.warn(`[files] reading ${path} for its preview failed`, error);
        if (alive) setText("missing");
      });
    return () => {
      alive = false;
    };
  }, [backend, path]);
  return text;
};

/** A tab whose file or folder isn't here (another worktree without it). */
const Missing = (): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={styles.missing} numberOfLines={2}>
      Not in this worktree
    </Text>
  );
};

const FolderPage = (props: { readonly path: string }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const entries = useFolder(props.path);
  if (entries === "missing") return <Missing />;
  return (
    <>
      {entries.slice(0, ROWS).map((entry) => (
        <View key={entry.name} style={styles.row}>
          <SetiIcon glyph={entry.type === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={26} />
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
        </View>
      ))}
    </>
  );
};

/** A file as its editor shows it: the editor's own drawing, laid over the
 * page at the screen's size (filePreview.ts); the editor's background until
 * the first one is drawn. */
const FilePage = (props: { readonly path: string; readonly name: string; readonly topInset: number }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const text = useText(props.path);
  const image = useFilePreview(props.path, props.name, props.topInset, text === "missing" || text === "" ? undefined : text);
  const { width, height } = useWindowDimensions();
  const background = editorThemeOf(useCodeTheme(), undefined).background;
  if (text === "missing") return <Missing />;
  return image === undefined ? <View style={[styles.file, { width, height, backgroundColor: background }]} /> : <Image source={{ uri: image }} style={[styles.file, { width, height }]} />;
};

export const TabPreview = (props: {
  readonly entry: FileNavEntry;
  /** The preview's width; its height is the screen's shape. */
  readonly width: number;
  /** Room at the page's top (the header, as on the full screen). */
  readonly topInset: number;
  /** Its height to its width: 3:4 in the overview (the page's top); the
   * screen's own while the pages are swiped (the whole page). */
  readonly aspect?: number;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("plain");
  const { width: screenW, height: screenH } = useWindowDimensions();
  const scale = props.width / screenW;
  return (
    // Safari's shape, 3:4: the page's top, the rest cropped.
    <View style={[styles.frame, { width: props.width, height: props.width * (props.aspect ?? PREVIEW_ASPECT), backgroundColor: background }]}>
      <View
        style={[
          styles.page,
          {
            width: screenW,
            height: screenH,
            paddingTop: props.topInset,
            // Scaled about its top left, into the frame.
            transform: [{ translateX: (props.width - screenW) / 2 }, { translateY: (screenH * scale - screenH) / 2 }, { scale }],
          },
        ]}
      >
        {props.entry.kind === "directory" ? <FolderPage path={props.entry.path} /> : <FilePage path={props.entry.path} name={props.entry.name} topInset={props.topInset} />}
      </View>
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    frame: {
      overflow: "hidden",
    },
    page: {
      paddingHorizontal: 14,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 54,
      paddingLeft: 26,
    },
    name: {
      flex: 1,
      color: text.label,
      fontSize: 15,
    },
    // Large, as it is drawn at the screen's size and shrunk.
    missing: {
      marginTop: 120,
      color: text.secondaryLabel,
      fontSize: 34,
      fontWeight: "600",
      textAlign: "center",
    },
    // The file's picture fills the page, under its padding.
    file: {
      position: "absolute",
      top: 0,
      left: 0,
    },
  });
