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

const caches = new WeakMap<OpencodeClient, Cache>();
const inFlight = new WeakMap<OpencodeClient, Promise<Cache | undefined>>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const load = async (client: OpencodeClient): Promise<Cache> => {
  const { data, error } = await client.provider.list();
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
 * Loads the server's models afresh (one load at a time per client), keeping
 * the last list if the load fails. Resolves to the list now known.
 */
export const refreshModels = (client: OpencodeClient): Promise<Cache | undefined> => {
  const pending = inFlight.get(client);
  if (pending !== undefined) return pending;
  const promise = load(client)
    .then(
      (cache): Cache | undefined => {
        caches.set(client, cache);
        for (const listener of listeners) listener();
        return cache;
      },
      (cause: unknown) => {
        console.warn("[models] refresh failed", cause);
        return caches.get(client);
      },
    )
    .finally(() => inFlight.delete(client));
  inFlight.set(client, promise);
  return promise;
};

/** Connected models: the last-known list, or the first load's. */
export const listModels = async (client: OpencodeClient): Promise<ReadonlyArray<ModelOption>> =>
  (caches.get(client) ?? (await refreshModels(client)))?.options ?? EMPTY;

/**
 * Connected models, refreshed when the caller mounts and whenever the app
 * comes back to the foreground; the last-known list meanwhile.
 */
export const useModels = (client: OpencodeClient): ReadonlyArray<ModelOption> => {
  React.useEffect(() => {
    void refreshModels(client);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshModels(client);
    });
    return () => subscription.remove();
  }, [client]);
  return React.useSyncExternalStore(subscribe, () => caches.get(client)?.options ?? EMPTY);
};

/** Server default model once the models have loaded for this client. */
export const getDefaultModel = (client: OpencodeClient): ModelOption | undefined =>
  caches.get(client)?.defaultModel;

export const findModel = (
  options: ReadonlyArray<ModelOption>,
  providerID: string,
  modelID: string,
): ModelOption | undefined => options.find((o) => o.providerID === providerID && o.modelID === modelID);
