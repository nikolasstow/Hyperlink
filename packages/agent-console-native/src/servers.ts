/**
 * Servers — a first-class Home category alongside repos. A server is a box the
 * app connects to (localhost or, over Tailscale, another machine); its page
 * lists the services/plugins bound to it.
 *
 * Phase 1 is a static list. Multi-server is designed in from the start (this is
 * a list, not one special box) — add/remove, persistence, and per-server plugin
 * binding come later and are additive. See
 * docs/handoffs/server-pages-and-widgets.md.
 *
 * @internal
 */

export interface Server {
  readonly id: string;
  readonly name: string;
  /** Host or IP the server's services are reached at (Tailscale), no scheme. */
  readonly address: string;
}

const SERVERS: ReadonlyArray<Server> = [
  { id: "mac-mini", name: "Mac mini", address: "100.67.32.32" },
];

export const useServers = (): ReadonlyArray<Server> => SERVERS;

export const serverById = (id: string): Server | undefined => SERVERS.find((server) => server.id === id);
