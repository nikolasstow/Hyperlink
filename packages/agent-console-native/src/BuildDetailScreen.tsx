/**
 * One EAS build in full — the metadata expo.dev shows, the install link, and
 * the phased log.
 *
 * The log is the reason this screen exists. A finished iOS build produces
 * ~28 phases and thousands of lines, so phases render collapsed, each showing
 * its line count and the worst level it contains: a red marker finds the
 * failing phase without opening the other 27. While the build is still
 * running, `/logs` is re-read on an interval and the newest phase starts
 * expanded, so the screen tails.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import {
  BUILD_POLL_INTERVAL_MS,
  fetchBuildDetail,
  fetchBuildLogs,
  firstLine,
  formatDuration,
  isTerminalStatus,
  levelTone,
  LOG_LINE_LIMIT,
  phaseLabel,
  phaseTone,
  relativeTimeOf,
  shortCommit,
  tailLines,
  type BuildDetail,
  type LogPhase,
  type LogTone,
} from "./builds";
import { BuildStatusPill } from "./BuildStatusPill";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "BuildDetail">;

const logToneColor = (tone: LogTone): typeof colors.label => {
  switch (tone) {
    case "error":
      return colors.destructive;
    case "warn":
      return colors.warning;
    case "info":
      return colors.secondaryLabel;
  }
};

const Field = (props: { readonly label: string; readonly value: string }): React.ReactElement => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{props.label}</Text>
    <Text style={styles.fieldValue} numberOfLines={3}>
      {props.value}
    </Text>
  </View>
);

/** The rows of the metadata card, skipping everything the build doesn't carry. */
const detailFields = (detail: BuildDetail): ReadonlyArray<{ readonly label: string; readonly value: string }> => {
  const fields: Array<{ readonly label: string; readonly value: string }> = [];
  const add = (label: string, value: string | undefined): void => {
    if (value !== undefined && value.trim() !== "") fields.push({ label, value });
  };

  add("Profile", detail.buildProfile);
  add("Platform", detail.platform);
  const version =
    detail.appVersion === undefined
      ? undefined
      : detail.appBuildVersion === undefined
        ? detail.appVersion
        : `${detail.appVersion} (${detail.appBuildVersion})`;
  add("Version", version);
  add("Distribution", detail.distribution);

  const commitSubject = firstLine(detail.gitCommitMessage);
  const commitHash = shortCommit(detail.gitCommitHash);
  const commit =
    commitSubject === undefined
      ? commitHash
      : commitHash === undefined
        ? commitSubject
        : `${commitHash} · ${commitSubject}`;
  add("Commit", commit);
  add("Started by", detail.initiatingActorName);

  add("Queued", formatDuration(detail.metrics?.queueTimeMs));
  add("Waited", formatDuration(detail.metrics?.waitTimeMs));
  add("Duration", formatDuration(detail.metrics?.durationMs));

  add("Created", relativeTimeOf(detail.createdAt));
  add("Completed", relativeTimeOf(detail.completedAt));
  return fields;
};

export const BuildDetailScreen = (props: Props): React.ReactElement => {
  const { id } = props.route.params;
  const insets = useSafeAreaInsets();
  const { backend } = useAppContext();

  const [detail, setDetail] = React.useState<BuildDetail | undefined>(undefined);
  const [phases, setPhases] = React.useState<ReadonlyArray<LogPhase>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [logError, setLogError] = React.useState<string | undefined>(undefined);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  /** Cleared after the first load seeds the tail, so a poll never re-expands
   * a phase the user has deliberately collapsed. */
  const seededTail = React.useRef(false);

  /**
   * Detail and logs are read together but reported separately: a build whose
   * log has not been produced yet still has metadata worth showing, so a log
   * failure must not blank the header. Neither failure clears what is already
   * on screen.
   */
  const load = React.useCallback(async (): Promise<void> => {
    const [detailResult, logsResult] = await Promise.all([
      fetchBuildDetail(backend, id),
      fetchBuildLogs(backend, id),
    ]);

    if (detailResult.ok) {
      setDetail(detailResult.value);
      setError(undefined);
    } else {
      setError(detailResult.message);
    }

    if (logsResult.ok) {
      setPhases(logsResult.value);
      setLogError(undefined);
      // Tail on open: the phase currently running is the one worth reading.
      if (!seededTail.current && detailResult.ok && logsResult.value.length > 0) {
        seededTail.current = true;
        const last = logsResult.value[logsResult.value.length - 1];
        if (!isTerminalStatus(detailResult.value.status) && last !== undefined) {
          setExpanded(new Set([last.phase]));
        }
      }
    } else {
      setLogError(logsResult.message);
    }

    setLoading(false);
  }, [backend, id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Stop the moment the build reaches a terminal state — nothing more arrives.
  const active = detail !== undefined && !isTerminalStatus(detail.status);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), BUILD_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const togglePhase = (phase: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const installUrl = detail?.status === "FINISHED" ? detail.buildUrl : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => props.navigation.goBack()}
          accessibilityLabel="Back"
        >
          <SystemIcon name="chevron.left" size={20} color={colors.tint} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {error === undefined ? null : (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => {
                setLoading(true);
                void load();
              }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {detail === undefined ? (
          loading ? <ActivityIndicator style={styles.loading} size="small" color={colors.secondaryLabel} /> : null
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <BuildStatusPill status={detail.status} />
              </View>
              {detailFields(detail).map((field) => (
                <Field key={field.label} label={field.label} value={field.value} />
              ))}
            </View>

            {detail.error === undefined ? null : (
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Error</Text>
                <Text style={styles.errorText}>{detail.error}</Text>
              </View>
            )}

            {installUrl === undefined ? null : (
              <TouchableOpacity
                style={styles.installButton}
                activeOpacity={0.6}
                onPress={() => {
                  Linking.openURL(installUrl).catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : "Could not open the install link.");
                  });
                }}
              >
                <Text style={styles.installText}>Install</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.sectionLabel}>Logs</Text>
            {logError !== undefined ? (
              <View style={styles.card}>
                <Text style={styles.errorText}>{logError}</Text>
              </View>
            ) : phases.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.hint}>
                  {isTerminalStatus(detail.status) ? "This build produced no log." : "Waiting for the first log lines…"}
                </Text>
              </View>
            ) : (
              <View style={styles.logCard}>
                {phases.map((phase, index) => {
                  const open = expanded.has(phase.phase);
                  const tone = phaseTone(phase);
                  const visible = tailLines(phase.lines, LOG_LINE_LIMIT);
                  return (
                    <View key={phase.phase} style={index > 0 ? styles.phaseBorder : undefined}>
                      <TouchableOpacity
                        style={styles.phaseHeader}
                        activeOpacity={0.6}
                        onPress={() => togglePhase(phase.phase)}
                      >
                        <SystemIcon
                          name={open ? "chevron.down" : "chevron.right"}
                          size={12}
                          color={colors.secondaryLabel}
                        />
                        <Text style={[styles.phaseTitle, tone !== "info" && { color: logToneColor(tone) }]} numberOfLines={1}>
                          {phaseLabel(phase.phase)}
                        </Text>
                        <Text style={styles.phaseCount}>{phase.lines.length}</Text>
                      </TouchableOpacity>
                      {open ? (
                        <ScrollView
                          horizontal
                          style={styles.logScroll}
                          contentContainerStyle={styles.logLines}
                          showsHorizontalScrollIndicator
                        >
                          <View>
                            {visible.hidden === 0 ? null : (
                              <Text style={[styles.logLine, styles.logElision]}>
                                {`… ${visible.hidden} earlier lines not shown`}
                              </Text>
                            )}
                            {visible.lines.map((line, lineIndex) => (
                              <Text
                                key={`${phase.phase}:${visible.hidden + lineIndex}`}
                                style={[styles.logLine, { color: logToneColor(levelTone(line.level)) }]}
                              >
                                {line.msg}
                              </Text>
                            ))}
                          </View>
                        </ScrollView>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  field: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  fieldLabel: {
    width: 92,
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  fieldValue: {
    flex: 1,
    color: colors.label,
    fontSize: 13,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  installButton: {
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    marginBottom: 10,
  },
  installText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  logCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    overflow: "hidden",
  },
  phaseBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  phaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  phaseTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontWeight: "500",
  },
  phaseCount: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  logScroll: {
    backgroundColor: colors.fillBackground,
  },
  logLines: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // Monospaced so the build tool's own column alignment survives. Menlo ships
  // with iOS — no font to bundle, no dependency.
  logLine: {
    fontFamily: "Menlo",
    fontSize: 11,
    lineHeight: 16,
  },
  logElision: {
    color: colors.secondaryLabel,
    fontStyle: "italic",
    marginBottom: 4,
  },
  loading: {
    marginTop: 32,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 18,
  },
  retryText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "500",
  },
});
