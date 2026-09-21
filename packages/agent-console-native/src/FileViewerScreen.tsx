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
      {state.kind === "loading" ? (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <ActivityIndicator color={colors.secondaryLabel} />
        </View>
      ) : state.kind === "text" ? (
        <View style={[styles.surface, { paddingTop: headerHeight }]}>
          <CodeSurface text={state.text} lang={lang} onLinkActivated={openLink} />
        </View>
      ) : (
        <View style={[styles.center, { paddingTop: headerHeight + 40 }]}>
          <Text style={styles.message}>{state.kind === "missing" ? "File not found." : "Couldn't read this file."}</Text>
        </View>
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
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
