/**
 * Servers are named by their base URL. Plain functions and a schema only: no
 * client or platform code, so anything (scripts, tests) can import it.
 *
 * @internal
 */
import { Schema } from "effect";

/** Accepts "host:port", "http://host:port", with or without a trailing
 * slash — normalizes to a bare "http://host:port" base URL. Defaults to
 * http:// (not https://) since this always points at a local/Tailscale
 * opencode server, never a public host. */
export const normalizeServerAddress = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
};

/** A server, by its base URL (`http://host:port`, no trailing slash). */
export const ServerAddress = Schema.String.pipe(Schema.brand("ServerAddress"));
export type ServerAddress = typeof ServerAddress.Type;

/** The address the user typed, in the form servers are named by. */
export const serverAddressOf = (input: string): ServerAddress => ServerAddress.make(normalizeServerAddress(input));
