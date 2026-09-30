/**
 * Live output of a process on the backend's process runner: what a script
 * started from an extension view is printing, backlog first, then as it
 * arrives, then how it ended. A Stop button while it runs.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { HeaderTitlePill } from "./HeaderTitlePill";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { followProcess, stopProcess } from "./extensionViewsClient";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ProcessOutput">;

/** Lines kept on screen; the full transcript is in the runner's log file. */
const MAX_LINES = 2000;

type Status =
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number | undefined }
  | { readonly kind: "lost"; readonly message: string };

interface Line {
  readonly text: string;
  readonly stderr: boolean;
}

export const ProcessOutputScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { id, title, commandLine } = props.route.params;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const scroll = React.useRef<ScrollView>(null);
  const [lines, setLines] = React.useState<ReadonlyArray<Line>>([]);
  const [status, setStatus] = React.useState<Status>({ kind: "running" });

  React.useEffect(() => {
    const controller = new AbortController();
    followProcess(
      apiBase,
      id,
      (event) => {
        if (event.kind === "line") setLines((current) => [...current, { text: event.text, stderr: event.stderr }].slice(-MAX_LINES));
        else setStatus({ kind: "exited", exitCode: event.exitCode });
      },
      controller.signal,
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) setStatus({ kind: "lost", message: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [apiBase, id]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <HeaderTitlePill title={title} />,
      headerRight:
        status.kind === "running"
          ? () => (
              <TouchableOpacity
                onPress={() => {
                  stopProcess(apiBase, id).catch((error: unknown) => Alert.alert("Couldn’t stop it", error instanceof Error ? error.message : String(error)));
                }}
              >
                <Text style={styles.stop}>Stop</Text>
              </TouchableOpacity>
            )
          : undefined,
    });
  }, [navigation, title, status.kind, apiBase, id, styles]);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + 12 }]}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <Text style={styles.command}>$ {commandLine}</Text>
        {lines.map((line, index) => (
          <Text key={index} style={line.stderr ? styles.stderr : styles.stdout} selectable>
            {line.text}
          </Text>
        ))}
        <View style={styles.status}>
          {status.kind === "running" ? (
            <ActivityIndicator size="small" color={textColors.secondaryLabel} />
          ) : status.kind === "exited" ? (
            <Text style={status.exitCode === 0 ? styles.ok : styles.failed}>
              {status.exitCode === 0 ? "Finished" : `Exited with code ${status.exitCode === undefined ? "unknown" : String(status.exitCode)}`}
            </Text>
          ) : (
            <Text style={styles.failed}>Lost the output stream: {status.message}</Text>
          )}
        </View>
      </ScrollView>
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  command: {
    color: text.secondaryLabel,
    fontFamily: "Menlo",
    fontSize: 12,
    marginBottom: 8,
  },
  stdout: {
    color: text.label,
    fontFamily: "Menlo",
    fontSize: 12,
  },
  stderr: {
    color: colors.warning,
    fontFamily: "Menlo",
    fontSize: 12,
  },
  status: {
    marginTop: 12,
    alignItems: "flex-start",
  },
  ok: {
    color: text.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
  },
  failed: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "600",
  },
  stop: {
    color: colors.tint,
    fontSize: 17,
  },
});
