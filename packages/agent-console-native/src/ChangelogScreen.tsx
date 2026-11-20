/**
 * The changelog (changelog.ts) in two places:
 *
 * - `ChangelogSheet`: when the app opens with entries the owner has not
 *   closed, a sheet lists them. "Done" keeps the newest version on the
 *   phone, so those entries do not show again.
 * - `ChangelogScreen`: every entry, from Settings → Changelog.
 *
 * Only the last version the owner closed is kept on the phone.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CardGlass, CARD_RADIUS } from "./CardGlass";
import { CHANGELOG, latestVersion, unseenEntries, type ChangelogEntry } from "./changelog";
import { useScreenBackground, useTextColors, useTheme } from "./theme";

const SEEN_KEY = "agent-console-native:changelog:last-seen";

const Entry = (props: { readonly entry: ChangelogEntry }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={styles.entry}>
      <CardGlass />
      <Text style={[styles.date, { color: text.tertiaryLabel }]}>
        {props.entry.date} · {props.entry.commits.join(", ")}
      </Text>
      <Text style={[styles.title, { color: text.label }]}>{props.entry.title}</Text>
      {props.entry.lines.map((line) => (
        <View key={line} style={styles.lineRow}>
          <Text style={[styles.bullet, { color: text.secondaryLabel }]}>•</Text>
          <Text style={[styles.line, { color: text.label }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
};

/** Every changelog entry, newest first. */
export const ChangelogScreen = (): React.ReactElement => {
  const background = useScreenBackground("grouped");
  return (
    <ScrollView style={{ flex: 1, backgroundColor: background }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {CHANGELOG.map((entry) => (
        <Entry key={entry.version} entry={entry} />
      ))}
    </ScrollView>
  );
};

/** Shows the entries the owner has not closed yet, once per new version. */
export const ChangelogSheet = (): React.ReactElement | null => {
  const text = useTextColors();
  const { colors } = useTheme();
  const background = useScreenBackground("grouped");
  const [unseen, setUnseen] = React.useState<ReadonlyArray<ChangelogEntry>>([]);
  const [error, setError] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((raw) => setUnseen(unseenEntries(CHANGELOG, raw === null ? undefined : Number(raw))))
      .catch((cause: unknown) => console.error("[changelog] reading the last seen version failed", cause));
  }, []);
  const close = (): void => {
    AsyncStorage.setItem(SEEN_KEY, String(latestVersion(CHANGELOG)))
      .then(() => setUnseen([]))
      .catch((cause: unknown) => {
        console.error("[changelog] keeping the last seen version failed", cause);
        setError(`Not kept: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
  };
  if (unseen.length === 0) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.sheet, { backgroundColor: background }]}>
        <View style={styles.sheetHead}>
          <Text style={[styles.sheetTitle, { color: text.label }]}>What's new</Text>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={10}>
            <Text style={[styles.done, { color: colors.primary }]}>Done</Text>
          </Pressable>
        </View>
        {error !== undefined ? <Text style={[styles.error, { color: text.secondaryLabel }]}>{error}</Text> : null}
        <ScrollView contentContainerStyle={styles.content}>
          {unseen.map((entry) => (
            <Entry key={entry.version} entry={entry} />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  entry: { borderRadius: CARD_RADIUS, padding: 16, gap: 6 },
  date: { fontSize: 12, fontVariant: ["tabular-nums"] },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 2 },
  lineRow: { flexDirection: "row", gap: 8 },
  bullet: { fontSize: 15, lineHeight: 21 },
  line: { flex: 1, fontSize: 15, lineHeight: 21 },
  sheet: { flex: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  sheetTitle: { fontSize: 28, fontWeight: "700" },
  done: { fontSize: 17, fontWeight: "600" },
  error: { fontSize: 13, paddingHorizontal: 20 },
});
