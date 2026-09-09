/**
 * EAS builds, read from OUR vite backend's `/builds` endpoints — the same data
 * expo.dev shows: the build list, the full `eas build:view` record, and the
 * phase-grouped log.
 *
 * Two things shape this file. First, `fetch` does not reject on a 4xx/5xx, so
 * every read checks `response.ok` explicitly and returns a result union; a
 * failed refresh is reported, never degraded into an empty list. Second,
 * `/builds/:id` returns an *open* record straight from the EAS CLI, so nothing
 * is trusted: every field is narrowed off `unknown` through `isRecord`, and a
 * field EAS renames later goes `undefined` rather than crashing a screen.
 *
 * Deliberately free of React Native imports — `colors.ts` resolves
 * `PlatformColor` at import time, so pulling it in here would make this module
 * unloadable under vitest. Presentation helpers therefore return a *tone*
 * ("success", "danger", …) and the screens map that to a colour.
 *
 * @internal
 */
import { relativeTime } from "./time";

/** Same narrowing `push.ts` and `providerAuth.ts` use for unknown payloads. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * `status` stays a raw string rather than a union. EAS owns this vocabulary
 * and can add to it; narrowing to six literals here would mean a new status
 * silently reads as one of the old ones. The presentation helpers below handle
 * the documented set and pass anything else through untouched.
 */
export type BuildRow = {
  readonly id: string;
  readonly status: string;
  readonly platform: string | undefined;
  readonly buildProfile: string | undefined;
  readonly appVersion: string | undefined;
  readonly gitCommitMessage: string | undefined;
  readonly buildUrl: string | undefined;
  readonly appSlug: string | undefined;
  readonly ownerName: string | undefined;
  /** `createdAt` is absent from the list rows; kept for when it appears. */
  readonly createdAt: string | undefined;
};

export type BuildMetrics = {
  readonly queueTimeMs: number | undefined;
  readonly waitTimeMs: number | undefined;
  readonly durationMs: number | undefined;
};

export type BuildDetail = {
  readonly id: string | undefined;
  readonly status: string;
  readonly platform: string | undefined;
  readonly buildProfile: string | undefined;
  readonly appVersion: string | undefined;
  readonly appBuildVersion: string | undefined;
  readonly gitCommitHash: string | undefined;
  readonly gitCommitMessage: string | undefined;
  readonly distribution: string | undefined;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly completedAt: string | undefined;
  readonly initiatingActorName: string | undefined;
  readonly buildUrl: string | undefined;
  readonly error: string | undefined;
  readonly metrics: BuildMetrics | undefined;
};

export type LogLine = {
  readonly level: number;
  readonly msg: string;
  readonly time: string | undefined;
};

export type LogPhase = {
  readonly phase: string;
  readonly lines: ReadonlyArray<LogLine>;
};

/* ------------------------------------------------------------------ *
 * Narrowing
 * ------------------------------------------------------------------ */

export const toBuildRow = (value: unknown): BuildRow | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringOf(value.id);
  const status = stringOf(value.status);
  // A row without these two is not addressable or displayable — dropping it
  // beats rendering a blank tappable row that leads nowhere.
  if (id === undefined || status === undefined) return undefined;

  const artifacts = isRecord(value.artifacts) ? value.artifacts : undefined;
  const app = isRecord(value.app) ? value.app : undefined;
  const owner = app !== undefined && isRecord(app.ownerAccount) ? app.ownerAccount : undefined;

  return {
    id,
    status,
    platform: stringOf(value.platform),
    buildProfile: stringOf(value.buildProfile),
    appVersion: stringOf(value.appVersion),
    gitCommitMessage: stringOf(value.gitCommitMessage),
    buildUrl: artifacts === undefined ? undefined : stringOf(artifacts.buildUrl),
    appSlug: app === undefined ? undefined : stringOf(app.slug),
    ownerName: owner === undefined ? undefined : stringOf(owner.name),
    createdAt: stringOf(value.createdAt),
  };
};

/**
 * EAS reports a failure either as a plain string or as an object carrying a
 * `message` (and usually an `errorCode`). Both are read; anything else yields
 * `undefined` rather than `[object Object]` on screen.
 */
const toBuildError = (value: unknown): string | undefined => {
  const direct = stringOf(value);
  if (direct !== undefined) return direct.trim() === "" ? undefined : direct;
  if (!isRecord(value)) return undefined;
  const message = stringOf(value.message);
  const code = stringOf(value.errorCode);
  if (message !== undefined && code !== undefined) return `${code}: ${message}`;
  return message ?? code;
};

const toMetrics = (value: unknown): BuildMetrics | undefined => {
  if (!isRecord(value)) return undefined;
  const metrics = {
    queueTimeMs: numberOf(value.buildQueueTime),
    waitTimeMs: numberOf(value.buildWaitTime),
    durationMs: numberOf(value.buildDuration),
  };
  const empty =
    metrics.queueTimeMs === undefined && metrics.waitTimeMs === undefined && metrics.durationMs === undefined;
  return empty ? undefined : metrics;
};

export const toBuildDetail = (value: unknown): BuildDetail | undefined => {
  if (!isRecord(value)) return undefined;
  const status = stringOf(value.status);
  if (status === undefined) return undefined;

  const artifacts = isRecord(value.artifacts) ? value.artifacts : undefined;
  const actor = isRecord(value.initiatingActor) ? value.initiatingActor : undefined;

  return {
    id: stringOf(value.id),
    status,
    platform: stringOf(value.platform),
    buildProfile: stringOf(value.buildProfile),
    appVersion: stringOf(value.appVersion),
    appBuildVersion: stringOf(value.appBuildVersion),
    gitCommitHash: stringOf(value.gitCommitHash),
    gitCommitMessage: stringOf(value.gitCommitMessage),
    distribution: stringOf(value.distribution),
    createdAt: stringOf(value.createdAt),
    updatedAt: stringOf(value.updatedAt),
    completedAt: stringOf(value.completedAt),
    initiatingActorName: actor === undefined ? undefined : stringOf(actor.displayName),
    buildUrl: artifacts === undefined ? undefined : stringOf(artifacts.buildUrl),
    error: toBuildError(value.error),
    metrics: toMetrics(value.metrics),
  };
};

export const toLogPhases = (value: unknown): ReadonlyArray<LogPhase> => {
  if (!isRecord(value) || !Array.isArray(value.phases)) return [];
  const phases: Array<LogPhase> = [];
  for (const entry of value.phases) {
    if (!isRecord(entry)) continue;
    const phase = stringOf(entry.phase);
    if (phase === undefined) continue;
    const rawLines = Array.isArray(entry.lines) ? entry.lines : [];
    const lines: Array<LogLine> = [];
    for (const rawLine of rawLines) {
      if (!isRecord(rawLine)) continue;
      lines.push({
        level: numberOf(rawLine.level) ?? LEVEL_INFO,
        msg: stringOf(rawLine.msg) ?? "",
        time: stringOf(rawLine.time),
      });
    }
    phases.push({ phase, lines });
  }
  return phases;
};

/* ------------------------------------------------------------------ *
 * Presentation (pure)
 * ------------------------------------------------------------------ */

export const LEVEL_INFO = 30;
export const LEVEL_WARN = 40;
export const LEVEL_ERROR = 50;

/** A build in one of these states will never change again, so polling stops. */
const TERMINAL_STATUSES: ReadonlyArray<string> = ["FINISHED", "ERRORED", "CANCELED"];

export const isTerminalStatus = (status: string): boolean => TERMINAL_STATUSES.includes(status);

/** Drives the list's auto-poll: any build still moving means keep refreshing. */
export const hasActiveBuild = (rows: ReadonlyArray<{ readonly status: string }>): boolean =>
  rows.some((row) => !isTerminalStatus(row.status));

/**
 * A semantic tone rather than a colour, so this stays testable outside React
 * Native. The screens map tone → `colors.ts`.
 */
export type StatusTone = "success" | "danger" | "active" | "neutral";

export const statusTone = (status: string): StatusTone => {
  switch (status) {
    case "FINISHED":
      return "success";
    case "ERRORED":
      return "danger";
    case "NEW":
    case "IN_QUEUE":
    case "IN_PROGRESS":
      return "active";
    default:
      return "neutral";
  }
};

/** True while a build is doing something — the pill shows a spinner. */
export const isRunningStatus = (status: string): boolean => status === "IN_PROGRESS" || status === "IN_QUEUE";

export type LogTone = "info" | "warn" | "error";

export const levelTone = (level: number): LogTone => {
  if (level >= LEVEL_ERROR) return "error";
  if (level >= LEVEL_WARN) return "warn";
  return "info";
};

/** The worst tone in a phase, so a collapsed phase can still show it failed. */
export const phaseTone = (phase: LogPhase): LogTone => {
  let tone: LogTone = "info";
  for (const line of phase.lines) {
    const lineTone = levelTone(line.level);
    if (lineTone === "error") return "error";
    if (lineTone === "warn") tone = "warn";
  }
  return tone;
};

/**
 * `SPIN_UP_BUILDER` → `Spin up builder`. EAS phase names are SCREAMING_SNAKE;
 * an unrecognised shape is passed through rather than mangled.
 */
export const phaseLabel = (phase: string): string => {
  const words = phase.trim().split(/[_\s]+/).filter((word) => word.length > 0);
  if (words.length === 0) return phase;
  const lowered = words.map((word) => word.toLowerCase());
  const first = lowered[0];
  if (first === undefined) return phase;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...lowered.slice(1)].join(" ");
};

/** Commit messages are often multi-line; the list shows only the subject. */
export const firstLine = (message: string | undefined): string | undefined => {
  if (message === undefined) return undefined;
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

export const shortCommit = (hash: string | undefined): string | undefined =>
  hash === undefined || hash.trim() === "" ? undefined : hash.trim().slice(0, 7);

/** `metrics` are milliseconds. Renders as `2h 5m` / `1m 23s` / `45s`. */
export const formatDuration = (ms: number | undefined): string | undefined => {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
};

/** ISO timestamp → the app's shared "…ago" wording, or undefined if unusable. */
export const relativeTimeOf = (iso: string | undefined): string | undefined => {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : relativeTime(ms);
};

/* ------------------------------------------------------------------ *
 * URLs and transport
 * ------------------------------------------------------------------ */

const trimBase = (backend: string): string => backend.replace(/\/+$/, "");

export const buildsUrl = (backend: string): string => `${trimBase(backend)}/builds`;
export const buildDetailUrl = (backend: string, id: string): string =>
  `${trimBase(backend)}/builds/${encodeURIComponent(id)}`;
export const buildLogsUrl = (backend: string, id: string): string =>
  `${trimBase(backend)}/builds/${encodeURIComponent(id)}/logs`;

/**
 * A failed request's message. The backend answers `{ error }` on a 404, which
 * is more useful than the status line, so it is preferred when present.
 */
export const httpErrorMessage = (status: number, body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      const message = stringOf(parsed.error) ?? stringOf(parsed.message);
      if (message !== undefined && message.trim() !== "") return message;
    }
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `The server answered ${status}.`;
};

export type Fetched<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string };

/**
 * One GET. `fetch` rejects only on a transport failure, so a 4xx/5xx has to be
 * caught by checking `response.ok` — without that, an error page would be
 * parsed as data.
 */
const getJson = async (url: string): Promise<Fetched<unknown>> => {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : `Could not reach ${url}.`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, message: httpErrorMessage(response.status, body) };
  }

  try {
    const value: unknown = await response.json();
    return { ok: true, value };
  } catch {
    return { ok: false, message: "The server sent a response that was not JSON." };
  }
};

export const fetchBuilds = async (backend: string): Promise<Fetched<ReadonlyArray<BuildRow>>> => {
  const result = await getJson(buildsUrl(backend));
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.data)) {
    return { ok: false, message: "The server sent no build list." };
  }
  const rows: Array<BuildRow> = [];
  for (const entry of result.value.data) {
    const row = toBuildRow(entry);
    if (row !== undefined) rows.push(row);
  }
  return { ok: true, value: rows };
};

export const fetchBuildDetail = async (backend: string, id: string): Promise<Fetched<BuildDetail>> => {
  const result = await getJson(buildDetailUrl(backend, id));
  if (!result.ok) return result;
  const detail = isRecord(result.value) ? toBuildDetail(result.value.data) : undefined;
  if (detail === undefined) return { ok: false, message: "The server sent no detail for this build." };
  return { ok: true, value: detail };
};

export const fetchBuildLogs = async (backend: string, id: string): Promise<Fetched<ReadonlyArray<LogPhase>>> => {
  const result = await getJson(buildLogsUrl(backend, id));
  if (!result.ok) return result;
  // An empty `phases` array is a real answer, not a failure: a queued build has
  // produced no log yet.
  return { ok: true, value: toLogPhases(result.value) };
};

/** How often the list and an in-progress detail re-read while something moves. */
export const BUILD_POLL_INTERVAL_MS = 10_000;

/**
 * Most lines rendered for one expanded phase. A real `RUN_FASTLANE` phase runs
 * to thousands of lines, and React Native lays out every `Text` in an expanded
 * `ScrollView` eagerly — enough of them visibly janks the screen. The *tail* is
 * kept rather than the head: the end of a phase is where the failure is.
 */
export const LOG_LINE_LIMIT = 500;

export type VisibleLines<A> = {
  readonly lines: ReadonlyArray<A>;
  /** How many were dropped off the front, so the UI can say so honestly. */
  readonly hidden: number;
};

export const tailLines = <A,>(lines: ReadonlyArray<A>, limit: number): VisibleLines<A> => {
  if (limit <= 0) return { lines: [], hidden: lines.length };
  if (lines.length <= limit) return { lines, hidden: 0 };
  return {
    lines: lines.slice(lines.length - limit),
    hidden: lines.length - limit,
  };
};
