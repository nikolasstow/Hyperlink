import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { afterEach, describe, expect, it } from "vitest";
import { adminTokenFile, devicesFile } from "../sessions/files";
import { DeviceAuth, PAIRING_TTL_MS, TICKET_TTL_MS } from "./DeviceAuth";
import { authMiddleware, healthRoute } from "./http";

/** Runs `body` with a fresh DeviceAuth over its own state folder. */
const withAuth = <A, E>(body: (dir: string) => Effect.Effect<A, E, DeviceAuth | FileSystem.FileSystem | Path.Path>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    process.env.AGENT_CONSOLE_STATE_DIR = dir;
    return yield* body(dir).pipe(Effect.provide(Layer.fresh(DeviceAuth.layer)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

afterEach(() => {
  delete process.env.AGENT_CONSOLE_STATE_DIR;
});

describe("DeviceAuth", () => {
  it("pairs a device with a single-use code; its token works until it is removed", async () => {
    const result = await Effect.runPromise(
      withAuth((dir) =>
        Effect.gen(function* () {
          const auth = yield* DeviceAuth;
          const { code } = yield* auth.pair;
          const paired = yield* auth.redeem(code.toLowerCase(), "Phone");
          const again = yield* Effect.flip(auth.redeem(code, "Other"));
          const caller = yield* auth.authorize(paired.token);
          const stranger = yield* auth.authorize("not-a-token");
          const listed = yield* auth.devices;
          const kept = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(dir, devicesFile));
          yield* auth.revoke(paired.id);
          const revoked = yield* auth.authorize(paired.token);
          return { paired, again, caller, stranger, listed, kept, revoked };
        }),
      ),
    );
    expect(result.again._tag).toBe("PairingRefused");
    expect(result.caller).toEqual(Option.some({ _tag: "Device", id: result.paired.id }));
    expect(result.stranger).toEqual(Option.none());
    expect(result.listed.map((device) => device.name)).toEqual(["Phone"]);
    // Only a hash is kept.
    expect(result.kept).not.toContain(result.paired.token);
    expect(result.revoked).toEqual(Option.none());
  });

  it("refuses a code once it has expired, and a ticket after its one use", async () => {
    const result = await Effect.runPromise(
      withAuth(() =>
        Effect.gen(function* () {
          const auth = yield* DeviceAuth;
          const { code } = yield* auth.pair;
          yield* TestClock.adjust(PAIRING_TTL_MS + 1);
          const late = yield* Effect.flip(auth.redeem(code, "Phone"));
          const { ticket } = yield* auth.ticket("device-1");
          const first = yield* auth.redeemTicket(ticket);
          const second = yield* auth.redeemTicket(ticket);
          const { ticket: stale } = yield* auth.ticket("device-1");
          yield* TestClock.adjust(TICKET_TTL_MS + 1);
          const expired = yield* auth.redeemTicket(stale);
          return { late, first, second, expired };
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );
    expect(result.late._tag).toBe("PairingRefused");
    expect(result.first).toEqual(Option.some("device-1"));
    expect(result.second).toEqual(Option.none());
    expect(result.expired).toEqual(Option.none());
  });

  it("keeps the admin token in a file only its owner can read, the same across starts", async () => {
    const result = await Effect.runPromise(
      withAuth((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const file = (yield* Path.Path).join(dir, adminTokenFile);
          const token = (yield* fs.readFileString(file)).trim();
          const mode = (yield* fs.stat(file)).mode & 0o777;
          const caller = yield* (yield* DeviceAuth).authorize(token);
          const restarted = yield* DeviceAuth.pipe(Effect.flatMap((auth) => auth.authorize(token)), Effect.provide(Layer.fresh(DeviceAuth.layer)));
          return { mode, caller, restarted };
        }),
      ),
    );
    expect(result.mode).toBe(0o600);
    expect(result.caller).toEqual(Option.some({ _tag: "Admin" }));
    expect(result.restarted).toEqual(Option.some({ _tag: "Admin" }));
  });
});

describe("the gate", () => {
  const Paired = Schema.Struct({ id: Schema.String, token: Schema.String });
  /** A server with the gate: a protected route, health, and stand-ins for
   * pairing and redeeming over the same DeviceAuth. */
  const app = Layer.mergeAll(
    HttpRouter.add("GET", "/secret", HttpServerResponse.text("secret")),
    HttpRouter.add(
      "POST",
      "/test/pair-and-redeem",
      Effect.gen(function* () {
        const auth = yield* DeviceAuth;
        const { code } = yield* auth.pair;
        const paired = yield* auth.redeem(code, "Phone");
        const { ticket } = yield* auth.ticket(paired.id);
        return yield* HttpServerResponse.json({ ...paired, ticket });
      }).pipe(Effect.orDie),
    ),
    healthRoute,
    authMiddleware,
  ).pipe(Layer.provideMerge(DeviceAuth.layer));

  it("lets through only a paired device, a ticket once, or the admin; health is open", async () => {
    const fs = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }).pipe(Effect.provide(NodeServices.layer)),
    );
    const dir = await Effect.runPromise(fs.makeTempDirectory());
    process.env.AGENT_CONSOLE_STATE_DIR = dir;
    const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true });
    const call = (path: string, init?: RequestInit) => handler(new Request(`http://localhost${path}`, init));
    try {
      expect((await call("/health")).status).toBe(200);
      expect((await call("/secret")).status).toBe(401);
      const admin = (await Effect.runPromise(fs.readFileString(`${dir}/${adminTokenFile}`))).trim();
      const pairing = await call("/test/pair-and-redeem", { method: "POST", headers: { authorization: `Bearer ${admin}` } });
      const paired = Schema.decodeUnknownSync(Schema.Struct({ ...Paired.fields, ticket: Schema.String }))(await pairing.json());
      expect((await call("/secret", { headers: { authorization: `Bearer ${paired.token}` } })).status).toBe(200);
      expect((await call("/secret", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      expect((await call(`/secret?ticket=${paired.ticket}`)).status).toBe(200);
      expect((await call(`/secret?ticket=${paired.ticket}`)).status).toBe(401);
    } finally {
      await dispose();
      await Effect.runPromise(fs.remove(dir, { recursive: true }));
    }
  });
});
