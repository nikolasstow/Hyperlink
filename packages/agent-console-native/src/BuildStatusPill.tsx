/**
 * A build's status as a capsule — the list's leading element and the detail
 * header's. Shared so the two screens can never disagree about what colour
 * `ERRORED` is.
 *
 * The tone comes from `builds.ts` (a pure, testable mapping); this file is the
 * only place that turns a tone into a colour, which is why `colors.ts` is
 * imported here and not there.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { isRunningStatus, statusTone, type StatusTone } from "./builds";
import { colors } from "./colors";

const toneColor = (tone: StatusTone): typeof colors.tint => {
  switch (tone) {
    case "success":
      return colors.success;
    case "danger":
      return colors.destructive;
    case "active":
      return colors.tint;
    case "neutral":
      return colors.secondaryLabel;
  }
};

/**
 * EAS's own vocabulary, spelled for reading. An unrecognised status is shown
 * verbatim rather than mapped to a wrong-but-familiar word.
 */
const statusLabel = (status: string): string => {
  switch (status) {
    case "NEW":
      return "New";
    case "IN_QUEUE":
      return "In queue";
    case "IN_PROGRESS":
      return "In progress";
    case "FINISHED":
      return "Finished";
    case "ERRORED":
      return "Errored";
    case "CANCELED":
      return "Canceled";
    default:
      return status;
  }
};

export const BuildStatusPill = (props: { readonly status: string }): React.ReactElement => {
  const color = toneColor(statusTone(props.status));
  return (
    <View style={styles.pill}>
      {isRunningStatus(props.status) ? <ActivityIndicator size="small" color={color} /> : null}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {statusLabel(props.status)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.fillBackground,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
