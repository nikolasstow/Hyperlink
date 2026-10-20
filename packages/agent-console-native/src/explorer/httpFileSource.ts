/**
 * A plugin's file system over the files-v1 HTTP contract, as a file source
 * for the shared explorer. The printer relay (saturn-uploader `relay`) is the
 * first endpoint: its storage areas are the printer, the USB drive, and the
 * home server, and its recent files are the recent prints.
 *
 * The contract (docs/handoffs/plugin-devices-files-editors.md §4):
 * `GET /api/files/roots`, `GET /api/files?path=`, `GET /api/files/preview.png?path=`,
 * and `GET /api/history?perFile=1` for recent files. Every reply is decoded
 * with `Schema`: it crosses the network.
 *
 * @internal
 */
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { relativeTime } from "../time";
import { type FileSource, type FileSourceEntry, FileSourceError, type FileSourceListing, type FileSourceRoot } from "./FileSource";

const RootJson = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  path: Schema.String,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  saveInto: Schema.Literals(["anywhere", "top", "none"]),
  newFolder: Schema.Boolean,
});

const RootsJson = Schema.Struct({ roots: Schema.Array(RootJson) });

const LastPrintJson = Schema.Struct({
  at: Schema.Number,
  outcome: Schema.String,
  reason: Schema.optional(Schema.String),
});

const EntryJson = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  kind: Schema.Literals(["file", "folder"]),
  size: Schema.optional(Schema.Number),
  printing: Schema.optional(Schema.Boolean),
  lastPrint: Schema.optional(LastPrintJson),
});
type EntryJson = typeof EntryJson.Type;

const ListingJson = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(EntryJson),
});

const RecentJson = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.optional(Schema.String),
      startedAt: Schema.optional(Schema.Number),
      endedAt: Schema.optional(Schema.Number),
      outcome: Schema.String,
      reason: Schema.optional(Schema.String),
      exists: Schema.optional(Schema.Boolean),
    }),
  ),
});

/** Bytes as a short size: "465 MB". */
export const formatBytes = (n: number | undefined): string => {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] ?? "GB"}`;
};

/** How a print ended, in a word or two, with the printer's reason for a stop. */
export const outcomeText = (outcome: string, reason: string | undefined): string => {
  const word = outcome === "completed" ? "Printed" : outcome === "failed" ? "Failed" : outcome === "stopped" ? "Stopped" : "Printed";
  return reason === undefined ? word : `${word}: ${reason}`;
};

/** A folder row as the explorer shows it: size and last print under the name, the slicer's preview, "Printing". */
export const entryOf = (base: string, json: EntryJson): FileSourceEntry => {
  const path = json.kind === "folder" && !json.path.endsWith("/") ? `${json.path}/` : json.path;
  const detail =
    json.kind === "folder"
      ? undefined
      : [formatBytes(json.size), json.lastPrint === undefined ? "" : `${outcomeText(json.lastPrint.outcome, undefined)} ${relativeTime(json.lastPrint.at)}`].filter((part) => part !== "").join(" · ");
  return {
    path,
    name: json.name,
    kind: json.kind === "folder" ? "directory" : "file",
    ...(detail === undefined || detail === "" ? {} : { detail }),
    ...(json.kind === "file" && /\.goo$/i.test(json.name) ? { thumbnail: previewUrl(base, path) } : {}),
    ...(json.printing === true ? { badge: "Printing" } : {}),
  };
};

/** A `.goo` file's slicer preview: 116 px (small) or 290 px (big). */
export const previewUrl = (base: string, path: string, big = false): string => `${base}/api/files/preview.png?path=${encodeURIComponent(path)}${big ? "&size=big" : ""}`;

/** GETs `url` and decodes its JSON body; a 404 is `undefined`. */
const getJson = <A>(url: string, path: string, schema: Schema.Codec<A, unknown>) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(url).pipe(Effect.mapError((error) => new FileSourceError({ reason: "Transport", path, message: error.message })));
    if (response.status === 404) return undefined;
    if (response.status >= 400) return yield* new FileSourceError({ reason: "Http", path, status: response.status, message: `The server answered HTTP ${response.status}` });
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(Effect.mapError(() => new FileSourceError({ reason: "Decode", path, message: "The server's reply could not be read" })));
  });

/** Listings by endpoint and path, kept for the life of the app. */
const listings = new Map<string, ReadonlyArray<FileSourceEntry>>();

/** The files-v1 endpoint at `base` (such as `http://100.67.32.32:5197`) as a file source. Make one per base and keep it. */
export const httpFileSource = (base: string, recentTitle = "Recent prints"): FileSource => {
  const key = (path: string): string => `${base}\u0000${path}`;
  return {
    id: `files-v1:${base}`,
    cached: (path) => listings.get(key(path)),
    list: (path) =>
      getJson(`${base}/api/files?path=${encodeURIComponent(path)}`, path, ListingJson).pipe(
        Effect.map((listing): FileSourceListing => {
          if (listing === undefined) return { _tag: "Missing" };
          const entries = listing.entries.map((entry) => entryOf(base, entry));
          listings.set(key(path), entries);
          return { _tag: "Found", entries };
        }),
      ),
    roots: getJson(`${base}/api/files/roots`, "/", RootsJson).pipe(
      Effect.map((json): ReadonlyArray<FileSourceRoot> =>
        (json?.roots ?? []).map((root) => ({
          id: root.id,
          title: root.title,
          path: root.path,
          available: root.available,
          reason: root.reason,
          saveInto: root.saveInto === "anywhere" ? "Anywhere" : root.saveInto === "top" ? "Top" : "None",
          newFolder: root.newFolder,
        })),
      ),
    ),
    recent: {
      title: recentTitle,
      load: getJson(`${base}/api/history?perFile=1&limit=12`, "/", RecentJson).pipe(
        Effect.map((json) =>
          (json?.entries ?? []).flatMap((entry): ReadonlyArray<FileSourceEntry> => {
            if (entry.path === undefined || entry.exists !== true) return [];
            const at = entry.endedAt ?? entry.startedAt;
            return [
              {
                path: entry.path,
                name: entry.name,
                kind: "file",
                detail: [outcomeText(entry.outcome, entry.reason), at === undefined ? "" : relativeTime(at)].filter((part) => part !== "").join(" · "),
                ...(/\.goo$/i.test(entry.name) ? { thumbnail: previewUrl(base, entry.path) } : {}),
              },
            ];
          }),
        ),
      ),
    },
  };
};
