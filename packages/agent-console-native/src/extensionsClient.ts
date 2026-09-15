/**
 * Client for the off-vite Effect API server (packages/agent-console `pnpm
 * serve`): install / list / remove VS Code extensions, and read/write the
 * device-synced app config. Plain `fetch` with a string body — the same choice
 * fsClient makes, since RN's `fetch` rejects the `Uint8Array` body the Effect
 * HttpClient sends. Responses are `Schema`-decoded (they cross a network
 * boundary), never cast.
 *
 * Errors are never swallowed: a non-2xx throws with the server's message so a
 * caller can surface it.
 *
 * @internal
 */
import { Schema } from "effect";

/** A contribution an installed extension provides. */
export interface ThemeContribution {
  readonly id: string;
  readonly label: string;
  readonly uiTheme?: string;
  readonly file: string;
}

export interface ExtensionManifest {
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly iconThemes: ReadonlyArray<ThemeContribution>;
  readonly colorThemes: ReadonlyArray<ThemeContribution>;
}

const ThemeContributionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  uiTheme: Schema.optional(Schema.String),
  file: Schema.String,
});

const ManifestSchema = Schema.Struct({
  id: Schema.String,
  publisher: Schema.String,
  name: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  iconThemes: Schema.Array(ThemeContributionSchema),
  colorThemes: Schema.Array(ThemeContributionSchema),
});

const ManifestListSchema = Schema.Array(ManifestSchema);
const ConfigSchema = Schema.Record(Schema.String, Schema.Unknown);

const decodeManifest = Schema.decodeUnknownSync(ManifestSchema);
const decodeManifestList = Schema.decodeUnknownSync(ManifestListSchema);
const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);

const base = (apiBase: string): string => apiBase.replace(/\/+$/, "");

const request = async (url: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    // The server sends a JSON error ({ reason, detail }); surface what we can.
    let detail = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && "reason" in parsed) {
        const reason = parsed.reason;
        const d = "detail" in parsed ? parsed.detail : undefined;
        detail = `${String(reason)}${typeof d === "string" ? `: ${d}` : ""}`;
      }
    } catch {
      // non-JSON body — keep the raw text
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return text === "" ? undefined : JSON.parse(text);
};

export const listExtensions = async (apiBase: string): Promise<ReadonlyArray<ExtensionManifest>> =>
  decodeManifestList(await request(`${base(apiBase)}/extensions`));

export const installExtension = async (apiBase: string, ref: string): Promise<ExtensionManifest> =>
  decodeManifest(
    await request(`${base(apiBase)}/extensions/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref }),
    }),
  );

export const removeExtension = async (apiBase: string, id: string): Promise<void> => {
  await request(`${base(apiBase)}/extensions/remove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
};

export const getRemoteConfig = async (apiBase: string): Promise<Record<string, unknown>> =>
  decodeConfig(await request(`${base(apiBase)}/config`));

export const putRemoteConfig = async (apiBase: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
  decodeConfig(
    await request(`${base(apiBase)}/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
