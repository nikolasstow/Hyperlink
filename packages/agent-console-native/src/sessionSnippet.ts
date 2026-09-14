/**
 * The last message of a session, for the card's long-press preview — cache-first
 * so it paints instantly, with a lazy fetch to fill or refresh it (the preview
 * updates reactively when that lands, so late content is fine, like Safari's
 * preview loading after it opens).
 *
 * Two cache sources, cheapest first:
 *   1. `transcriptCache` — a session opened this run already has its transcript
 *      in memory, so its last message is free (no request).
 *   2. a snippet cache keyed by `${id}:${updated}` — filled by one `messages`
 *      fetch (limited to the tail) the first time a not-yet-cached session is
 *      shown while Home is focused. Keyed on `updated` so a new turn re-fetches.
 *
 * Fetches are deduped by key and never block the card; a failed fetch degrades to
 * "no preview" (logged, not cached, so it retries) rather than surfacing an error
 * — a preview is not worth an alert.
 *
 * @internal
 */
import * as React from "react";
import type { OpencodeClient } from "./client";
import { transcriptCache } from "./transcriptCache";
import type { Transcript } from "./useSessionStream";

export type SessionSnippet = {
  readonly role: "user" | "assistant";
  readonly text: string;
};

/** How many trailing messages to pull, and how long a snippet may run. */
const TAIL_LIMIT = 8;
const MAX_CHARS = 240;

const cache = new Map<string, SessionSnippet | null>();
const inFlight = new Set<string>();

const keyFor = (id: string, updated: number): string => `${id}:${updated}`;

const clip = (text: string): string => {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_CHARS ? `${collapsed.slice(0, MAX_CHARS - 1)}…` : collapsed;
};

/** Concatenated non-synthetic text of a message's parts (ignores tools/reasoning). */
const textOfParts = (parts: ReadonlyArray<{ readonly type?: string; readonly text?: string; readonly synthetic?: boolean }>): string =>
  parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.synthetic !== true)
    .map((part) => part.text as string)
    .join(" ")
    .trim();

const roleOf = (role: string): "user" | "assistant" => (role === "assistant" ? "assistant" : "user");

/** Newest message with text in an in-memory transcript, if any. */
const fromTranscript = (transcript: Transcript): SessionSnippet | null => {
  for (let i = transcript.order.length - 1; i >= 0; i -= 1) {
    const message = transcript.messages.get(transcript.order[i]);
    if (message === undefined) continue;
    const text = textOfParts(Array.from(message.parts.values()));
    if (text !== "") return { role: message.role, text: clip(text) };
  }
  return null;
};

/**
 * Best snippet known without a request: the fetched one for this exact version,
 * else whatever an open transcript yields. `undefined` means "unknown, worth
 * fetching"; `null` means "known to have no text".
 */
const cachedSnippet = (id: string, updated: number): SessionSnippet | null | undefined => {
  const fetched = cache.get(keyFor(id, updated));
  if (fetched !== undefined) return fetched;
  const transcript = transcriptCache.get(id);
  return transcript !== undefined ? fromTranscript(transcript) : undefined;
};

const fetchSnippet = async (client: OpencodeClient, id: string, updated: number): Promise<void> => {
  const key = keyFor(id, updated);
  if (cache.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const { data, error } = await client.session.messages({ path: { id }, query: { limit: TAIL_LIMIT } });
    if (error !== undefined) {
      console.warn("session snippet fetch failed", error);
      return;
    }
    const messages = data ?? [];
    let snippet: SessionSnippet | null = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = textOfParts(messages[i].parts);
      if (text !== "") {
        snippet = { role: roleOf(messages[i].info.role), text: clip(text) };
        break;
      }
    }
    cache.set(key, snippet);
  } finally {
    inFlight.delete(key);
  }
};

/**
 * The session's last-message snippet for the preview. Returns the cached value
 * immediately, then (while `enabled`) lazily fetches to fill/refresh it and
 * updates when that resolves.
 */
export const useSessionSnippet = (
  client: OpencodeClient,
  id: string,
  updated: number,
  enabled: boolean,
): SessionSnippet | null | undefined => {
  const [snippet, setSnippet] = React.useState<SessionSnippet | null | undefined>(() => cachedSnippet(id, updated));

  React.useEffect(() => {
    const known = cachedSnippet(id, updated);
    setSnippet(known);
    // Only hit the network when nothing is cached at all: an open session's
    // transcript already answers this, and a prior fetch is keyed by `updated`.
    if (!enabled || known !== undefined) return;
    let alive = true;
    void fetchSnippet(client, id, updated).then(() => {
      if (alive) setSnippet(cachedSnippet(id, updated));
    });
    return () => {
      alive = false;
    };
  }, [client, id, updated, enabled]);

  return snippet;
};
