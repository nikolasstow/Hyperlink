/**
 * The print library, from the relay's Resin catalog: the print files on the
 * home server, shown by what they are. Files with a print come first, with
 * their outcome and their runs; the rest follow by project. Each row shows
 * what the file is, its layers and settings, and its date. The file name
 * goes small, in a detail line.
 *
 * The catalog knows files by SHA-256, because the organizer renames them.
 * A file's older names (from the backups' SHA256SUMS) find its print record.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authedSource } from "../auth/serverTokens";
import { previewUrl } from "../explorer/httpFileSource";
import type { RootStackParamList } from "../RootNavigator";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";
import { Backdrop } from "./Backdrop";
import { fmtBytes, fmtDuration } from "./printerFormat";
import { libraryRoute, useCatalog, type LibraryFile } from "./resinApi";
import { describeFile, fmtShortDate } from "./resinFormat";
import { OutcomeChip } from "./RunParts";
import { relayBaseOf } from "./sdcp";
import { Card, LCD, Note } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinLibrary">;

const ROW_HEIGHT = 84;
const THUMB = 60;

/** The library in sections: printed files first, then each project (the folder under Library), then Drop. */
export const sectionsOf = (files: ReadonlyArray<LibraryFile>): ReadonlyArray<{ readonly title: string; readonly files: ReadonlyArray<LibraryFile> }> => {
  const printed = files.filter((file) => file.print !== null);
  const rest = files.filter((file) => file.print === null);
  const byProject = new Map<string, Array<LibraryFile>>();
  rest.forEach((file) => {
    const [top, project] = file.path.split("/");
    const title = top === "Library" && project !== undefined && project !== file.name ? (project === "goo" ? "Other" : project) : (top ?? "Other");
    byProject.set(title, [...(byProject.get(title) ?? []), file]);
  });
  return [...(printed.length > 0 ? [{ title: "Printed", files: printed }] : []), ...Array.from(byProject.entries()).map(([title, list]) => ({ title, files: list }))];
};

const FileRow = (props: { readonly relayBase: string; readonly file: LibraryFile; readonly last: boolean; readonly onPress: (() => void) | undefined }): React.ReactElement => {
  const text = useTextColors();
  const { file } = props;
  const identity = describeFile(file.name, file.print);
  const header = file.header;
  const facts =
    file.size === 0
      ? "Empty file (0 bytes)"
      : header === null
        ? fmtBytes(file.size)
        : [`${header.layerCount.toLocaleString()} layers`, `${header.exposureSeconds} s`, fmtDuration(header.printSeconds * 1000), `${header.volumeMl.toFixed(1)} ml`].join(" · ");
  const body = (
    <View style={styles.row}>
      <View style={styles.thumb}>
        {file.browserPath !== null && file.size > 0 && file.name.toLowerCase().endsWith(".goo") ? (
          <Image source={authedSource(previewUrl(props.relayBase, file.browserPath, false))} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <SystemIcon name="doc" size={20} color="rgba(244,245,249,0.5)" />
        )}
      </View>
      <View style={[styles.main, props.last ? null : styles.line]}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: text.label }]} numberOfLines={1}>
            {identity.title}
          </Text>
          {file.print !== null ? <OutcomeChip outcome={file.print.outcome} /> : <Text style={[styles.date, { color: text.tertiaryLabel }]}>{fmtShortDate(file.modified)}</Text>}
        </View>
        <Text style={[styles.detail, { color: text.secondaryLabel }]} numberOfLines={1}>
          {[identity.detail, file.print !== null ? `Print ${file.print.id}${file.print.started !== null ? `, ${file.print.started}` : ""}` : undefined].filter((part) => part !== undefined).join(" · ") || facts}
        </Text>
        {identity.detail !== undefined || file.print !== null ? (
          <Text style={[styles.facts, { color: text.secondaryLabel }]} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
        <Text style={[styles.name, { color: text.tertiaryLabel }]} numberOfLines={1}>
          {file.name}
          {file.aliases.length > 0 ? ` · also ${file.aliases[0]}${file.aliases.length > 1 ? ` +${file.aliases.length - 1}` : ""}` : ""}
          {file.sha256 !== null ? ` · ${file.sha256.slice(0, 8)}` : ""}
        </Text>
      </View>
      {props.onPress !== undefined ? <SystemIcon name="chevron.right" size={13} color={text.tertiaryLabel} weight="semibold" /> : null}
    </View>
  );
  return props.onPress === undefined ? (
    body
  ) : (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={identity.title} style={({ pressed }) => [pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
};

export const LibraryScreen = (props: Props): React.ReactElement => {
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const library = useCatalog(relayBase, libraryRoute);
  const sections = React.useMemo(() => sectionsOf(library.value?.files ?? []), [library.value]);
  const wide = width >= 700;
  const contentWidth = Math.min(width - 32, 1100);
  const columnWidth = wide ? Math.floor((contentWidth - 14) / 2) : contentWidth;

  const cards = sections.map((section) => (
    <View key={section.title} style={{ width: columnWidth }}>
      <View style={styles.section}>
        <Text style={[styles.sectionText, { color: text.secondaryLabel }]}>{section.title.toUpperCase()}</Text>
        <Text style={[styles.sectionCount, { color: text.tertiaryLabel }]}>{section.files.length}</Text>
      </View>
      <Card flush style={{ height: section.files.length * ROW_HEIGHT }}>
        {section.files.map((file, index) => {
          const runId = file.print?.runA ?? file.print?.runB ?? null;
          return (
            <FileRow
              key={file.path}
              relayBase={relayBase}
              file={file}
              last={index === section.files.length - 1}
              onPress={runId === null ? undefined : () => props.navigation.navigate("ServerResinRun", { serverName, serverAddress, runId })}
            />
          );
        })}
      </Card>
    </View>
  ));

  return (
    <View style={styles.root}>
      <Backdrop uri={undefined} glow={0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40, width: contentWidth, alignSelf: "center" }}>
        {library.value === undefined || library.error !== undefined ? (
          <Note text={library.error !== undefined ? `The catalog did not answer: ${library.error}` : "Reading the library…"} tone={library.error !== undefined ? "bad" : undefined} />
        ) : library.value.hashing > 0 ? (
          <Note text={`Hashing ${library.value.hashing} files on the server. Their print records show once they have a SHA-256.`} />
        ) : null}
        {wide ? <View style={styles.columns}>{cards}</View> : cards}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  columns: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, alignItems: "flex-start" },
  section: { height: 34, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4, paddingBottom: 6 },
  sectionText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  sectionCount: { fontSize: 12 },
  pressed: { backgroundColor: "rgba(127,127,127,0.12)" },
  row: { flexDirection: "row", alignItems: "center", height: ROW_HEIGHT, paddingLeft: 16, paddingRight: 14, gap: 12 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12, overflow: "hidden", backgroundColor: LCD, alignItems: "center", justifyContent: "center" },
  thumbImage: { width: THUMB, height: THUMB },
  main: { flex: 1, height: ROW_HEIGHT, justifyContent: "center", gap: 1 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 15.5, fontWeight: "600" },
  date: { fontSize: 12, fontVariant: ["tabular-nums"] },
  detail: { fontSize: 12.5 },
  facts: { fontSize: 12, fontVariant: ["tabular-nums"] },
  name: { fontSize: 10.5 },
});
