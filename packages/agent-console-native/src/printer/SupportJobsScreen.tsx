/**
 * Support jobs: the relay owns each job (slice/plan/burn stages, the plan, the
 * burned result). Both the desktop and this app render the SAME job by id, so
 * a job started on the Mac continues on the phone.
 *
 * The native shell stays thin on purpose: a jobs LIST and per-job PROGRESS
 * (polled from the relay), then the review/approve step is the relay's own
 * page in a WebView. The page changes often and stays off the app binary; the
 * list and the progress change rarely and are native (the owner's "proper UI").
 *
 * The list and progress work against the live relay today. The Review/Approve
 * WebView needs the relay's `/page` route and its `?token=` sign-in, which ship
 * with the approval-page relay branch.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import * as React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { RootStackParamList } from "../RootNavigator";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";
import { Backdrop } from "./Backdrop";
import { approvalPageUrl, burnSupportJob, fetchSupportJob, fetchSupportJobs, type SupportJob, supportJobBusy } from "./relayApi";
import { useRelayToken } from "./relayToken";
import { relayBaseOf } from "./sdcp";
import { Card, Chip, type Tone, usePalette } from "./ui";

/** The base name of a library path, for the job's title. */
const baseName = (path: string): string => path.split("/").pop() ?? path;

/** How a job's stage reads, and its tone. */
const stageOf = (job: SupportJob): { readonly label: string; readonly tone: Tone } => {
  const step = job.step ?? undefined;
  const seconds = job.seconds ?? undefined;
  const progress = step === undefined ? "" : ` · ${step}${seconds === undefined ? "" : ` ${seconds.toFixed(0)}s`}`;
  switch (job.stage) {
    case "waiting":
      return { label: `Waiting${job.waitingFor === undefined || job.waitingFor === null ? "" : ` for ${job.waitingFor}`}`, tone: "plain" };
    case "analyzing":
      return { label: `Planning${progress}`, tone: "uv" };
    case "ready":
      return { label: "Ready — supports planned", tone: "ok" };
    case "burning":
      return { label: `Burning${progress}`, tone: "uv" };
    case "burned":
      return job.burn?.passed === true ? { label: "Burned — review and approve", tone: "ok" } : { label: "Burn failed its check", tone: "bad" };
    case "failed":
      return { label: job.error ?? "Failed", tone: "bad" };
    default:
      return { label: job.stage, tone: "plain" };
  }
};

/** Polls the relay for every job while the screen is open. */
const useSupportJobs = (relayBase: string): ReadonlyArray<SupportJob> | undefined => {
  const [jobs, setJobs] = React.useState<ReadonlyArray<SupportJob> | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    const tick = (): void => {
      fetchSupportJobs(relayBase)
        .then((next) => {
          if (alive) setJobs(next);
        })
        .catch((cause: unknown) => console.error("[support] reading the jobs failed", cause));
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [relayBase]);
  return jobs;
};

/** Polls one job while the screen is open; faster while the relay still works on it. */
const useSupportJob = (relayBase: string, jobId: string): SupportJob | undefined => {
  const [job, setJob] = React.useState<SupportJob | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    const tick = (): void => {
      fetchSupportJob(relayBase, jobId)
        .then((next) => {
          if (alive) setJob(next);
        })
        .catch((cause: unknown) => console.error("[support] reading the job failed", cause));
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [relayBase, jobId]);
  return job;
};

type ListProps = NativeStackScreenProps<RootStackParamList, "ServerSupportJobs">;

export const SupportJobsScreen = (props: ListProps): React.ReactElement => {
  const { serverAddress, serverName } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const jobs = useSupportJobs(relayBase);
  return (
    <View style={styles.root}>
      <Backdrop uri={undefined} glow={0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.narrow}>
          {jobs === undefined
            ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>Loading the jobs…</Text>
            : jobs.length === 0
            ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>No support jobs yet. Start one from the Mac.</Text>
            : jobs.map((job) => {
              const stage = stageOf(job);
              return (
                <Pressable key={job.id} onPress={() => props.navigation.navigate("ServerSupportJob", { serverName, serverAddress, jobId: job.id })}>
                  <Card title={undefined}>
                    <View style={styles.jobRow}>
                      <View style={styles.jobText}>
                        <Text style={[styles.jobTitle, { color: text.label }]} numberOfLines={1}>{baseName(job.gooPath)}</Text>
                        <Text style={[styles.jobNote, { color: text.tertiaryLabel }]} numberOfLines={1}>{stage.label}</Text>
                      </View>
                      <Chip tone={stage.tone} label={job.stage} />
                    </View>
                  </Card>
                </Pressable>
              );
            })}
        </View>
      </ScrollView>
    </View>
  );
};

type JobProps = NativeStackScreenProps<RootStackParamList, "ServerSupportJob">;

export const SupportJobScreen = (props: JobProps): React.ReactElement => {
  const { jobId, serverAddress } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const token = useRelayToken(relayBase);
  const text = useTextColors();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const job = useSupportJob(relayBase, jobId);
  const [review, setReview] = React.useState(false);
  const [burning, setBurning] = React.useState(false);

  const burn = React.useCallback(() => {
    setBurning(true);
    burnSupportJob(relayBase, jobId)
      .catch((cause: unknown) => console.error("[support] starting the burn failed", cause))
      .finally(() => setBurning(false));
  }, [relayBase, jobId]);

  const stage = job === undefined ? undefined : stageOf(job);
  const ready = job?.stage === "ready";
  const burned = job?.stage === "burned" && job.burn?.passed === true;

  return (
    <View style={styles.root}>
      <Backdrop uri={undefined} glow={0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.narrow}>
          {job === undefined || stage === undefined
            ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>Loading the job…</Text>
            : (
              <>
                <Card title="Support job">
                  <Text style={[styles.jobTitle, { color: text.label }]} numberOfLines={1}>{baseName(job.gooPath)}</Text>
                  <View style={styles.stageRow}>
                    {supportJobBusy(job) ? <ActivityIndicator color={palette.accent} /> : null}
                    <Text style={[styles.jobNote, { color: text.secondaryLabel }]}>{stage.label}</Text>
                  </View>
                </Card>
                {ready ? (
                  <Pressable style={[styles.action, { backgroundColor: palette.accent }]} onPress={burn} disabled={burning}>
                    <SystemIcon name="flame.fill" size={16} color="#14181d" weight="semibold" />
                    <Text style={styles.actionLabel}>{burning ? "Starting…" : "Burn supports"}</Text>
                  </Pressable>
                ) : null}
                {burned ? (
                  <Pressable style={[styles.action, { backgroundColor: palette.accent }]} onPress={() => setReview(true)}>
                    <SystemIcon name="checkmark.seal.fill" size={16} color="#14181d" weight="semibold" />
                    <Text style={styles.actionLabel}>Review and approve</Text>
                  </Pressable>
                ) : null}
                {job.error !== undefined && job.error !== null ? <Text style={[styles.err, { color: palette.bad }]}>{job.error}</Text> : null}
              </>
            )}
        </View>
      </ScrollView>
      <Modal visible={review} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setReview(false)}>
        <View style={styles.fullScreen}>
          {review ? <WebView source={{ uri: approvalPageUrl(relayBase, jobId, token) }} style={styles.web} originWhitelist={["*"]} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} /> : null}
          <Pressable style={[styles.close, { top: insets.top + 12 }]} hitSlop={10} onPress={() => setReview(false)} accessibilityLabel="Close">
            <SystemIcon name="xmark" size={15} color="#ffffff" weight="bold" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  narrow: { width: "100%", maxWidth: 700, alignSelf: "center", gap: 12 },
  foot: { fontSize: 13, textAlign: "center", marginTop: 40 },
  jobRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  jobText: { flex: 1, gap: 2 },
  jobTitle: { fontSize: 16, fontWeight: "600" },
  jobNote: { fontSize: 13 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 12 },
  actionLabel: { fontSize: 16, fontWeight: "600", color: "#14181d" },
  err: { fontSize: 14, marginTop: 4 },
  fullScreen: { flex: 1, backgroundColor: "#000000" },
  web: { flex: 1, backgroundColor: "#14181d" },
  close: { position: "absolute", right: 16, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
});
