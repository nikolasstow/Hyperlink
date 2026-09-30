/**
 * How often each model is sent with, and when last: the model picker's Recents
 * and its providers' order come from it. Kept on this device (AsyncStorage),
 * read once at startup and counted on each send.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { modelKey, type ModelOption } from "./models";

const USAGE_KEY = "agent-console-native:modelUsage";

/** One model's use. */
export interface ModelUse {
  readonly count: number;
  /** Epoch ms of the last send. */
  readonly lastUsed: number;
}

/** Uses by model key (`provider/model`). */
export type ModelUsage = ReadonlyMap<string, ModelUse>;

let usage: ModelUsage = new Map();
const listeners = new Set<() => void>();

const publish = (next: ModelUsage): void => {
  usage = next;
  for (const listener of listeners) listener();
};

const isUse = (value: unknown): value is ModelUse =>
  typeof value === "object" &&
  value !== null &&
  "count" in value &&
  typeof value.count === "number" &&
  "lastUsed" in value &&
  typeof value.lastUsed === "number";

const parse = (raw: string): ModelUsage => {
  const parsed: unknown = JSON.parse(raw);
  const entries = new Map<string, ModelUse>();
  if (typeof parsed !== "object" || parsed === null) return entries;
  for (const [key, use] of Object.entries(parsed)) if (isUse(use)) entries.set(key, use);
  return entries;
};

const loaded = AsyncStorage.getItem(USAGE_KEY).then(
  (raw) => {
    if (raw !== null) publish(parse(raw));
  },
  (cause: unknown) => console.warn("[modelUsage] load failed", cause),
);

/** Counts a send with `model`. */
export const recordModelUse = async (model: Pick<ModelOption, "providerID" | "modelID">): Promise<void> => {
  await loaded;
  const key = modelKey(model);
  const next = new Map(usage);
  next.set(key, {
    count: (usage.get(key)?.count ?? 0) + 1,
    lastUsed: Date.now(),
  });
  publish(next);
  await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(next)));
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useModelUsage = (): ModelUsage => React.useSyncExternalStore(subscribe, () => usage);
