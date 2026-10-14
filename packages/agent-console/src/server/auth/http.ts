/**
 * The gate in front of every route (docs/handoffs/app-auth.md): a request
 * goes through with a paired device's token (`Authorization: Bearer …`), a
 * WebSocket ticket (`?ticket=…`), or the admin token; `/health` and redeeming
 * a pairing code are open. Also the `auth` group's handlers.
 *
 * @internal
 */
import { Effect, Option } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { api } from "../api";
import { type Caller, DeviceAuth, NotAllowed } from "./DeviceAuth";

/** Paths anyone may call. */
const OPEN_PATHS: ReadonlySet<string> = new Set(["/health", "/auth/redeem"]);

/** The query parameter a WebSocket ticket travels in. */
export const TICKET_PARAM = "ticket";

/** The bearer token on a request, if any. */
const bearerOf = (request: HttpServerRequest.HttpServerRequest): Option.Option<string> =>
  Headers.get(request.headers, "authorization").pipe(
    Option.flatMap((header) => {
      const match = /^Bearer\s+(.+)$/i.exec(header);
      return match?.[1] === undefined ? Option.none() : Option.some(match[1].trim());
    }),
  );

/** Who sent `request`, by its bearer token. */
const callerOf = (auth: DeviceAuth["Service"], request: HttpServerRequest.HttpServerRequest) =>
  Option.match(bearerOf(request), {
    onNone: () => Effect.succeed(Option.none<Caller>()),
    onSome: auth.authorize,
  });

const unauthorized = HttpServerResponse.jsonUnsafe({ _tag: "Unauthorized", message: "Pair this device first" }, { status: 401 });

/** Lets a request through only with a token or ticket (or to an open path). */
export const authMiddleware = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* DeviceAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.originalUrl, "http://localhost");
        if (OPEN_PATHS.has(url.pathname) || request.method === "OPTIONS") return yield* httpEffect;
        const ticket = url.searchParams.get(TICKET_PARAM);
        const allowed = ticket === null ? Option.isSome(yield* callerOf(auth, request)) : Option.isSome(yield* auth.redeemTicket(ticket));
        return allowed ? yield* httpEffect : unauthorized;
      }).pipe(
        Effect.catchTag("DeviceAuthError", (error) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ _tag: error._tag, message: error.message }, { status: 500 })),
        ),
      );
  }),
  { global: true },
);

/** Open: whether this is a server, before pairing with it. */
export const healthRoute = HttpRouter.add("GET", "/health", HttpServerResponse.jsonUnsafe({ status: "ok" }));

export const authHandlers = HttpApiBuilder.group(api, "auth", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* DeviceAuth;
    return handlers
      .handle("pair", ({ request }) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(auth, request);
          if (Option.isNone(caller) || caller.value._tag !== "Admin") return yield* new NotAllowed();
          return yield* auth.pair;
        }),
      )
      .handle("redeem", ({ payload }) => auth.redeem(payload.code, payload.name))
      .handle("devices", () => auth.devices)
      .handle("revoke", ({ payload }) => auth.revoke(payload.id).pipe(Effect.andThen(auth.devices)))
      .handle("ticket", ({ request }) =>
        Effect.gen(function* () {
          const caller = yield* callerOf(auth, request);
          if (Option.isNone(caller) || caller.value._tag !== "Device") return yield* new NotAllowed();
          return yield* auth.ticket(caller.value.id);
        }),
      );
  }),
);
