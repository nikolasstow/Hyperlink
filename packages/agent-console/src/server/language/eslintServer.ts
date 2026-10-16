/**
 * ESLint's language server: the one VS Code runs (Microsoft's `vscode-eslint`
 * extension, MIT), taken from the extension's package on Open VSX. Pinned to
 * one version and checked against its hash; fetched once into the state
 * folder, then run from there. It lints with each repo's own ESLint and
 * config, as the repo's `eslint` command does.
 *
 * @internal
 */
import { Crypto, Duration, Effect, FileSystem, Path } from "effect";
import { Hex } from "effect/encoding";
import { HttpClient, HttpClientResponse } from "effect/http";
import { unzipSync } from "fflate";
import { stateDirectory } from "../sessions/files";

const VERSION = "3.0.34";
const VSIX_URL = `https://open-vsx.org/api/dbaeumer/vscode-eslint/${VERSION}/file/dbaeumer.vscode-eslint-${VERSION}.vsix`;
const VSIX_SHA256 = "ca5334d46f6a39079e751ef4601bfc9f86bc3a46483e87291ec609239d161308";
/** How long the fetch may take (it holds up the repo's servers' start). */
const FETCH_WAIT = Duration.minutes(1);
/** The server, inside the package. */
const ENTRY = "extension/server/out/eslintServer.js";

/** The server's script: fetched the first time, then kept. */
export const eslintServer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(stateDirectory((...parts) => path.join(...parts)), "language-servers", `vscode-eslint-${VERSION}`);
  // `.cjs`: the bundle is CommonJS, and the state folder may sit under a
  // `"type": "module"` package.
  const script = path.join(dir, "eslintServer.cjs");
  if (yield* fs.exists(script)) return script;
  yield* Effect.logInfo(`[language] fetching ESLint's language server ${VERSION}`);
  const bytes = yield* HttpClient.get(VSIX_URL).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.timeoutOrElse({ duration: FETCH_WAIT, orElse: () => Effect.fail(new Error(`fetching ${VSIX_URL} took over a minute`)) }),
  );
  const hash = Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes));
  if (hash !== VSIX_SHA256) return yield* Effect.fail(new Error(`ESLint's language server package has hash ${hash}, not ${VSIX_SHA256}`));
  const server = unzipSync(bytes, { filter: (file) => file.name === ENTRY })[ENTRY];
  if (server === undefined) return yield* Effect.fail(new Error(`ESLint's language server package has no ${ENTRY}`));
  // Written whole, then moved in: a server never starts from half a file.
  yield* fs.makeDirectory(dir, { recursive: true });
  const partial = `${script}.partial`;
  yield* fs.writeFile(partial, server);
  yield* fs.rename(partial, script);
  return script;
});
