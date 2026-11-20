/**
 * Pure formatting for the Resin pages: what a print file is, how a print
 * ended, and the labels of run metrics and settings. Pure, so it is easy
 * to test.
 *
 * @internal
 */
import type { PrintRecord } from "./resinApi";

/** What a print file is, for a title and a detail line. The file name goes elsewhere, small. */
export interface FileIdentity {
  readonly title: string;
  readonly detail: string | undefined;
}

const stemOf = (name: string): string => name.replace(/\.(goo|ctb)$/i, "");

/**
 * A print file by what it is. A print record with two runs is an A/B plate;
 * a name such as "Head 183 A + 184 B" is one too. Any other file keeps its
 * name without the extension.
 */
export const describeFile = (name: string, print: PrintRecord | null | undefined): FileIdentity => {
  const stem = stemOf(name.split("/").at(-1) ?? name);
  const subject = /^([A-Za-z][A-Za-z ]*?)\s+\d/.exec(print?.file ?? stem)?.[1] ?? stem.split(/\s+/)[0] ?? stem;
  if (print !== null && print !== undefined && print.runA !== null && print.runB !== null) {
    return print.runA === print.runB
      ? { title: `${subject} ×2`, detail: `Run ${print.runA} on both heads` }
      : { title: `${subject} A/B`, detail: `A ${print.runA} · B ${print.runB}` };
  }
  // The organizer's names: "Head — 2026-11-01 00.47 (18)", "Feet app supports — 2026-10-30 04.05".
  const filed = /^(.+?) — (\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\s*(.*)$/.exec(stem);
  if (filed !== null) {
    const [, filedSubject, year, month, day, hour, minute, rest] = filed;
    const when = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    const copy = /^\((\d+)\)$/.exec(rest ?? "")?.[1];
    const note = copy !== undefined ? `copy ${copy}` : rest === undefined || rest === "" ? undefined : rest;
    return { title: filedSubject ?? stem, detail: [`Sliced ${fmtShortDate(when.getTime())}`, note].filter((part) => part !== undefined).join(" · ") };
  }
  const plate = /^(.+?)\s+(\d+)\s*A?\s*\+\s*(\d+)\s*B?\b/.exec(stem);
  if (plate?.[1] !== undefined && plate[2] !== undefined && plate[3] !== undefined) {
    return { title: `${plate[1]} A/B`, detail: `A ${plate[2]} · B ${plate[3]}` };
  }
  return { title: stem, detail: undefined };
};

/** How a print ended, as a tone and a short word, from the run database's free text. */
export type OutcomeKind = "completed" | "separated" | "failed" | "stopped" | "unknown";

export const outcomeKindOf = (outcome: string | null | undefined): OutcomeKind => {
  const text = (outcome ?? "").toLowerCase();
  if (text === "" || text.startsWith("unknown")) return "unknown";
  if (text.includes("separation")) return "separated";
  if (text.startsWith("completed")) return "completed";
  if (text.startsWith("stopped")) return "stopped";
  if (text.startsWith("failed")) return "failed";
  return "unknown";
};

export const OUTCOME_LABEL: Readonly<Record<OutcomeKind, string>> = {
  completed: "Completed",
  separated: "Separated",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Unknown",
};

/** Plain names for the metrics a person reads first; other keys show as they are. */
const METRIC_LABELS: Readonly<Record<string, string>> = {
  placed: "Contacts placed",
  failed: "Contacts failed",
  burn_unsupported_islands: "Unsupported islands",
  burn_still_floating: "Still floating",
  validator_passed: "Validator",
  braces: "Braces",
  anchored: "Anchored",
  plan_seconds: "Plan time",
  body_p99: "Body load p99",
  body_max: "Body load max",
  trees_gt1: "Trees over 1",
  tip_trees_gt1: "Tip trees over 1",
  contacts_gt1: "Contacts over 1",
  feet: "Feet",
  chin_body_max: "Chin body max",
};

export const metricLabel = (key: string): string => METRIC_LABELS[key] ?? key;

/** A metric value: whole numbers as they are, others to three significant digits. */
export const fmtMetric = (key: string, value: number | string): string => {
  if (typeof value === "string") return value;
  if (key === "validator_passed") return value === 1 ? "Passed" : "Failed";
  if (key === "plan_seconds") return `${value.toFixed(1)} s`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toPrecision(3);
};

/** Whether a metric went up or down against the parent, for a small arrow. */
export const deltaOf = (value: number | string, parent: number | string | null): "up" | "down" | "same" | undefined => {
  if (parent === null || typeof value !== "number" || typeof parent !== "number") return undefined;
  return value > parent ? "up" : value < parent ? "down" : "same";
};

/**
 * What two runs test against each other: the flags whose values differ, in
 * A's order, then the flags only B has. A missing flag is null.
 */
export const abDiff = (
  a: ReadonlyArray<{ readonly flag: string; readonly value: string | null }>,
  b: ReadonlyArray<{ readonly flag: string; readonly value: string | null }>,
): ReadonlyArray<{ readonly flag: string; readonly a: string | null; readonly b: string | null }> => {
  const ofA = new Map(a.map((setting) => [setting.flag, setting.value ?? "on"]));
  const ofB = new Map(b.map((setting) => [setting.flag, setting.value ?? "on"]));
  const fromA = a.flatMap((setting) => {
    const valueA = setting.value ?? "on";
    const valueB = ofB.get(setting.flag) ?? null;
    return valueA === valueB ? [] : [{ flag: setting.flag, a: valueA, b: valueB }];
  });
  const onlyB = b.flatMap((setting) => (ofA.has(setting.flag) ? [] : [{ flag: setting.flag, a: null, b: setting.value ?? "on" }]));
  return [...fromA, ...onlyB];
};

/** A flag without its dashes, such as "junction radius". */
export const flagLabel = (flag: string): string => flag.replace(/^--/, "").replaceAll("-", " ");

/** A run's render name as a caption: "whole-front.png" becomes "Whole, front". */
export const renderLabel = (name: string): string => {
  const words = name.replace(/\.png$/i, "").split("-");
  const [first, ...rest] = words;
  if (first === undefined) return name;
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length === 0 ? head : `${head}, ${rest.join(" ")}`;
};

/** A date from Unix milliseconds: "Nov 18, 15:17". */
export const fmtShortDate = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

/** The day of a print record's `started` text, such as "2026-11-18", for grouping; undefined when it has none. */
export const dayOf = (started: string | null): string | undefined => /^\d{4}-\d{2}-\d{2}/.exec(started ?? "")?.[0];

/** A day as a heading: "Wednesday, Nov 18". */
export const fmtDay = (day: string): string => {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) return day;
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

/** The time part of a print record's `started` text, with any note after it. */
export const timeOf = (started: string | null): string | undefined => {
  const rest = (started ?? "").replace(/^\d{4}-\d{2}-\d{2}\s*/, "").trim();
  return rest === "" ? undefined : rest;
};

/** The time a run in progress has left against a typical run: "4 min left". */
export const timeLeft = (finishAt: number | null, nowMs: number): string | undefined => {
  if (finishAt === null) return undefined;
  const left = Math.ceil((finishAt - nowMs) / 60_000);
  return left > 0 ? `${left} min left` : "past the usual time";
};

/** A run in progress in a few words: "Run 640 · anti-alias · 4 min left". */
export const activeLine = (run: { readonly number: number; readonly stage: string | null; readonly finishAt: number | null }, nowMs: number): string =>
  [`Run ${run.number}`, run.stage ?? "starting", timeLeft(run.finishAt, nowMs)].filter((part) => part !== undefined).join(" · ");

/** A print record's or a note's time as a sortable key: "2026-11-18 15:17" from "2026-11-18 15:17 (restart …)". */
export const timeKey = (text: string | null): string => /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/.exec(text ?? "")?.[0] ?? "";

/** A print's start as Unix ms (local time), or undefined when its text has no date. */
export const startedMs = (started: string | null): number | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(started ?? "");
  if (match === null) return undefined;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour ?? "0"), Number(minute ?? "0")).getTime();
};

/** The head's timeline: each print with the notes about it, and the other notes in time order. */
export type HeadEvent<P, N> = { readonly kind: "Print"; readonly key: string; readonly print: P; readonly notes: ReadonlyArray<N> } | { readonly kind: "Note"; readonly key: string; readonly note: N };

export const headTimeline = <P extends { readonly id: string; readonly started: string | null }, N extends { readonly id: number; readonly at: string; readonly print: string | null }>(
  prints: ReadonlyArray<P>,
  notes: ReadonlyArray<N>,
): ReadonlyArray<HeadEvent<P, N>> => {
  const printIds = new Set(prints.map((print) => print.id));
  const events: ReadonlyArray<{ readonly at: string; readonly order: number; readonly event: HeadEvent<P, N> }> = [
    ...prints.map((print) => ({
      at: timeKey(print.started),
      order: Number(print.id.replace(/\D/g, "")),
      event: { kind: "Print" as const, key: print.id, print, notes: notes.filter((note) => note.print === print.id) },
    })),
    ...notes.filter((note) => note.print === null || !printIds.has(note.print)).map((note) => ({ at: timeKey(note.at), order: 0, event: { kind: "Note" as const, key: `note-${note.id}`, note } })),
  ];
  return [...events].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order).map((entry) => entry.event);
};
