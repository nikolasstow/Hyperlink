/**
 * A file, rendered on the app's code surface: Monaco in a WebView, read-only,
 * themed by the same Shiki theme and grammars the chat code blocks use. The
 * file text comes from OUR backend (`/fs/read`).
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
import { Button, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { buttonStyle, menuIndicator, menuStyle } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { isCodeEditorNative } from "../../modules/code-editor";
import { useAppContext } from "../AppContext";
import { CodeSurface } from "../CodeSurface";
import { runFs } from "../effect/runtime";
import { fsReadText, fsWrite } from "../fsClient";
import { langFromFilename } from "../shikiHighlighter";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import { CodeEditor } from "./CodeEditor";
import { clearFileEdit, getFileEditSync, setFileEdit } from "./fileEdits";
import { keepOnDevice, removeFromDevice, useKeptPaths } from "./fileKeep";
import { getFileTextSync, setFileText } from "./fileTextCache";
import { preloadFile } from "./preloadFile";
import { useSaveLight } from "./saveLight";
import { StatusLight } from "./StatusLight";

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
  /** Room above it (the transparent header). */
  readonly topInset: number;
  /** Room below it (the bottom bar + safe area), so the last lines clear it. */
  readonly bottomInset: number;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { path, name, line, topInset, bottomInset } = props;
  const { backend } = useAppContext();
  // Start from what we have, offline-first: a pending local edit wins over the
  // cached disk text, so the editor mounts instantly with your latest work (even
  // after a restart, before any network).
  const [state, setState] = React.useState<State>(() => {
    const shown = getFileEditSync(path) ?? getFileTextSync(path);
    return shown === undefined ? { kind: "loading" } : { kind: "text", text: shown };
  });
  const lang = React.useMemo(() => langFromFilename(name), [name]);

  // Editing + autosave. The native editor owns the text after mount; we read its
  // changes (onChangeText) and save them — a local (device) checkpoint after a
  // short pause, a cloud (disk) write after a longer pause, flushed at a max
  // wait. Autosave is on app-wide for now (scoped setting to come).
  const { current: lightCurrent, flash } = useSaveLight();
  const editedRef = React.useRef<string | null>(null);
  const diskRef = React.useRef<string>("");
  const localTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cloudTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cloudMaxTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveCloud = React.useCallback((): void => {
    if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
    if (cloudMaxTimer.current !== undefined) clearTimeout(cloudMaxTimer.current);
    cloudTimer.current = undefined;
    cloudMaxTimer.current = undefined;
    const next = editedRef.current;
    if (next === null || next === diskRef.current) return;
    void runFs(fsWrite(backend, path, next))
      .then(() => {
        // Disk now matches: the pending offline edit is no longer pending.
        diskRef.current = next;
        setFileText(path, next);
        clearFileEdit(path);
        flash("cloud");
      })
      .catch(() => undefined);
  }, [backend, path, flash]);

  const onChangeText = React.useCallback(
    (next: string): void => {
      editedRef.current = next;
      // Local (device) checkpoint — debounced short: persist the edit offline so
      // it survives a restart, then flash the light.
      if (localTimer.current !== undefined) clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => {
        if (next === diskRef.current) {
          clearFileEdit(path);
        } else {
          setFileEdit(path, next);
          flash("local");
        }
      }, LOCAL_DELAY_MS);
      // Cloud (disk) autosave — debounced, with a max-wait flush so a steady
      // typist still saves every few seconds.
      if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
      cloudTimer.current = setTimeout(saveCloud, CLOUD_DELAY_MS);
      if (cloudMaxTimer.current === undefined) cloudMaxTimer.current = setTimeout(saveCloud, CLOUD_MAX_WAIT_MS);
    },
    [flash, saveCloud, path],
  );

  // The file's 3-dot menu: a manual (permanent) Save, and Keep On Device.
  const kept = useKeptPaths();
  const isKept = kept.has(path);
  const theme = useCodeTheme();
  const toggleKeep = React.useCallback((): void => {
    if (isKept) {
      removeFromDevice(path);
    } else {
      keepOnDevice(path);
      void preloadFile(backend, path, name, theme);
    }
  }, [isKept, path, name, backend, theme]);

  React.useEffect(() => {
    let alive = true;
    // New file (or path change). Offline-first: a pending local edit is the
    // current content (it survived a restart); otherwise the cached disk text;
    // otherwise load.
    const pendingEdit = getFileEditSync(path);
    editedRef.current = pendingEdit ?? null;
    const cached = getFileTextSync(path);
    const shown = pendingEdit ?? cached;
    diskRef.current = cached ?? "";
    setState(shown === undefined ? { kind: "loading" } : { kind: "text", text: shown });
    // Revalidate in the background: re-read, refresh the disk cache, update the
    // shown text only when there's no pending edit, and drop a pending edit that
    // now matches disk.
    void runFs(fsReadText(backend, path))
      .then((text) => {
        if (!alive) return;
        if (text === undefined) {
          if (shown === undefined) setState({ kind: "missing" });
          return;
        }
        setFileText(path, text);
        diskRef.current = text;
        if (editedRef.current === null) {
          setState((prev) => (prev.kind === "text" && prev.text === text ? prev : { kind: "text", text }));
        } else if (editedRef.current === text) {
          // The pending edit is already on disk (saved elsewhere): no longer pending.
          clearFileEdit(path);
        }
      })
      .catch(() => {
        if (alive && shown === undefined) setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [backend, path]);

  // Drop pending saves when the file (or the view) goes away.
  React.useEffect(
    () => () => {
      if (localTimer.current !== undefined) clearTimeout(localTimer.current);
      if (cloudTimer.current !== undefined) clearTimeout(cloudTimer.current);
      if (cloudMaxTimer.current !== undefined) clearTimeout(cloudMaxTimer.current);
    },
    [],
  );

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
          <CodeEditor path={path} name={name} text={state.text} editable onChangeText={onChangeText} topInset={topInset + EDITOR_TOP_MARGIN} bottomInset={bottomInset} stickyFill={topInset + EDITOR_TOP_MARGIN} />
        ) : (
          <View style={[styles.surface, { paddingTop: topInset }]} />
        )}
        {state.kind === "text" ? (
          <View style={[styles.topRight, { top: topInset + 6 }]}>
            <Host style={styles.menuHost}>
              <Menu
                label={
                  <RNHostView matchContents>
                    <GlassView style={styles.menuButton} isInteractive>
                      <SystemIcon name="ellipsis" size={17} color={textColors.label} />
                    </GlassView>
                  </RNHostView>
                }
                modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
              >
                <Button label="Save" systemImage="square.and.arrow.down" onPress={() => saveCloud()} />
                <Button
                  label={isKept ? "Remove from Device" : "Keep On Device"}
                  systemImage={isKept ? "trash" : "arrow.down.circle"}
                  onPress={toggleKeep}
                />
              </Menu>
            </Host>
            <StatusLight current={lightCurrent} />
          </View>
        ) : null}
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
    topRight: {
      position: "absolute",
      right: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    menuHost: {
      width: 34,
      height: 34,
    },
    menuButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    message: {
      color: text.secondaryLabel,
      fontSize: 15,
    },
  });
