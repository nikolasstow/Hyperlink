/**
 * The app's code surface: Monaco in a WebView, read-only for now.
 *
 * This is the foundation the editor grows from rather than a viewer that would
 * be thrown away for one. Editing is `READ_ONLY` becoming false, on this same
 * Monaco instance, which is what lets language intelligence, inline completions
 * and collaborative editing land later without swapping engines.
 *
 * The page itself is `assets/code-surface.html`, built by
 * `scripts/gen-code-surface.mjs` and shipped inside the app. It loads from disk
 * with everything inline, so a file renders with no network and no CDN.
 *
 * Theming goes through `useCodeTheme`, the same hook the chat blocks and the
 * Appearance preview read, and the surface tokenizes with the same Shiki
 * grammars. A file and a chat block in one language and theme therefore resolve
 * the same colours.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";
import * as React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  CodeSurfaceNativeView,
  isCodeSurfaceNative,
  type CodeSurfaceHandle,
} from "../modules/code-surface";
import {
  isSurfaceNavigationAllowed,
  parseSurfaceMessage,
  surfaceLanguageOf,
  toInjectedScript,
  type HostMessage,
  type SurfaceMessage,
  type SurfaceTheme,
} from "./codeSurfaceProtocol";
import { codeSurfaceUri } from "./codeSurfaceAsset";
import { colors } from "./colors";
import { useCodeTheme } from "./useCodeTheme";
import { useTheme } from "./theme";

/**
 * Phase 1 is this constant becoming `false`. It is sent to the surface as a
 * message rather than compiled in, so the switch is genuinely one value.
 */
const READ_ONLY = true;

/** Matches the chat code blocks, so the two surfaces sit at the same scale. */
const FONT_SIZE = 12.5;

/**
 * How long the surface may take to say `ready` before the host calls it a
 * failure.
 *
 * Cold, the page is five and a half megabytes of Monaco and Shiki to parse, and
 * a loaded device is welcome to several seconds of that. What it is not welcome
 * to is staying blank forever with nothing said: a blank view is the one
 * failure that looks like a slow success, and it is the failure this screen has
 * already shipped once.
 */
const READY_TIMEOUT_MS = 15_000;

export interface CodeSurfaceProps {
  /** Identifies the file. Each path is its own Monaco model in the surface. */
  readonly path: string;
  /**
   * The file's contents, or undefined while it is still being read.
   *
   * The surface mounts either way, so the page boots while the read is in
   * flight rather than after it. Without a native host that overlap is the only
   * thing standing between a tap and most of a second of parsing.
   */
  readonly text: string | undefined;
  /** A filename extension or language id; anything unknown renders plain. */
  readonly lang: string;
  /** A line to reveal once the surface is up, 1-based. */
  readonly scrollToLine?: number;
  readonly onSelectionChange?: (selection: { readonly text: string; readonly startLine: number; readonly endLine: number }) => void;
  readonly onLinkActivated?: (url: string) => void;
}

/**
 * The theme shaped for the bridge: a bundled name, or the whole document with a
 * name guaranteed, since that is how both sides address it.
 */
const toSurfaceTheme = (theme: string | ThemeRegistrationRaw): string | SurfaceTheme =>
  typeof theme === "string" ? theme : { ...theme, name: theme.name ?? "custom" };

export const CodeSurface = (props: CodeSurfaceProps): React.ReactElement => {
  const webView = React.useRef<WebView>(null);
  /**
   * The native host, when this build has it. It keeps the surface warm across
   * screens, which the WebView cannot: React Native gives a native view no way
   * to move between parents, so one owned by a screen dies with it.
   */
  const native = React.useRef<CodeSurfaceHandle>(null);
  const { theme: appTheme } = useTheme();
  const codeTheme = useCodeTheme();

  const [uri, setUri] = React.useState<string | undefined>(undefined);
  const [assetFailed, setAssetFailed] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  const [ready, setReady] = React.useState(false);

  const language = React.useMemo(() => surfaceLanguageOf(props.lang), [props.lang]);
  const surfaceTheme = React.useMemo(() => toSurfaceTheme(codeTheme), [codeTheme]);

  /**
   * Every message this surface should be holding. The WebView can report
   * `ready` more than once (a reload, a process recycle after memory
   * pressure), and each time it does it has forgotten everything, so the
   * desired state is kept here and replayed rather than queued and drained.
   */
  const desired = React.useRef<ReadonlyArray<HostMessage>>([]);
  const version = React.useRef(0);

  /**
   * The paths the surface is holding, as far as the host knows.
   *
   * Showing a file it already has costs one small message; opening one costs
   * the whole file. The surface reports what it evicts, which is what keeps
   * this honest, and a `ready` means it has forgotten everything.
   */
  const held = React.useRef<ReadonlySet<string>>(new Set());

  const send = React.useCallback((message: HostMessage): void => {
    const script = toInjectedScript(message);
    if (isCodeSurfaceNative) {
      void native.current?.send(script);
      return;
    }
    webView.current?.injectJavaScript(script);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void codeSurfaceUri()
      .then((local) => {
        if (!cancelled) setUri(local);
      })
      .catch(() => {
        if (!cancelled) setAssetFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The surface is gone. Whichever path found out, the state is the same: no
   * page, nothing held, and a message on screen instead of an empty frame.
   * Clearing `ready` also re-arms the deadline, so a surface that comes back
   * by itself is allowed to.
   */
  const fail = React.useCallback((reason: string): void => {
    held.current = new Set();
    setReady(false);
    setLoadError(reason);
  }, []);

  /**
   * The surface has a deadline. Whatever the cause (a cancelled navigation, a
   * page that threw before it could report it, a content process that never
   * came back), the host says so rather than leaving an empty frame that reads
   * as a slow load. A `ready` after the deadline clears it.
   */
  React.useEffect(() => {
    // A failure that already named itself keeps its own message.
    if (uri === undefined || ready || loadError !== undefined) return;
    const timer = setTimeout(() => {
      setLoadError("The code surface didn't finish loading.");
    }, READY_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [uri, ready, loadError]);

  /** Record a message as part of the surface's state, and send it if it is up. */
  const apply = React.useCallback(
    (message: HostMessage): void => {
      desired.current = [...desired.current.filter((held) => held.kind !== message.kind), message];
      if (ready) send(message);
    },
    [ready, send],
  );

  const { path, text } = props;
  React.useEffect(() => {
    if (text === undefined) return;
    if (held.current.has(path)) {
      // The surface still has this file, so it only needs telling which one to
      // show. Its scroll position and undo history come back with it.
      apply({ kind: "showDocument", path });
      return;
    }
    version.current += 1;
    held.current = new Set([...held.current, path]);
    apply({ kind: "openDocument", path, text, language, version: version.current });
  }, [path, text, language, apply]);

  React.useEffect(() => {
    apply({ kind: "setTheme", theme: surfaceTheme });
  }, [surfaceTheme, apply]);

  React.useEffect(() => {
    // No `source`: a custom code font needs `expo-font` before the rest of the
    // app can render one, and this surface has to match the chat blocks rather
    // than get ahead of them. The protocol carries the bytes when that lands.
    apply({ kind: "setFont", family: appTheme.codeFont, size: FONT_SIZE });
  }, [appTheme.codeFont, apply]);

  React.useEffect(() => {
    apply({ kind: "setReadOnly", readOnly: READ_ONLY });
  }, [apply]);

  const line = props.scrollToLine;
  React.useEffect(() => {
    if (line === undefined) return;
    apply({ kind: "scrollTo", line });
  }, [line, apply]);

  const { onSelectionChange, onLinkActivated } = props;

  const handle = React.useCallback(
    (message: SurfaceMessage): void => {
      switch (message.kind) {
        case "ready":
          // A reload leaves the surface holding nothing, whatever the host
          // believed a moment ago.
          held.current = new Set();
          setReady(true);
          // A surface that came up late is a working surface.
          setLoadError(undefined);
          for (const message of desired.current) send(message);
          return;
        case "selectionChanged":
          onSelectionChange?.({ text: message.text, startLine: message.startLine, endLine: message.endLine });
          return;
        case "linkActivated":
          onLinkActivated?.(message.url);
          return;
        case "documentEvicted":
          // The surface let this file go, so the next open has to carry its
          // text again rather than asking for something that is not there.
          held.current = new Set([...held.current].filter((open) => open !== message.path));
          return;
        case "error":
          // Once the surface is up, an error inside Monaco must not blank the
          // screen: the page keeps whatever it last rendered. Before that it is
          // fatal, and saying so beats an empty view.
          if (!ready) setLoadError(message.message);
          return;
        case "loadFailed":
          // The page is not there, which the native host reports this way
          // because a dead web view cannot report anything itself. Fatal
          // whenever it arrives: a content process killed under memory
          // pressure an hour in leaves the same empty frame as one that never
          // loaded.
          fail(message.message);
          return;
        case "contentHeight":
          // The surface fills its container, so the height is advisory here.
          return;
      }
    },
    [onSelectionChange, onLinkActivated, send, ready, fail],
  );

  const onMessage = React.useCallback(
    (event: { readonly nativeEvent: { readonly data: string } }): void => {
      const message = parseSurfaceMessage(event.nativeEvent.data);
      if (message !== undefined) handle(message);
    },
    [handle],
  );

  if (assetFailed || loadError !== undefined) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{loadError ?? "Couldn't load the code surface."}</Text>
      </View>
    );
  }

  if (uri === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.secondaryLabel} />
      </View>
    );
  }

  if (CodeSurfaceNativeView !== undefined) {
    return (
      <View style={styles.root}>
        <CodeSurfaceNativeView ref={native} sourceUrl={uri} style={styles.web} onSurfaceMessage={onMessage} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        ref={webView}
        source={{ uri }}
        style={styles.web}
        // The page is transparent so the screen's own background shows until
        // the theme lands, rather than a white flash.
        containerStyle={styles.web}
        originWhitelist={["file://", "http://localhost", "http://127.0.0.1"]}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={uri.slice(0, uri.lastIndexOf("/") + 1)}
        // Nothing in the page navigates. A tapped link is reported to the host,
        // which decides, so the surface can never be steered somewhere else.
        onShouldStartLoadWithRequest={(request) => isSurfaceNavigationAllowed(request.url, uri)}
        onMessage={onMessage}
        // A load that fails has to say so. A cancelled navigation and a dead
        // content process both render as an empty view otherwise.
        onError={(event) => fail(event.nativeEvent.description || "The code surface could not be loaded.")}
        onHttpError={(event) => fail(`The code surface returned ${String(event.nativeEvent.statusCode)}.`)}
        onContentProcessDidTerminate={() => fail("The code surface ran out of memory and was closed by iOS.")}
        javaScriptEnabled
        domStorageEnabled={false}
        // Monaco does its own scrolling and its own zoom handling.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        setSupportMultipleWindows={false}
        // A large file is a large document, not a reason to recycle the page.
        cacheEnabled={false}
        incognito
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  web: {
    flex: 1,
    backgroundColor: "transparent",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
