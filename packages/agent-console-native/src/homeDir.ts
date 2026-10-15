/**
 * Resolves the server's `$HOME`, once per server, for expanding a
 * `~/`-prefixed root folder. The file API's `directory` param is a literal
 * filesystem path (`~/Coding` is a folder named `~`, which does not exist),
 * and the app cannot expand it itself, so it asks the server
 * (`echo $HOME` through repoAdmin.ts).
 *
 * @internal
 */
import type { ServerAddress } from "./opencode/serverAddress";
import { runRepoAdmin } from "./repoAdmin";

const cache = new Map<ServerAddress, string>();
const inFlight = new Map<ServerAddress, Promise<string>>();

/** The server's `$HOME`; rejects when it cannot be read. */
export const resolveHomeDir = (server: ServerAddress): Promise<string> => {
  const known = cache.get(server);
  if (known !== undefined) return Promise.resolve(known);
  const existing = inFlight.get(server);
  if (existing !== undefined) return existing;

  const promise = runRepoAdmin(server, "/", "echo $HOME")
    .then((home) => {
      if (!home.startsWith("/")) throw new Error(`The server's $HOME is not a path: ${home}`);
      cache.set(server, home);
      return home;
    })
    .finally(() => {
      inFlight.delete(server);
    });
  inFlight.set(server, promise);
  return promise;
};

/** Expands a leading `~` (bare, or `~/...`) against the server's real
 * `$HOME`; any other path is returned unchanged. */
export const expandHome = async (server: ServerAddress, path: string): Promise<string> => {
  if (path !== "~" && !path.startsWith("~/")) return path;
  const home = await resolveHomeDir(server);
  return path === "~" ? home : `${home}${path.slice(1)}`;
};
