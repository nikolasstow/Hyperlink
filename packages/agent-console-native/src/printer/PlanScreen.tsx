/**
 * The plan review page: one run's support plan, to review before a print.
 *
 * - 3D: the model and the plan's supports (ModelViewer, every triangle).
 *   A tap on any part of a support (contact, cone, neck, stem, shaft, leg,
 *   brace, base) selects its tree; the whole tree is marked.
 * - The cut: a top view of the plane at any height, the model grey and the
 *   supports orange, from the relay (`section.png`). The slider moves the
 *   height; a tap on a support's section selects its tree.
 * - When more than one support is under the finger, a short list asks
 *   which one: the page never guesses.
 * - The selected support: its position ID, tree, tip and contact radius,
 *   neck, stem, and shaft, its tree's load U, and the requirements and
 *   notes about its position.
 * - Feedback: a note or a requirement about the selected support, stored
 *   in runs.db with its position ID and the run (the catalog's one write).
 * - The requirements that name a position are marked in 3D and on the cut.
 *
 * Timings go to the perf log: the page's first frame, each cut from the
 * slider to its image, and each tap to its details.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { File } from "expo-file-system";
import * as React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type GestureResponderEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ModelViewer, type ModelMarker } from "../../modules/model-viewer";
import { authedSource } from "../auth/serverTokens";
import { useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground, useTextColors, withAlpha } from "../theme";
import { useLoadedUri } from "./PrinterStage";
import { openModel, type PrintModel } from "./printModel";
import { makeDownloads, type DownloadState } from "./relayDownload";
import { fetchPicks, loadCatalog, notesRoute, planMeshUrl, planRoute, requirementsRoute, sectionUrl, sendFeedback, treeMeshUrl, useCatalog, type PlanPick, type PlanReply } from "./resinApi";
import { choose, decodePosition, positionsIn } from "./resinFormat";
import { relayBaseOf } from "./sdcp";
import { Button, Card, CatalogProblem, ListRow, Note, Row, usePalette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinPlan">;

/** A 3D tap hits a surface point: supports within this distance of it count (mm). */
const TAP_3D_REACH_MM = 0.15;
/** A finger's reach on the cut, in points; it becomes mm at the cut's scale, up to `CUT_REACH_MAX_MM`. */
const FINGER_PT = 14;
const CUT_REACH_MAX_MM = 1.5;
/** A requirement's mark shows on a cut within this height of its position (mm). */
const MARK_WITHIN_MM = 1;
const VIEWER_HEIGHT = 380;
const SLIDER_HEIGHT = 44;
const LAYER_MM = 0.02;

const meshStore = (part: "model" | "supports") =>
  makeDownloads<PrintModel>({
    folder: "plan-meshes",
    urlOf: (relayBase, runId) => planMeshUrl(relayBase, runId, part),
    extension: `.${part}.mesh`,
    keep: 6,
    open: (file: File) => openModel(file),
  });

const meshes = { model: meshStore("model"), supports: meshStore("supports") };

/** The selected tree's own triangles, by `<run>~<tree>`. */
const treeMeshes = makeDownloads<PrintModel>({
  folder: "plan-meshes",
  urlOf: (relayBase, key) => {
    const [runId = "", tree = ""] = key.split("~");
    return treeMeshUrl(relayBase, runId, tree);
  },
  extension: ".tree.mesh",
  keep: 40,
  open: (file: File) => openModel(file),
});

/** The selected tree's mesh file on the device, once it is there. */
const useTreeMesh = (relayBase: string, key: string | undefined): string | undefined => {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => treeMeshes.subscribe(() => setVersion((n) => n + 1)), []);
  React.useEffect(() => {
    if (key !== undefined) treeMeshes.ensure(relayBase, key);
  }, [relayBase, key]);
  return key === undefined ? undefined : treeMeshes.opened(key)?.uri;
};


/** A plan's mesh on the device: its state, and its file once it is there. */
const useMesh = (part: "model" | "supports", relayBase: string, runId: string, ready: boolean): { readonly state: DownloadState | undefined; readonly uri: string | undefined } => {
  const store = meshes[part];
  const [, setVersion] = React.useState(0);
  React.useEffect(() => store.subscribe(() => setVersion((n) => n + 1)), [store]);
  React.useEffect(() => {
    if (ready) store.ensure(relayBase, runId);
  }, [store, relayBase, runId, ready]);
  return { state: store.state(runId), uri: store.opened(runId)?.uri };
};

const meshNote = (part: string, state: DownloadState | undefined): string | undefined =>
  state === undefined || state.kind === "Ready" ? undefined : state.kind === "Failed" ? `The ${part} did not load: ${state.reason}` : `Loading the ${part}…`;

/** A height slider: drag or tap anywhere on the track. */
const HeightSlider = (props: { readonly width: number; readonly low: number; readonly high: number; readonly value: number; readonly onChange: (z: number) => void }): React.ReactElement => {
  const palette = usePalette();
  const zAt = (x: number): number => props.low + Math.min(1, Math.max(0, x / props.width)) * (props.high - props.low);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => props.onChange(zAt(event.x)))
    .onUpdate((event) => props.onChange(zAt(event.x)));
  const fraction = (props.value - props.low) / Math.max(0.001, props.high - props.low);
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.slider, { width: props.width }]}>
        <View style={styles.sliderTrack} />
        <View style={[styles.sliderFill, { width: fraction * props.width, backgroundColor: palette.accent }]} />
        <View style={[styles.sliderThumb, { left: fraction * props.width - 11, borderColor: palette.accent }]} />
      </View>
    </GestureDetector>
  );
};

const fmt = (value: number | null, digits = 2, unit = " mm"): string => (value === null ? "—" : `${value.toFixed(digits)}${unit}`);

export const PlanScreen = (props: Props): React.ReactElement => {
  useOpenTiming("ServerResinPlan");
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { serverAddress, runId } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const plan = useCatalog(relayBase, planRoute(runId));
  const requirements = useCatalog(relayBase, requirementsRoute);
  const notes = useCatalog(relayBase, notesRoute);
  const value: PlanReply | undefined = plan.value;
  // The meshes ask for the plan's files only once the plan is ready on the relay.
  const model = useMesh("model", relayBase, runId, value !== undefined);
  const supports = useMesh("supports", relayBase, runId, value !== undefined);

  const [z, setZ] = React.useState<number | undefined>(undefined);
  const height = z ?? (value === undefined ? 0 : (value.low[2] + value.high[2]) / 2);
  const [selected, setSelected] = React.useState<PlanPick | undefined>(undefined);
  const [choices, setChoices] = React.useState<ReadonlyArray<PlanPick> | undefined>(undefined);
  const [pickNote, setPickNote] = React.useState<{ readonly text: string; readonly bad: boolean } | undefined>(undefined);
  const highlightUri = useTreeMesh(relayBase, selected === undefined ? undefined : `${runId}~${selected.tree}`);
  // The selected tree's contacts, from the plan: their sizes and position IDs.
  const treeContacts = React.useMemo(() => (selected === undefined || value === undefined ? [] : value.contacts.filter((contact) => contact.tree === selected.tree)), [selected, value]);
  const tapAt = React.useRef<number | undefined>(undefined);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ readonly ok: boolean; readonly text: string } | undefined>(undefined);

  // The cut on screen is the newest that has loaded; each logs the time from the slider to its image.
  const wantedCut = value === undefined ? undefined : sectionUrl(relayBase, runId, height);
  const cutAsked = React.useRef<{ readonly uri: string; readonly z: number; readonly at: number } | undefined>(undefined);
  if (wantedCut !== undefined && cutAsked.current?.uri !== wantedCut) cutAsked.current = { uri: wantedCut, z: height, at: Date.now() };
  const cutUri = useLoadedUri(wantedCut);
  React.useEffect(() => {
    const asked = cutAsked.current;
    if (cutUri !== undefined && asked !== undefined && asked.uri === cutUri) console.log("[perf] cut", JSON.stringify({ z: asked.z.toFixed(2), ms: Date.now() - asked.at }));
  }, [cutUri]);

  React.useEffect(() => {
    if (selected === undefined || tapAt.current === undefined) return;
    const started = tapAt.current;
    tapAt.current = undefined;
    const id = requestAnimationFrame(() => console.log("[perf] select", JSON.stringify({ tree: selected.tree, part: selected.part, ms: Date.now() - started })));
    return () => cancelAnimationFrame(id);
  }, [selected]);

  const contentWidth = Math.min(width - 32, 900);
  const cutWidth = contentWidth - 32;
  const cutHeight = value === undefined ? cutWidth : Math.round((cutWidth * value.cut.height) / value.cut.width);
  const scale = value === undefined ? 1 : cutWidth / value.cut.width;

  // Requirements and notes that name a position: marked in 3D and on the cut.
  const positioned = React.useMemo(() => {
    const fromRequirements = (requirements.value?.requirements ?? []).flatMap((requirement) =>
      [...new Set([...(requirement.position === null ? [] : [requirement.position]), ...positionsIn(requirement.text)])].flatMap((position) => {
        const point = decodePosition(position);
        return point === undefined ? [] : [{ key: `${requirement.id}-${position}`, label: requirement.id, position, point, kind: "requirement" as const, text: requirement.text }];
      }),
    );
    const fromNotes = (notes.value?.notes ?? []).flatMap((note) => {
      const point = note.position === null ? undefined : decodePosition(note.position);
      return point === undefined || note.position === null ? [] : [{ key: `note-${note.id}`, label: "Note", position: note.position, point, kind: "note" as const, text: note.text }];
    });
    return [...fromRequirements, ...fromNotes];
  }, [requirements.value, notes.value]);

  const markers = React.useMemo(
    (): ReadonlyArray<ModelMarker> => positioned.map((mark) => ({ x: mark.point[0], y: mark.point[1], z: mark.point[2], color: mark.kind === "requirement" ? palette.bad : palette.warn, radius: 0.7 })),
    [positioned, palette],
  );

  /** Asks the relay what is under the point, then selects it, or asks the owner which one. */
  const select = (point: readonly [number, number, number], reachMm: number): void => {
    if (value === undefined) return;
    tapAt.current = Date.now();
    setSent(undefined);
    fetchPicks(relayBase, runId, point, reachMm)
      .then((picks) => {
        const chosen = choose(picks);
        if (chosen.kind === "One") {
          setSelected(chosen.pick);
          setChoices(undefined);
          setPickNote(undefined);
        } else if (chosen.kind === "Several") {
          setChoices(chosen.picks);
          setPickNote(undefined);
        } else {
          setChoices(undefined);
          setPickNote({ text: "No support under the finger there.", bad: false });
        }
      })
      .catch((cause: unknown) => {
        console.error("[plan] picking a support failed", cause);
        setPickNote({ text: `Could not find the support: ${cause instanceof Error ? cause.message : String(cause)}`, bad: true });
      });
  };

  const onCutPress = (event: GestureResponderEvent): void => {
    if (value === undefined) return;
    const x = value.cut.lowX + event.nativeEvent.locationX / scale / value.cut.pxPerMm;
    const y = value.cut.highY - event.nativeEvent.locationY / scale / value.cut.pxPerMm;
    select([x, y, height], Math.min(CUT_REACH_MAX_MM, FINGER_PT / scale / value.cut.pxPerMm));
  };

  const treePositions = new Set([...treeContacts.map((contact) => contact.position), ...(selected === undefined ? [] : [selected.partPosition])]);
  const about = positioned.filter((mark) => treePositions.has(mark.position));
  const first = treeContacts[0];

  const send = (kind: "note" | "requirement"): void => {
    if (selected === undefined || draft.trim() === "") return;
    setSending(true);
    sendFeedback(relayBase, { kind, text: draft.trim(), run: runId, position: selected.partPosition })
      .then((id) => {
        setSent({ ok: true, text: `${kind === "note" ? "Note" : "Requirement"} ${id} saved for ${selected.partPosition} (tree ${selected.tree}).` });
        setDraft("");
        if (kind === "note") loadCatalog(relayBase, notesRoute);
        else loadCatalog(relayBase, requirementsRoute);
      })
      .catch((cause: unknown) => {
        console.error("[plan] saving the feedback failed", cause);
        setSent({ ok: false, text: `Not saved: ${cause instanceof Error ? cause.message : String(cause)}` });
      })
      .finally(() => setSending(false));
  };

  return (
    <ScrollView style={[styles.root, { backgroundColor: background }]} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: contentWidth, alignSelf: "center" }}>
        {value === undefined ? (
          <Card>
            {plan.error !== undefined ? (
              <CatalogProblem error={plan.error} unreachable={plan.unreachable} />
            ) : (
              <Note text="Preparing the plan on the relay. The first time takes about half a minute: it copies the run's files and builds its meshes." />
            )}
          </Card>
        ) : (
          <>
            <Card title="3D" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{`${(value.triangles.model / 1e6).toFixed(2)} M + ${(value.triangles.supports / 1e6).toFixed(2)} M triangles`}</Text>} flush>
              <View style={[styles.viewer, { height: VIEWER_HEIGHT }]}>
                <ModelViewer
                  style={StyleSheet.absoluteFill}
                  uri={model.uri}
                  color="#cdd0d8"
                  supportsUri={supports.uri}
                  supportsColor="#ff9f0a"
                  markers={markers}
                  onPointTap={(point) => select([point.x, point.y, point.z], TAP_3D_REACH_MM)}
                  highlightUri={highlightUri}
                  highlightColor="#3399ff"
                  clipHighMm={z}
                />
              </View>
              {[meshNote("model", model.state), meshNote("supports", supports.state)].filter((note): note is string => note !== undefined).map((note) => (
                <View key={note} style={styles.pad}>
                  <Note text={note} tone={note.startsWith("The") ? "bad" : undefined} />
                </View>
              ))}
            </Card>

            <Card title="Cut" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{`${height.toFixed(2)} mm · layer ${Math.round(height / LAYER_MM).toLocaleString()}`}</Text>}>
              <Pressable onPress={onCutPress} style={[styles.cut, { width: cutWidth, height: cutHeight }]}>
                {cutUri !== undefined ? <Image source={authedSource(cutUri)} style={{ width: cutWidth, height: cutHeight }} resizeMode="stretch" /> : null}
                {positioned
                  .filter((mark) => Math.abs(mark.point[2] - height) <= MARK_WITHIN_MM)
                  .map((mark) => (
                    <View
                      key={mark.key}
                      pointerEvents="none"
                      style={[styles.mark, { left: (mark.point[0] - value.cut.lowX) * value.cut.pxPerMm * scale - 6, top: (value.cut.highY - mark.point[1]) * value.cut.pxPerMm * scale - 6, borderColor: mark.kind === "requirement" ? palette.bad : palette.warn }]}
                    />
                  ))}

              </Pressable>
              <HeightSlider width={cutWidth} low={value.low[2]} high={value.high[2]} value={height} onChange={(next) => setZ(Math.round(next / LAYER_MM) * LAYER_MM)} />
              <Text style={[styles.legend, { color: text.tertiaryLabel }]}>Grey: the model. Orange: the supports. Red rings: requirements. Tap any part of a support to select it.</Text>
            </Card>

            {choices !== undefined ? (
              <Card title="Which support?" flush>
                {choices.map((pick, index) => (
                  <ListRow
                    key={pick.tree}
                    icon="cone"
                    tint="#5E5CE6"
                    title={`Tree ${pick.tree} · ${pick.part}`}
                    detail={`${pick.partPosition}${pick.treePosition !== null ? ` · tip ${pick.treePosition}` : ""}${pick.distance > 0 ? ` · ${pick.distance.toFixed(2)} mm away` : ""}`}
                    last={index === choices.length - 1}
                    onPress={() => {
                      tapAt.current = Date.now();
                      setSelected(pick);
                      setChoices(undefined);
                    }}
                  />
                ))}
              </Card>
            ) : null}

            <Card title={selected === undefined ? "Support" : `Support ${selected.treePosition ?? selected.tree}`}>
              {pickNote !== undefined ? <Note text={pickNote.text} tone={pickNote.bad ? "bad" : undefined} /> : null}
              {selected === undefined ? (
                <Note text="Tap any part of a support in 3D or on the cut." />
              ) : (
                <>
                  <Row label="Tree" value={selected.tree} />
                  <Row label="Tree position ID" value={selected.treePosition ?? "—"} />
                  <Row label="Part tapped" value={selected.part} />
                  <Row label="Part position ID" value={selected.partPosition} />
                  <Row label="Contacts" value={`${treeContacts.length}`} />
                  <Row label="Tip radius" value={fmt(first?.tipRadius ?? null, 3)} />
                  <Row label="Contact radius" value={fmt(first?.radius ?? null, 3)} />
                  <Row label="Neck" value={first === undefined || first.neckRadius === null ? "—" : `r ${first.neckRadius.toFixed(3)} · ${fmt(first.neckLength)}`} />
                  <Row label="Stem radius" value={fmt(first?.stemRadius ?? null, 3)} />
                  <Row label="Shaft radius" value={fmt(first?.shaftRadius ?? null, 3)} />
                  <Row label="Load U (tree)" value={first === undefined || first.loadU === null ? (value.hasLoads ? "—" : "No loads for this run") : first.loadU.toPrecision(3)} tone={first !== undefined && first.loadU !== null && first.loadU > 1 ? "bad" : undefined} />
                  <Row label="Plate column" value={first?.plateColumn === true ? "Yes" : "No"} last={treeContacts.length <= 1 && about.length === 0} />
                  {treeContacts.length > 1 ? <Text style={[styles.about, { color: text.secondaryLabel }]}>Contacts: {treeContacts.map((contact) => contact.position).join(", ")}</Text> : null}
                  {about.map((mark) => (
                    <Text key={mark.key} style={[styles.about, { color: text.label }]}>
                      <Text style={{ color: mark.kind === "requirement" ? palette.bad : palette.warn }}>{mark.label} </Text>
                      {mark.text}
                    </Text>
                  ))}
                </>
              )}
            </Card>

            {selected !== undefined ? (
              <Card title={`Feedback on ${selected.partPosition}`}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Beef up this support…"
                  placeholderTextColor={text.tertiaryLabel}
                  multiline
                  style={[styles.input, { color: text.label, borderColor: withAlpha(palette.accent, 0.4) }]}
                />
                <View style={styles.buttons}>
                  <Button label="Add note" icon="note.text" disabled={draft.trim() === ""} busy={sending} onPress={() => send("note")} style={styles.button} />
                  <Button label="Add requirement" icon="checklist" kind="primary" disabled={draft.trim() === ""} busy={sending} onPress={() => send("requirement")} style={styles.button} />
                </View>
                {sent !== undefined ? <Note text={sent.text} tone={sent.ok ? "ok" : "bad"} /> : <Note text={`Saved in runs.db with ${selected.partPosition} (the part tapped) and run ${runId}.`} />}
              </Card>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  count: { fontSize: 12 },
  pad: { paddingHorizontal: 16, paddingVertical: 10 },
  viewer: { borderRadius: 18, overflow: "hidden", backgroundColor: "#0b0c10" },
  cut: { alignSelf: "center", backgroundColor: "#0b0c10", borderRadius: 12, overflow: "hidden" },
  mark: { position: "absolute", width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  selected: { position: "absolute", width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
  slider: { height: SLIDER_HEIGHT, justifyContent: "center", alignSelf: "center", marginTop: 8 },
  sliderTrack: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: "rgba(127,127,127,0.25)" },
  sliderFill: { position: "absolute", left: 0, height: 4, borderRadius: 2 },
  sliderThumb: { position: "absolute", width: 22, height: 22, borderRadius: 11, borderWidth: 3, backgroundColor: "#ffffff" },
  legend: { fontSize: 11.5, marginTop: 4 },
  about: { fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  input: { minHeight: 72, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, textAlignVertical: "top" },
  buttons: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 8 },
  button: { flex: 1 },
});
