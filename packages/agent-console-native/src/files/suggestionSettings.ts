/**
 * Inline suggestions in the editor (docs/handoffs/code-intelligence.md): on
 * or off, and the model that writes them. Without one chosen, a fast one the
 * server offers (`defaultSuggestionModel`): opencode's own default is its free
 * tier, which answers only opencode's apps. A setting (Settings → Files),
 * remembered on this device.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Schema } from "effect";
import * as React from "react";
import type { ModelOption } from "../models";

const storageKey = "editorSuggestions";

export const SuggestionSettings = Schema.Struct({
  enabled: Schema.Boolean,
  model: Schema.optionalKey(Schema.Struct({ providerID: Schema.String, id: Schema.String })),
});
export type SuggestionSettings = typeof SuggestionSettings.Type;

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(SuggestionSettings));

let settings: SuggestionSettings = { enabled: true };
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Read once; until it arrives, suggestions are on with the default model.
AsyncStorage.getItem(storageKey).then(
  (saved) => {
    if (saved === null) return;
    const read = decode(saved);
    if (read._tag === "None") {
      console.error("[suggestions] the saved setting is unreadable; using the default");
      return;
    }
    settings = read.value;
    emit();
  },
  (error: unknown) => console.error("[suggestions] reading the setting failed", error),
);

export const setSuggestionSettings = (next: SuggestionSettings): void => {
  settings = next;
  emit();
  AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch((error: unknown) => console.error("[suggestions] saving the setting failed", error));
};

export const suggestionSettingsNow = (): SuggestionSettings => settings;

export const useSuggestionSettings = (): SuggestionSettings => React.useSyncExternalStore(subscribe, () => settings);

/** The model suggestions use when none is chosen: Claude Haiku 4.5 when the
 * server offers it (quick, and good at this), else another Haiku. */
export const defaultSuggestionModel = (models: ReadonlyArray<ModelOption>): ModelOption | undefined =>
  models.find((model) => model.providerID === "opencode" && model.modelID === "claude-haiku-4-5") ?? models.find((model) => model.modelID.includes("haiku"));
