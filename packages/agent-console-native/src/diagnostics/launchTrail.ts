/**
 * The launch trail: the steps of this launch, so a launch that dies says how
 * far it got. Each step is kept on the device and sent to the printer's relay
 * log (`POST /api/app-log`, in `relay.log`). A launch is stable once the app
 * has run for `STABLE_MS` after the navigator mounted.
 *
 * At the next launch, a trail that never became stable is sent again and
 * shown, with the step it stopped after. A native crash then shows as a trail
 * that stops between two steps; a JS error shows as its own step.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Option, Schema } from "effect";
import { authedFetch } from "../auth/serverTokens";

const STORE_KEY = "agent-console-native:launchTrail";
/** How long the app must run after the navigator mounts to count as launched. */
export const STABLE_MS = 15_000;
/** The most lines kept while the relay is not known or not reachable. */
const MAX_UNSENT = 200;

export const Trail = Schema.Struct({
  id: Schema.String,
  /** When the JS started (epoch ms). */
  started: Schema.Number,
  /** Each step, `at` milliseconds after the JS started. */
  steps: Schema.Array(Schema.Struct({ at: Schema.Number, step: Schema.String })),
  stable: Schema.Boolean,
});
export type Trail = typeof Trail.Type;

const decodeTrail = Schema.decodeUnknownOption(Schema.fromJsonString(Trail));

const startedAt = Date.now();
let trail: Trail = { id: new Date(startedAt).toISOString(), started: startedAt, steps: [], stable: false };
let relay: string | undefined;
let unsent: ReadonlyArray<string> = [];

/** The last launch's trail, read before this launch writes its own. */
const previous: Promise<Trail | undefined> = AsyncStorage.getItem(STORE_KEY)
  .then((raw) => (raw === null ? undefined : Option.getOrUndefined(decodeTrail(raw))))
  .catch(() => undefined);

/** Writes in order, each after the previous trail was read. */
let writes: Promise<unknown> = previous;
const save = (): void => {
  const snapshot = JSON.stringify(trail);
  writes = writes.then(() => AsyncStorage.setItem(STORE_KEY, snapshot)).catch(() => undefined);
};

const flush = (): void => {
  if (relay === undefined || unsent.length === 0) return;
  const lines = unsent;
  unsent = [];
  authedFetch(`${relay}/api/app-log`, { method: "POST", headers: { "content-type": "text/plain" }, body: lines.join("\n") })
    .then((response) => {
      // A refusal (the relay's token was not read yet, or is wrong) keeps the lines for the next send.
      if (!response.ok) throw new Error(`the relay answered HTTP ${response.status}`);
    })
    .catch(() => {
      unsent = [...lines, ...unsent].slice(-MAX_UNSENT);
    });
};

const send = (line: string): void => {
  unsent = [...unsent, line].slice(-MAX_UNSENT);
  flush();
};

/** Records one step of this launch. */
export const mark = (step: string): void => {
  const at = Date.now() - startedAt;
  trail = { ...trail, steps: [...trail.steps, { at, step }] };
  save();
  send(`launch ${trail.id} +${at}ms ${step}`);
};

/** This launch lived long enough: the next launch does not report it. */
export const markStable = (): void => {
  trail = { ...trail, stable: true };
  mark("stable");
};

/** Sends the trail to the relay at `relayBase` from now on, with what is waiting. */
export const setTrailRelay = (relayBase: string): void => {
  relay = relayBase;
  flush();
};

/** The last launch's trail when it never became stable (it died, or was closed early). */
export const unfinishedPrevious = (): Promise<Trail | undefined> => previous.then((last) => (last !== undefined && !last.stable ? last : undefined));

/** The trail as lines, for the log and for the owner. */
export const describeTrail = (last: Trail): string => last.steps.map((entry) => `+${entry.at}ms ${entry.step}`).join("\n");

/**
 * Records every JS error that reaches the global handler. A fatal one is
 * recorded, then handed on after a short wait, so the step can reach the
 * device's storage and the relay before the app ends.
 */
export const watchErrors = (): void => {
  const handOn = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const text = error instanceof Error ? `${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(0, 8).join("\n")}` : String(error);
    mark(`${isFatal === true ? "FATAL JS error" : "JS error"}: ${text}`);
    if (isFatal === true) setTimeout(() => handOn(error, isFatal), 1500);
    else handOn(error, isFatal);
  });
};
