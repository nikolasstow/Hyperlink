/**
 * `pnpm pair`: pairs a phone with this machine's API server
 * (docs/handoffs/app-auth.md). Asks the running server for a single-use code
 * (with the admin token from its state folder) and prints it with the
 * server's addresses, and a QR code of both for the app to scan:
 * `{ "code": "…", "urls": ["http://100.x.y.z:5199", …] }`.
 *
 * Port: `AGENT_CONSOLE_API_PORT` (default 5199), as the server. Run it from
 * the folder the server runs in (or set `AGENT_CONSOLE_STATE_DIR` the same).
 *
 * @internal
 */
import { networkInterfaces } from "node:os";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { renderUnicodeCompact } from "uqr";
import { PairingCode } from "./auth/DeviceAuth";
import { adminTokenFile, stateDirectory } from "./sessions/files";

/** Tailscale's address range (100.64.0.0/10): reachable from the phone anywhere. */
const isTailscale = (address: string): boolean => {
  const [first, second] = address.split(".").map(Number);
  return first === 100 && second !== undefined && second >= 64 && second < 128;
};

/** This machine's IPv4 addresses a phone can reach, Tailscale first. */
const reachableAddresses = (): ReadonlyArray<string> => {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  return [...addresses.filter(isTailscale), ...addresses.filter((address) => !isTailscale(address))];
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const port = yield* Config.Int("AGENT_CONSOLE_API_PORT").pipe(Config.withDefault(5199));
  const admin = (yield* fs.readFileString(path.join(stateDirectory((...parts) => path.join(...parts)), adminTokenFile))).trim();
  const pairing = yield* HttpClientRequest.post(`http://127.0.0.1:${port}/auth/pair`).pipe(
    HttpClientRequest.bearerToken(admin),
    HttpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(PairingCode)),
  );
  const urls = reachableAddresses().map((address) => `http://${address}:${port}`);
  const minutes = Math.round((pairing.expiresAt - Date.now()) / 60_000);
  yield* Console.log(
    [
      "",
      `  Pairing code: ${pairing.code}  (works once, for ${minutes} minutes)`,
      "",
      ...urls.map((url) => `  ${url}`),
      "",
      ...renderUnicodeCompact(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({ code: Schema.String, urls: Schema.Array(Schema.String) })))({ code: pairing.code, urls }), { border: 2 })
        .split("\n")
        .map((line) => `  ${line}`),
      "",
      "  In the app: Add Server, then scan this, or type an address and the code.",
      "",
    ].join("\n"),
  );
});

program.pipe(Effect.provide([FetchHttpClient.layer, NodeServices.layer]), NodeRuntime.runMain);
