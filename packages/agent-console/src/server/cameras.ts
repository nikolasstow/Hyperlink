/**
 * The home cameras: the list, one frame, and the live H.264 feed the app's
 * Picture in Picture plays.
 *
 * go2rtc on this Mac owns each camera's one connection and restreams it on
 * `rtsp://127.0.0.1:8554/<stream>`; Frigate records from the same restream.
 * The list is `cameras.json` in the state folder.
 *
 * - `GET /cameras`: the cameras and the Frigate address, for the Cameras page.
 * - `GET /cameras/frame?id=<id>`: one JPEG frame, from go2rtc.
 * - `GET /cameras/h264?id=<id>` (WebSocket): one H.264 access unit per
 *   message, in Annex B form, with SPS and PPS before each keyframe. This is
 *   the printer relay's `/api/camera.h264` format, so the app's player is the
 *   same. One `ffmpeg` runs for each camera while someone watches, and stops
 *   a short time after the last viewer leaves.
 *
 * @internal
 */
import { Context, Duration, Effect, FileSystem, Layer, Path, PubSub, RcMap, Ref, Schema, Scope, Stream } from "effect";
import { HttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { stateDirectory } from "./sessions/files";

export const camerasFile = "cameras.json";

export class Camera extends Schema.Class<Camera>("Camera")({
  /** The id the app sends back. */
  id: Schema.String,
  /** The name people see. */
  name: Schema.String,
  /** go2rtc's stream name for the main stream. */
  stream: Schema.String,
}) {}

export class CamerasConfig extends Schema.Class<CamerasConfig>("CamerasConfig")({
  cameras: Schema.Array(Camera),
  /** go2rtc's RTSP restream, without the stream name. */
  rtsp: Schema.String,
  /** go2rtc's HTTP API, for single frames. */
  go2rtc: Schema.String,
  /** Frigate's web page, for recordings. Optional. */
  frigate: Schema.optionalKey(Schema.String),
}) {}

export class CamerasError extends Schema.TaggedError<CamerasError>()("CamerasError", {
  message: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// H.264 framing (copied from the printer relay's Camera.ts)
// ---------------------------------------------------------------------------

/** One frame of H.264 in Annex B form, starting with its access unit delimiter. */
export interface AccessUnit {
  readonly data: Uint8Array;
  /** True when the frame holds an IDR slice, so a viewer can start on it. */
  readonly key: boolean;
}

const NAL_IDR = 5;
const NAL_AUD = 9;
/** A buffer that grows past this without a whole frame is junk; drop it. */
const maxPending = 8 * 1024 * 1024;
/** A keyframe interval longer than this many frames is not kept whole. */
const maxSinceKey = 600;

/** Positions of NAL units: the index of the first header byte after each start code. */
export const nalStarts = (bytes: Uint8Array): ReadonlyArray<number> => {
  const starts: Array<number> = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts;
};

const startCodeAt = (bytes: Uint8Array, header: number): number => (header >= 4 && bytes[header - 4] === 0 ? header - 4 : header - 3);

const isKeyUnit = (bytes: Uint8Array): boolean => nalStarts(bytes).some((at) => ((bytes[at] ?? 0) & 0x1f) === NAL_IDR);

/** Cuts complete access units out of `buffer`: each runs from one delimiter to the next. */
export const takeAccessUnits = (buffer: Uint8Array): readonly [rest: Uint8Array, units: ReadonlyArray<AccessUnit>] => {
  const delimiters = nalStarts(buffer)
    .filter((at) => ((buffer[at] ?? 0) & 0x1f) === NAL_AUD)
    .map((at) => startCodeAt(buffer, at));
  const units: Array<AccessUnit> = [];
  for (let i = 0; i + 1 < delimiters.length; i++) {
    const data = buffer.slice(delimiters[i], delimiters[i + 1]);
    units.push({ data, key: isKeyUnit(data) });
  }
  const last = delimiters[delimiters.length - 1];
  const rest = last === undefined ? buffer : buffer.subarray(last);
  return [rest.length > maxPending ? new Uint8Array(0) : rest, units];
};

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

/** Splits an Annex B byte stream into access units. */
export const accessUnits = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<AccessUnit, E, R> =>
  bytes.pipe(
    Stream.mapAccum(
      () => new Uint8Array(0),
      (pending: Uint8Array, chunk: Uint8Array) => takeAccessUnits(concat(pending, chunk)),
    ),
  );

/** Reads go2rtc's restream over TCP and writes its H.264, unchanged, to stdout. */
export const readerArgs = (url: string): ReadonlyArray<string> => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-rtsp_transport",
  "tcp",
  "-i",
  url,
  "-an",
  "-c:v",
  "copy",
  // SPS and PPS before every keyframe, so a viewer can start at any keyframe; then an access
  // unit delimiter at the start of every frame, so the server can cut the stream into frames.
  "-bsf:v",
  "dump_extra=freq=keyframe,h264_metadata=aud=insert",
  "-f",
  "h264",
  "pipe:1",
];

/** A LaunchAgent's PATH has none of the Homebrew folders. */
const ffmpegPath = process.env.AGENT_CONSOLE_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";

interface Feed {
  readonly units: PubSub.PubSub<AccessUnit>;
  readonly sinceKey: Ref.Ref<ReadonlyArray<AccessUnit>>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const file = path.join(stateDirectory(path.join), camerasFile);

  /** Read on each request, so a change to the file needs no restart. */
  const config = fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(CamerasConfig))),
    Effect.mapError((cause) => new CamerasError({ message: `${file}: ${String(cause)}` })),
  );

  const find = (id: string) =>
    config.pipe(
      Effect.flatMap((current) => {
        const camera = current.cameras.find((each) => each.id === id);
        return camera === undefined ? Effect.fail(new CamerasError({ message: `no camera ${id}` })) : Effect.succeed({ camera, config: current });
      }),
    );

  /** One ffmpeg per watched camera; it stops 10 s after the last viewer leaves. */
  const feeds = yield* RcMap.make({
    lookup: (stream: string): Effect.Effect<Feed, CamerasError, Scope.Scope> =>
      Effect.gen(function* () {
        const { rtsp } = yield* config;
        const url = `${rtsp.replace(/\/+$/, "")}/${stream}`;
        const units = yield* PubSub.sliding<AccessUnit>(64);
        const sinceKey = yield* Ref.make<ReadonlyArray<AccessUnit>>([]);
        const handle = yield* spawner
          .spawn(ChildProcess.make(ffmpegPath, [...readerArgs(url)], { stdin: "ignore" }))
          .pipe(Effect.mapError((cause) => new CamerasError({ message: `ffmpeg (${ffmpegPath}): ${cause.message}` })));
        yield* Effect.logInfo(`Cameras: reading ${stream}`);
        yield* handle.stdout.pipe(
          accessUnits,
          Stream.runForEach((unit) =>
            Ref.update(sinceKey, (current) => (unit.key ? [unit] : current.length >= maxSinceKey ? current : [...current, unit])).pipe(
              Effect.andThen(PubSub.publish(units, unit)),
            ),
          ),
          Effect.catch((error) => Effect.logWarning(`Cameras: ${stream} output failed: ${String(error)}`)),
          // No more frames: end every viewer's stream so the app reconnects.
          Effect.ensuring(PubSub.shutdown(units)),
          Effect.forkScoped,
        );
        yield* handle.stderr.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.runForEach((line) => Effect.logWarning(`Cameras: ${stream} ffmpeg: ${line}`)),
          Effect.ignore,
          Effect.forkScoped,
        );
        return { units, sinceKey };
      }),
    idleTimeToLive: Duration.seconds(10),
  });

  /** Every frame from the latest keyframe on, then each new one. */
  const frames = (stream: string): Stream.Stream<AccessUnit, CamerasError, Scope.Scope> =>
    RcMap.get(feeds, stream).pipe(
      Effect.flatMap((feed) =>
        PubSub.subscribe(feed.units).pipe(
          Effect.flatMap((subscription) =>
            Ref.get(feed.sinceKey).pipe(Effect.map((backlog) => Stream.concat(Stream.fromIterable(backlog), Stream.fromSubscription(subscription)))),
          ),
        ),
      ),
      Stream.unwrap,
    );

  return { config, find, frames };
});

export class Cameras extends Context.Service<Cameras, Effect.Success<typeof make>>()("agent-console/Cameras") {
  static readonly layer = Layer.effect(Cameras, make);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const idOf = (url: string): string | null => new URL(url, "http://localhost").searchParams.get("id");

const listRoute = HttpRouter.add("GET", "/cameras", () =>
  Cameras.use((cameras) => cameras.config).pipe(
    Effect.map((config) =>
      HttpServerResponse.jsonUnsafe({
        cameras: config.cameras.map((camera) => ({ id: camera.id, name: camera.name })),
        ...(config.frigate === undefined ? {} : { frigate: config.frigate }),
      }),
    ),
    Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 500 }))),
  ),
);

const frameRoute = HttpRouter.add("GET", "/cameras/frame", (request) =>
  Effect.gen(function* () {
    const id = idOf(request.url);
    if (id === null) return HttpServerResponse.text("Expected ?id=<camera>", { status: 400 });
    const { camera, config } = yield* Cameras.use((cameras) => cameras.find(id));
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`${config.go2rtc.replace(/\/+$/, "")}/api/frame.jpeg?src=${encodeURIComponent(camera.stream)}`);
    const body = yield* response.arrayBuffer;
    return response.status === 200 && body.byteLength > 0
      ? HttpServerResponse.uint8Array(new Uint8Array(body), { contentType: "image/jpeg", headers: { "cache-control": "no-store" } })
      : HttpServerResponse.text(`go2rtc answered ${response.status} with ${body.byteLength} bytes`, { status: 502 });
  }).pipe(
    Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 404 }))),
    Effect.catch((error) => Effect.succeed(HttpServerResponse.text(`go2rtc: ${String(error)}`, { status: 502 }))),
  ),
);

const h264Route = HttpRouter.add("GET", "/cameras/h264", (request) =>
  Effect.gen(function* () {
    const id = idOf(request.url);
    if (id === null) return HttpServerResponse.text("Expected ?id=<camera>", { status: 400 });
    const cameras = yield* Cameras;
    const { camera } = yield* cameras.find(id);
    const socket = yield* request.upgrade;
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;
    yield* Effect.raceFirst(
      cameras.frames(camera.stream).pipe(Stream.runForEach((unit) => writer.write(unit.data))),
      // The app sends nothing; reading notices when it leaves.
      reader.pull.pipe(Effect.forever),
    );
    return HttpServerResponse.empty();
  }).pipe(
    Effect.scoped,
    Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 404 }))),
    Effect.catch((error) => Effect.logDebug(`Cameras: viewer left: ${String(error)}`).pipe(Effect.as(HttpServerResponse.empty()))),
  ),
);

/** The camera routes, with their service. */
export const camerasRoutes = Layer.mergeAll(listRoute, frameRoute, h264Route);
