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
 * - `GET /cameras/h264?id=<id>&quality=auto|high|low` (WebSocket): one
 *   H.264 access unit per message, in Annex B form, with SPS and PPS before
 *   each keyframe. This is the printer relay's `/api/camera.h264` format, so
 *   the app's player is the same. One `ffmpeg` runs for each stream while
 *   someone watches, and stops a short time after the last viewer leaves.
 *   The server never queues frames for a slow phone: when the socket falls
 *   behind, it drops frames up to the next keyframe. With `auto`, a phone
 *   that keeps falling behind gets the sub stream, and tries the main stream
 *   again later.
 * - `POST /cameras/ptz?id=<id>&pan=<-1..1>&tilt=<-1..1>`: one pan and tilt
 *   step, over ONVIF. The app sends steps again while a button is held.
 * - `GET /cameras/frigate/<path>`: Frigate's review list, recording summary,
 *   thumbnails and HLS recordings, with the server's Frigate login. The app
 *   needs no Frigate login.
 *
 * @internal
 */
import { NodeHttpClient, NodeHttpServerRequest } from "@effect/platform-node";
import { Context, Crypto, Duration, Effect, FileSystem, Layer, Option, Path, PubSub, RcMap, Ref, Schema, Scope, Stream } from "effect";
import { Base64 } from "effect/encoding";
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
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
  /** go2rtc's stream name for the sub stream: the low quality the `auto` live view drops to. */
  sub: Schema.optionalKey(Schema.String),
  /** The camera's ONVIF service, for pan and tilt (Tapo: `http://<ip>:2020/onvif/service`). */
  onvif: Schema.optionalKey(Schema.String),
  /** Frigate's name for the camera. The default is `id`. */
  frigate: Schema.optionalKey(Schema.String),
}) {}

export class CamerasConfig extends Schema.Class<CamerasConfig>("CamerasConfig")({
  cameras: Schema.Array(Camera),
  /** go2rtc's RTSP restream, without the stream name. */
  rtsp: Schema.String,
  /** go2rtc's HTTP API, for single frames. */
  go2rtc: Schema.String,
  /** Frigate's web page, for recordings. Optional. */
  frigate: Schema.optionalKey(Schema.String),
  /** Frigate's API on this Mac (`https://127.0.0.1:8971`). Its certificate is self-signed. */
  frigateApi: Schema.optionalKey(Schema.String),
  /** An env file with `FRIGATE_USER` and `FRIGATE_PASS`. */
  frigateLogin: Schema.optionalKey(Schema.String),
  /** An env file with `CAM_USER` and `CAM_PASS`: the cameras' own account, for ONVIF. */
  cameraLogin: Schema.optionalKey(Schema.String),
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

// ---------------------------------------------------------------------------
// Live quality
// ---------------------------------------------------------------------------

export type Quality = "auto" | "high" | "low";
export type Level = "high" | "low";

/** Bytes the socket may hold before the viewer is behind: about 1.5 s of each stream. */
export const behindBytes: Readonly<Record<Level, number>> = { high: 320 * 1024, low: 96 * 1024 };
/** After a drop, the socket must empty to this before the next keyframe goes out. */
export const caughtUpBytes = 32 * 1024;
/** Two drops in this time on the main stream move an `auto` viewer to the sub stream. */
export const dropWindowMs = 30_000;
/** The first wait on the sub stream before `auto` tries the main stream again; it doubles to `maxRetryMs`. */
export const firstRetryMs = 60_000;
export const maxRetryMs = 10 * 60_000;

/** What one viewer's quality control knows. */
export interface Pace {
  readonly level: Level;
  /** True after a drop: send nothing until a keyframe and an empty socket. */
  readonly waitKey: boolean;
  /** Times of the recent drops. */
  readonly drops: ReadonlyArray<number>;
  /** When `auto` tries the main stream again. */
  readonly retryAt: number;
  readonly retryMs: number;
  /** When the viewer last moved to the main stream. */
  readonly upAt: number;
}

export const startPace = (quality: Quality, now: number): Pace => ({
  level: quality === "low" ? "low" : "high",
  waitKey: true,
  drops: [],
  retryAt: 0,
  retryMs: firstRetryMs,
  upAt: now,
});

/** One decision: send the frame, drop it, or move to the other stream before it. */
export type Step = { readonly _tag: "send" } | { readonly _tag: "drop" } | { readonly _tag: "switch"; readonly to: Level };

/**
 * Decides what to do with the next frame, from the bytes the socket still
 * holds. Pure, so the rules have tests.
 */
export const pace = (state: Pace, unit: AccessUnit, buffered: number, quality: Quality, now: number): readonly [Pace, Step] => {
  if (quality === "auto" && state.level === "low" && now >= state.retryAt && buffered <= caughtUpBytes) {
    return [{ ...state, level: "high", waitKey: true, upAt: now }, { _tag: "switch", to: "high" }];
  }
  if (state.waitKey) {
    return unit.key && buffered <= caughtUpBytes ? [{ ...state, waitKey: false }, { _tag: "send" }] : [state, { _tag: "drop" }];
  }
  if (buffered <= behindBytes[state.level]) return [state, { _tag: "send" }];
  const drops = [...state.drops.filter((at) => now - at < dropWindowMs), now];
  if (quality === "auto" && state.level === "high" && drops.length >= 2) {
    // Back on the sub stream soon after the last try: wait longer before the next one.
    const retryMs = now - state.upAt < 2 * dropWindowMs && state.upAt > 0 ? Math.min(state.retryMs * 2, maxRetryMs) : firstRetryMs;
    return [{ ...state, level: "low", waitKey: true, drops: [], retryAt: now + retryMs, retryMs }, { _tag: "switch", to: "low" }];
  }
  return [{ ...state, waitKey: true, drops }, { _tag: "drop" }];
};

// ---------------------------------------------------------------------------
// ONVIF
// ---------------------------------------------------------------------------

/** Reads `KEY=VALUE` lines. */
export const parseEnv = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")] as const;
      }),
  );

const xmlEscape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A SOAP envelope with a WS-Security password digest: base64(SHA-1(nonce + created + password)). */
export const onvifEnvelope = (input: {
  readonly user: string;
  readonly nonce: Uint8Array;
  readonly created: string;
  readonly digest: Uint8Array;
  readonly body: string;
}): string =>
  [
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>',
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken>',
    `<Username>${xmlEscape(input.user)}</Username>`,
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${Base64.encode(input.digest)}</Password>`,
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${Base64.encode(input.nonce)}</Nonce>`,
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${input.created}</Created>`,
    "</UsernameToken></Security></s:Header>",
    `<s:Body>${input.body}</s:Body></s:Envelope>`,
  ].join("");

/** The step a full press of a pan or tilt button makes, in ONVIF's generic translation space. */
export const ptzStep = 0.06;

/**
 * One relative pan and tilt step. A Tapo C200 turns the view left for a
 * positive pan, so `pan` (positive = right) is negated. Positive tilt is up.
 */
export const relativeMove = (pan: number, tilt: number): string => {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const x = (-clamp(pan) * ptzStep).toFixed(4);
  const y = (clamp(tilt) * ptzStep).toFixed(4);
  return [
    '<RelativeMove xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>profile_1</ProfileToken>',
    `<Translation><PanTilt xmlns="http://www.onvif.org/ver10/schema" x="${x}" y="${y}"/></Translation>`,
    "</RelativeMove>",
  ].join("");
};

// ---------------------------------------------------------------------------
// Frigate proxy
// ---------------------------------------------------------------------------

/** The Frigate paths the app may read: review items, recording summaries, thumbnails, and recordings. */
export const frigatePathAllowed = (path: string): boolean =>
  !path.includes("..") &&
  (/^api\/review(\/|\?|$)/.test(path) ||
    /^api\/events\/[^/]+\/(thumbnail|snapshot)/.test(path) ||
    /^api\/[a-z0-9_-]+\/recordings(\/summary)?(\?|$)/i.test(path) ||
    /^clips\/review\//.test(path) ||
    /^vod\//.test(path));

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
  // A restream that sends nothing for 5 s ends ffmpeg, so the viewers reconnect.
  "-timeout",
  "5000000",
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
  const crypto = yield* Crypto.Crypto;
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

  /** Two keys from an env file. */
  const login = (envFile: string | undefined, userKey: string, passKey: string) =>
    Effect.gen(function* () {
      if (envFile === undefined) return yield* new CamerasError({ message: `cameras.json has no login file for ${userKey}` });
      const text = yield* fs.readFileString(envFile).pipe(Effect.mapError((cause) => new CamerasError({ message: `${envFile}: ${cause.message}` })));
      const env = parseEnv(text);
      const user = env.get(userKey);
      const password = env.get(passKey);
      if (user === undefined || password === undefined) return yield* new CamerasError({ message: `${envFile} has no ${userKey} or ${passKey}` });
      return { user, password };
    });

  /** One ffmpeg per watched stream; it stops 10 s after the last viewer leaves. */
  const feeds: RcMap.RcMap<string, Feed, CamerasError> = yield* RcMap.make({
    lookup: (stream: string): Effect.Effect<Feed, CamerasError, Scope.Scope> =>
      Effect.gen(function* () {
        const { rtsp } = yield* config;
        const url = `${rtsp.replace(/\/+$/, "")}/${stream}`;
        const units = yield* PubSub.sliding<AccessUnit>(256);
        const sinceKey = yield* Ref.make<ReadonlyArray<AccessUnit>>([]);
        const handle = yield* spawner
          .spawn(ChildProcess.make(ffmpegPath, [...readerArgs(url)], { stdin: "ignore" }))
          .pipe(Effect.mapError((cause) => new CamerasError({ message: `ffmpeg (${ffmpegPath}): ${cause.message}` })));
        yield* Effect.logInfo(`Cameras: reading ${stream}`);
        // Set when the last viewer's idle time ends, before ffmpeg stops: then the feed is already gone.
        const closing = yield* Ref.make(false);
        yield* Effect.addFinalizer(() => Ref.set(closing, true));
        yield* handle.stdout.pipe(
          accessUnits,
          Stream.runForEach((unit) =>
            Ref.update(sinceKey, (current) => (unit.key ? [unit] : current.length >= maxSinceKey ? current : [...current, unit])).pipe(
              Effect.andThen(PubSub.publish(units, unit)),
            ),
          ),
          Effect.catch((error) => Effect.logWarning(`Cameras: ${stream} output failed: ${String(error)}`)),
          // No more frames: end every viewer's stream so the app reconnects. If ffmpeg
          // stopped by itself, drop this feed too, so the next viewer starts a new ffmpeg.
          Effect.ensuring(
            PubSub.shutdown(units).pipe(
              Effect.andThen(Ref.get(closing)),
              Effect.flatMap((closed) => (closed ? Effect.void : RcMap.invalidate(feeds, stream))),
            ),
          ),
          // Not scoped: the cleanup above closes this feed's scope, and must not wait on itself.
          Effect.forkDetach,
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

  /**
   * Sends one camera to one viewer until the feed ends or the viewer leaves.
   * `buffered` reads the bytes the socket has not sent yet.
   */
  const watch = <E>(camera: Camera, quality: Quality, buffered: () => number, write: (data: Uint8Array) => Effect.Effect<void, E>) =>
    Effect.gen(function* () {
      const state = yield* Ref.make(startPace(quality, Date.now()));
      const streamOf = (level: Level) => (level === "low" && camera.sub !== undefined ? camera.sub : camera.stream);
      // Each pass reads one stream; a switch ends the pass and the next one reads the other stream.
      const pass = Ref.get(state).pipe(
        Effect.flatMap((start) =>
          frames(streamOf(start.level)).pipe(
            Stream.mapEffect((unit): Effect.Effect<Step, E> =>
              Ref.modify(state, (current) => {
                const [next, step] = pace(current, unit, buffered(), camera.sub === undefined ? "high" : quality, Date.now());
                return [step, next] as const;
              }).pipe(Effect.flatMap((step) => (step._tag === "send" ? write(unit.data).pipe(Effect.as<Step>(step)) : Effect.succeed(step)))),
            ),
            Stream.takeUntil((step) => step._tag === "switch"),
            Stream.runLast,
            Effect.tap((last) =>
              Option.isSome(last) && last.value._tag === "switch" ? Effect.logInfo(`Cameras: ${camera.id} viewer moved to the ${last.value.to} stream`) : Effect.void,
            ),
            Effect.scoped,
          ),
        ),
      );
      // A pass that ended without a switch means the feed ended: stop, so the app reconnects.
      yield* pass.pipe(Effect.repeat({ while: (last) => Option.isSome(last) && last.value._tag === "switch" }));
    });

  const onvif = (camera: Camera, body: string) =>
    Effect.gen(function* () {
      const current = yield* config;
      if (camera.onvif === undefined) return yield* new CamerasError({ message: `${camera.id} has no ONVIF address` });
      const { user, password } = yield* login(current.cameraLogin, "CAM_USER", "CAM_PASS");
      const nonce = yield* crypto.randomBytes(16);
      const created = new Date().toISOString().replace(/\.\d+Z$/, ".000Z");
      const digest = yield* crypto.digest("SHA-1", new Uint8Array([...nonce, ...new TextEncoder().encode(created + password)]));
      // macOS Local Network privacy blocks this Node binary from the LAN; Apple's own curl
      // is exempt. The envelope goes on stdin, so the digest is not on a command line.
      const envelope = onvifEnvelope({ user, nonce, created, digest, body });
      const output = yield* spawner.string(
        ChildProcess.make(
          "/usr/bin/curl",
          ["-s", "-m", "7", "-H", "Content-Type: application/soap+xml", "--data-binary", "@-", "-w", "\\n%{http_code}", camera.onvif],
          { stdin: { stream: Stream.make(new TextEncoder().encode(envelope)) } },
        ),
      );
      const at = output.lastIndexOf("\n");
      const status = Number(output.slice(at + 1));
      const text = output.slice(0, Math.max(at, 0));
      if (status !== 200 || text.includes("Fault>")) {
        return yield* new CamerasError({ message: `ONVIF answered ${status}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}` });
      }
    }).pipe(
      Effect.timeout(Duration.seconds(8)),
      Effect.mapError((cause) => (cause instanceof CamerasError ? cause : new CamerasError({ message: `ONVIF: ${String(cause)}` }))),
    );

  // Frigate: one login cookie for the server, made again when Frigate refuses it.
  const frigateClient = yield* NodeHttpClient.makeNodeHttp.pipe(
    // Frigate's own certificate is self-signed, and the address is this Mac.
    Effect.provide(NodeHttpClient.layerAgentOptions({ rejectUnauthorized: false })),
  );
  const frigateCookie = yield* Ref.make<string | undefined>(undefined);

  const frigateLoginCookie = Effect.gen(function* () {
    const current = yield* config;
    if (current.frigateApi === undefined) return yield* new CamerasError({ message: "cameras.json has no frigateApi" });
    const { user, password } = yield* login(current.frigateLogin, "FRIGATE_USER", "FRIGATE_PASS");
    const response = yield* frigateClient.execute(
      HttpClientRequest.post(`${current.frigateApi.replace(/\/+$/, "")}/api/login`).pipe(HttpClientRequest.bodyJsonUnsafe({ user, password })),
    );
    const cookie = (response.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    if (response.status !== 200 || !cookie.includes("=")) return yield* new CamerasError({ message: `Frigate login answered ${response.status}` });
    yield* Ref.set(frigateCookie, cookie);
    return cookie;
  }).pipe(Effect.mapError((cause) => (cause instanceof CamerasError ? cause : new CamerasError({ message: `Frigate login: ${String(cause)}` }))));

  const frigateGet = (pathAndQuery: string, range: string | undefined) =>
    Effect.gen(function* () {
      const current = yield* config;
      if (current.frigateApi === undefined) return yield* new CamerasError({ message: "cameras.json has no frigateApi" });
      const url = `${current.frigateApi.replace(/\/+$/, "")}/${pathAndQuery}`;
      const send = (cookie: string) =>
        frigateClient.execute(
          HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders({ cookie, ...(range === undefined ? {} : { range }) })),
        );
      const cookie = (yield* Ref.get(frigateCookie)) ?? (yield* frigateLoginCookie);
      const first = yield* send(cookie);
      if (first.status !== 401 && first.status !== 403) return first;
      return yield* send(yield* frigateLoginCookie);
    }).pipe(Effect.mapError((cause) => (cause instanceof CamerasError ? cause : new CamerasError({ message: `Frigate: ${String(cause)}` }))));

  return { config, find, frames, watch, onvif, frigateGet };
});

export class Cameras extends Context.Service<Cameras, Effect.Success<typeof make>>()("agent-console/Cameras") {
  static readonly layer = Layer.effect(Cameras, make);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const paramsOf = (url: string): URLSearchParams => new URL(url, "http://localhost").searchParams;
const idOf = (url: string): string | null => paramsOf(url).get("id");

const listRoute = HttpRouter.add("GET", "/cameras", () =>
  Cameras.use((cameras) => cameras.config).pipe(
    Effect.map((config) =>
      HttpServerResponse.jsonUnsafe({
        cameras: config.cameras.map((camera) => ({
          id: camera.id,
          name: camera.name,
          frigate: camera.frigate ?? camera.id,
          ptz: camera.onvif !== undefined,
          sub: camera.sub !== undefined,
        })),
        recordings: config.frigateApi !== undefined,
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

const qualityOf = (value: string | null): Quality => (value === "high" || value === "low" ? value : "auto");

/** Node's write buffer under the viewer's WebSocket. */
const socketBuffered = (request: HttpServerRequest.HttpServerRequest): (() => number) => {
  const socket = NodeHttpServerRequest.toIncomingMessage(request).socket;
  return () => socket.writableLength;
};

/** An app message: `ack <bytes>`, the bytes of video it has received so far. */
export const ackOf = (chunk: Uint8Array | string): number | undefined => {
  const match = /^ack (\d+)$/.exec(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  return match === null ? undefined : Number(match[1]);
};

/**
 * Counts the bytes in flight to one viewer. The kernel send buffer can hold
 * seconds of video that Node's buffer never sees, so an app that acknowledges
 * what it received gives the true count. An app that sends no acks (a build
 * from before them) gets Node's buffer only.
 */
const inFlight = (nodeBuffered: () => number) => {
  let sent = 0;
  let acked: number | undefined;
  return {
    sent: (bytes: number) => {
      sent += bytes;
    },
    ack: (bytes: number) => {
      acked = Math.max(acked ?? 0, bytes);
    },
    buffered: () => Math.max(nodeBuffered(), acked === undefined ? 0 : sent - acked),
  };
};

const h264Route = HttpRouter.add("GET", "/cameras/h264", (request) =>
  Effect.gen(function* () {
    const params = paramsOf(request.url);
    const id = params.get("id");
    if (id === null) return HttpServerResponse.text("Expected ?id=<camera>", { status: 400 });
    const cameras = yield* Cameras;
    const { camera } = yield* cameras.find(id);
    const flight = inFlight(socketBuffered(request));
    const socket = yield* request.upgrade;
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;
    yield* Effect.raceFirst(
      cameras.watch(camera, qualityOf(params.get("quality")), flight.buffered, (data) =>
        writer.write(data).pipe(Effect.tap(() => Effect.sync(() => flight.sent(data.length)))),
      ),
      // The app sends acks; reading also notices when it leaves.
      reader.pull.pipe(
        Effect.tap((chunks) =>
          Effect.sync(() => {
            for (const chunk of chunks) {
              const bytes = ackOf(chunk);
              if (bytes !== undefined) flight.ack(bytes);
            }
          }),
        ),
        Effect.forever,
      ),
    );
    return HttpServerResponse.empty();
  }).pipe(
    Effect.scoped,
    Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 404 }))),
    Effect.catch((error) => Effect.logDebug(`Cameras: viewer left: ${String(error)}`).pipe(Effect.as(HttpServerResponse.empty()))),
  ),
);

const ptzRoute = HttpRouter.add("POST", "/cameras/ptz", (request) =>
  Effect.gen(function* () {
    const params = paramsOf(request.url);
    const id = params.get("id");
    const pan = Number(params.get("pan") ?? "0");
    const tilt = Number(params.get("tilt") ?? "0");
    if (id === null || !Number.isFinite(pan) || !Number.isFinite(tilt)) return HttpServerResponse.text("Expected ?id=<camera>&pan=<-1..1>&tilt=<-1..1>", { status: 400 });
    const cameras = yield* Cameras;
    const { camera } = yield* cameras.find(id);
    yield* cameras.onvif(camera, relativeMove(pan, tilt));
    return HttpServerResponse.empty({ status: 204 });
  }).pipe(Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 502 })))),
);

/** Headers a Frigate answer keeps on the way to the app. */
const passHeaders = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"] as const;

const frigateRoute = HttpRouter.add("GET", "/cameras/frigate/*", (request) =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost");
    const rest = url.pathname.replace(/^\/cameras\/frigate\//, "") + url.search;
    if (!frigatePathAllowed(rest)) return HttpServerResponse.text(`Not a Frigate path the app may read: ${rest}`, { status: 403 });
    const cameras = yield* Cameras;
    const response = yield* cameras.frigateGet(rest, request.headers["range"]);
    const headers: Record<string, string> = {};
    for (const name of passHeaders) {
      const value = response.headers[name];
      if (value !== undefined) headers[name] = value;
    }
    return HttpServerResponse.stream(response.stream, { status: response.status, headers });
  }).pipe(Effect.catchTag("CamerasError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 502 })))),
);

/** The camera routes, with their service. */
export const camerasRoutes = Layer.mergeAll(listRoute, frameRoute, h264Route, ptzRoute, frigateRoute);
