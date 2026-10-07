/**
 * A tab, shrunk: what it shows (a folder's listing, or a file's first lines),
 * drawn at the screen's size and scaled down, so it reads as the screen it
 * opens to and the overview's zoom lines up with it. Kept up to date: a
 * folder from the listing cache (refreshed from the server), a file read again
 * whenever the preview is shown.
 *
 * Plain views only (no glass, no web view), so it can be scaled and many can
 * be on screen.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAppContext } from "../AppContext";
import { runFs } from "../effect/runtime";
import { iconForFile } from "../fileIcon";
import { getCachedListing, loadTree } from "../fileListingCache";
import { type FsEntry, fsReadText } from "../fsClient";
import { langFromFilename, type HighlightResult, tokenizeCode } from "../shikiHighlighter";
import { useCodeTheme } from "../useCodeTheme";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { type TextColors, useScreenBackground, useThemedStyles } from "../theme";
import type { FileNavEntry } from "./FileNav";
import { notePath } from "./missingPaths";
import { PREVIEW_ASPECT } from "./tabShape";

/** Rows and lines drawn: more than a screen holds, so it is always full. */
const ROWS = 24;
const LINES = 80;
/** The code font size, shared by the gutter and the lines. */
const CODE_FONT_SIZE = 12;

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
      .catch((error: unknown) => console.error(`[files] reading ${path} for its preview failed`, error));
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

/** Menlo's advance at the code font size, to size the line-number gutter from
 * the digit count (nothing measured). */
const CODE_GLYPH_WIDTH = CODE_FONT_SIZE * 0.6;

/** A file's first lines tokenised by Shiki, cached (shikiHighlighter.ts) — the
 * same colours the chat blocks and the real viewer resolve. Undefined until
 * the (async) tokenise lands; the raw text shows meanwhile. */
const useHighlight = (text: string, name: string): HighlightResult | undefined => {
  const theme = useCodeTheme();
  const lang = React.useMemo(() => langFromFilename(name), [name]);
  const themeName = typeof theme === "string" ? theme : (theme.name ?? "custom");
  const code = React.useMemo(() => text.split("\n").slice(0, LINES).join("\n"), [text]);
  const [result, setResult] = React.useState<HighlightResult | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    tokenizeCode({ code, lang, theme })
      .then((next) => {
        if (alive) setResult(next);
      })
      .catch((error: unknown) => console.error(`[files] highlighting ${name} for its preview failed`, error));
    return () => {
      alive = false;
    };
  }, [code, lang, themeName]); // eslint-disable-line react-hooks/exhaustive-deps -- theme keyed by name
  return result;
};

const FilePage = (props: { readonly path: string; readonly name: string }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const text = useText(props.path);
  const highlight = useHighlight(text === "missing" ? "" : text, props.name);
  if (text === "missing") return <Missing />;
  // A line per line, never wrapped — clipped at the edge as the editor shows
  // it — each with its number in a gutter, and its tokens coloured once the
  // highlight lands (the raw line until then).
  const rawLines = text.split("\n").slice(0, LINES);
  const lines = highlight?.lines ?? rawLines;
  const gutterWidth = Math.ceil(String(lines.length).length * CODE_GLYPH_WIDTH);
  return (
    <>
      {lines.map((line, index) => (
        <View key={index} style={styles.codeLine}>
          <Text style={[styles.gutter, { width: gutterWidth }]} numberOfLines={1}>
            {index + 1}
          </Text>
          <Text style={styles.code} numberOfLines={1} ellipsizeMode="clip">
            {typeof line === "string"
              ? line === ""
                ? " "
                : line
              : line.length === 0
                ? " "
                : line.map((token, tokenIndex) => (
                    <Text key={tokenIndex} style={{ color: token.color, fontStyle: token.italic === true ? "italic" : "normal", fontWeight: token.bold === true ? "700" : "400" }}>
                      {token.content}
                    </Text>
                  ))}
          </Text>
        </View>
      ))}
    </>
  );
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
        {props.entry.kind === "directory" ? <FolderPage path={props.entry.path} /> : <FilePage path={props.entry.path} name={props.entry.name} />}
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
    codeLine: {
      flexDirection: "row",
    },
    // The line number, right-aligned in its gutter, dim as the editor's.
    gutter: {
      color: text.tertiaryLabel,
      fontFamily: "Menlo",
      fontSize: CODE_FONT_SIZE,
      lineHeight: 17,
      textAlign: "right",
      marginRight: 10,
    },
    code: {
      flex: 1,
      color: text.label,
      fontFamily: "Menlo",
      fontSize: CODE_FONT_SIZE,
      lineHeight: 17,
    },
  });
