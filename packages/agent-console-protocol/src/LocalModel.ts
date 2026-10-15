/**
 * The model the API server runs on its own machine for inline suggestions
 * (docs/handoffs/code-intelligence.md): a fill-in-the-middle model (Qwen2.5-
 * Coder) on llama.cpp's server, which the API server starts, watches and
 * stops. Its settings (on or off, which model) and its state, as the `local-
 * model` endpoints send them; the app's server page shows them and changes
 * them.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/** The models it can run. */
export const ModelId = Schema.Literals(["qwen2.5-coder-7b-q4", "qwen2.5-coder-7b-q8", "qwen2.5-coder-3b"]);
export type ModelId = typeof ModelId.Type;

/** Each model, as a picker shows it. */
export interface ModelInfo {
  readonly id: ModelId;
  readonly name: string;
  /** What it costs and gives, in a few words. */
  readonly note: string;
}

export const MODELS: ReadonlyArray<ModelInfo> = [
  { id: "qwen2.5-coder-7b-q4", name: "Qwen2.5-Coder 7B", note: "Recommended · 4.7 GB · ~1 s a line" },
  { id: "qwen2.5-coder-7b-q8", name: "Qwen2.5-Coder 7B (8-bit)", note: "8.5 GB · a little better, slower" },
  { id: "qwen2.5-coder-3b", name: "Qwen2.5-Coder 3B", note: "3.3 GB · fastest, weaker" },
];

export const Settings = Schema.Struct({
  /** Whether the server runs it. */
  enabled: Schema.Boolean,
  model: ModelId,
});
export type Settings = typeof Settings.Type;

export const DEFAULT_SETTINGS: Settings = { enabled: true, model: "qwen2.5-coder-7b-q4" };

/** What it is doing. */
export const State = Schema.Literals(["off", "not-installed", "installing", "starting", "ready", "failed"]);
export type State = typeof State.Type;

export const Status = Schema.Struct({
  state: State,
  model: ModelId,
  /** More about the state: download progress while starting, why it failed. */
  message: Schema.optionalKey(Schema.String),
});
export type Status = typeof Status.Type;

/** Its settings and state, as every endpoint answers. */
export const Overview = Schema.Struct({
  settings: Settings,
  status: Status,
});
export type Overview = typeof Overview.Type;

export class LocalModelError extends Schema.TaggedError<LocalModelError>()("LocalModelError", {
  message: Schema.String,
}) {}

/** The `local-model` endpoints. */
export const group = HttpApiGroup.make("localModel").add(
  HttpApiEndpoint.get("overview", "/local-model", { success: Overview, error: LocalModelError }),
  HttpApiEndpoint.put("settings", "/local-model/settings", { payload: Settings, success: Overview, error: LocalModelError }),
  HttpApiEndpoint.post("install", "/local-model/install", { success: Overview, error: LocalModelError }),
  HttpApiEndpoint.post("restart", "/local-model/restart", { success: Overview, error: LocalModelError }),
);
