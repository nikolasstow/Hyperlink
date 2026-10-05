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
import * as React from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { useAppContext } from "../AppContext";
import { CodeSurface } from "../CodeSurface";
import { runFs } from "../effect/runtime";
import { fsReadText } from "../fsClient";
import { langFromFilename } from "../shikiHighlighter";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";

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

export const FileView = (props: {
  readonly path: string;
  readonly name: string;
  readonly line?: number;
  /** Room above it (the transparent header). */
  readonly topInset: number;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { path, name, line, topInset } = props;
  const { backend } = useAppContext();
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

  if (state.kind === "missing" || state.kind === "error") {
    return (
      <View style={[styles.center, { paddingTop: topInset + 40 }]}>
        <Text style={styles.message}>{state.kind === "missing" ? "File not found." : "Couldn't read this file."}</Text>
      </View>
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
