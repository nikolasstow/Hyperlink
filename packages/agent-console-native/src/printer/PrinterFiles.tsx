/**
 * The printer's files on the printer page: the shared explorer's home over
 * the relay (explorer/httpFileSource.ts). It shows the storage areas as tabs
 * (the printer, its USB drive, the home server), then the recent prints, then
 * the files, with previews. A file that a plugin viewer takes opens in it
 * (viewers/fileViewers.ts: a `.goo` opens its 3D model and details); any
 * other file opens its details, and a printer or USB file can print from
 * there.
 *
 * Uploads go from the phone to the relay, then from the relay to the printer
 * (saturn-uploader's delivery: MD5 check, verified listing). Uploads that
 * other devices send show too (`useUploadWatch`), from their first byte at the
 * relay, with who sent them. An upload never starts a print. While a print runs, the relay paces the upload so the
 * printer is not disturbed, and it refuses to replace the file being printed.
 *
 * @internal
 */
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as React from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { showToast } from "../AppToast";
import { colors } from "../colors";
import { ExplorerHome } from "../explorer/ExplorerHome";
import { httpFileSource, previewUrl } from "../explorer/httpFileSource";
import type { SourceRow } from "../explorer/sourceRows";
import type { RootStackParamList } from "../RootNavigator";
import { SystemIcon } from "../SystemIcon";
import { useTextColors, withAlpha } from "../theme";
import { isPrintableName, settingsCells } from "./printerFormat";
import { cancelUpload, fetchFileInfo, fetchUploads, printFile, startUpload, UploadCancelled, UploadRefused, type PrintHeader, type UploadJob, type UploadStage } from "./relayApi";
import { Button, Card, Cells, LCD, usePalette } from "./ui";
import { viewerFor } from "../viewers/fileViewers";
import { authedSource } from "../auth/serverTokens";

/** An upload as the page shows it: the phone's leg, then the relay's job. */
interface Upload {
  readonly key: string;
  readonly name: string;
  readonly size: number | undefined;
  readonly stage: "uploading" | UploadStage;
  /** 0 to 1 for the current leg. */
  readonly progress: number;
  readonly paced: boolean;
  readonly error: string | undefined;
  readonly jobId: string | undefined;
  /** Who sent it, from the relay. */
  readonly from: string | undefined;
  /** True for an upload another device sends. */
  readonly remote: boolean;
}

const STAGE_LABEL: Record<Upload["stage"], string> = {
  uploading: "Uploading to the relay",
  receiving: "Arriving at the relay",
  queued: "Waiting its turn",
  copying: "Copying",
  editing: "Changing settings",
  hashing: "Preparing",
  sending: "Sending to the printer",
  verifying: "The printer is verifying it",
  saving: "Saving",
  starting: "Starting the print",
  done: "On the printer",
  failed: "Failed",
  cancelled: "Cancelled",
};

const finished = (stage: Upload["stage"]): boolean => stage === "done" || stage === "failed" || stage === "cancelled";

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The current leg's progress, 0 to 1: the bytes the relay has while it receives, then the bytes the printer has. */
const progressOf = (job: UploadJob): number => (job.size > 0 ? (job.stage === "receiving" ? (job.received ?? 0) : job.sent) / job.size : 0);

/** A relay job as an upload row: one this page started before it closed, or one from another device. */
const rowOf = (job: UploadJob): Upload => ({
  key: job.id,
  name: job.name,
  size: job.size,
  stage: job.stage,
  progress: progressOf(job),
  paced: job.paced,
  error: job.error,
  jobId: job.id,
  from: job.from,
  remote: true,
});

/**
 * The upload rows, kept outside the page: an upload goes on when the owner
 * leaves the page, and shows again when they come back.
 */
const uploadStore = (() => {
  let rows: ReadonlyArray<Upload> = [];
  const listeners = new Set<() => void>();
  return {
    rows: (): ReadonlyArray<Upload> => rows,
    change: (next: (current: ReadonlyArray<Upload>) => ReadonlyArray<Upload>): void => {
      rows = next(rows);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Cancels for uploads still on the phone's leg, by row key. */
    cancels: new Map<string, () => void>(),
    /** Relay jobs already shown or dismissed, so a dismissed one does not come back. */
    seen: new Set<string>(),
    /** Counts the uploads that reached the printer, so the file list reloads. */
    landed: 0,
  };
})();

/** How many uploads are still on their way to the printer, for the page's Files button. */
export const useRunningUploads = (): number => React.useSyncExternalStore(uploadStore.subscribe, uploadStore.rows).filter((u) => !finished(u.stage)).length;

/** How often the relay's jobs are read while an upload runs, and while none does. Reading them is cache-only on the relay. */
const WATCH_RUNNING_MS = 1000;
const WATCH_IDLE_MS = 3000;

/**
 * Follows the relay's upload jobs while the printer page is open: this
 * phone's uploads, and the ones other devices send, which show from their
 * first byte at the relay. At first only the jobs still running show; after
 * that every new job does, also one that ended between two reads.
 */
export const useUploadWatch = (relayBase: string, reachable: boolean): void => {
  React.useEffect(() => {
    if (!reachable) return;
    let current = true;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      fetchUploads(relayBase)
        .then((jobs) => {
          if (!current) return;
          let landed = false;
          uploadStore.change((rows) => {
            const known = rows.map((u): Upload => {
              if (u.jobId === undefined || finished(u.stage)) return u;
              const job = jobs.find((j) => j.id === u.jobId);
              // The relay keeps a job until it finishes, so a missing one was lost in a relay restart.
              if (job === undefined) return { ...u, stage: "failed", error: "The relay restarted and lost this upload. Upload it again." };
              if (job.stage === "done") {
                landed = true;
                showToast({ message: `${job.name} is on the printer.` });
              }
              if (job.stage === "failed") showToast({ message: `${job.name}: ${job.error ?? "the upload failed"}` });
              return { ...u, stage: job.stage, progress: progressOf(job), paced: job.paced, error: job.error, from: job.from };
            });
            const fresh = jobs.filter((job) => {
              if (uploadStore.seen.has(job.id) || rows.some((u) => u.jobId === job.id)) return false;
              uploadStore.seen.add(job.id);
              // This phone's own upload, still arriving: its row gets the job's id when the relay answers.
              const ours = job.stage === "receiving" && rows.some((u) => u.stage === "uploading" && u.name === job.name);
              return !ours && !(first && finished(job.stage));
            });
            return [...fresh.map(rowOf), ...known];
          });
          first = false;
          if (landed) {
            uploadStore.landed += 1;
            uploadStore.change((rows) => rows);
          }
        })
        .catch((cause: unknown) => console.error("[printer] following the relay's uploads failed", cause))
        .finally(() => {
          if (!current) return;
          const running = uploadStore.rows().some((u) => !finished(u.stage));
          timer = setTimeout(tick, running ? WATCH_RUNNING_MS : WATCH_IDLE_MS);
        });
    };
    tick();
    return () => {
      current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [relayBase, reachable]);
};

/** A file the details sheet shows. */
interface OpenFile {
  readonly path: string;
  readonly name: string;
  readonly detail: string | undefined;
  readonly printing: boolean;
}

const isPrinterFile = (path: string): boolean => path.startsWith("/local/") || path.startsWith("/usb/");

export const PrinterFiles = (props: {
  readonly relayBase: string;
  readonly reachable: boolean;
  /** The file being printed, while a print runs or waits paused. */
  readonly printingName: string | undefined;
}): React.ReactElement => {
  const { relayBase, reachable } = props;
  const text = useTextColors();
  const palette = usePalette();
  const source = React.useMemo(() => httpFileSource(relayBase), [relayBase]);
  const [reloadKey, setReloadKey] = React.useState(0);
  const uploads = React.useSyncExternalStore(uploadStore.subscribe, uploadStore.rows);
  const [open, setOpen] = React.useState<OpenFile | undefined>(undefined);
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const refresh = (): void => setReloadKey((n) => n + 1);

  // An upload that reached the printer: show it in the list.
  const landed = React.useSyncExternalStore(uploadStore.subscribe, () => uploadStore.landed);
  React.useEffect(() => {
    if (landed > 0) setReloadKey((n) => n + 1);
  }, [landed]);

  const send = (asset: DocumentPicker.DocumentPickerAsset, overwrite: boolean): void => {
    const key = `${Date.now()}-${asset.name}`;
    const fresh: Upload = { key, name: asset.name, size: asset.size, stage: "uploading", progress: 0, paced: false, error: undefined, jobId: undefined, from: undefined, remote: false };
    // Keep the newest six rows, and every upload still running.
    uploadStore.change((rows) => [fresh, ...rows].filter((u, index) => index < 6 || !finished(u.stage)));
    const update = (change: (u: Upload) => Upload): void => uploadStore.change((rows) => rows.map((u) => (u.key === key ? change(u) : u)));
    const upload = startUpload(relayBase, asset.uri, asset.name, overwrite, (fraction) => update((u) => ({ ...u, progress: fraction })));
    uploadStore.cancels.set(key, upload.cancel);
    upload.done
      .then((job) => {
        uploadStore.seen.add(job.id);
        update((u) => ({ ...u, stage: job.stage, progress: 0, jobId: job.id, from: job.from }));
      })
      .catch((cause: unknown) => {
        if (cause instanceof UploadRefused && cause.exists) {
          uploadStore.change((rows) => rows.filter((u) => u.key !== key));
          Alert.alert(`Replace ${asset.name}?`, "A file with this name is already on the printer. The upload replaces it.", [
            { text: "Cancel", style: "cancel" },
            { text: "Replace", onPress: () => send(asset, true) },
          ]);
          return;
        }
        update((u) => ({ ...u, stage: cause instanceof UploadCancelled ? "cancelled" : "failed", error: messageOf(cause) }));
      })
      .finally(() => uploadStore.cancels.delete(key));
  };

  const pick = (): void => {
    DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false })
      .then((result) => {
        if (result.canceled) return;
        for (const asset of result.assets) {
          if (!isPrintableName(asset.name)) {
            Alert.alert("Not a print file", `${asset.name}: the printer prints .goo and .ctb files only.`);
            continue;
          }
          if (props.printingName !== undefined && asset.name === props.printingName) {
            Alert.alert("Printing now", `${asset.name} is printing. It cannot be replaced until the print ends.`);
            continue;
          }
          // The relay asks before it replaces a file of the same name (UploadRefused with `exists`).
          send(asset, false);
        }
      })
      .catch((cause: unknown) => showToast({ message: `Could not open the file picker: ${messageOf(cause)}` }));
  };

  const cancel = (u: Upload): void => {
    const local = uploadStore.cancels.get(u.key);
    if (local !== undefined) {
      local();
      return;
    }
    if (u.jobId === undefined) return;
    cancelUpload(relayBase, u.jobId).catch((cause: unknown) => showToast({ message: `Could not cancel ${u.name}: ${messageOf(cause)}` }));
  };

  const openRow = (row: SourceRow): void => {
    const target = { endpoint: reachable ? relayBase : undefined, path: row.path, name: row.name };
    const viewer = viewerFor(target);
    if (viewer !== undefined) viewer.open(navigation, target);
    else setOpen({ path: row.path, name: row.name, detail: row.detail, printing: row.badge === "Printing" });
  };

  const right = (
    <View style={styles.headRight}>
      <Pressable hitSlop={8} onPress={refresh} accessibilityLabel="Refresh">
        <SystemIcon name="arrow.clockwise" size={15} color={text.secondaryLabel} weight="semibold" />
      </Pressable>
      <Pressable hitSlop={8} onPress={pick} disabled={!reachable} accessibilityLabel="Upload to the printer">
        <SystemIcon name="square.and.arrow.up" size={16} color={reachable ? palette.accent : text.tertiaryLabel} weight="semibold" />
      </Pressable>
    </View>
  );

  return (
    <Card title="Files" right={right}>
      {uploads.map((u) => (
        <View key={u.key} style={[styles.job, { backgroundColor: withAlpha(u.stage === "done" ? palette.ok : u.stage === "failed" ? palette.bad : palette.accent, 0.12) }]}>
          <View style={styles.jobTop}>
            <Text style={[styles.jobName, { color: text.label }]} numberOfLines={1}>
              {u.name}
            </Text>
            <Text style={[styles.jobState, { color: text.secondaryLabel }]} numberOfLines={1}>
              {STAGE_LABEL[u.stage]}
              {u.stage === "uploading" || u.stage === "receiving" || (u.stage === "sending" && u.progress > 0) ? ` · ${Math.floor(u.progress * 100)}%` : ""}
            </Text>
            {/* The relay cannot stop an upload that another device is still sending. */}
            {u.remote && u.stage === "receiving" ? null : (
              <Pressable hitSlop={8} onPress={() => (finished(u.stage) ? uploadStore.change((rows) => rows.filter((x) => x.key !== u.key)) : cancel(u))} accessibilityLabel={finished(u.stage) ? "Dismiss" : "Cancel"}>
                <SystemIcon name="xmark" size={12} color={text.secondaryLabel} weight="bold" />
              </Pressable>
            )}
          </View>
          <View style={styles.jobTrack}>
            <View style={[styles.jobFill, { width: `${u.stage === "done" ? 100 : Math.min(100, u.progress * 100)}%`, backgroundColor: u.stage === "done" ? palette.ok : u.stage === "failed" ? palette.bad : palette.accent }]} />
          </View>
          {u.from !== undefined ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>From {u.from}.</Text> : null}
          {u.stage === "failed" && u.error !== undefined ? <Text style={[styles.jobNote, { color: palette.bad }]}>{u.error}</Text> : null}
          {u.paced && !finished(u.stage) ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>Paced to protect the running print.</Text> : null}
          {u.stage === "sending" && u.progress === 0 ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>The printer takes a few seconds to accept the first packet.</Text> : null}
          {u.stage === "done" ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>Open it below to print it.</Text> : null}
        </View>
      ))}

      {!reachable ? (
        <Text style={[styles.empty, { color: text.secondaryLabel }]}>The file browser needs the relay, which is not reachable.</Text>
      ) : (
        <ExplorerHome source={source} onOpen={openRow} folderTap="expand" reloadKey={reloadKey} emptyText="No print files here yet. Upload a .goo or .ctb file." />
      )}

      <Text style={[styles.hint, { color: text.tertiaryLabel }]}>Uploads go to the printer’s onboard storage. A running print is safe: uploads slow down while it prints, and nothing starts by itself.</Text>

      <FileSheet file={open} relayBase={relayBase} printRunning={props.printingName !== undefined} onClose={() => setOpen(undefined)} onPrinted={refresh} />
    </Card>
  );
};

/** A file's preview and print details, read from the file's header, and Print for a printer or USB file. */
const FileSheet = (props: { readonly file: OpenFile | undefined; readonly relayBase: string; readonly printRunning: boolean; readonly onClose: () => void; readonly onPrinted: () => void }): React.ReactElement => {
  const text = useTextColors();
  const [info, setInfo] = React.useState<PrintHeader | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [starting, setStarting] = React.useState(false);
  // Keep the last file on screen while the sheet slides away.
  const [shown, setShown] = React.useState(props.file);
  if (props.file !== undefined && props.file !== shown) setShown(props.file);
  const file = props.file ?? shown;
  const goo = file !== undefined && /\.goo$/i.test(file.name);
  React.useEffect(() => {
    setInfo(undefined);
    setError(undefined);
    if (file === undefined || !/\.goo$/i.test(file.name)) return;
    let alive = true;
    fetchFileInfo(props.relayBase, file.path)
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(messageOf(cause));
      });
    return () => {
      alive = false;
    };
  }, [file, props.relayBase]);

  const canPrint = file !== undefined && isPrinterFile(file.path) && isPrintableName(file.name) && !props.printRunning;
  const print = (): void => {
    if (file === undefined) return;
    Alert.alert(`Print ${file.name}?`, "Make sure the build plate is clean and the vat has enough resin. The print starts from the first layer.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Print",
        onPress: () => {
          setStarting(true);
          printFile(props.relayBase, file.path)
            .then(() => {
              showToast({ message: `Printing ${file.name}.` });
              props.onPrinted();
              props.onClose();
            })
            .catch((cause: unknown) => Alert.alert("The print did not start", messageOf(cause)))
            .finally(() => setStarting(false));
        },
      },
    ]);
  };

  const where = file === undefined ? "" : file.printing ? "PRINTING NOW" : file.path.startsWith("/usb/") ? "ON THE USB DRIVE" : file.path.startsWith("/server/") ? "ON THE HOME SERVER" : "ON THE PRINTER";
  return (
    <Modal visible={props.file !== undefined} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.sheetPreview}>{goo && file !== undefined ? <Image source={authedSource(previewUrl(props.relayBase, file.path, true))} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <SystemIcon name="doc" size={30} color="rgba(244,245,249,0.6)" />}</View>
          <View style={styles.sheetText}>
            <Text style={[styles.sheetEyebrow, { color: text.tertiaryLabel }]}>{where}</Text>
            <Text style={[styles.sheetName, { color: text.label }]}>{file?.name ?? ""}</Text>
            {file?.detail !== undefined ? <Text style={[styles.sheetMeta, { color: text.secondaryLabel }]}>{file.detail}</Text> : null}
          </View>
        </View>
        {file !== undefined && isPrinterFile(file.path) && isPrintableName(file.name) ? (
          <Button label={props.printRunning ? "A print is running" : "Print"} icon="printer.fill" kind="primary" busy={starting} disabled={!canPrint} onPress={print} style={styles.sheetPrint} />
        ) : null}
        {!goo ? (
          <Text style={[styles.empty, { color: text.secondaryLabel }]}>Details are shown for .goo files.</Text>
        ) : info !== undefined ? (
          <Cells cells={settingsCells(info)} />
        ) : error !== undefined ? (
          <Text style={[styles.empty, { color: text.secondaryLabel }]}>Could not read the file: {error}</Text>
        ) : (
          <ActivityIndicator style={styles.spinner} />
        )}
        <Button label="Done" onPress={props.onClose} style={styles.sheetDone} />
      </ScrollView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  headRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  job: { padding: 12, borderRadius: 13, marginBottom: 8 },
  jobTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  jobName: { flex: 1, fontSize: 14, fontWeight: "600" },
  jobState: { fontSize: 12, fontVariant: ["tabular-nums"] },
  jobTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
  jobFill: { height: 4, borderRadius: 2 },
  jobNote: { fontSize: 12, marginTop: 6 },
  empty: { fontSize: 14, textAlign: "center", paddingVertical: 20 },
  spinner: { paddingVertical: 20 },
  hint: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  sheet: { padding: 20, paddingBottom: 48 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 },
  sheetPreview: { width: 120, height: 120, borderRadius: 18, overflow: "hidden", backgroundColor: LCD, alignItems: "center", justifyContent: "center" },
  sheetText: { flex: 1 },
  sheetEyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  sheetName: { fontSize: 20, fontWeight: "700", marginTop: 4, letterSpacing: -0.3 },
  sheetMeta: { fontSize: 13, marginTop: 4 },
  sheetPrint: { marginBottom: 16 },
  sheetDone: { marginTop: 20 },
});
