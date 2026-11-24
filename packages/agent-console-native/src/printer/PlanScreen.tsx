/**
 * The plan review page: one run's support plan, to review before a print.
 *
 * - 3D: the model and the plan's supports (ModelViewer, every triangle).
 *   A tap is a ray through the whole scene: every support along it, at any
 *   depth, behind the model and behind other supports, can be picked. The
 *   model never blocks a pick. The selected tree is marked whole.
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
import { canDrawPaintPatches, ModelViewer, type ModelMarker, type PaintPatch } from "../../modules/model-viewer";
import { authedSource } from "../auth/serverTokens";
import { useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground, useTextColors, withAlpha } from "../theme";
import { useLoadedUri } from "./PrinterStage";
import { openModel, type PrintModel } from "./printModel";
import { makeDownloads, type DownloadState } from "./relayDownload";
import { allMarksRoute, boxFrame, fetchPicks, fetchRayPicks, loadCatalog, marksRoute, sendMark, type CutBox, type MarkKind, notesRoute, planMeshUrl, planRoute, requirementsRoute, sectionUrl, sendFeedback, treeMeshUrl, useCatalog, type PlanPick, type PlanReply } from "./resinApi";
import { choose, decodePosition, positionsIn } from "./resinFormat";
import { relayBaseOf } from "./sdcp";
import { Button, Card, CatalogProblem, ListRow, Note, Row, usePalette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinPlan">;

/** A finger's reach on the cut, in points; it becomes mm at the cut's scale, up to `CUT_REACH_MAX_MM`. */
const FINGER_PT = 14;
const CUT_REACH_MAX_MM = 1.5;
/** A requirement's mark shows on a cut within this height of its position (mm). */
const MARK_WITHIN_MM = 1;
const VIEWER_HEIGHT = 380;
const SLIDER_HEIGHT = 44;
const LAYER_MM = 0.02;
/** A position ID is a 0.25 mm cell: a pick this close to the box's edge still counts as inside it (mm). */
const PICK_SLACK_MM = 0.5;
/** The cut box is never smaller than this on a side (mm). */
const MIN_BOX_MM = 1;

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

/** Two thumbs on one track: a range in mm. A touch moves the thumb nearer to it; the thumbs never cross. */
const RangeSlider = (props: { readonly width: number; readonly low: number; readonly high: number; readonly from: number; readonly to: number; readonly onChange: (from: number, to: number) => void }): React.ReactElement => {
  const palette = usePalette();
  const span = Math.max(0.001, props.high - props.low);
  const valueAt = (x: number): number => props.low + Math.min(1, Math.max(0, x / props.width)) * span;
  const moving = React.useRef<"from" | "to">("from");
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => {
      const value = valueAt(event.x);
      moving.current = Math.abs(value - props.from) <= Math.abs(value - props.to) ? "from" : "to";
      if (moving.current === "from") props.onChange(Math.min(value, props.to - MIN_BOX_MM), props.to);
      else props.onChange(props.from, Math.max(value, props.from + MIN_BOX_MM));
    })
    .onUpdate((event) => {
      const value = valueAt(event.x);
      if (moving.current === "from") props.onChange(Math.min(value, props.to - MIN_BOX_MM), props.to);
      else props.onChange(props.from, Math.max(value, props.from + MIN_BOX_MM));
    });
  const left = ((props.from - props.low) / span) * props.width;
  const right = ((props.to - props.low) / span) * props.width;
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.slider, { width: props.width }]}>
        <View style={styles.sliderTrack} />
        <View style={[styles.sliderFill, { left, width: Math.max(0, right - left), backgroundColor: palette.accent }]} />
        <View style={[styles.sliderThumb, { left: left - 11, borderColor: palette.accent }]} />
        <View style={[styles.sliderThumb, { left: right - 11, borderColor: palette.accent }]} />
      </View>
    </GestureDetector>
  );
};

const MARK_KINDS: ReadonlyArray<MarkKind> = ["break", "separation", "fusing", "other"];

type Point = readonly [number, number, number];
/** One finger stroke: its paths on the surface (a new path where the finger left the target) and the brush radius. */
interface Stroke {
  readonly paths: ReadonlyArray<ReadonlyArray<Point>>;
  readonly radius: number;
}
/** The brush sizes: the radius in mm. */
const BRUSHES: ReadonlyArray<{ readonly label: string; readonly radius: number }> = [
  { label: "S 0.5", radius: 0.5 },
  { label: "M 1.0", radius: 1 },
  { label: "L 2.0", radius: 2 },
];

/** Which marks and rings show in 3D and on the cut: this run's, every run's, or none. */
type MarkScope = "run" | "all" | "off";
const MARK_SCOPES: ReadonlyArray<{ readonly scope: MarkScope; readonly label: string }> = [
  { scope: "run", label: "This run" },
  { scope: "all", label: "All runs" },
  { scope: "off", label: "Off" },
];
const MARK_COLOR: Readonly<Record<MarkKind, string>> = { break: "#ff3b30", separation: "#af52de", fusing: "#ff2d55", other: "#30b0c7" };

/** The layer at a height; below the plate is layer 0. */
const layerOf = (mm: number): number => Math.max(0, Math.round(mm / LAYER_MM));

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

  // The Z range (mm); undefined: the plan's own bottom or top. The cut image is the top thumb's layer.
  const [zLow, setZLow] = React.useState<number | undefined>(undefined);
  const [z, setZ] = React.useState<number | undefined>(undefined);
  const zBottom = zLow ?? (value === undefined ? 0 : value.low[2]);
  const zTop = z ?? (value === undefined ? 0 : value.high[2]);
  // The top layer is the plan's last: the cut is one layer below it, so it is never empty.
  const height = value === undefined ? 0 : Math.min(zTop, value.high[2] - LAYER_MM);
  const [markScope, setMarkScope] = React.useState<MarkScope>("run");
  /** Both thumbs snap to whole layers; a thumb at the plan's end means "no cut" on that side. */
  const setZRange = (from: number, to: number): void => {
    if (value === undefined) return;
    const snap = (mm: number): number => Math.round(mm / LAYER_MM) * LAYER_MM;
    setZLow(from <= value.low[2] + LAYER_MM ? undefined : snap(from));
    setZ(to >= value.high[2] - LAYER_MM ? undefined : snap(to));
  };
  const [selected, setSelected] = React.useState<PlanPick | undefined>(undefined);
  const [choices, setChoices] = React.useState<ReadonlyArray<PlanPick> | undefined>(undefined);
  const [pickNote, setPickNote] = React.useState<{ readonly text: string; readonly bad: boolean } | undefined>(undefined);
  const highlightUri = useTreeMesh(relayBase, selected === undefined ? undefined : `${runId}~${selected.tree}`);
  // The selected tree's contacts, from the plan: their sizes and position IDs.
  const treeContacts = React.useMemo(() => (selected === undefined || value === undefined ? [] : value.contacts.filter((contact) => contact.tree === selected.tree)), [selected, value]);
  const tapAt = React.useRef<number | undefined>(undefined);
  // The cut box (x and y ranges, mm); undefined: the whole plan.
  const [box, setBox] = React.useState<CutBox | undefined>(undefined);
  const [modelOpacity, setModelOpacity] = React.useState(1);
  const [supportsOpacity, setSupportsOpacity] = React.useState(1);
  // Painting a failure: on the selected support, or on the model.
  const [paintOn, setPaintOn] = React.useState<"support" | "model" | undefined>(undefined);
  const [painting, setPainting] = React.useState(false);
  const [strokes, setStrokes] = React.useState<ReadonlyArray<Stroke>>([]);
  const [brushRadius, setBrushRadius] = React.useState(1);
  const [markKind, setMarkKind] = React.useState<MarkKind>("break");
  const [markText, setMarkText] = React.useState("");
  const [markNote, setMarkNote] = React.useState<{ readonly ok: boolean; readonly text: string } | undefined>(undefined);
  const [markSaving, setMarkSaving] = React.useState(false);
  const marks = useCatalog(relayBase, marksRoute(runId));
  // Every run's marks are read only when the owner asks for them.
  const otherMarks = useCatalog(relayBase, markScope === "all" ? allMarksRoute : undefined);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ readonly ok: boolean; readonly text: string } | undefined>(undefined);

  // The cut on screen is the newest that has loaded; each logs the time from the slider to its image.
  const wantedCut = value === undefined ? undefined : sectionUrl(relayBase, runId, height, box);
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
  // The sliders under the 3D: two half-width ones side by side, then the full-width ranges.
  const fullWidth = contentWidth - 32 - 22;
  const halfWidth = Math.floor((fullWidth - 16) / 2);
  // The cut image's frame: the whole plan, or the box at a finer scale.
  const frame = value === undefined ? undefined : box === undefined ? value.cut : boxFrame(box);
  const cutHeight = frame === undefined ? cutWidth : Math.round((cutWidth * frame.height) / frame.width);
  const scale = frame === undefined ? 1 : cutWidth / frame.width;

  // Requirements and notes that name a position: marked in 3D and on the cut.
  const positioned = React.useMemo(() => {
    if (markScope === "off") return [];
    // A requirement or note from another run shows only when the owner asks for every run.
    const shown = (run: string | null): boolean => markScope === "all" || run === runId;
    const fromRequirements = (requirements.value?.requirements ?? []).filter((requirement) => shown(requirement.run)).flatMap((requirement) =>
      [...new Set([...(requirement.position === null ? [] : [requirement.position]), ...positionsIn(requirement.text)])].flatMap((position) => {
        const point = decodePosition(position);
        return point === undefined ? [] : [{ key: `${requirement.id}-${position}`, label: requirement.id, position, point, kind: "requirement" as const, text: requirement.text }];
      }),
    );
    // A painted mark is also a note ("mark:N"): it shows by its own painted points, not as a ring.
    const fromNotes = (notes.value?.notes ?? []).filter((note) => shown(note.run) && !(note.source ?? "").startsWith("mark:")).flatMap((note) => {
      const point = note.position === null ? undefined : decodePosition(note.position);
      return point === undefined || note.position === null ? [] : [{ key: `note-${note.id}`, label: "Note", position: note.position, point, kind: "note" as const, text: note.text }];
    });
    return [...fromRequirements, ...fromNotes];
  }, [requirements.value, notes.value, markScope, runId]);
  const shownMarks = React.useMemo(
    () => (markScope === "off" ? [] : markScope === "all" ? (otherMarks.value?.marks ?? marks.value?.marks ?? []) : (marks.value?.marks ?? [])),
    [markScope, otherMarks.value, marks.value],
  );

  const markers = React.useMemo(
    (): ReadonlyArray<ModelMarker> => [
      ...positioned.map((mark) => ({ x: mark.point[0], y: mark.point[1], z: mark.point[2], color: mark.kind === "requirement" ? palette.bad : palette.warn, radius: 0.7 })),
      // Saved failures: each painted point, in its kind's colour.
      // A mark with strokes is a patch on a build that draws patches; otherwise its points are dots.
      ...shownMarks.filter((mark) => !(canDrawPaintPatches && (mark.strokes ?? null) !== null)).flatMap((mark) => mark.points.map(([x, y, z]) => ({ x, y, z, color: MARK_COLOR[mark.kind], radius: 0.18 }))),
      // The strokes not saved yet.
      ...(canDrawPaintPatches ? [] : strokes.flatMap((stroke) => stroke.paths.flat().map(([x, y, z]) => ({ x, y, z, color: MARK_COLOR[markKind], radius: 0.18 })))),
    ],
    [positioned, palette, shownMarks, strokes, markKind],
  );

  // Painted regions as filled patches: the strokes not saved yet, then the saved area marks that show.
  const patches = React.useMemo((): ReadonlyArray<PaintPatch> => {
    if (!canDrawPaintPatches) return [];
    const flat = (paths: ReadonlyArray<ReadonlyArray<Point>>) => paths.map((path) => path.flatMap((point) => [point[0], point[1], point[2]]));
    const saved = shownMarks.flatMap((mark): ReadonlyArray<PaintPatch> => {
      const strokesOf = mark.strokes ?? null;
      if (strokesOf === null || typeof mark.radius !== "number") return [];
      // On the selected support, its own triangles; on another support, every support's (the region may reach a neighbour).
      const surface = mark.target === "model" ? "model" : selected?.tree === mark.tree ? "highlight" : "supports";
      return [{ key: `mark-${mark.id}-${surface}`, color: MARK_COLOR[mark.kind], radius: mark.radius, surface, paths: flat(strokesOf) }];
    });
    const pendingSurface = paintOn === "model" ? "model" : "highlight";
    const pending = strokes.map((stroke, index): PaintPatch => ({ key: `pending-${index}-${pendingSurface}-${markKind}`, color: MARK_COLOR[markKind], radius: stroke.radius, surface: pendingSurface, paths: flat(stroke.paths) }));
    return [...saved, ...pending];
  }, [shownMarks, selected, strokes, paintOn, markKind]);

  const paintTarget = paintOn === "model" ? { kind: "model" as const } : paintOn === "support" && selected !== undefined ? { kind: "support" as const, tree: selected.tree, part: selected.part } : undefined;

  const saveMark = (): void => {
    if (paintTarget === undefined || strokes.length === 0) return;
    setMarkSaving(true);
    // One mark has one brush radius: the size buttons are locked while strokes wait to be saved.
    sendMark(relayBase, { run: runId, target: paintTarget, kind: markKind, text: markText.trim() === "" ? null : markText.trim(), strokes: strokes.flatMap((stroke) => stroke.paths), radius: strokes[0]?.radius ?? brushRadius })
      .then((saved) => {
        setMarkNote({ ok: true, text: `Mark ${saved.id} saved: ${markKind} on ${paintTarget.kind === "model" ? "the model" : `tree ${paintTarget.tree} (${paintTarget.part})`}${saved.area === undefined ? "" : `, ${saved.area.toFixed(1)} mm²`}, ${saved.positions.length} position${saved.positions.length === 1 ? "" : "s"} (${saved.positions.slice(0, 3).join(", ")}${saved.positions.length > 3 ? ", …" : ""}).` });
        setStrokes([]);
        setMarkText("");
        setPainting(false);
        loadCatalog(relayBase, marksRoute(runId));
        if (markScope === "all") loadCatalog(relayBase, allMarksRoute);
        loadCatalog(relayBase, notesRoute);
      })
      .catch((cause: unknown) => {
        console.error("[plan] saving the mark failed", cause);
        setMarkNote({ ok: false, text: `Not saved: ${cause instanceof Error ? cause.message : String(cause)}` });
      })
      .finally(() => setMarkSaving(false));
  };

  /** Asks the relay what is under the tap, then selects it, or asks the owner which one. */
  const select = (ask: () => Promise<ReadonlyArray<PlanPick>>): void => {
    if (value === undefined) return;
    tapAt.current = Date.now();
    setSent(undefined);
    ask()
      .then((all) => {
        // Only what the cut box and the height show can be picked: a clipped support is not on screen.
        const picks = all.filter((pick) => {
          const point = decodePosition(pick.partPosition);
          return point === undefined || ((box === undefined || (point[0] >= box.x0 - PICK_SLACK_MM && point[0] <= box.x1 + PICK_SLACK_MM && point[1] >= box.y0 - PICK_SLACK_MM && point[1] <= box.y1 + PICK_SLACK_MM)) && point[2] >= zBottom - PICK_SLACK_MM && point[2] <= zTop + PICK_SLACK_MM);
        });
        const chosen = choose(picks);
        if (chosen.kind === "One") {
          setSelected(chosen.pick);
          setChoices(undefined);
          setPickNote(undefined);
        } else if (chosen.kind === "Several") {
          setChoices(chosen.picks);
          // The nearest one shows whole in 3D at once; a row of the list selects another.
          setSelected(chosen.picks[0]);
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
    if (frame === undefined) return;
    const x = frame.lowX + event.nativeEvent.locationX / scale / frame.pxPerMm;
    const y = frame.highY - event.nativeEvent.locationY / scale / frame.pxPerMm;
    select(() => fetchPicks(relayBase, runId, [x, y, height], Math.min(CUT_REACH_MAX_MM, FINGER_PT / scale / frame.pxPerMm)));
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
                  onRayTap={(ray) => select(() => fetchRayPicks(relayBase, runId, ray))}
                  highlightUri={highlightUri}
                  highlightColor="#3399ff"
                  clipLowMm={zLow}
                  clipHighMm={z}
                  clipMinX={box?.x0}
                  clipMaxX={box?.x1}
                  clipMinY={box?.y0}
                  clipMaxY={box?.y1}
                  modelOpacity={modelOpacity}
                  supportsOpacity={supportsOpacity}
                  paintMode={painting && paintTarget !== undefined ? paintTarget.kind : "off"}
                  paintColor={MARK_COLOR[markKind]}
                  brushRadius={brushRadius}
                  patches={patches}
                  onPaintStroke={(flatPaths) => {
                    const paths = flatPaths
                      .map((flat) => {
                        const points: Array<Point> = [];
                        for (let i = 0; i + 2 < flat.length; i += 3) points.push([flat[i] ?? 0, flat[i + 1] ?? 0, flat[i + 2] ?? 0]);
                        return points;
                      })
                      .filter((path) => path.length > 0);
                    if (paths.length > 0) setStrokes((all) => [...all, { paths, radius: brushRadius }]);
                  }}
                />
              </View>
              <View style={styles.pad}>
                <View style={styles.opacityRow}>
                  <View style={styles.opacityHalf}>
                    <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>Model {Math.round(modelOpacity * 100)}%</Text>
                    <HeightSlider width={halfWidth} low={0} high={1} value={modelOpacity} onChange={setModelOpacity} />
                  </View>
                  <View style={styles.opacityHalf}>
                    <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>Supports {Math.round(supportsOpacity * 100)}%</Text>
                    <HeightSlider width={halfWidth} low={0} high={1} value={supportsOpacity} onChange={setSupportsOpacity} />
                  </View>
                </View>
                <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>
                  X {(box?.x0 ?? value.low[0]).toFixed(1)} to {(box?.x1 ?? value.high[0]).toFixed(1)} mm
                </Text>
                <RangeSlider
                  width={fullWidth}
                  low={value.low[0]}
                  high={value.high[0]}
                  from={box?.x0 ?? value.low[0]}
                  to={box?.x1 ?? value.high[0]}
                  onChange={(x0, x1) => setBox({ x0, x1, y0: box?.y0 ?? value.low[1], y1: box?.y1 ?? value.high[1] })}
                />
                <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>
                  Y {(box?.y0 ?? value.low[1]).toFixed(1)} to {(box?.y1 ?? value.high[1]).toFixed(1)} mm
                </Text>
                <RangeSlider
                  width={fullWidth}
                  low={value.low[1]}
                  high={value.high[1]}
                  from={box?.y0 ?? value.low[1]}
                  to={box?.y1 ?? value.high[1]}
                  onChange={(y0, y1) => setBox({ x0: box?.x0 ?? value.low[0], x1: box?.x1 ?? value.high[0], y0, y1 })}
                />
                <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>
                  Z {zBottom.toFixed(2)} to {zTop.toFixed(2)} mm · layers {layerOf(zBottom).toLocaleString()} to {layerOf(zTop).toLocaleString()}
                </Text>
                <RangeSlider width={fullWidth} low={value.low[2]} high={value.high[2]} from={zBottom} to={zTop} onChange={setZRange} />
                <View style={styles.scopeRow}>
                  <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>Marks</Text>
                  <View style={styles.kinds}>
                    {MARK_SCOPES.map((option) => (
                      <Pressable key={option.scope} onPress={() => setMarkScope(option.scope)} style={[styles.kind, { borderColor: palette.accent, backgroundColor: markScope === option.scope ? withAlpha(palette.accent, 0.25) : "transparent" }]} accessibilityRole="button" accessibilityState={{ selected: markScope === option.scope }}>
                        <Text style={[styles.kindText, { color: text.label }]}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                {box !== undefined || zLow !== undefined || z !== undefined ? (
                  <Button
                    label="Whole plan"
                    icon="arrow.up.left.and.arrow.down.right"
                    onPress={() => {
                      setBox(undefined);
                      setZLow(undefined);
                      setZ(undefined);
                    }}
                    style={styles.wholeButton}
                  />
                ) : null}
              </View>
              {[meshNote("model", model.state), meshNote("supports", supports.state)].filter((note): note is string => note !== undefined).map((note) => (
                <View key={note} style={styles.pad}>
                  <Note text={note} tone={note.startsWith("The") ? "bad" : undefined} />
                </View>
              ))}
            </Card>

            <Card title="Cut" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{`top ${height.toFixed(2)} mm · layer ${layerOf(height).toLocaleString()}`}</Text>}>
              <Pressable onPress={onCutPress} style={[styles.cut, { width: cutWidth, height: cutHeight }]}>
                {cutUri !== undefined ? <Image source={authedSource(cutUri)} style={{ width: cutWidth, height: cutHeight }} resizeMode="stretch" /> : null}
                {positioned
                  .filter((mark) => Math.abs(mark.point[2] - height) <= MARK_WITHIN_MM)
                  .map((mark) => (
                    <View
                      key={mark.key}
                      pointerEvents="none"
                      style={[styles.mark, { left: (mark.point[0] - (frame?.lowX ?? 0)) * (frame?.pxPerMm ?? 1) * scale - 6, top: ((frame?.highY ?? 0) - mark.point[1]) * (frame?.pxPerMm ?? 1) * scale - 6, borderColor: mark.kind === "requirement" ? palette.bad : palette.warn }]}
                    />
                  ))}

              </Pressable>
              <RangeSlider width={cutWidth} low={value.low[2]} high={value.high[2]} from={zBottom} to={zTop} onChange={setZRange} />
              <Text style={[styles.legend, { color: text.tertiaryLabel }]}>Grey: the model. Orange: the supports. Red rings: requirements. The cut is the top of the Z range. Tap any part of a support to select it.</Text>
            </Card>

            {choices !== undefined ? (
              <Card title="Which support?" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>nearest first</Text>} flush>
                {choices.map((pick, index) => (
                  <ListRow
                    key={pick.tree}
                    icon={selected?.tree === pick.tree ? "checkmark.circle.fill" : "cone"}
                    tint={selected?.tree === pick.tree ? "#3399ff" : "#8E8E93"}
                    title={`Tree ${pick.tree} · ${pick.part}`}
                    detail={[pick.partPosition, pick.depth !== undefined ? `${pick.depth.toFixed(1)} mm deep` : undefined, pick.distance > 0 ? `${pick.distance.toFixed(2)} mm away` : undefined].filter((part) => part !== undefined).join(" · ")}
                    last={index === choices.length - 1}
                    onPress={() => {
                      tapAt.current = Date.now();
                      setSelected(pick);
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

            <Card title="Paint a failure">
              <View style={styles.buttons}>
                <Button
                  label={selected === undefined ? "Select a support first" : `Support ${selected.tree}`}
                  icon="cone"
                  kind={paintOn === "support" ? "primary" : "default"}
                  disabled={selected === undefined}
                  onPress={() => {
                    setPaintOn("support");
                    setStrokes([]);
                    setMarkNote(undefined);
                  }}
                  style={styles.button}
                />
                <Button
                  label="The model"
                  icon="person.crop.square"
                  kind={paintOn === "model" ? "primary" : "default"}
                  onPress={() => {
                    setPaintOn("model");
                    setStrokes([]);
                    setMarkNote(undefined);
                  }}
                  style={styles.button}
                />
              </View>
              {paintTarget === undefined ? (
                <Note text="Choose what to paint on: the selected support, or the model." />
              ) : (
                <>
                  <Button
                    label={painting ? "Stop painting" : `Paint on ${paintTarget.kind === "model" ? "the model" : `tree ${paintTarget.tree}`}`}
                    icon="paintbrush.pointed"
                    kind={painting ? "destructive" : "primary"}
                    onPress={() => setPainting((on) => !on)}
                  />
                  <Note text={painting ? "One finger paints in 3D; two fingers turn the view; a pinch zooms." : `${strokes.length} stroke${strokes.length === 1 ? "" : "s"} not saved.`} />
                  <Text style={[styles.sliderLabel, { color: text.secondaryLabel }]}>Brush radius</Text>
                  <View style={styles.kinds}>
                    {BRUSHES.map((brush) => (
                      <Pressable
                        key={brush.label}
                        disabled={strokes.length > 0}
                        onPress={() => setBrushRadius(brush.radius)}
                        style={[styles.kind, { opacity: strokes.length > 0 && brushRadius !== brush.radius ? 0.4 : 1, borderColor: palette.accent, backgroundColor: brushRadius === brush.radius ? withAlpha(palette.accent, 0.25) : "transparent" }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: brushRadius === brush.radius, disabled: strokes.length > 0 }}
                      >
                        <Text style={[styles.kindText, { color: text.label }]}>{brush.label} mm</Text>
                      </Pressable>
                    ))}
                  </View>
                  {strokes.length > 0 ? <Note text="One mark has one brush size: save or undo the strokes to change it." /> : null}
                  <View style={styles.kinds}>
                    {MARK_KINDS.map((kind) => (
                      <Pressable key={kind} onPress={() => setMarkKind(kind)} style={[styles.kind, { borderColor: MARK_COLOR[kind], backgroundColor: markKind === kind ? withAlpha(MARK_COLOR[kind], 0.25) : "transparent" }]} accessibilityRole="button" accessibilityState={{ selected: markKind === kind }}>
                        <Text style={[styles.kindText, { color: text.label }]}>{kind}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput value={markText} onChangeText={setMarkText} placeholder="What failed here (optional)" placeholderTextColor={text.tertiaryLabel} style={[styles.input, styles.markInput, { color: text.label, borderColor: withAlpha(palette.accent, 0.4) }]} />
                  <View style={styles.buttons}>
                    <Button label="Undo stroke" icon="arrow.uturn.backward" disabled={strokes.length === 0} onPress={() => setStrokes((all) => all.slice(0, -1))} style={styles.button} />
                    <Button label="Save mark" icon="checkmark" kind="primary" disabled={strokes.length === 0} busy={markSaving} onPress={saveMark} style={styles.button} />
                  </View>
                </>
              )}
              {markNote !== undefined ? <Note text={markNote.text} tone={markNote.ok ? "ok" : "bad"} /> : null}
            </Card>

            <Card title="Marks on this run" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{marks.value === undefined ? "…" : `${marks.value.marks.length}`}</Text>}>
              {marks.error !== undefined ? (
                <CatalogProblem error={marks.error} unreachable={marks.unreachable} />
              ) : marks.value === undefined ? (
                <Note text="Reading the marks…" />
              ) : marks.value.marks.length === 0 ? (
                <Note text="No failure painted on this run yet." />
              ) : (
                marks.value.marks.map((mark) => (
                  <Text key={mark.id} style={[styles.about, { color: text.label }]}>
                    <Text style={{ color: MARK_COLOR[mark.kind] }}>{mark.kind} </Text>
                    {mark.target === "model" ? "on the model" : `on tree ${mark.tree ?? ""} (${mark.part ?? ""})`}
                    {typeof mark.area === "number" ? ` · ${mark.area.toFixed(1)} mm²` : ""} · {mark.positions.length} positions ({mark.positions.slice(0, 2).join(", ")}
                    {mark.positions.length > 2 ? ", …" : ""}){mark.text !== null ? ` · ${mark.text}` : ""}
                  </Text>
                ))
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
  opacityRow: { flexDirection: "row", gap: 16 },
  opacityHalf: { flex: 1 },
  sliderLabel: { fontSize: 12, marginTop: 6 },
  wholeButton: { marginTop: 8 },
  scopeRow: { marginTop: 4 },
  kinds: { flexDirection: "row", gap: 6, marginTop: 6 },
  kind: { flex: 1, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  kindText: { fontSize: 13, fontWeight: "600" },
  markInput: { minHeight: 44, marginTop: 8 },
});
