/**
 * The relay's network-health API, as the Network page uses it. The relay next
 * to the printer pings the printer and records the connection, the status age,
 * and the print state over time, then serves it here. The page charts it and
 * shows the pattern that comes before a freeze.
 *
 * Same conventions as relayApi.ts: `authedFetch`, `Schema`-decoded replies,
 * a non-2xx surfaced with the relay's message.
 *
 * @internal
 */
import { Schema } from "effect";
import { authedFetch } from "../auth/serverTokens";

/** A time-value point: `[Unix ms, value]`. */
const Point = Schema.Tuple([Schema.Number, Schema.Number]);
export type Point = typeof Point.Type;

/** The live view: the freshest sample plus the pre-freeze flag. */
export const NetworkNow = Schema.Struct({
  connection: Schema.String,
  reachable: Schema.Boolean,
  rttMs: Schema.NullOr(Schema.Number),
  lossPct: Schema.NullOr(Schema.Number),
  statusAgeMs: Schema.NullOr(Schema.Number),
  printing: Schema.Boolean,
  layer: Schema.NullOr(Schema.Number),
  total: Schema.NullOr(Schema.Number),
  prefreeze: Schema.Boolean,
});
export type NetworkNow = typeof NetworkNow.Type;

/** A noted moment on the timeline. */
export const NetworkEvent = Schema.Struct({
  t: Schema.Number,
  kind: Schema.Literals(["loss", "reconnect", "stall", "prefreeze"]),
  message: Schema.String,
});
export type NetworkEvent = typeof NetworkEvent.Type;

/** The whole reply for a time range. */
export const NetworkHealth = Schema.Struct({
  updated: Schema.Number,
  now: NetworkNow,
  series: Schema.Struct({
    rtt: Schema.Array(Point),
    loss: Schema.Array(Point),
    statusAge: Schema.Array(Point),
  }),
  outages: Schema.Array(Schema.Struct({ start: Schema.Number, end: Schema.NullOr(Schema.Number) })),
  stats: Schema.Struct({
    rttMin: Schema.NullOr(Schema.Number),
    rttMax: Schema.NullOr(Schema.Number),
    rttAvg: Schema.NullOr(Schema.Number),
    lossPct: Schema.Number,
    disconnects: Schema.Number,
    worstStatusAgeMs: Schema.NullOr(Schema.Number),
    samples: Schema.Number,
  }),
  events: Schema.Array(NetworkEvent),
  dataStartMs: Schema.NullOr(Schema.Number),
  from: Schema.Number,
  to: Schema.Number,
});
export type NetworkHealth = typeof NetworkHealth.Type;

const decode = Schema.decodeUnknownPromise(NetworkHealth);

/** The network health over the last `mins` minutes. */
export const fetchNetworkHealth = async (relayBase: string, mins: number): Promise<NetworkHealth> => {
  const response = await authedFetch(`${relayBase}/api/network?mins=${mins}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`The relay answered HTTP ${response.status}`);
  return decode(await response.json());
};
