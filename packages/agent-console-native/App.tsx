import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { AppState, Button, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppContextProvider, useAppContext } from "./src/AppContext";
import { PermissionAutoApprover } from "./src/PermissionAutoApprover";
import { type PairingLink, parsePairingLink } from "./src/auth/pairingLink";
import { pairWithServer, serverAuthReadBack } from "./src/auth/useServerAuth";
import { deviceInfo } from "./src/deviceName";
import { ModelCatalogSync, modelCatalogReadBack } from "./src/models/useModelCatalog";
import { conversationsReadBack } from "./src/conversations/useConversations";
import { homeLayoutReadBack } from "./src/home/useHomeLayout";
import { keptThemesReadBack } from "./src/useCodeTheme";
import { codeFontsReadBack, syncCodeFonts } from "./src/fonts/useCodeFonts";
import { fileScrollsReadBack } from "./src/files/useFileScrolls";
import { keptNavReadBack } from "./src/navigation/useKeptNav";
import { favoritesReadBack } from "./src/favorites/useFavorites";
import { reposReadBack } from "./src/repoScanCache";
import { sessionsReadBack } from "./src/sessionCache";
import { extensionViewsReadBack } from "./src/extensionViewsStore";
import { ConversationPreloader } from "./src/conversations/ConversationPreloader";
import { LiveFilesFollower } from "./src/files/useLiveFiles";
import { AppToastHost } from "./src/AppToast";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { mark } from "./src/diagnostics/launchTrail";
import { LaunchNavigator } from "./src/LaunchNavigator";
import { Effect } from "effect";
import { HttpClientError } from "effect/http";
import { runApp } from "./src/effect/runtime";
import { Opencode } from "./src/opencode/Opencode";
import { UnauthorizedError } from "./src/opencode/protocol/errors";
import { normalizeServerAddress, serverAddressOf } from "./src/opencode/serverAddress";
import { colors } from "./src/colors";
import { RootNavigator } from "./src/RootNavigator";
import { ThemeProvider } from "./src/theme";
import { ThemeSync } from "./src/themeSync";
import {
  clearServerAddress,
  deriveBackendAddress,
  getDefaultPermissionMode,
  getRootDir,
  getServerAddress,
  getBackendAddress,
  opencodeAddressOf,
  getSessionPermissionModes,
  setRootDir,
  setServerAddress,
} from "./src/settings";
import { primeDefaultPermissionMode, primeSessionPermissionModes } from "./src/sessionPermissions";
import { registerForPush, useRegisterOnForeground } from "./src/push";
import { KeyboardHeightProvider } from "./src/keyboardHeight";

/** Only the one-time async bootstrap (resolve a server address, connect,
 * resolve a root folder) lives in this hand-rolled state machine — once
 * the server and `rootDir` are known, RootNavigator (a real
 * @react-navigation/native-stack) takes over for Home/Chat/Settings. This
 * flow has no "back" between its own steps (each one is just "waiting on
 * the previous async step to resolve"), so it doesn't need real navigation
 * itself. */
type Screen =
  | { readonly step: "loading" }
  | { readonly step: "server-setup"; readonly error?: string }
  | { readonly step: "connecting"; readonly server: string }
  | { readonly step: "root-setup"; readonly server: string; readonly error?: string }
  | { readonly step: "ready"; readonly server: string; readonly rootDir: string }
  // A pairing link opened the app (auth/pairingLink.ts): asks before it
  // pairs, and goes back to where it was on Cancel.
  | { readonly step: "pair"; readonly link: PairingLink; readonly previous: Screen; readonly busy: boolean; readonly error?: string };

/** The longest the launch waits for the device's stores to be read back. */
const READ_BACK_WAIT_MS = 1000;

/** Reaching the server (and opencode through it) gives up after this long:
 * an address that answers nothing must not hold the app on the launch screen. */
const CONNECT_TIMEOUT_MS = 10_000;

/** Whether a failure is the server asking for this phone to be paired. */
const isUnpaired = (error: unknown): boolean =>
  error instanceof UnauthorizedError ||
  (HttpClientError.isHttpClientError(error) && "response" in error.reason && error.reason.response?.status === 401);

/** Connect through the server: opencode's info there proves both are up. */
const connectToServer = (server: string): Promise<void> =>
  runApp(
    Opencode.pipe(
      Effect.flatMap((opencode) => opencode.client(serverAddressOf(opencodeAddressOf(server)))),
      Effect.flatMap((client) => client["server.server"]["server.info"]()),
      Effect.timeout(CONNECT_TIMEOUT_MS),
      Effect.mapError((error) =>
        isUnpaired(error)
          ? new Error(`The server at "${server}" asks for this phone to be paired. Run pnpm pair on the Mac, then open its link, or type its code below.`)
          : error._tag === "TimeoutError"
            ? new Error(`No answer from "${server}". Is the agent-console server running there?`)
            : new Error(`Couldn't reach opencode through the server at "${server}": ${error.message}`),
      ),
      Effect.asVoid,
    ),
  );

const AppInner = (): React.ReactElement => {
  // No LayoutAnimation on bootstrap transitions: the launch→ready swap changes
  // the whole tree (LaunchNavigator → RootNavigator), and animating that made
  // the content slide down-and-up a few pixels. Swap instantly instead.
  const [screen, setScreen] = React.useState<Screen>({ step: "loading" });
  React.useEffect(() => {
    mark(`app screen: ${screen.step}`);
  }, [screen.step]);
  const [addressInput, setAddressInput] = React.useState("");
  const [rootDirInput, setRootDirInput] = React.useState("");
  const [pairingCodeInput, setPairingCodeInput] = React.useState("");
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    (async () => {
      // Primed before any session can open, so the first permission ask is
      // answered by the user's chosen default rather than the built-in one.
      // Home's cards are sized from the conversations kept on the device, and
      // the launch screen draws Home's kept layout: both read back before
      // Home shows, so its cards are right from their first frame. The
      // session list, the repo scan, the favorites and the pages last open read back too, so
      // the app reopens on those pages, filled from their first frame.
      // Never longer than READ_BACK_WAIT_MS: a store that cannot be read must
      // not hold the app on the launch screen.
      const readBack = Promise.race([
        Promise.all([conversationsReadBack, homeLayoutReadBack, sessionsReadBack, reposReadBack, keptNavReadBack, favoritesReadBack, keptThemesReadBack, codeFontsReadBack, fileScrollsReadBack, extensionViewsReadBack, modelCatalogReadBack]),
        new Promise<void>((resolve) => setTimeout(resolve, READ_BACK_WAIT_MS)),
      ]);
      // The paired servers' tokens, before the first request to one.
      await Promise.race([serverAuthReadBack, new Promise<void>((resolve) => setTimeout(resolve, READ_BACK_WAIT_MS))]);
      primeDefaultPermissionMode(await getDefaultPermissionMode());
      primeSessionPermissionModes(await getSessionPermissionModes());
      const savedAddress = await getServerAddress();
      if (savedAddress === undefined) {
        setScreen({ step: "server-setup" });
        return;
      }
      setAddressInput(savedAddress);
      // Fire and forget: the backend may be down, permission may be denied,
      // and neither should delay or block getting to the session list.
      void getBackendAddress(savedAddress).then((backend) => registerForPush(backend));
      setScreen({ step: "connecting", server: savedAddress });
      try {
        await connectToServer(savedAddress);
        const savedRootDir = await getRootDir();
        if (savedRootDir === undefined) {
          setScreen({ step: "root-setup", server: savedAddress });
        } else {
          setRootDirInput(savedRootDir);
          await readBack;
          setScreen({ step: "ready", server: savedAddress, rootDir: savedRootDir });
        }
      } catch (err) {
        setScreen({ step: "server-setup", error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  /** Connects to `address` and goes on to the app (or to choosing a root). */
  const connectTo = (address: string): void => {
    setScreen({ step: "connecting", server: address });
    connectToServer(address)
      .then(async () => {
        void setServerAddress(address);
        const savedRootDir = await getRootDir();
        if (savedRootDir === undefined) {
          setScreen({ step: "root-setup", server: address });
        } else {
          setRootDirInput(savedRootDir);
          setScreen({ step: "ready", server: address, rootDir: savedRootDir });
        }
      })
      .catch((err: unknown) => setScreen({ step: "server-setup", error: err instanceof Error ? err.message : String(err) }));
  };

  const onSubmitServer = (): void => {
    const address = addressInput.trim();
    if (address.length === 0) return;
    const code = pairingCodeInput.trim();
    if (code.length === 0) {
      connectTo(address);
      return;
    }
    // A code typed with the address: pair first, then connect.
    setScreen({ step: "connecting", server: address });
    pairWithServer([normalizeServerAddress(address)], code, deviceInfo().name)
      .then((origin) => {
        setPairingCodeInput("");
        connectTo(origin);
      })
      .catch((err: unknown) => setScreen({ step: "server-setup", error: err instanceof Error ? err.message : String(err) }));
  };

  /** Pairs as the open pairing link says, then connects to that server. */
  const onPair = (pairing: Extract<Screen, { readonly step: "pair" }>): void => {
    setScreen({ ...pairing, busy: true, error: undefined });
    pairWithServer(pairing.link.urls, pairing.link.code, deviceInfo().name)
      .then((origin) => {
        setAddressInput(origin);
        connectTo(origin);
      })
      .catch((err: unknown) => setScreen({ ...pairing, busy: false, error: err instanceof Error ? err.message : String(err) }));
  };

  // A pairing link, whether it launched the app or arrived while it runs.
  React.useEffect(() => {
    const open = (url: string | null): void => {
      const link = url === null ? undefined : parsePairingLink(url);
      if (link === undefined) return;
      setScreen((current) => ({ step: "pair", link, previous: current.step === "pair" ? current.previous : current, busy: false }));
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", ({ url }) => open(url));
    return () => subscription.remove();
  }, []);

  const onSubmitRootDir = (server: string): void => {
    const rootDir = rootDirInput.trim();
    if (rootDir.length === 0) return;
    void setRootDir(rootDir);
    setScreen({ step: "ready", server, rootDir });
  };

  const onChangeServer = (): void => {
    void clearServerAddress();
    setAddressInput("");
    setScreen({ step: "server-setup" });
  };

  const onChangeRootDir = (rootDir: string): void => {
    const trimmed = rootDir.trim();
    if (trimmed.length === 0) return;
    void setRootDir(trimmed);
    setRootDirInput(trimmed);
    setScreen((current) =>
      current.step === "ready" ? { ...current, rootDir: trimmed } : current,
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {screen.step === "pair" ? (
        <ScrollView style={styles.root} contentContainerStyle={[styles.center, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={styles.title}>Pair this phone?</Text>
          <Text style={styles.dimText}>With the server at {screen.link.urls[0]}. It gets its own token, kept in this phone’s Keychain.</Text>
          {screen.link.urls.length > 1 ? <Text style={styles.dimText}>Also tried, in order: {screen.link.urls.slice(1).join(", ")}</Text> : null}
          {screen.error !== undefined ? <Text style={styles.errorText}>{screen.error}</Text> : null}
          <Button title={screen.busy ? "Pairing…" : "Pair"} disabled={screen.busy} onPress={() => onPair(screen)} />
          <Button title="Cancel" disabled={screen.busy} onPress={() => setScreen(screen.previous)} />
        </ScrollView>
      ) : screen.step === "loading" || screen.step === "connecting" ? (
        // The launch loading view: a minimal navigator whose screen uses Home's
        // SAME shared native header (homeHeader.ts) over the skeleton body, so
        // the header buttons and cards line up exactly with Home. No client, no
        // Home data — so it can't hit the blank the early Home-mount caused.
        <LaunchNavigator />
      ) : screen.step === "server-setup" ? (
        <ScrollView style={styles.root} contentContainerStyle={[styles.center, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={styles.title}>Where’s your server?</Text>
          <Text style={styles.dimText}>The agent-console server’s host and port, e.g. 100.67.32.32:5199</Text>
          {screen.error !== undefined ? <Text style={styles.errorText}>{screen.error}</Text> : null}
          <TextInput
            style={styles.input}
            value={addressInput}
            onChangeText={setAddressInput}
            placeholder="100.67.32.32:5199"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={onSubmitServer}
          />
          <Text style={styles.dimText}>Pairing code, if the server asks for one (from pnpm pair on the Mac)</Text>
          <TextInput
            style={styles.input}
            value={pairingCodeInput}
            onChangeText={setPairingCodeInput}
            placeholder="ABCD2345"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={onSubmitServer}
          />
          <Button title="Connect" onPress={onSubmitServer} />
        </ScrollView>
      ) : screen.step === "root-setup" ? (
        <ScrollView style={styles.root} contentContainerStyle={[styles.center, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={styles.title}>Where do your repos live?</Text>
          <Text style={styles.dimText}>The folder repos are checked out under, e.g. /Users/you/Coding</Text>
          {screen.error !== undefined ? <Text style={styles.errorText}>{screen.error}</Text> : null}
          <TextInput
            style={styles.input}
            value={rootDirInput}
            onChangeText={setRootDirInput}
            placeholder="/Users/you/Coding"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => onSubmitRootDir(screen.server)}
          />
          <Button title="Continue" onPress={() => onSubmitRootDir(screen.server)} />
        </ScrollView>
      ) : (
        <AppContextProvider
          value={{
            server: normalizeServerAddress(screen.server),
            address: opencodeAddressOf(screen.server),
            backend: deriveBackendAddress(screen.server),
            rootDir: screen.rootDir,
            onChangeRootDir,
            onChangeServer,
          }}
        >
          <ThemeSync />
          {/* Answers permission asks for allow-all sessions, app-wide. */}
          <PermissionAutoApprover />
          {/* Keeps the recent conversations on the device, before any is opened. */}
          <ConversationPreloader />
          {/* Keeps open and kept files in step with the file hub, before any is opened. */}
          <LiveFilesFollower />
          {/* Makes this the app notifications go to whenever it is opened. */}
          <PushOnForeground />
          {/* Installs the custom code fonts the server lists. */}
          <CodeFontsInstaller />
          {/* The model lists, at open and on return: loaded before a picker opens. */}
          <ModelCatalogSync />
          {/* The one keyboard tracker for the whole app (keyboardHeight.tsx). */}
          <KeyboardHeightProvider>
            <RootNavigator />
            <AppToastHost />
          </KeyboardHeightProvider>
        </AppContextProvider>
      )}
    </View>
  );
};

/** Keeps the custom code fonts installed: at launch and on each foreground. */
const CodeFontsInstaller = (): null => {
  const { server } = useAppContext();
  React.useEffect(() => {
    const sync = (): void => {
      syncCodeFonts(server).catch((error: unknown) => console.error("[fonts] syncing the custom fonts failed", error));
    };
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [server]);
  return null;
};

/** Re-registers for pushes on each foreground (push.ts). */
const PushOnForeground = (): null => {
  const { backend } = useAppContext();
  useRegisterOnForeground(backend);
  return null;
};

export default function App() {
  return (
    // GestureHandlerRootView at the very root so gesture-handler works app-wide
    // (the Dubz drag-to-resize bar needs it).
    <GestureHandlerRootView style={styles.root}>
      {/* initialMetrics so safe-area insets are correct on the FIRST render instead
       * of arriving as 0 then settling — that settle was moving the space between
       * the nav bar and the content. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <ErrorBoundary>
            <AppInner />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  title: {
    color: colors.label,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  dimText: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 15,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.label,
    fontSize: 17,
  },
});
