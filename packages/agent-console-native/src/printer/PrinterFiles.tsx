/**
 * The printer's files on the printer page: onboard storage and the USB drive,
 * with previews and print details, and uploads from the phone.
 *
 * An upload goes from the phone to the relay, then from the relay to the
 * printer (saturn-uploader's delivery: MD5 check, verified listing). It never
 * starts a print. While a print runs, the relay paces the upload so the
 * printer is not disturbed, and it refuses to replace the file being printed.
 *
 * @internal
 */
import * as DocumentPicker from "expo-document-picker";
import * as React from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { showToast } from "../AppToast";
import { colors } from "../colors";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";
import { fmtBytes, isPrintableName, settingsCells } from "./printerFormat";
import { cancelUpload, fetchFileInfo, fetchFiles, fetchUploads, filePreviewUrl, startUpload, UploadCancelled, UploadRefused, type FileList, type FileView, type PrintHeader, type UploadJob, type UploadStage } from "./relayApi";
import { Button, Card, Cells, Chip, GREEN, LCD, RED, UV, UV_INK } from "./ui";

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
}

const STAGE_LABEL: Record<Upload["stage"], string> = {
  uploading: "Uploading to the relay",
  queued: "Waiting its turn",
  hashing: "Preparing",
  sending: "Sending to the printer",
  verifying: "The printer is verifying it",
  done: "On the printer",
  failed: "Failed",
  cancelled: "Cancelled",
};

const finished = (stage: Upload["stage"]): boolean => stage === "done" || stage === "failed" || stage === "cancelled";

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** A relay job as an upload row: one this page started before it closed, or one from another device. */
const rowOf = (job: UploadJob): Upload => ({ key: job.id, name: job.name, size: job.size, stage: job.stage, progress: job.size > 0 ? job.sent / job.size : 0, paced: job.paced, error: job.error, jobId: job.id });

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
  };
})();

/** How many uploads are still on their way to the printer, for the page's Files tab. */
export const useRunningUploads = (): number => React.useSyncExternalStore(uploadStore.subscribe, uploadStore.rows).filter((u) => !finished(u.stage)).length;

const rootOf = (storage: "local" | "usb"): string => (storage === "usb" ? "/usb/" : "/local/");

const parentOf = (folder: string, root: string): string => (folder === root ? root : folder.slice(0, folder.slice(0, -1).lastIndexOf("/") + 1));

export const PrinterFiles = (props: { readonly relayBase: string; readonly reachable: boolean; readonly printingName: string | undefined; readonly usbIn: boolean }): React.ReactElement => {
  const { relayBase, reachable } = props;
  const text = useTextColors();
  const [storage, setStorage] = React.useState<"local" | "usb">("local");
  // The folder the owner asked for, and the last listing of it.
  const [path, setPath] = React.useState("/local/");
  const [list, setList] = React.useState<FileList | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [refreshes, setRefreshes] = React.useState(0);
  const uploads = React.useSyncExternalStore(uploadStore.subscribe, uploadStore.rows);
  const [open, setOpen] = React.useState<FileView | undefined>(undefined);

  // List the folder. A reply for a folder the owner has left is dropped.
  React.useEffect(() => {
    if (!reachable) return;
    let current = true;
    setLoading(true);
    fetchFiles(relayBase, path)
      .then((next) => {
        if (!current) return;
        setList(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setList(undefined);
        setError(path.startsWith("/usb/") ? "No USB drive, or it could not be read." : `Could not list the printer's files: ${messageOf(cause)}`);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      setLoading(false);
    };
  }, [relayBase, reachable, path, refreshes]);

  const refresh = (): void => setRefreshes((n) => n + 1);

  const go = (target: string): void => {
    if (target === path) {
      refresh();
      return;
    }
    setPath(target);
    setList(undefined);
    setError(undefined);
  };

  const chooseStorage = (next: "local" | "usb"): void => {
    setStorage(next);
    go(rootOf(next));
  };

  // Show uploads that went on while the page was closed, or that another device started.
  React.useEffect(() => {
    if (!reachable) return;
    let current = true;
    fetchUploads(relayBase)
      .then((jobs) => {
        if (current) uploadStore.change((rows) => [...jobs.filter((job) => !finished(job.stage) && !rows.some((u) => u.jobId === job.id)).map(rowOf), ...rows]);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [relayBase, reachable]);

  // Follow the relay's jobs while any upload is still on its way to the printer.
  const following = uploads.some((u) => u.jobId !== undefined && !finished(u.stage));
  React.useEffect(() => {
    if (!following) return;
    let current = true;
    const tick = (): void => {
      fetchUploads(relayBase)
        .then((jobs) => {
          if (!current) return;
          let landed = false;
          uploadStore.change((rows) =>
            rows.map((u): Upload => {
              if (u.jobId === undefined || finished(u.stage)) return u;
              const job = jobs.find((j) => j.id === u.jobId);
              // The relay keeps a job until it finishes, so a missing one was lost in a relay restart.
              if (job === undefined) return { ...u, stage: "failed", error: "The relay restarted and lost this upload. Upload it again." };
              if (job.stage === "done") {
                landed = true;
                showToast({ message: `${job.name} is on the printer.` });
              }
              if (job.stage === "failed") showToast({ message: `${job.name}: ${job.error ?? "the upload failed"}` });
              return { ...u, stage: job.stage, progress: job.size > 0 ? job.sent / job.size : 0, paced: job.paced, error: job.error };
            }),
          );
          if (landed) setRefreshes((n) => n + 1);
        })
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [following, relayBase]);

  const send = (asset: DocumentPicker.DocumentPickerAsset, overwrite: boolean): void => {
    const key = `${Date.now()}-${asset.name}`;
    const fresh: Upload = { key, name: asset.name, size: asset.size, stage: "uploading", progress: 0, paced: false, error: undefined, jobId: undefined };
    // Keep the newest six rows, and every upload still running.
    uploadStore.change((rows) => [fresh, ...rows].filter((u, index) => index < 6 || !finished(u.stage)));
    const update = (change: (u: Upload) => Upload): void => uploadStore.change((rows) => rows.map((u) => (u.key === key ? change(u) : u)));
    const upload = startUpload(relayBase, asset.uri, asset.name, overwrite, (fraction) => update((u) => ({ ...u, progress: fraction })));
    uploadStore.cancels.set(key, upload.cancel);
    upload.done
      .then((job) => update((u) => ({ ...u, stage: job.stage, progress: 0, jobId: job.id })))
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
          const listed = list?.storage === "local" && list.path === "/local/" && list.entries.some((e) => e.kind === "file" && e.name === asset.name);
          if (listed) {
            Alert.alert(`Replace ${asset.name}?`, "A file with this name is already on the printer. The upload replaces it.", [
              { text: "Cancel", style: "cancel" },
              { text: "Replace", onPress: () => send(asset, true) },
            ]);
          } else {
            send(asset, false);
          }
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

  const files = list?.entries ?? [];
  const fileCount = files.filter((e) => e.kind === "file").length;
  const root = rootOf(storage);
  const inFolder = path !== root;

  const right = (
    <View style={styles.headRight}>
      {fileCount > 0 ? <Text style={[styles.count, { color: text.tertiaryLabel }]}>{fileCount}</Text> : null}
      <Pressable hitSlop={8} onPress={refresh} accessibilityLabel="Refresh">
        {loading ? <ActivityIndicator /> : <SystemIcon name="arrow.clockwise" size={15} color={text.secondaryLabel} weight="semibold" />}
      </Pressable>
    </View>
  );

  return (
    <Card title="Files" right={right}>
      <View style={styles.toolbar}>
        <View style={styles.segment}>
          {(["local", "usb"] as const).map((s) => (
            <Pressable key={s} disabled={s === "usb" && !props.usbIn} onPress={() => chooseStorage(s)} style={[styles.segmentItem, storage === s ? styles.segmentOn : null, s === "usb" && !props.usbIn ? styles.segmentOff : null]}>
              <Text style={[styles.segmentText, { color: storage === s ? text.label : text.secondaryLabel }]}>{s === "local" ? "Printer" : "USB drive"}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Upload" icon="square.and.arrow.up" kind="primary" disabled={!reachable} onPress={pick} style={styles.uploadButton} />
      </View>

      {uploads.map((u) => (
        <View key={u.key} style={[styles.job, u.stage === "done" ? styles.jobDone : u.stage === "failed" ? styles.jobFailed : null]}>
          <View style={styles.jobTop}>
            <Text style={[styles.jobName, { color: text.label }]} numberOfLines={1}>
              {u.name}
            </Text>
            <Text style={[styles.jobState, { color: text.secondaryLabel }]} numberOfLines={1}>
              {STAGE_LABEL[u.stage]}
              {u.stage === "uploading" || (u.stage === "sending" && u.progress > 0) ? ` · ${Math.floor(u.progress * 100)}%` : ""}
            </Text>
            <Pressable hitSlop={8} onPress={() => (finished(u.stage) ? uploadStore.change((rows) => rows.filter((x) => x.key !== u.key)) : cancel(u))} accessibilityLabel={finished(u.stage) ? "Dismiss" : "Cancel"}>
              <SystemIcon name="xmark" size={12} color={text.secondaryLabel} weight="bold" />
            </Pressable>
          </View>
          <View style={styles.jobTrack}>
            <View style={[styles.jobFill, { width: `${u.stage === "done" ? 100 : Math.min(100, u.progress * 100)}%`, backgroundColor: u.stage === "done" ? GREEN : u.stage === "failed" ? RED : UV }]} />
          </View>
          {u.stage === "failed" && u.error !== undefined ? <Text style={[styles.jobNote, { color: RED }]}>{u.error}</Text> : null}
          {u.paced && !finished(u.stage) ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>Paced to protect the running print.</Text> : null}
          {u.stage === "sending" && u.progress === 0 ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>The printer takes a few seconds to accept the first packet.</Text> : null}
          {u.stage === "done" ? <Text style={[styles.jobNote, { color: text.tertiaryLabel }]}>Start it on the printer when you are ready.</Text> : null}
        </View>
      ))}

      {inFolder ? (
        <Pressable style={styles.up} onPress={() => go(parentOf(path, root))}>
          <SystemIcon name="chevron.left" size={13} color={UV_INK} weight="semibold" />
          <Text style={[styles.upText, { color: UV_INK }]}>{path.slice(root.length, -1)}</Text>
        </Pressable>
      ) : null}

      {!reachable ? (
        <Text style={[styles.empty, { color: text.secondaryLabel }]}>The file browser needs the relay, which is not reachable.</Text>
      ) : error !== undefined ? (
        <Text style={[styles.empty, { color: text.secondaryLabel }]}>{error}</Text>
      ) : list === undefined ? (
        <ActivityIndicator style={styles.spinner} />
      ) : files.length === 0 ? (
        <Text style={[styles.empty, { color: text.secondaryLabel }]}>No print files here yet. Upload a .goo or .ctb file.</Text>
      ) : (
        files.map((entry, index) => <FileRow key={entry.path} entry={entry} relayBase={relayBase} last={index === files.length - 1} onPress={() => (entry.kind === "folder" ? go(entry.path) : setOpen(entry))} />)
      )}

      <Text style={[styles.hint, { color: text.tertiaryLabel }]}>Uploads go to the printer’s onboard storage. A running print is safe: uploads slow down while it prints, and nothing starts by itself.</Text>

      <FileSheet entry={open} relayBase={relayBase} onClose={() => setOpen(undefined)} />
    </Card>
  );
};

const FileRow = (props: { readonly entry: FileView; readonly relayBase: string; readonly last: boolean; readonly onPress: () => void }): React.ReactElement => {
  const text = useTextColors();
  const { entry } = props;
  const goo = entry.kind === "file" && /\.goo$/i.test(entry.name);
  const ext = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".") + 1).toUpperCase() : "";
  const meta = entry.kind === "folder" ? "Folder" : [fmtBytes(entry.size), ext].filter((s) => s !== "").join(" · ");
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.fileRow, props.last ? null : styles.fileLine, pressed ? styles.pressed : null]}>
      <View style={[styles.thumb, entry.kind === "folder" ? styles.thumbFolder : null]}>
        {goo ? <Image source={{ uri: filePreviewUrl(props.relayBase, entry.path) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <SystemIcon name={entry.kind === "folder" ? "folder.fill" : "doc"} size={18} color={entry.kind === "folder" ? UV_INK : "rgba(244,245,249,0.6)"} />}
      </View>
      <View style={styles.fileText}>
        <Text style={[styles.fileName, { color: text.label }]} numberOfLines={1}>
          {entry.name}
        </Text>
        <Text style={[styles.fileMeta, { color: text.tertiaryLabel }]}>{meta}</Text>
      </View>
      {entry.printing ? <Chip tone="uv" label="Printing" dot={false} /> : null}
      <SystemIcon name="chevron.right" size={13} color={text.tertiaryLabel} weight="semibold" />
    </Pressable>
  );
};

/** A file's preview and print details, read from the file's header on the printer. */
const FileSheet = (props: { readonly entry: FileView | undefined; readonly relayBase: string; readonly onClose: () => void }): React.ReactElement => {
  const text = useTextColors();
  const [info, setInfo] = React.useState<PrintHeader | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  // Keep the last file on screen while the sheet slides away.
  const [shown, setShown] = React.useState(props.entry);
  if (props.entry !== undefined && props.entry !== shown) setShown(props.entry);
  const entry = props.entry ?? shown;
  const goo = entry !== undefined && /\.goo$/i.test(entry.name);
  React.useEffect(() => {
    setInfo(undefined);
    setError(undefined);
    if (entry === undefined || !/\.goo$/i.test(entry.name)) return;
    let alive = true;
    fetchFileInfo(props.relayBase, entry.path)
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, [entry, props.relayBase]);
  return (
    <Modal visible={props.entry !== undefined} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.sheetPreview}>{goo && entry !== undefined ? <Image source={{ uri: filePreviewUrl(props.relayBase, entry.path, true) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <SystemIcon name="doc" size={30} color="rgba(244,245,249,0.6)" />}</View>
          <View style={styles.sheetText}>
            <Text style={[styles.sheetEyebrow, { color: text.tertiaryLabel }]}>{entry?.printing === true ? "PRINTING NOW" : entry?.path.startsWith("/usb/") === true ? "ON THE USB DRIVE" : "ON THE PRINTER"}</Text>
            <Text style={[styles.sheetName, { color: text.label }]}>{entry?.name ?? ""}</Text>
            <Text style={[styles.fileMeta, { color: text.secondaryLabel }]}>{fmtBytes(entry?.size)}</Text>
          </View>
        </View>
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
  headRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  segment: { flex: 1, flexDirection: "row", padding: 3, borderRadius: 11, backgroundColor: "rgba(127,127,127,0.14)" },
  segmentItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  segmentOff: { opacity: 0.4 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  uploadButton: { height: 38, paddingHorizontal: 14 },
  job: { padding: 12, borderRadius: 13, backgroundColor: "rgba(143,115,255,0.12)", marginBottom: 8 },
  jobDone: { backgroundColor: "rgba(50,208,124,0.12)" },
  jobFailed: { backgroundColor: "rgba(255,90,95,0.12)" },
  jobTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  jobName: { flex: 1, fontSize: 14, fontWeight: "600" },
  jobState: { fontSize: 12, fontVariant: ["tabular-nums"] },
  jobTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
  jobFill: { height: 4, borderRadius: 2 },
  jobNote: { fontSize: 12, marginTop: 6 },
  up: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 },
  upText: { fontSize: 14, fontWeight: "600" },
  empty: { fontSize: 14, textAlign: "center", paddingVertical: 20 },
  spinner: { paddingVertical: 20 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  fileLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  pressed: { opacity: 0.6 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: "hidden", backgroundColor: LCD, alignItems: "center", justifyContent: "center" },
  thumbFolder: { backgroundColor: "rgba(143,115,255,0.18)" },
  fileText: { flex: 1 },
  fileName: { fontSize: 15, fontWeight: "600" },
  fileMeta: { fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },
  hint: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  sheet: { padding: 20, paddingBottom: 48 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 },
  sheetPreview: { width: 120, height: 120, borderRadius: 18, overflow: "hidden", backgroundColor: LCD, alignItems: "center", justifyContent: "center" },
  sheetText: { flex: 1 },
  sheetEyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  sheetName: { fontSize: 20, fontWeight: "700", marginTop: 4, letterSpacing: -0.3 },
  sheetDone: { marginTop: 20 },
});
