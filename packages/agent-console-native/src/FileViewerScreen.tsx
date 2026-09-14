/**
 * A minimal read-only file view — plain monospace text from OUR backend
 * (`/fs/read`). This is the placeholder target for tapping a file in the
 * explorer; the real viewer (syntax highlighting, twoslash + LSP hovers, tap-to-
 * open from chat) is a later phase — see the file-viewer requirements.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { runFs } from "./effect/runtime";
import { fsReadText } from "./fsClient";
import type { RootStackParamList } from "./RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "FileViewer">;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

export const FileViewerScreen = (props: Props): React.ReactElement => {
  const { path } = props.route.params;
  const { backend } = useAppContext();
  const headerHeight = useHeaderHeight();
  const [state, setState] = React.useState<State>({ kind: "loading" });

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
        <ScrollViewMarker style={styles.fill} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
          <ScrollView contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40, paddingHorizontal: 16 }}>
            <Text style={styles.code} selectable>
              {state.text}
            </Text>
          </ScrollView>
        </ScrollViewMarker>
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
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
  },
  code: {
    color: colors.label,
    fontFamily: "Menlo",
    fontSize: 12,
    lineHeight: 18,
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
