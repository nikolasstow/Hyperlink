/**
 * `fetch` whose response body streams, with a paired server's token: through
 * `expo/fetch` (React Native's own `fetch` reads a body whole). For an Effect
 * HTTP client that reads a response as it comes (the model catalog).
 *
 * @internal
 */
import { fetch as expoFetch } from "expo/fetch";
import { authHeaders } from "./serverTokens";

export const authedStreamingFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(authHeaders(url))) headers.set(name, value);
  return expoFetch(url, {
    method: init?.method,
    headers,
    body: init?.body,
    signal: init?.signal ?? null,
  });
};
