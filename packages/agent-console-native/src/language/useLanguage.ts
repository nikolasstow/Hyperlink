/**
 * Language intelligence for React (LanguageClient.ts): `LanguageFollower`
 * (mounted once, where the server is known) follows the files live files
 * follow; `useDiagnostics` gives a file's problems as they change; `hoverAt`
 * asks what is at a place.
 *
 * @internal
 */
import type { Language } from "agent-console-protocol";
import { Effect, HashMap, Option, Stream } from "effect";
import * as React from "react";
import { useAppContext } from "../AppContext";
import { forkApp, runApp } from "../effect/runtime";
import { useFollowedPaths } from "../files/useLiveFiles";
import { LanguageClient } from "./LanguageClient";

let problems: HashMap.HashMap<string, Language.FileDiagnostics> = HashMap.empty();
let server: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
const start = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Stream.unwrap(LanguageClient.pipe(Effect.map((client) => client.changes))).pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          problems = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** A file's problems, as they change (undefined until its server answers). */
export const useDiagnostics = (path: string): Language.FileDiagnostics | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(problems, path)));

/** What is at `offset` in `path`, if anything (none without a server). */
export const hoverAt = (path: string, offset: number): Promise<Option.Option<Language.HoverInfo>> => {
  const from = server;
  if (from === undefined) return Promise.resolve(Option.none());
  return runApp(
    Effect.gen(function* () {
      return yield* (yield* LanguageClient).hover(from, path, offset);
    }).pipe(Effect.catch((error) => Effect.logWarning(`[language] no hover in ${path}`, error).pipe(Effect.as(Option.none<Language.HoverInfo>())))),
  );
};

/** Follows the files someone might open next. Mounted once. */
export const LanguageFollower = (): null => {
  const context = useAppContext();
  const paths = useFollowedPaths();
  React.useEffect(start, []);
  React.useEffect(() => {
    server = context.server;
    void runApp(
      Effect.gen(function* () {
        yield* (yield* LanguageClient).follow(context.server, paths);
      }),
    );
  }, [context.server, paths]);
  return null;
};
