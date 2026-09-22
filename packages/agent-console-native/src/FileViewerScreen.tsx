/**
 * A file, rendered on the app's code surface: Monaco in a WebView, read-only,
 * themed by the same Shiki theme and grammars the chat code blocks use. The
 * file text comes from OUR backend (`/fs/read`).
 *
 * The surface scrolls itself and virtualizes its own lines, so this screen
 * hands it a fixed frame rather than putting it inside a `ScrollView`. That is
 * also why there is no size cap here any more: a large file is Monaco's problem
 * and it is built for it.
 *
 * Editing is the same surface with `READ_ONLY` false, so nothing here is
 * interim. See `CodeSurface.tsx`.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { CodeSurface } from "./CodeSurface";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { runFs } from "./effect/runtime";
import { fsReadText } from "./fsClient";
import type { RootStackParamList } from "./RootNavigator";
import { langFromFilename } from "./shikiHighlighter";

type Props = NativeStackScreenProps<RootStackParamList, "FileViewer">;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

/** Only a link someone could have meant to open leaves the app. */
const openLink = (url: string): void => {
  if (!/^https?:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => undefined);
};

export const FileViewerScreen = (props: Props): React.ReactElement => {
  const { path, name } = props.route.params;
  const { backend } = useAppContext();
  const headerHeight = useHeaderHeight();
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const lang = React.useMemo(() => langFromFilename(name), [name]);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void runFs(fsReadText(backend, path))
      .then((text) => {
        if (!alive) return;
        setState(text === undefined ? { kind: "missing" } : { kind: "text", text });
      })
      .catch(() => {
        if (alive) setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [backend, path]);

  return (
    <View style={styles.root}>
      {state.kind === "missing" || state.kind === "error" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>{state.kind === "missing" ? "File not found." : "Couldn't read this file."}</Text>
        </View>
      ) : (
        <>
          {/* Mounted before the text arrives on purpose: the surface boots
           * while `/fs/read` is still in flight instead of afterwards. It
           * opens nothing until there is something to open. */}
          <View style={[styles.surface, { paddingTop: headerHeight }]}>
            <CodeSurface
              path={path}
              text={state.kind === "text" ? state.text : undefined}
              lang={lang}
              onLinkActivated={openLink}
            />
          </View>
          {state.kind === "loading" ? (
            <View style={[styles.center, styles.overlay, { paddingTop: headerHeight + 40 }]} pointerEvents="none">
              <ActivityIndicator color={colors.secondaryLabel} />
            </View>
          ) : null}
        </>
      )}
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
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
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
