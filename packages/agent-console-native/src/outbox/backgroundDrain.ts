/**
 * The outbox in the background: an iOS background task that sends what is
 * still on the device (queued while the server could not be reached), so a
 * message goes out without the app being opened. iOS decides when it runs
 * (at most every 15 minutes, when conditions allow); the app returning to the
 * foreground drains the outbox anyway.
 *
 * Defined at module scope (imported from index.ts), as iOS may launch the app
 * straight into the task.
 *
 * @internal
 */
import { Effect } from "effect";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { runApp } from "../effect/runtime";
import { Outbox } from "./Outbox";

const TASK = "doubleagent.outbox.drain";
/** Inside iOS's allowance for a background run. */
const RUN_LIMIT = "25 seconds";
/** Minutes between runs (iOS's minimum). */
const INTERVAL = 15;

TaskManager.defineTask(TASK, () =>
  runApp(
    Effect.gen(function* () {
      const outbox = yield* Outbox;
      yield* outbox.drain;
    }).pipe(
      Effect.timeout(RUN_LIMIT),
      Effect.as(BackgroundTask.BackgroundTaskResult.Success),
      // Not drained in time is not a failure: what is left stays queued.
      Effect.catchTag("TimeoutError", () => Effect.succeed(BackgroundTask.BackgroundTaskResult.Success)),
      Effect.catchCause((cause) => Effect.logError("[outbox] background drain failed", cause).pipe(Effect.as(BackgroundTask.BackgroundTaskResult.Failed))),
    ),
  ),
);

/** Registers the task (once; iOS keeps it across launches). */
export const registerBackgroundDrain = Effect.tryPromise({
  try: () => BackgroundTask.registerTaskAsync(TASK, { minimumInterval: INTERVAL }),
  catch: (cause) => cause,
}).pipe(Effect.catch((cause) => Effect.logError("[outbox] registering the background drain failed", cause)));
