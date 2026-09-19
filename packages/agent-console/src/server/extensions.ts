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
import { homedir } from "node:os";
import { unzipSync } from "fflate";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";

/** A contribution we extracted from an installed extension. `file` is the
 * store-relative path (under the extension's `files/` dir) to the theme JSON. */
export interface ThemeContribution {
  readonly id: string;
  readonly label: string;
  /** Colour themes only: `vs` (light) / `vs-dark` / `hc-black`. */
  readonly uiTheme?: string;
  readonly file: string;
}

/** An extension found already installed in a local VS Code-family IDE, offered
 * for import. `sourcePath` is its on-disk folder; `source` names the IDE. */
export interface LocalExtension {
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly iconThemes: ReadonlyArray<ThemeContribution>;
  readonly colorThemes: ReadonlyArray<ThemeContribution>;
  readonly source: string;
  readonly sourcePath: string;
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

/** Schema-backed so it doubles as the HttpApi error channel. */
export class ExtensionError extends Schema.TaggedErrorClass<ExtensionError>()("ExtensionError", {
  reason: Schema.Literals(["download", "unzip", "manifest", "io", "not-found"]),
  detail: Schema.optional(Schema.String),
}) {}

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

/** VS Code localises manifest strings as `%key%`, resolved from
 * `package.nls.json`. Resolve those, leaving plain strings untouched. */
const resolveNls = (value: string, nls: Record<string, unknown>): string => {
  const match = value.match(/^%(.+)%$/);
  if (match === null) return value;
  const resolved = nls[match[1]];
  return typeof resolved === "string" ? resolved : value;
};

const toContribution = (base: string, nls: Record<string, unknown>, c: { id?: string; label?: string; uiTheme?: string; path: string }): ThemeContribution => {
  const label = resolveNls(c.label ?? c.id ?? c.path, nls);
  return {
    id: c.id ?? c.label ?? c.path,
    label,
    ...(c.uiTheme === undefined ? {} : { uiTheme: c.uiTheme }),
    // `path` is relative to the extension root; store it relative to `<id>/files/`.
    file: `${base}/files/${c.path.replace(/^\.\//, "")}`,
  };
};

type ParsedPackage = typeof PackageJson.Type;

/** Build the manifest we persist/return from a decoded package.json, resolving
 * `%nls%` strings against the extension's `package.nls.json` when supplied. */
const buildManifest = (id: string, publisher: string, pkg: ParsedPackage, nls: Record<string, unknown> = {}): ExtensionManifest => ({
  id,
  publisher,
  name: pkg.name,
  version: pkg.version ?? "0.0.0",
  displayName: resolveNls(pkg.displayName ?? pkg.name, nls),
  description: resolveNls(pkg.description ?? "", nls),
  iconThemes: (pkg.contributes?.iconThemes ?? []).map((c) => toContribution(id, nls, c)),
  colorThemes: (pkg.contributes?.themes ?? []).map((c) => toContribution(id, nls, c)),
});

/** Best-effort read of an extension dir's `package.nls.json` (for `%key%`). */
const readNls = (fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const file = path.join(dir, "package.nls.json");
    const has = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    if (!has) return {};
    const raw = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"));
    return parseNlsBytes(new TextEncoder().encode(raw));
  });

/** Decode a package.json's bytes, or fail with a manifest error. */
const parsePackage = (bytes: Uint8Array): Effect.Effect<ParsedPackage, ExtensionError> =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(bytes)),
      catch: (error) => new ExtensionError({ reason: "manifest", detail: String(error) }),
    });
    return yield* Schema.decodeUnknownEffect(PackageJson)(json).pipe(
      Effect.mapError((issue) => new ExtensionError({ reason: "manifest", detail: String(issue) })),
    );
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

    const pkg = yield* parsePackage(pkgRaw);
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

    const nlsRaw = files["extension/package.nls.json"];
    const nls = nlsRaw === undefined ? {} : parseNlsBytes(nlsRaw);
    const manifest = buildManifest(id, publisher, pkg, nls);
    yield* fs.writeFileString(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2)).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );
    return manifest;
  });

/** Parse `package.nls.json` bytes to a flat string map, tolerating garbage. */
const parseNlsBytes = (bytes: Uint8Array): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
};

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

/** Pretty IDE name for a `~/.<slug>[-server]` extensions home. Known editors get
 * a proper label; anything else falls back to the slug, so a new VS Code-based
 * IDE is still covered without a code change. `-server` = a Remote-SSH host. */
const IDE_LABELS: Record<string, string> = {
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  "vscode-oss": "VS Code OSS",
  vscodium: "VSCodium",
  "vscodium-insiders": "VSCodium Insiders",
  cursor: "Cursor",
  windsurf: "Windsurf",
  "windsurf-next": "Windsurf Next",
  positron: "Positron",
  trae: "Trae",
  void: "Void",
  pearai: "PearAI",
  kiro: "Kiro",
};

const ideLabel = (dotDir: string): string => {
  const slug = dotDir.replace(/^\./, "");
  const remote = slug.endsWith("-server");
  const baseSlug = remote ? slug.slice(0, -"-server".length) : slug;
  const name = IDE_LABELS[baseSlug] ?? baseSlug;
  return remote ? `${name} (Remote)` : name;
};

/** Publisher from `publisher.name-version` folder name, when package.json omits
 * it (installed copies sometimes do). */
const publisherFromFolder = (folder: string): string => {
  const withoutVersion = folder.replace(/-\d+\.\d+\.\d+.*$/, "");
  const dot = withoutVersion.indexOf(".");
  return dot > 0 ? withoutVersion.slice(0, dot) : "local";
};

/**
 * Scan the local IDEs' extension folders and return everything installed, so
 * the user can see their setup and import what's useful. Each carries its
 * supported contributions (icon / color themes) — often empty for
 * language/tooling extensions. De-duplicated by extension id (first IDE wins).
 */
export const discoverLocalExtensions = (): Effect.Effect<ReadonlyArray<LocalExtension>, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = homedir();
    const seen = new Set<string>();
    const found: LocalExtension[] = [];

    const sources: Array<{ ide: string; dir: string }> = [];

    // 1. Every `~/.<ide>[-server]/extensions` — user- and Remote-SSH-installed
    // extensions, discovered by scanning $HOME's dot directories (not a fixed
    // list) so all VS Code-based IDEs and any future one are covered.
    const homeEntries = yield* fs.readDirectory(home).pipe(Effect.orElseSucceed(() => []));
    for (const entry of homeEntries) {
      if (!entry.startsWith(".")) continue;
      sources.push({ ide: ideLabel(entry), dir: path.join(home, entry, "extensions") });
    }

    // 2. Every VS Code-based app's BUILT-IN extensions
    // (`<App>.app/Contents/Resources/app/extensions`) — the default themes and
    // icon themes (Dark+, Seti, …) ship here. Scan the app folders.
    const appRoots = ["/Applications", path.join(home, "Applications")];
    for (const appRoot of appRoots) {
      const rootExists = yield* fs.exists(appRoot).pipe(Effect.orElseSucceed(() => false));
      if (!rootExists) continue;
      const apps = yield* fs.readDirectory(appRoot).pipe(Effect.orElseSucceed(() => []));
      for (const app of apps) {
        if (!app.endsWith(".app")) continue;
        sources.push({
          ide: `${app.replace(/\.app$/, "")} (built-in)`,
          dir: path.join(appRoot, app, "Contents", "Resources", "app", "extensions"),
        });
      }
    }

    for (const { ide, dir } of sources) {
      const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) continue;
      const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
      for (const entry of entries) {
        const extDir = path.join(dir, entry);
        const pkgFile = path.join(extDir, "package.json");
        const hasPkg = yield* fs.exists(pkgFile).pipe(Effect.orElseSucceed(() => false));
        if (!hasPkg) continue;
        const bytes = yield* fs.readFile(pkgFile).pipe(Effect.option);
        if (bytes._tag === "None") continue;
        const pkg = yield* parsePackage(bytes.value).pipe(Effect.option);
        if (pkg._tag === "None") continue;
        const publisher = pkg.value.publisher ?? publisherFromFolder(entry);
        const id = `${publisher}.${pkg.value.name}`;
        if (seen.has(id)) continue;
        const nls = yield* readNls(fs, path, extDir);
        const manifest = buildManifest(id, publisher, pkg.value, nls);
        // Only surface extensions we can actually use (themes/icons); language
        // grammars and tooling would just be noise in the import list.
        if (manifest.iconThemes.length === 0 && manifest.colorThemes.length === 0) continue;
        seen.add(id);
        found.push({
          id,
          publisher,
          name: manifest.name,
          version: manifest.version,
          displayName: manifest.displayName,
          description: manifest.description,
          iconThemes: manifest.iconThemes,
          colorThemes: manifest.colorThemes,
          source: ide,
          sourcePath: extDir,
        });
      }
    }
    return found;
  });

/** Import an already-extracted extension folder (from a local IDE) into our
 * store: copy the tree, extract contributions, write a manifest. */
export const importFromPath = (sourceDir: string): Effect.Effect<ExtensionManifest, ExtensionError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const pkgFile = path.join(sourceDir, "package.json");
    const hasPkg = yield* fs.exists(pkgFile).pipe(Effect.orElseSucceed(() => false));
    if (!hasPkg) return yield* new ExtensionError({ reason: "not-found", detail: sourceDir });
    const bytes = yield* fs.readFile(pkgFile).pipe(Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })));
    const pkg = yield* parsePackage(bytes);
    const publisher = pkg.publisher ?? publisherFromFolder(path.basename(sourceDir));
    const id = `${publisher}.${pkg.name}`;

    const extDir = path.join(storeRoot(path), id);
    yield* fs.remove(extDir, { recursive: true }).pipe(Effect.ignore);
    yield* fs.makeDirectory(extDir, { recursive: true }).pipe(Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })));
    // Copy the whole extension tree so theme JSONs keep their sibling assets.
    yield* fs.copy(sourceDir, path.join(extDir, "files")).pipe(Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })));

    const nls = yield* readNls(fs, path, sourceDir);
    const manifest = buildManifest(id, publisher, pkg, nls);
    yield* fs.writeFileString(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2)).pipe(
      Effect.mapError((error) => new ExtensionError({ reason: "io", detail: String(error) })),
    );
    return manifest;
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
