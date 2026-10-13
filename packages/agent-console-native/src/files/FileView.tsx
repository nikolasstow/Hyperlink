/**
 * A file, rendered on the app's code surface: Monaco in a WebView, read-only,
 * themed by the same Shiki theme and grammars the chat code blocks use. The
 * file is kept in step with the file hub (LiveFiles.ts): an agent's edit
 * lands in the open editor in place, and our edits are written through the
 * hub, never over a change we have not seen.
 *
 * The surface scrolls itself and virtualizes its own lines, so it gets a
 * fixed frame rather than a `ScrollView`; a large file is Monaco's problem
 * and it is built for it. Editing is the same surface with `READ_ONLY` false
 * (CodeSurface.tsx).
 *
 * Shared by Files (FilesScreen.tsx) and the standalone viewer
 * (FileViewerScreen.tsx).
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { isCodeEditorNative } from "../../modules/code-editor";
import type { Rebase } from "file-sync";
import { CodeSurface } from "../CodeSurface";
import { langFromFilename } from "../shikiHighlighter";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { CodeEditor, type CodeEditorApi } from "./CodeEditor";
import { autosaveSettingsNow, resolveAutosave } from "./autosaveSettings";
import { clearFileEdit, getFileEditSync, setFileEdit } from "./fileEdits";
import { registerSave, unregisterSave } from "./fileSave";
import { getFileTextSync } from "./fileTextCache";
import { flashFile } from "./saveLight";
import { editLiveFile, liveFileNow, resolveLiveConflict, saveLiveFile, useLiveFile, useLiveFileEvents, useLiveFileProblem, useOnScreen } from "./useLiveFiles";

/** Autosave timing (prototype): a local (device) flash after a short pause, a
 * cloud (disk) write after a longer pause — debounced, but flushed at the max
 * wait so a steady typist still saves every few seconds. */
const LOCAL_DELAY_MS = 400;
const CLOUD_DELAY_MS = 1200;
const CLOUD_MAX_WAIT_MS = 5000;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

const noConflicts: ReadonlyArray<Rebase.Conflict> = [];

/** Extra breathing room between the top bar and the first line of code. */
const EDITOR_TOP_MARGIN = 24;

/** Only a link someone could have meant to open leaves the app. */
const openLink = (url: string): void => {
  if (!/^https?:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => undefined);
};

export const FileView = (props: {
  readonly path: string;
  readonly name: string;
  readonly line?: number;
  /** The repo/workspace the file is in, for scope-based settings (autosave). */
  readonly repo?: string;
  /** Room above it (the transparent header). */
  readonly topInset: number;
  /** Room below it (the bottom bar + safe area), so the last lines clear it. */
  readonly bottomInset: number;
  /** Open the session that made a change (from its popover in the gutter). */
  readonly onOpenSession?: (sessionID: string) => void;
  /** The named scopes the line you are at is in, when they change. */
  readonly onScopes?: (scopes: ReadonlyArray<string>) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { path, name, line, repo, topInset, bottomInset, onOpenSession, onScopes } = props;
  // Followed while on screen (and before, when it is open in a tab or kept).
  useOnScreen(path);
  const live = useLiveFile(path);
  // Start from what we have, offline-first: a pending local edit wins over the
  // cached disk text, so the editor mounts instantly with your latest work (even
  // after a restart, before any network). The hub's text replaces it only when
  // nothing was kept; after that the editor owns the text and outside changes
  // arrive as changes (`useLiveFileEvents`).
  const [state, setState] = React.useState<State>(() => {
    const shown = liveFileNow(path)?.text ?? getFileEditSync(path) ?? getFileTextSync(path);
    return shown === undefined ? { kind: "loading" } : { kind: "text", text: shown };
  });
  React.useEffect(() => {
    const shown = liveFileNow(path)?.text ?? getFileEditSync(path) ?? getFileTextSync(path);
    setState(shown === undefined ? { kind: "loading" } : { kind: "text", text: shown });
  }, [path]);
  // Nothing was kept: the hub's text, once it comes (or why it can't).
  const problem = useLiveFileProblem(path);
  React.useEffect(() => {
    if (state.kind !== "loading") return;
    if (live !== undefined) setState({ kind: "text", text: live.text });
    else if (problem === "NotFound" || problem === "NotAFile") setState({ kind: "missing" });
    else if (problem !== undefined) setState({ kind: "error" });
  }, [live, problem, state.kind]);
  const lang = React.useMemo(() => langFromFilename(name), [name]);

  // Editing + autosave. The native editor owns the text after mount; we read its
  // changes (onChangeText): a local (device) checkpoint after a short pause, and
  // a write through the hub after a longer pause, flushed at a max wait.
  // The file's light, shown beside its name in Files' pill.
  const flash = React.useCallback((kind: "local" | "cloud" | "incoming") => flashFile(path, kind), [path]);
  const editor = React.useRef<CodeEditorApi>(null);
  const localTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cloudTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cloudMaxTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveCloud = React.useCallback((): void => {
    if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
    if (cloudMaxTimer.current !== undefined) clearTimeout(cloudMaxTimer.current);
    cloudTimer.current = undefined;
    cloudMaxTimer.current = undefined;
    saveLiveFile(path);
  }, [path]);

  // An outside change reaches the open editor in place and flashes the light
  // purple; a write that reached the disk flashes it green.
  useLiveFileEvents(
    path,
    (update) => {
      editor.current?.apply(update);
      flash("incoming");
    },
    () => flash("cloud"),
  );

  const onChangeText = React.useCallback(
    (next: string): void => {
      editLiveFile(path, next);
      // Local (device) checkpoint — debounced short: persist the edit offline so
      // it survives a restart, then flash the light.
      if (localTimer.current !== undefined) clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => {
        const base = liveFileNow(path)?.base ?? getFileTextSync(path);
        if (next === base) {
          clearFileEdit(path);
        } else {
          setFileEdit(path, next);
          flash("local");
        }
      }, LOCAL_DELAY_MS);
      // Write through the hub — debounced, with a max-wait flush so a steady
      // typist still saves every few seconds — but only when autosave is on for
      // this file's scope (manual Save still writes regardless).
      const autosave = resolveAutosave(autosaveSettingsNow(), { path, repo });
      // DIAG(live-files): temporary — whether this keystroke schedules a save.
      console.log("[live] typed", path.split("/").pop(), "autosave", autosave);
      if (!autosave) return;
      if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
      cloudTimer.current = setTimeout(saveCloud, CLOUD_DELAY_MS);
      if (cloudMaxTimer.current === undefined) cloudMaxTimer.current = setTimeout(saveCloud, CLOUD_MAX_WAIT_MS);
    },
    [flash, saveCloud, path, repo],
  );

  // Expose a manual save for the file's menu (in the screen's 3-dot), keyed by
  // path, so the menu can save without owning this editor's state.
  React.useEffect(() => {
    registerSave(path, saveCloud);
    return () => unregisterSave(path, saveCloud);
  }, [path, saveCloud]);

  // Drop pending saves when the file (or the view) goes away.
  React.useEffect(
    () => () => {
      if (localTimer.current !== undefined) clearTimeout(localTimer.current);
      if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
      if (cloudMaxTimer.current !== undefined) clearTimeout(cloudMaxTimer.current);
    },
    [],
  );

  const conflicts = live?.conflicts ?? noConflicts;

  if (state.kind === "missing" || state.kind === "error") {
    return (
      <View style={[styles.center, { paddingTop: topInset + 40 }]}>
        <Text style={styles.message}>{state.kind === "missing" ? "File not found." : "Couldn't read this file."}</Text>
      </View>
    );
  }
  // The native editor is the one renderer for viewing and editing; the viewer
  // is it with `editable={false}`. Cheap to mount natively, so it waits for the
  // text rather than booting ahead the way the web surface must.
  if (isCodeEditorNative) {
    return (
      <>
        {state.kind === "text" ? (
          <CodeEditor
            ref={editor}
            path={path}
            name={name}
            text={state.text}
            editable
            onChangeText={onChangeText}
            conflicts={conflicts}
            onConflictChoice={(index, keep) => resolveLiveConflict(path, index, keep)}
            {...(onOpenSession === undefined ? {} : { onOpenSession })}
            {...(onScopes === undefined ? {} : { onScopes })}
            topInset={topInset + EDITOR_TOP_MARGIN}
            bottomInset={bottomInset}
            stickyFill={topInset + EDITOR_TOP_MARGIN}
          />
        ) : (
          <View style={[styles.surface, { paddingTop: topInset }]} />
        )}
        {state.kind === "loading" ? (
          <View style={[styles.center, styles.overlay, { paddingTop: topInset + 40 }]} pointerEvents="none">
            <ActivityIndicator color={textColors.secondaryLabel} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <>
      {/* Mounted before the text arrives on purpose: the surface boots while
       * `/fs/read` is still in flight instead of afterwards. It opens nothing
       * until there is something to open. */}
      <View style={[styles.surface, { paddingTop: topInset }]}>
        <CodeSurface
          path={path}
          text={state.kind === "text" ? state.text : undefined}
          lang={lang}
          {...(line === undefined ? {} : { scrollToLine: line })}
          onLinkActivated={openLink}
        />
      </View>
      {state.kind === "loading" ? (
        <View style={[styles.center, styles.overlay, { paddingTop: topInset + 40 }]} pointerEvents="none">
          <ActivityIndicator color={textColors.secondaryLabel} />
        </View>
      ) : null}
    </>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    surface: {
      flex: 1,
    },
    center: {
      alignItems: "center",
    },
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    message: {
      color: text.secondaryLabel,
      fontSize: 15,
    },
  });
