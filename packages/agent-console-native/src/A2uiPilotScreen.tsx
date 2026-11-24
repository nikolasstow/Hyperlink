/**
 * A2UI pilot (dev): renders a hand-written A2UI surface through {@link A2uiSurface}
 * with DA's glass components, to judge whether the open generative-UI shape maps
 * cleanly onto the native design system. No agent emits it yet. A Button fires an
 * action whose context is the live data model — shown in an alert to prove the
 * "user acts → agent would re-emit" loop. See docs/handoffs/a2ui-for-da.md.
 *
 * @internal
 */
import * as React from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { A2uiSurface } from "./a2ui/A2uiSurface";
import { demoSurface } from "./a2ui/demoSurface";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "A2uiPilot">;

export const A2uiPilotScreen = (_props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={[styles.note, { color: textColors.secondaryLabel }]}>A hand-written A2UI surface, drawn by DA's glass renderer. No agent — this is the open declarative shape rendered with the native design system.</Text>
      <View style={styles.surface}>
        <A2uiSurface surface={demoSurface} onAction={(action, data) => Alert.alert(`A2UI action: ${action.name}`, JSON.stringify(data, null, 2))} />
      </View>
    </ScrollView>
  );
};

const makeStyles = (_text: TextColors) =>
  StyleSheet.create({
    root: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
    note: { fontSize: 13, lineHeight: 18 },
    surface: { gap: 12 },
  });
