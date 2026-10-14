/**
 * `pnpm pair`: pairs a phone with this machine's API server
 * (docs/handoffs/app-auth.md). Asks the running server for a single-use code
 * (with the admin token from its state folder) and prints a pairing link, and
 * a QR code of it: scanned with the iPhone's camera, it opens the app, which
 * asks before it pairs. The link is
 * `<scheme>://pair?code=…&url=http://100.x.y.z:5199&url=…` (addresses
 * Tailscale first), for the app built from this worktree (its variant's
 * scheme; `APP_VARIANT=<name>` for another variant's).
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
import { appScheme, resolveVariant } from "../../../agent-console-native/variant";
import { adminTokenFile, stateDirectory } from "./sessions/files";

/** The app's base scheme, from its app.json. */
const AppJson = Schema.fromJsonString(Schema.Struct({ expo: Schema.Struct({ scheme: Schema.String }) }));

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
  const appDir = path.join(path.dirname(path.dirname(process.cwd())), "packages", "agent-console-native");
  const { expo } = yield* Schema.decodeUnknownEffect(AppJson)(yield* fs.readFileString(path.join(appDir, "app.json")));
  const scheme = appScheme(expo.scheme, resolveVariant(appDir));
  const link = `${scheme}://pair?${new URLSearchParams([["code", pairing.code], ...urls.map((url) => ["url", url])]).toString()}`;
  const minutes = Math.round((pairing.expiresAt - Date.now()) / 60_000);
  yield* Console.log(
    [
      "",
      `  Scan with the iPhone's camera to pair (${scheme}); works once, for ${minutes} minutes.`,
      "",
      ...renderUnicodeCompact(link, { border: 2 })
        .split("\n")
        .map((line) => `  ${line}`),
      "",
      `  Or in the app, Add Server: code ${pairing.code} at`,
      ...urls.map((url) => `    ${url}`),
      "",
    ].join("\n"),
  );
});

program.pipe(Effect.provide([FetchHttpClient.layer, NodeServices.layer]), NodeRuntime.runMain);
