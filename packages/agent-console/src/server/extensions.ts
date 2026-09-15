/**
 * VS Code extension installation — the server-agnostic Effect core.
 *
 * Deliberately NOT a vite plugin: this is the durable logic (unzip a `.vsix`,
 * read its `contributes`, extract the parts we support, persist them, list /
 * remove), written as `Effect`s over the platform `FileSystem` and run through a
 * `ManagedRuntime` — the same shape as fs.ts. The HTTP surface that exposes it
 * (an Effect `HttpApi` served by `@effect/platform-node`'s `NodeHttpServer`,
 * replacing the vite middleware) is a thin adapter on top; this core is unaware
 * of how it's served.
 *
 * We support the easy, high-value VS Code contributions first — icon themes and
 * color themes — extracting each theme JSON and its sibling assets. Everything
 * else in `contributes` is ignored for now.
 *
 * A small `config.json` alongside the store holds the synced app config (active
 * theme, active icon/color theme) so multiple devices match — read/written here,
 * served by the same adapter.
 *
 * @internal
 */
import { unzipSync } from "fflate";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Data, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";

/** A contribution we extracted from an installed extension. `file` is the
 * store-relative path (under the extension's `files/` dir) to the theme JSON. */
export interface ThemeContribution {
  readonly id: string;
  readonly label: string;
  /** Colour themes only: `vs` (light) / `vs-dark` / `hc-black`. */
  readonly uiTheme?: string;
  readonly file: string;
}

/** What an installed extension provides, as persisted in its manifest. */
export interface ExtensionManifest {
  /** `publisher.name`, the VS Code extension identity. */
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly iconThemes: ReadonlyArray<ThemeContribution>;
  readonly colorThemes: ReadonlyArray<ThemeContribution>;
}

export class ExtensionError extends Data.TaggedError("ExtensionError")<{
  readonly reason: "download" | "unzip" | "manifest" | "io" | "not-found";
  readonly detail?: string;
}> {}

const Contribution = Schema.Struct({
  id: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  uiTheme: Schema.optional(Schema.String),
  path: Schema.String,
});

const PackageJson = Schema.Struct({
  name: Schema.String,
  publisher: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  contributes: Schema.optional(
    Schema.Struct({
      iconThemes: Schema.optional(Schema.Array(Contribution)),
      themes: Schema.optional(Schema.Array(Contribution)),
    }),
  ),
});

const storeRoot = (path: Path.Path): string => {
  const override = process.env.AGENT_CONSOLE_EXTENSIONS_DIR;
  if (override !== undefined && override !== "") return override;
  return path.join(process.cwd(), ".agent-console", "extensions");
};

/** The `.vsix` puts everything under `extension/`; normalise to store-relative. */
const underExtension = (entryPath: string): string | undefined => {
  const prefix = "extension/";
  return entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : undefined;
};

/** Publisher isn't always in package.json (it lives in the vsix manifest), so
 * fall back to a cheap read of `extension.vsixmanifest`'s `Publisher="…"`. */
const publisherOf = (pkgPublisher: string | undefined, files: Record<string, Uint8Array>): string => {
  if (pkgPublisher !== undefined && pkgPublisher !== "") return pkgPublisher;
  const manifest = files["extension.vsixmanifest"];
  if (manifest !== undefined) {
    const xml = new TextDecoder().decode(manifest);
    const match = xml.match(/Publisher\s*=\s*"([^"]+)"/);
    if (match !== null) return match[1];
  }
  return "local";
};

const toContribution = (base: string, c: { id?: string; label?: string; uiTheme?: string; path: string }): ThemeContribution => ({
  id: c.id ?? c.label ?? c.path,
  label: c.label ?? c.id ?? c.path,
  ...(c.uiTheme === undefined ? {} : { uiTheme: c.uiTheme }),
  // `path` is relative to the extension root; store it relative to `<id>/files/`.
  file: `${base}/files/${c.path.replace(/^\.\//, "")}`,
});

/** Install from raw `.vsix` bytes: unzip, read package.json, copy the extension
 * tree into the store, extract the supported contributions, write a manifest. */
export const installFromVsix = (bytes: Uint8Array): Effect.Effect<ExtensionManifest, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const files = yield* Effect.try({
      try: () => unzipSync(bytes),
      catch: (error) => new ExtensionError({ reason: "unzip", detail: String(error) }),
    });

    const pkgRaw = files["extension/package.json"];
    if (pkgRaw === undefined) return yield* new ExtensionError({ reason: "manifest", detail: "no extension/package.json" });

    const pkgJson = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(pkgRaw)),
      catch: (error) => new ExtensionError({ reason: "manifest", detail: String(error) }),
    });
    const pkg = yield* Schema.decodeUnknownEffect(PackageJson)(pkgJson).pipe(
      Effect.mapError((issue) => new ExtensionError({ reason: "manifest", detail: String(issue) })),
    );

    const publisher = publisherOf(pkg.publisher, files);
    const id = `${publisher}.${pkg.name}`;
    const base = storeRoot(path);
    const extDir = path.join(base, id);

    // Replace any prior install of the same id.
    yield* fs.remove(extDir, { recursive: true }).pipe(Effect.ignore);
    yield* fs.makeDirectory(path.join(extDir, "files"), { recursive: true }).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );

    // Copy the whole extension tree so theme JSONs keep their sibling assets
    // (fonts, referenced files) resolvable.
    for (const [entry, data] of Object.entries(files)) {
      const rel = underExtension(entry);
      if (rel === undefined || rel === "" || rel.endsWith("/")) continue;
      const dest = path.join(extDir, "files", rel);
      yield* fs.makeDirectory(path.dirname(dest), { recursive: true }).pipe(Effect.ignore);
      yield* fs.writeFile(dest, data).pipe(Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })));
    }

    const iconThemes = (pkg.contributes?.iconThemes ?? []).map((c) => toContribution(id, c));
    const colorThemes = (pkg.contributes?.themes ?? []).map((c) => toContribution(id, c));

    const manifest: ExtensionManifest = {
      id,
      publisher,
      name: pkg.name,
      version: pkg.version ?? "0.0.0",
      displayName: pkg.displayName ?? pkg.name,
      description: pkg.description ?? "",
      iconThemes,
      colorThemes,
    };
    yield* fs.writeFileString(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2)).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );
    return manifest;
  });

/** Parse `publisher.name`, or a marketplace URL (`…?itemName=publisher.name`). */
const parseRef = (ref: string): { publisher: string; name: string } | undefined => {
  const trimmed = ref.trim();
  const fromUrl = trimmed.match(/itemName=([^&]+)/);
  const id = fromUrl !== null ? decodeURIComponent(fromUrl[1]) : trimmed;
  const dot = id.indexOf(".");
  if (dot <= 0 || dot === id.length - 1) return undefined;
  return { publisher: id.slice(0, dot), name: id.slice(dot + 1) };
};

/** Resolve the latest version via the gallery, then download the `.vsix`. Uses
 * `fetch` (node) inside Effect — reliable for the binary body and the gallery's
 * gzip — rather than guessing the HttpClient binary API. */
const downloadVsix = (publisher: string, name: string): Effect.Effect<Uint8Array, ExtensionError> =>
  Effect.gen(function* () {
    const version = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
          method: "POST",
          headers: {
            accept: "application/json;api-version=3.0-preview.1",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filters: [{ criteria: [{ filterType: 7, value: `${publisher}.${name}` }] }],
            flags: 0x1,
          }),
        });
        if (!res.ok) throw new Error(`extensionquery ${res.status}`);
        const body: unknown = await res.json();
        return latestVersion(body);
      },
      catch: (error) => new ExtensionError({ reason: "download", detail: String(error) }),
    });
    if (version === undefined) return yield* new ExtensionError({ reason: "not-found", detail: `${publisher}.${name}` });

    return yield* Effect.tryPromise({
      try: async () => {
        const url = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage`;
        const res = await fetch(url, { headers: { "accept-encoding": "gzip" } });
        if (!res.ok) throw new Error(`vspackage ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      catch: (error) => new ExtensionError({ reason: "download", detail: String(error) }),
    });
  });

/** Pull `results[0].extensions[0].versions[0].version` out of a gallery reply,
 * defensively (the shape crosses the network) and without casts. */
const latestVersion = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null || !("results" in body)) return undefined;
  const { results } = body;
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const first: unknown = results[0];
  if (typeof first !== "object" || first === null || !("extensions" in first)) return undefined;
  const { extensions } = first;
  if (!Array.isArray(extensions) || extensions.length === 0) return undefined;
  const ext: unknown = extensions[0];
  if (typeof ext !== "object" || ext === null || !("versions" in ext)) return undefined;
  const { versions } = ext;
  if (!Array.isArray(versions) || versions.length === 0) return undefined;
  const v: unknown = versions[0];
  if (typeof v !== "object" || v === null || !("version" in v)) return undefined;
  const { version } = v;
  return typeof version === "string" ? version : undefined;
};

export const installFromMarketplace = (ref: string): Effect.Effect<ExtensionManifest, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const parsed = parseRef(ref);
    if (parsed === undefined) return yield* new ExtensionError({ reason: "not-found", detail: `bad ref: ${ref}` });
    const bytes = yield* downloadVsix(parsed.publisher, parsed.name);
    return yield* installFromVsix(bytes);
  });

export const listExtensions = (): Effect.Effect<ReadonlyArray<ExtensionManifest>, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = storeRoot(path);
    const exists = yield* fs.exists(base).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [];
    const ids = yield* fs.readDirectory(base).pipe(Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })));
    const manifests: ExtensionManifest[] = [];
    for (const id of ids) {
      const file = path.join(base, id, "manifest.json");
      const has = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
      if (!has) continue;
      const raw = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
      const parsed = yield* Effect.try({ try: () => JSON.parse(raw), catch: () => new ExtensionError({ reason: "io" }) }).pipe(Effect.orElseSucceed(() => undefined));
      if (parsed !== undefined) manifests.push(parsed);
    }
    return manifests;
  });

export const removeExtension = (id: string): Effect.Effect<void, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Guard against traversal — an id is a single path segment.
    if (id.includes("/") || id.includes("..")) return yield* new ExtensionError({ reason: "not-found", detail: id });
    yield* fs.remove(path.join(storeRoot(path), id), { recursive: true }).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );
  });

/** The shared, device-synced app config document. Free-form JSON (theme, active
 * icon/color theme) — the client owns its shape; the server just stores it. */
export const getConfig = (): Effect.Effect<Record<string, unknown>, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(storeRoot(path), "config.json");
    const has = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    if (!has) return {};
    const raw = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"));
    return yield* Effect.try({ try: () => JSON.parse(raw), catch: () => new ExtensionError({ reason: "io" }) }).pipe(Effect.orElseSucceed(() => ({})));
  });

export const putConfig = (patch: Record<string, unknown>): Effect.Effect<Record<string, unknown>, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = storeRoot(path);
    yield* fs.makeDirectory(base, { recursive: true }).pipe(Effect.ignore);
    const current = yield* getConfig();
    const next = { ...current, ...patch };
    yield* fs.writeFileString(path.join(base, "config.json"), JSON.stringify(next, null, 2)).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );
    return next;
  });

/** Runtime over the platform layers — the core's only dependencies. Server-
 * agnostic: whatever serves this (the last-ts Effect HTTP layer, or a test)
 * runs the Effects through this, exactly as fs.ts does. */
export const extensionsRuntime = ManagedRuntime.make(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer));
