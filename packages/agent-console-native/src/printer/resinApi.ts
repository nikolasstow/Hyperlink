/**
 * The relay's Resin catalog (saturn-uploader `Catalog.ts`): the planner's
 * runs, the print library by SHA-256, the print history, and how one
 * printer file was made. Every route is read-only.
 *
 * Every reply is decoded with `Schema`: it crosses the network. The shapes
 * match the relay's.
 *
 * The replies live in one store on the phone, by relay and route. The
 * printer page preloads them when it opens, so a tap on a row only renders.
 * A page that shows a reply asks again every `REFRESH_MS` while it is open.
 *
 * @internal
 */
import { Option, Schema } from "effect";
import { useIsFocused } from "@react-navigation/native";
import * as React from "react";
import { authedFetch } from "../auth/serverTokens";

export const Check = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  passed: Schema.NullOr(Schema.Boolean),
});
export type Check = typeof Check.Type;

export const RunPrint = Schema.Struct({
  id: Schema.String,
  head: Schema.Literals(["A", "B"]),
  outcome: Schema.NullOr(Schema.String),
});
export type RunPrint = typeof RunPrint.Type;

export const RunSummary = Schema.Struct({
  id: Schema.String,
  series: Schema.Number,
  step: Schema.Number,
  parent: Schema.NullOr(Schema.String),
  parentInferred: Schema.Boolean,
  purpose: Schema.NullOr(Schema.String),
  created: Schema.NullOr(Schema.Number),
  checks: Schema.Array(Check),
  placed: Schema.NullOr(Schema.Number),
  failed: Schema.NullOr(Schema.Number),
  render: Schema.NullOr(Schema.String),
  prints: Schema.Array(RunPrint),
});
export type RunSummary = typeof RunSummary.Type;

export const Setting = Schema.Struct({
  flag: Schema.String,
  value: Schema.NullOr(Schema.String),
});
export type Setting = typeof Setting.Type;

export const SettingChange = Schema.Struct({
  flag: Schema.String,
  parent: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
});
export type SettingChange = typeof SettingChange.Type;

const MetricValue = Schema.Union([Schema.Number, Schema.String]);

export const Metric = Schema.Struct({
  key: Schema.String,
  value: MetricValue,
  parent: Schema.NullOr(MetricValue),
});
export type Metric = typeof Metric.Type;

export const RunDetail = Schema.Struct({
  ...RunSummary.fields,
  folder: Schema.String,
  source: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  binary: Schema.NullOr(Schema.String),
  settings: Schema.Array(Setting),
  changes: Schema.Array(SettingChange),
  metrics: Schema.Array(Metric),
  renders: Schema.Array(Schema.String),
  children: Schema.Array(Schema.String),
});
export type RunDetail = typeof RunDetail.Type;

export const PrintRecord = Schema.Struct({
  id: Schema.String,
  file: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
  runA: Schema.NullOr(Schema.String),
  runB: Schema.NullOr(Schema.String),
  exposure: Schema.NullOr(Schema.Number),
  started: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  libraryPath: Schema.NullOr(Schema.String),
});
export type PrintRecord = typeof PrintRecord.Type;

export const FileHeader = Schema.Struct({
  layerCount: Schema.Number,
  layerHeightMm: Schema.Number,
  exposureSeconds: Schema.Number,
  printSeconds: Schema.Number,
  volumeMl: Schema.Number,
});
export type FileHeader = typeof FileHeader.Type;

export const LibraryFile = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  folder: Schema.String,
  size: Schema.Number,
  modified: Schema.Number,
  sha256: Schema.NullOr(Schema.String),
  aliases: Schema.Array(Schema.String),
  header: Schema.NullOr(FileHeader),
  print: Schema.NullOr(PrintRecord),
  /** The file's path in the relay's file browser (`/server/…`): previews use it. */
  browserPath: Schema.NullOr(Schema.String),
});
export type LibraryFile = typeof LibraryFile.Type;

export const RunsReply = Schema.Struct({ runs: Schema.Array(RunSummary) });
export type RunsReply = typeof RunsReply.Type;
/** The relay's background hashing: files done of this pass, and the file it reads now. */
export const HashState = Schema.Struct({
  done: Schema.Number,
  total: Schema.Number,
  current: Schema.NullOr(Schema.String),
});

/** Why the run database gave nothing, and whether the runs computer (the MacBook) was unreachable. */
export const RunsProblem = Schema.Struct({
  error: Schema.String,
  unreachable: Schema.Boolean,
});

export const LibraryReply = Schema.Struct({
  files: Schema.Array(LibraryFile),
  hashing: HashState,
  problems: Schema.Array(Schema.String),
  runs: Schema.NullOr(RunsProblem),
});
export type LibraryReply = typeof LibraryReply.Type;
export const HistoryReply = Schema.Struct({ prints: Schema.Array(PrintRecord) });
export type HistoryReply = typeof HistoryReply.Type;
export const OriginReply = Schema.Struct({
  file: Schema.NullOr(LibraryFile),
  candidates: Schema.Number,
  print: Schema.NullOr(PrintRecord),
  runs: Schema.Array(RunDetail),
});
export type OriginReply = typeof OriginReply.Type;

/** A planner run in progress, or one that ended in the last 24 hours (the relay's `GET /api/resin/active`). */
export const ActiveRun = Schema.Struct({
  number: Schema.Number,
  folder: Schema.String,
  id: Schema.NullOr(Schema.String),
  running: Schema.Boolean,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  elapsedSeconds: Schema.Number,
  estimateSeconds: Schema.Number,
  finishAt: Schema.NullOr(Schema.Number),
  stage: Schema.NullOr(Schema.String),
  stageSeconds: Schema.NullOr(Schema.Number),
  burn: Schema.NullOr(Schema.Struct({ passed: Schema.Boolean, line: Schema.String })),
  gate: Schema.NullOr(Schema.Struct({ passed: Schema.Boolean, checks: Schema.Array(Schema.Struct({ key: Schema.String, passed: Schema.Boolean })) })),
  treesOver1: Schema.NullOr(Schema.Number),
  unattachedContacts: Schema.NullOr(Schema.Number),
});
export type ActiveRun = typeof ActiveRun.Type;
export const ActiveReply = Schema.Struct({ runs: Schema.Array(ActiveRun), at: Schema.Number });
export type ActiveReply = typeof ActiveReply.Type;

/** A note on the head's history: the owner's words or an agent's finding. `at` is the time as written. */
export const HeadNote = Schema.Struct({
  id: Schema.Number,
  at: Schema.String,
  author: Schema.Literals(["owner", "agent"]),
  print: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
  text: Schema.String,
  source: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  /** The support or point the note is about, as a position ID. */
  position: Schema.NullOr(Schema.String),
});
export type HeadNote = typeof HeadNote.Type;

/** One check of a requirement on one run and head (tools/requirements.py or rundb.py req). */
export const CheckResult = Schema.Struct({
  requirement: Schema.String,
  /** The run as stored: "6-33a/A", "cones-run644/A", or "2-4". */
  ref: Schema.String,
  runId: Schema.NullOr(Schema.String),
  folder: Schema.NullOr(Schema.String),
  head: Schema.NullOr(Schema.Literals(["A", "B"])),
  result: Schema.Literals(["met", "failed"]),
  checkName: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  at: Schema.String,
});
export type CheckResult = typeof CheckResult.Type;

/** A requirement for the next print, with its status, evidence, and each run's result. */
export const Requirement = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  added: Schema.String,
  quote: Schema.NullOr(Schema.String),
  scope: Schema.Literals(["print", "standing"]),
  required: Schema.Boolean,
  status: Schema.Literals(["open", "met", "failed", "waived"]),
  verifiedRun: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(Schema.String),
  updated: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  /** The support or point it is about, as a position ID, and the run it was written from. */
  position: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
  /** The latest result for each run and head, newest first. */
  checks: Schema.Array(CheckResult),
  /** The newest result per head: the requirement's status now. */
  latest: Schema.Array(CheckResult),
  /** Every check ever made, newest first. */
  history: Schema.Array(CheckResult),
});

/** One part being printed, such as the Beast's head. */
export const Task = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "paused", "done"]),
  current: Schema.Boolean,
  /** Globs on library paths, such as `Library/Beast/Heads/*`. */
  patterns: Schema.Array(Schema.String),
  runs: Schema.Array(Schema.String),
  prints: Schema.Array(Schema.String),
  lastActivity: Schema.NullOr(Schema.Number),
});
export type Task = typeof Task.Type;

export const Project = Schema.Struct({ id: Schema.String, name: Schema.String, tasks: Schema.Array(Task) });
export type Project = typeof Project.Type;
export const ProjectsReply = Schema.Struct({ projects: Schema.Array(Project) });
export type ProjectsReply = typeof ProjectsReply.Type;
export type Requirement = typeof Requirement.Type;

export const NotesReply = Schema.Struct({ notes: Schema.Array(HeadNote) });
export type NotesReply = typeof NotesReply.Type;
export const RequirementsReply = Schema.Struct({ requirements: Schema.Array(Requirement) });
export type RequirementsReply = typeof RequirementsReply.Type;

/** One support contact of a plan: where it is, its position ID, its sizes, and its tree's load. */
export const PlanContact = Schema.Struct({
  id: Schema.String,
  tree: Schema.String,
  position: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
  tipRadius: Schema.NullOr(Schema.Number),
  radius: Schema.Number,
  neckRadius: Schema.NullOr(Schema.Number),
  neckLength: Schema.NullOr(Schema.Number),
  stemRadius: Schema.NullOr(Schema.Number),
  shaftRadius: Schema.NullOr(Schema.Number),
  loadU: Schema.NullOr(Schema.Number),
  plateColumn: Schema.Boolean,
});
export type PlanContact = typeof PlanContact.Type;

const Vec3 = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]);

/** A plan for review: its bounds, the frame of its cut images, and its support contacts. */
export const PlanReply = Schema.Struct({
  run: Schema.String,
  folder: Schema.String,
  low: Vec3,
  high: Vec3,
  cut: Schema.Struct({ lowX: Schema.Number, highY: Schema.Number, pxPerMm: Schema.Number, width: Schema.Number, height: Schema.Number }),
  triangles: Schema.Struct({ model: Schema.Number, supports: Schema.Number }),
  contacts: Schema.Array(PlanContact),
  hasLoads: Schema.Boolean,
});
export type PlanReply = typeof PlanReply.Type;

const ErrorBody = Schema.Struct({ error: Schema.String, unreachable: Schema.optional(Schema.Boolean) });

/** A catalog request that failed: the relay's reason, and whether the MacBook with the run database was unreachable. */
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly unreachable: boolean,
  ) {
    super(message);
  }
}

/** One catalog route: its path under the relay, and the shape of its reply. */
export interface CatalogRoute<A> {
  readonly path: string;
  readonly schema: Schema.Codec<A, unknown>;
}

export const runsRoute: CatalogRoute<RunsReply> = { path: "/api/resin/runs", schema: RunsReply };
export const libraryRoute: CatalogRoute<LibraryReply> = { path: "/api/resin/library", schema: LibraryReply };
export const historyRoute: CatalogRoute<HistoryReply> = { path: "/api/resin/history", schema: HistoryReply };
export const planRoute = (runId: string): CatalogRoute<PlanReply> => ({ path: `/api/resin/runs/${encodeURIComponent(runId)}/plan`, schema: PlanReply });

/** The plan's cut at height z, seen from above: the model grey, the supports orange. */
export const sectionUrl = (relayBase: string, runId: string, z: number): string => `${relayBase}/api/resin/runs/${encodeURIComponent(runId)}/section.png?z=${z.toFixed(2)}`;

/** A plan's model or supports as a `model.mesh` file. */
export const planMeshUrl = (relayBase: string, runId: string, part: "model" | "supports"): string => `${relayBase}/api/resin/runs/${encodeURIComponent(runId)}/mesh/${part}`;

/** One support under a point: its tree, the part hit, and their position IDs. */
export const PlanPick = Schema.Struct({
  tree: Schema.String,
  treePosition: Schema.NullOr(Schema.String),
  part: Schema.String,
  partPosition: Schema.String,
  /** How far the point is outside the part, in mm (0: on or in it). */
  distance: Schema.Number,
});
export type PlanPick = typeof PlanPick.Type;

const PicksReply = Schema.Struct({ picks: Schema.Array(PlanPick) });

/** The supports under a point of a plan (mm), one per tree, nearest first. `reachMm` is the finger's reach. */
export const fetchPicks = async (relayBase: string, runId: string, point: readonly [number, number, number], reachMm: number): Promise<ReadonlyArray<PlanPick>> => {
  const [x, y, z] = point;
  const response = await authedFetch(`${relayBase}/api/resin/runs/${encodeURIComponent(runId)}/pick?x=${x}&y=${y}&z=${z}&r=${reachMm}`, { cache: "no-store" });
  const reply: unknown = await response.json();
  if (!response.ok) {
    const error = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(reply));
    throw new CatalogError(error?.error ?? `The relay answered HTTP ${response.status}`, error?.unreachable === true);
  }
  return (await Schema.decodeUnknownPromise(PicksReply)(reply)).picks;
};

/** One tree's triangles of a plan's supports, as a `model.mesh` file: to mark the whole support. */
export const treeMeshUrl = (relayBase: string, runId: string, tree: string): string => `${relayBase}/api/resin/runs/${encodeURIComponent(runId)}/trees/${encodeURIComponent(tree)}/mesh`;

const FeedbackReply = Schema.Struct({ kind: Schema.Literals(["note", "requirement"]), id: Schema.String });

/** Writes a note or a requirement about a position of a run (the catalog's one write). Resolves with its id. */
export const sendFeedback = async (
  relayBase: string,
  body: { readonly kind: "note" | "requirement"; readonly text: string; readonly run: string; readonly position: string | null },
): Promise<string> => {
  const response = await authedFetch(`${relayBase}/api/resin/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const reply: unknown = await response.json();
  if (!response.ok) {
    const error = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(reply));
    throw new CatalogError(error?.error ?? `The relay answered HTTP ${response.status}`, error?.unreachable === true);
  }
  return (await Schema.decodeUnknownPromise(FeedbackReply)(reply)).id;
};

export const projectsRoute: CatalogRoute<ProjectsReply> = { path: "/api/resin/projects", schema: ProjectsReply };
export const notesRoute: CatalogRoute<NotesReply> = { path: "/api/resin/notes", schema: NotesReply };
export const requirementsRoute: CatalogRoute<RequirementsReply> = { path: "/api/resin/requirements", schema: RequirementsReply };
export const activeRoute: CatalogRoute<ActiveReply> = { path: "/api/resin/active", schema: ActiveReply };
export const runRoute = (id: string): CatalogRoute<RunDetail> => ({ path: `/api/resin/runs/${encodeURIComponent(id)}`, schema: RunDetail });
export const originRoute = (name: string): CatalogRoute<OriginReply> => ({ path: `/api/resin/origin?name=${encodeURIComponent(name)}`, schema: OriginReply });

/** A run's render; `thumb` asks for the relay's small copy. */
export const renderUrl = (relayBase: string, runId: string, name: string, thumb: boolean): string =>
  `${relayBase}/api/resin/runs/${encodeURIComponent(runId)}/renders/${encodeURIComponent(name)}${thumb ? "?size=thumb" : ""}`;

const readCatalog = async <A>(relayBase: string, route: CatalogRoute<A>): Promise<A> => {
  const response = await authedFetch(`${relayBase}${route.path}`, { cache: "no-store" });
  const text = await response.text();
  // A relay without the catalog answers 404 with no JSON: say that, not the parse error.
  if (!response.ok && !(response.headers.get("content-type") ?? "").includes("json")) {
    throw new CatalogError(response.status === 404 ? "This relay has no Resin catalog yet (HTTP 404). It needs a relay update." : `The relay answered HTTP ${response.status}`, false);
  }
  const body = await Schema.decodeUnknownPromise(Schema.fromJsonString(Schema.Unknown))(text);
  if (!response.ok) {
    const error = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(body));
    throw new CatalogError(error?.error ?? `The relay answered HTTP ${response.status}`, error?.unreachable === true);
  }
  return Schema.decodeUnknownPromise(route.schema)(body);
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** How often an open page asks the relay again. */
export const REFRESH_MS = 30_000;

/** How often a page that shows runs in progress asks again. */
export const LIVE_REFRESH_MS = 5_000;

/** A reply as a page sees it. The last value stays while a new request runs or fails. */
export interface Loaded<A> {
  readonly value: A | undefined;
  readonly error: string | undefined;
  /** The last request failed because the MacBook with the run database did not answer. */
  readonly unreachable: boolean;
}

interface Entry {
  value: unknown;
  error: string | undefined;
  unreachable: boolean;
  loading: boolean;
  snapshot: Loaded<unknown>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const EMPTY: Loaded<never> = { value: undefined, error: undefined, unreachable: false };

const keyOf = (relayBase: string, route: CatalogRoute<unknown>): string => `${relayBase}${route.path}`;

/** Asks the relay for a route, unless a request for it runs now. The answer goes to the store. */
export const loadCatalog = <A>(relayBase: string, route: CatalogRoute<A>): void => {
  const key = keyOf(relayBase, route);
  const entry = entries.get(key) ?? { value: undefined, error: undefined, unreachable: false, loading: false, snapshot: EMPTY };
  entries.set(key, entry);
  if (entry.loading) return;
  entry.loading = true;
  readCatalog(relayBase, route)
    .then((value) => {
      entry.value = value;
      entry.error = undefined;
      entry.unreachable = false;
    })
    .catch((cause: unknown) => {
      console.error(`[resin] reading ${route.path} failed`, cause);
      entry.error = cause instanceof Error ? cause.message : String(cause);
      entry.unreachable = cause instanceof CatalogError && cause.unreachable;
    })
    .finally(() => {
      entry.loading = false;
      entry.snapshot = { value: entry.value, error: entry.error, unreachable: entry.unreachable };
      notify();
    });
};

/**
 * A route's reply from the store. It loads at once, then every `refreshMs`
 * while the page is on screen; a page under another one does not ask.
 */
export const useCatalog = <A>(relayBase: string, route: CatalogRoute<A> | undefined, refreshMs: number = REFRESH_MS): Loaded<A> => {
  const focused = useIsFocused();
  const key = route === undefined ? undefined : keyOf(relayBase, route);
  // The key names the route: a new route object with the same key asks for nothing new.
  const routeRef = React.useRef(route);
  routeRef.current = route;
  React.useEffect(() => {
    const current = routeRef.current;
    if (key === undefined || current === undefined || !focused) return;
    loadCatalog(relayBase, current);
    const id = setInterval(() => loadCatalog(relayBase, current), refreshMs);
    return () => clearInterval(id);
  }, [relayBase, key, focused, refreshMs]);
  const snapshot = React.useSyncExternalStore(subscribe, () => (key === undefined ? EMPTY : (entries.get(key)?.snapshot ?? EMPTY)));
  const schema = route?.schema;
  return React.useMemo((): Loaded<A> => {
    if (schema === undefined) return EMPTY;
    // The store holds every route's reply; the route's own schema says which this one is.
    const value = snapshot.value !== undefined && Schema.is(schema)(snapshot.value) ? snapshot.value : undefined;
    return { value, error: snapshot.error, unreachable: snapshot.unreachable };
  }, [schema, snapshot]);
};
