/**
 * The device tokens of the servers this phone is paired with, by origin, as
 * `ServerAuth` last read them (useServerAuth.ts keeps this in step), and the
 * one way a request gets its token: `Authorization: Bearer <token>`, added
 * only for a paired server's origin. Every way the app reaches a server goes
 * through here: the Effect HTTP client (its `Fetch`, runtime.ts), the
 * opencode SDK (client.ts), plain `fetch` (`authedFetch`), downloads
 * (`authHeaders`). A server not paired gets no token, and answers as before
 * if it does not ask for one.
 *
 * A module of its own, imported by the runtime and by the React mirror, so
 * neither imports the other.
 *
 * @internal
 */

let tokens: ReadonlyMap<string, string> = new Map();

/** Replaces the known tokens (useServerAuth.ts, as ServerAuth changes). */
export const setServerTokens = (next: ReadonlyMap<string, string>): void => {
  tokens = next;
};

/** An http(s) URL's origin (`http://host:port`), if it is one. Parsed by
 * hand: React Native's `URL` has no `canParse`. */
export const originOf = (url: string): string | undefined => /^https?:\/\/[^/?#\s]+/i.exec(url)?.[0];

/** The token for the server `url` is on, if paired. */
export const tokenFor = (url: string): string | undefined => {
  const origin = originOf(url);
  return origin === undefined ? undefined : tokens.get(origin);
};

/** The headers to send `url` with: the token, if its server is paired. */
export const authHeaders = (url: string): Readonly<Record<string, string>> => {
  const token = tokenFor(url);
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
};

const urlOf = (input: RequestInfo | URL): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** `init` with the token added, if the request goes to a paired server. */
const authorizedInit = (input: RequestInfo | URL, init: RequestInit | undefined): RequestInit | undefined => {
  const token = tokenFor(urlOf(input));
  if (token === undefined) return init;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
};

/** `fetch`, with the token for a paired server. */
export const authedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, authorizedInit(input, init));

/** `request`, with the token for a paired server. */
export const authorizeRequest = (request: Request): Request => {
  const token = tokenFor(request.url);
  if (token === undefined) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
};
