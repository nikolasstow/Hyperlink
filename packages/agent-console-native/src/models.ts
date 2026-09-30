/**
 * Connected models from `client.provider.list()`. Never log or touch the
 * raw provider `.key` field — the response includes API keys inline (not
 * in the SDK’s declared type); only `.id` / `.name` / `.models` are read.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import type { OpencodeClient } from "./client";

export type ModelOption = {
  readonly providerID: string;
  /** Provider display name from the server (`provider.name`), not reformatted. */
  readonly providerName: string;
  readonly modelID: string;
  readonly name: string;
};

export const modelKey = (model: Pick<ModelOption, "providerID" | "modelID">): string =>
  `${model.providerID}/${model.modelID}`;

type Cache = {
  readonly options: ReadonlyArray<ModelOption>;
  readonly defaultModel: ModelOption | undefined;
};

const EMPTY: ReadonlyArray<ModelOption> = [];

/**
 * Lists by client, then by directory: opencode keeps one list per directory
 * (its instance there), so the models a session can run are its directory's.
 * `undefined` is the server's own directory.
 */
const caches = new WeakMap<OpencodeClient, Map<string | undefined, Cache>>();
const inFlight = new WeakMap<OpencodeClient, Map<string | undefined, Promise<Cache | undefined>>>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const cached = (client: OpencodeClient, directory: string | undefined): Cache | undefined => caches.get(client)?.get(directory);

const inFlightFor = (client: OpencodeClient): Map<string | undefined, Promise<Cache | undefined>> => {
  const existing = inFlight.get(client);
  if (existing !== undefined) return existing;
  const created = new Map<string | undefined, Promise<Cache | undefined>>();
  inFlight.set(client, created);
  return created;
};

const load = async (client: OpencodeClient, directory: string | undefined): Promise<Cache> => {
  const { data, error } = await client.provider.list(directory !== undefined ? { query: { directory } } : undefined);
  if (data === undefined) throw new Error(`Couldn't load the models: ${JSON.stringify(error)}`);

  const connected = new Set(data.connected);
  const options: Array<ModelOption> = [];
  for (const provider of data.all) {
    if (!connected.has(provider.id)) continue;
    for (const model of Object.values(provider.models)) {
      options.push({
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        name: model.name,
      });
    }
  }

  const defaultProviderID = data.connected.find((id) => data.default[id] !== undefined);
  const defaultModelID = defaultProviderID !== undefined ? data.default[defaultProviderID] : undefined;
  const defaultModel =
    defaultProviderID !== undefined && defaultModelID !== undefined
      ? options.find((o) => o.providerID === defaultProviderID && o.modelID === defaultModelID)
      : undefined;

  return { options, defaultModel };
};

/**
 * Loads a directory's models afresh (one load at a time per directory),
 * keeping the last list if the load fails. Resolves to the list now known.
 */
export const refreshModels = (client: OpencodeClient, directory: string | undefined): Promise<Cache | undefined> => {
  const pending = inFlightFor(client);
  const existing = pending.get(directory);
  if (existing !== undefined) return existing;
  const promise = load(client, directory)
    .then(
      (cache): Cache | undefined => {
        const byDirectory = caches.get(client) ?? new Map<string | undefined, Cache>();
        byDirectory.set(directory, cache);
        caches.set(client, byDirectory);
        for (const listener of listeners) listener();
        return cache;
      },
      (cause: unknown) => {
        console.warn("[models] refresh failed", directory, cause);
        return cached(client, directory);
      },
    )
    .finally(() => pending.delete(directory));
  pending.set(directory, promise);
  return promise;
};

/**
 * Has the server fetch the models.dev catalog now and rebuild its model lists
 * from it (`POST /provider/refresh`, from our opencode patch; raw fetch, as
 * the pinned SDK has no such call), then loads the directory's list afresh.
 * Throws when the server can't refresh, so the caller can say so.
 */
export const reloadModels = async (client: OpencodeClient, address: string, directory: string | undefined): Promise<void> => {
  const response = await fetch(`${address}/provider/refresh`, { method: "POST" });
  if (!response.ok) throw new Error(`Model refresh failed: HTTP ${response.status} ${await response.text()}`);
  await refreshModels(client, directory);
};

/** A directory's models: the last-known list, or the first load's. */
export const listModels = async (client: OpencodeClient, directory: string | undefined): Promise<ReadonlyArray<ModelOption>> =>
  (cached(client, directory) ?? (await refreshModels(client, directory)))?.options ?? EMPTY;

/**
 * A directory's models, refreshed when the caller mounts or its directory
 * changes, and whenever the app comes back to the foreground; the last-known
 * list meanwhile.
 */
export const useModels = (client: OpencodeClient, directory: string | undefined): ReadonlyArray<ModelOption> => {
  React.useEffect(() => {
    void refreshModels(client, directory);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshModels(client, directory);
    });
    return () => subscription.remove();
  }, [client, directory]);
  return React.useSyncExternalStore(subscribe, () => cached(client, directory)?.options ?? EMPTY);
};

/** A directory's default model once its models have loaded. */
export const getDefaultModel = (client: OpencodeClient, directory: string | undefined): ModelOption | undefined =>
  cached(client, directory)?.defaultModel;

export const findModel = (
  options: ReadonlyArray<ModelOption>,
  providerID: string,
  modelID: string,
): ModelOption | undefined => options.find((o) => o.providerID === providerID && o.modelID === modelID);
