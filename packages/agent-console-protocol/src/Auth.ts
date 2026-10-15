/**
 * Pairing and the paired devices (docs/handoffs/app-auth.md): the `auth`
 * endpoints, what they send, and how a request proves who sent it.
 *
 * A request carries a paired device's token (`Authorization: Bearer …`), a
 * one-use WebSocket ticket (`?ticket=…`), or the Mac's admin token. `/health`
 * and redeeming a pairing code are open.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

/** Answers before pairing: whether this is a server. Open. */
export const healthPath = "/health";
export const pairPath = "/auth/pair";
/** Open: redeeming a code is how a device gets its token. */
export const redeemPath = "/auth/redeem";
export const devicesPath = "/auth/devices";
export const revokePath = "/auth/revoke";
export const ticketPath = "/auth/ticket";

/** The query parameter a WebSocket ticket travels in. */
export const ticketParam = "ticket";

/** A device paired with a server, as the server lists it. */
export const Device = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pairedAt: Schema.Number,
  lastSeenAt: Schema.Number,
});
export type Device = typeof Device.Type;

/** A new pairing code. */
export const PairingCode = Schema.Struct({
  code: Schema.String,
  expiresAt: Schema.Number,
});
export type PairingCode = typeof PairingCode.Type;

/** What redeeming a code gives the device: its id and token on the server. */
export const PairedToken = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
});
export type PairedToken = typeof PairedToken.Type;

export const RedeemPayload = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
});

export const RevokePayload = Schema.Struct({
  id: Schema.String,
});

/** A one-use ticket for a WebSocket (a socket cannot send a header). */
export const WebSocketTicket = Schema.Struct({
  ticket: Schema.String,
  expiresAt: Schema.Number,
});
export type WebSocketTicket = typeof WebSocketTicket.Type;

/** The devices could not be read or written. */
export class DeviceAuthError extends Schema.TaggedError<DeviceAuthError>()("DeviceAuthError", {
  message: Schema.String,
}) {}

/** The pairing code is unknown, used or expired. */
export class PairingRefused extends Schema.TaggedError<PairingRefused>()("PairingRefused", {}) {}

/** The caller may not do this (only the Mac's tools may pair). */
export class NotAllowed extends Schema.TaggedError<NotAllowed>()("NotAllowed", {}) {}

/** The `auth` endpoints. `redeem` is open; the rest need a device token (or,
 * for `pair`, the admin token). */
export const group = HttpApiGroup.make("auth").add(
  HttpApiEndpoint.post("pair", pairPath, {
    success: PairingCode,
    error: [DeviceAuthError, NotAllowed.pipe(HttpApiSchema.status(403))],
  }),
  HttpApiEndpoint.post("redeem", redeemPath, {
    payload: RedeemPayload,
    success: PairedToken,
    error: [DeviceAuthError, PairingRefused.pipe(HttpApiSchema.status(403))],
  }),
  HttpApiEndpoint.get("devices", devicesPath, {
    success: Schema.Array(Device),
    error: DeviceAuthError,
  }),
  HttpApiEndpoint.post("revoke", revokePath, {
    payload: RevokePayload,
    success: Schema.Array(Device),
    error: DeviceAuthError,
  }),
  HttpApiEndpoint.post("ticket", ticketPath, {
    success: WebSocketTicket,
    error: [DeviceAuthError, NotAllowed.pipe(HttpApiSchema.status(403))],
  }),
);
