/**
 * Who may use this server: the devices paired with it (docs/handoffs/app-auth.md).
 *
 * - **Pairing.** `pair` makes a single-use code that expires (`PAIRING_TTL`);
 *   a device redeems it once, with its name, for its own token.
 * - **Tokens.** A device's token is kept only as a SHA-256 hash, with the
 *   device's name and when it was last seen, in `devices.json` under the state
 *   folder. Removing the device revokes the token.
 * - **Tickets.** A paired device trades its token for a short-lived,
 *   single-use ticket to open a WebSocket with (a WebSocket cannot carry a
 *   header from React Native).
 * - **The admin token.** Local tools (`pnpm pair`) use the token in
 *   `admin-token` under the state folder, readable only by the Mac's user; it
 *   is made at first start.
 *
 * @internal
 */
import { NodeServices } from "@effect/platform-node";
import { Clock, Context, Crypto, Effect, FileSystem, Layer, Option, Path, Ref, Schema, SynchronizedRef } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import { Auth } from "agent-console-protocol";
import { adminTokenFile, devicesFile, stateDirectory } from "../sessions/files";

/** How long a pairing code can be redeemed. */
/** For now 20 minutes (owner, 2026-10-14): long enough to get from the Mac to the phone. */
export const PAIRING_TTL_MS = 20 * 60 * 1000;
/** How long a WebSocket ticket can be used. */
export const TICKET_TTL_MS = 30 * 1000;
/** How often a device's last-seen time is written, at most. */
const LAST_SEEN_EVERY_MS = 60 * 1000;
/** Pairing code letters: no 0/O, 1/I/L. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

/** A paired device, as kept. */
export const PairedDevice = Schema.Struct({
  name: Schema.String,
  tokenHash: Schema.String,
  pairedAt: Schema.Number,
  lastSeenAt: Schema.Number,
});
export type PairedDevice = typeof PairedDevice.Type;

/** Every paired device, by id. */
const PairedDevices = Schema.Record(Schema.String, PairedDevice);
type PairedDevices = typeof PairedDevices.Type;
const devicesJson = Schema.fromJsonString(PairedDevices);

/** What a request proved: a paired device, or the Mac's own tools. */
export type Caller = { readonly _tag: "Device"; readonly id: string } | { readonly _tag: "Admin" };

const failed = (message: string) => (cause: unknown) =>
  new Auth.DeviceAuthError({ message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}` });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const dir = stateDirectory((...parts) => path.join(...parts));
  const file = path.join(dir, devicesFile);

  /** 32 random bytes (two UUIDv4s: 244 random bits), base64url. */
  const secret = Effect.all([crypto.randomUUIDv4({ format: "bytes" }), crypto.randomUUIDv4({ format: "bytes" })]).pipe(
    Effect.map(([a, b]) => Base64Url.encode(new Uint8Array([...a, ...b]))),
    Effect.mapError(failed("making a token")),
  );
  const hashOf = (token: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(token)).pipe(Effect.map(Hex.encode), Effect.mapError(failed("hashing a token")));

  // The admin token: made once, kept where only this user can read it.
  const adminFile = path.join(dir, adminTokenFile);
  const admin = yield* fs.exists(adminFile).pipe(
    Effect.flatMap((exists) =>
      exists
        ? fs.readFileString(adminFile).pipe(Effect.map((text) => text.trim()))
        : secret.pipe(
            Effect.tap((token) =>
              fs.makeDirectory(dir, { recursive: true }).pipe(
                Effect.andThen(fs.writeFileString(adminFile, `${token}\n`, { mode: 0o600 })),
                Effect.andThen(fs.chmod(adminFile, 0o600)),
              ),
            ),
          ),
    ),
    Effect.mapError(failed(`reading ${adminFile}`)),
  );

  // Compared by hash, like device tokens, so a comparison's timing says nothing about the token.
  const adminHash = yield* hashOf(admin);

  const read = fs.exists(file).pipe(
    Effect.flatMap((exists) => (exists ? fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(devicesJson))) : Effect.succeed<PairedDevices>({}))),
    Effect.mapError(failed(`reading ${file}`)),
  );
  const devices = yield* SynchronizedRef.make<PairedDevices>(yield* read);
  const write = (next: PairedDevices) =>
    fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.andThen(Schema.encodeEffect(devicesJson)(next)),
      Effect.flatMap((text) => fs.writeFileString(file, text, { mode: 0o600 })),
      Effect.mapError(failed(`writing ${file}`)),
    );
  /** Changes the devices, written before they are kept. */
  const change = (update: (current: PairedDevices) => PairedDevices) =>
    SynchronizedRef.updateEffect(devices, (current) => {
      const next = update(current);
      return next === current ? Effect.succeed(current) : write(next).pipe(Effect.as(next));
    });

  /** Pairing codes and tickets waiting, with when they expire. */
  const codes = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const tickets = yield* Ref.make<ReadonlyMap<string, { readonly id: string; readonly expiresAt: number }>>(new Map());

  /** Takes `key` out of a waiting set if it is there and not expired. */
  const takeLive = <V>(ref: Ref.Ref<ReadonlyMap<string, V>>, key: string, expiresAt: (value: V) => number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Ref.modify(ref, (waiting): readonly [Option.Option<V>, ReadonlyMap<string, V>] => {
        const live = new Map([...waiting].filter(([, value]) => expiresAt(value) > now));
        const found = live.get(key);
        live.delete(key);
        return [found === undefined ? Option.none() : Option.some(found), live];
      }),
    );

  const deviceWithHash = (hash: string) =>
    SynchronizedRef.get(devices).pipe(Effect.map((all) => Option.fromNullishOr(Object.entries(all).find(([, device]) => device.tokenHash === hash)?.[0])));

  /** Notes that a device was seen (written at most once a `LAST_SEEN_EVERY_MS`). */
  const seen = (id: string) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      change((all) => {
        const device = all[id];
        if (device === undefined || now - device.lastSeenAt < LAST_SEEN_EVERY_MS) return all;
        return { ...all, [id]: { ...device, lastSeenAt: now } };
      }),
    );

  return {
    /** A new pairing code, and when it expires. */
    pair: Effect.gen(function* () {
      const letters = yield* Effect.forEach(Array.from({ length: CODE_LENGTH }), () =>
        crypto.randomIntBetween(0, CODE_ALPHABET.length, { halfOpen: true }),
      );
      const code = letters.map((index) => CODE_ALPHABET[index]).join("");
      const expiresAt = (yield* Clock.currentTimeMillis) + PAIRING_TTL_MS;
      yield* Ref.update(codes, (waiting) => new Map(waiting).set(code, expiresAt));
      return { code, expiresAt };
    }),
    /** Redeems a pairing code for a new device's id and token. */
    redeem: (code: string, name: string) =>
      Effect.gen(function* () {
        const found = yield* takeLive(codes, code.trim().toUpperCase(), (expiresAt) => expiresAt);
        if (Option.isNone(found)) return yield* new Auth.PairingRefused();
        const token = yield* secret;
        const tokenHash = yield* hashOf(token);
        const id = yield* crypto.randomUUIDv4().pipe(Effect.mapError(failed("making a device id")));
        const now = yield* Clock.currentTimeMillis;
        yield* change((all) => ({ ...all, [id]: { name, tokenHash, pairedAt: now, lastSeenAt: now } }));
        return { id, token };
      }),
    /** Who `token` is: a paired device (now seen), the admin, or nobody. */
    authorize: (token: string): Effect.Effect<Option.Option<Caller>, Auth.DeviceAuthError> =>
      hashOf(token).pipe(
        Effect.flatMap((hash) =>
          hash === adminHash
            ? Effect.succeed(Option.some<Caller>({ _tag: "Admin" }))
            : deviceWithHash(hash).pipe(
                Effect.tap((id) => (Option.isSome(id) ? seen(id.value) : Effect.void)),
                Effect.map(Option.map((id): Caller => ({ _tag: "Device", id }))),
              ),
        ),
      ),
    /** A WebSocket ticket for a paired device. */
    ticket: (id: string) =>
      Effect.gen(function* () {
        const ticket = yield* secret;
        const expiresAt = (yield* Clock.currentTimeMillis) + TICKET_TTL_MS;
        yield* Ref.update(tickets, (waiting) => new Map(waiting).set(ticket, { id, expiresAt }));
        return { ticket, expiresAt };
      }),
    /** The device a ticket was issued to, using it up. */
    redeemTicket: (ticket: string) =>
      takeLive(tickets, ticket, (waiting) => waiting.expiresAt).pipe(Effect.map(Option.map((waiting) => waiting.id))),
    /** Every paired device. */
    devices: SynchronizedRef.get(devices).pipe(
      Effect.map((all) => Object.entries(all).map(([id, device]): Auth.Device => ({ id, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt }))),
    ),
    /** Removes a device; its token stops working. */
    revoke: (id: string) => change((all) => Object.fromEntries(Object.entries(all).filter(([kept]) => kept !== id))),
  };
});

export class DeviceAuth extends Context.Service<DeviceAuth, Effect.Success<typeof make>>()("agent-console/DeviceAuth") {
  static readonly layer = Layer.effect(DeviceAuth, make).pipe(Layer.provide(NodeServices.layer));
}
