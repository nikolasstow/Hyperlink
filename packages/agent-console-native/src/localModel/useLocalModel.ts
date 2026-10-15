/**
 * The local model for React (LocalModelClient.ts): `LocalModelSync` (in the
 * app, where the server is known) fetches it at open and on return to the
 * foreground; `useLocalModel` gives it, and the page's changes, and fetches
 * it again while the page is open (often while it starts or installs).
 *
 * @internal
 */
import type { LocalModel } from "agent-console-protocol";
import { Effect, Option, Stream } from "effect";
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "../AppContext";
import { forkApp, runApp } from "../effect/runtime";
import { LocalModelClient } from "./LocalModelClient";

/** How often the open page asks: while it starts or installs, and else. */
const BUSY_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

let overview: LocalModel.Overview | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
/** Mirrors the client's overview for React (once). */
const start = (): void => {
  if (started) return;
  started = true;
  forkApp(
    LocalModelClient.pipe(
      Effect.map((client) => client.changes),
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          overview = Option.getOrUndefined(next);
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

const refresh = (server: string) =>
  runApp(LocalModelClient.pipe(Effect.flatMap((client) => client.refresh(server)))).catch((error: unknown) => console.warn("[local model] fetching its state failed", error));

/** Fetches it at open and on return to the foreground. Mounted once. */
export const LocalModelSync = (): null => {
  const { server } = useAppContext();
  React.useEffect(() => {
    start();
    void refresh(server);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh(server);
    });
    return () => subscription.remove();
  }, [server]);
  return null;
};

export interface LocalModelControls {
  /** As the server last sent it (none: not fetched yet). */
  readonly overview: LocalModel.Overview | undefined;
  /** The last change that failed: why. */
  readonly error: string | undefined;
  readonly setSettings: (settings: LocalModel.Settings) => void;
  readonly install: () => void;
  readonly restart: () => void;
}

/** The local model, its changes, and (while mounted) fresh state. */
export const useLocalModel = (): LocalModelControls => {
  const { server } = useAppContext();
  const now = React.useSyncExternalStore(subscribe, () => overview);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const state = now?.status.state;
  React.useEffect(() => {
    start();
    const busy = state === "starting" || state === "installing";
    const id = setInterval(() => void refresh(server), busy ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [server, state]);
  const change = React.useCallback(
    (run: (client: LocalModelClient["Service"]) => Effect.Effect<unknown, unknown>) => {
      setError(undefined);
      runApp(LocalModelClient.pipe(Effect.flatMap(run))).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    },
    [],
  );
  return {
    overview: now,
    error,
    setSettings: (settings) => change((client) => client.setSettings(server, settings)),
    install: () => change((client) => client.install(server)),
    restart: () => change((client) => client.restart(server)),
  };
};
