/**
 * The transcript shown in a card's long-press preview — the same `Transcript`
 * the chat renders, so the preview can reuse `MessageBubble` (markdown, user
 * bubbles, tool calls, reasoning) verbatim.
 *
 * Cache-first so it paints instantly, with a lazy fetch to fill or refresh it
 * (the preview updates reactively when that lands — late content is fine, like
 * Safari's preview loading after it opens). Two sources, cheapest first:
 *   1. `transcriptCache` — a session opened this run is already in memory, free.
 *   2. a preview cache keyed by `${id}:${updated}`, filled by one tail-limited
 *      `messages` fetch the first time a not-yet-cached session is shown while
 *      Home is focused. Keyed on `updated` so a new turn re-fetches.
 *
 * The fetch is deduped by key and never blocks the card; a failure degrades to
 * "no preview" (logged, uncached so it retries) rather than an error surface.
 *
 * @internal
 */
import * as React from "react";
import type { Message, Part } from "@opencode-ai/sdk";
import type { OpencodeClient } from "./client";
import { transcriptCache } from "./transcriptCache";
import { EMPTY, isRenderablePart, withPart, withRole, type Transcript } from "./useSessionStream";

/** Trailing messages to pull — enough to fill roughly half a screen. */
const TAIL_LIMIT = 30;

const cache = new Map<string, Transcript>();
const inFlight = new Set<string>();

const keyFor = (id: string, updated: number): string => `${id}:${updated}`;

/** Build the chat's `Transcript` from a `messages` response, exactly as the
 * chat's own history load does — so the preview and the chat agree. */
const toTranscript = (messages: ReadonlyArray<{ readonly info: Message; readonly parts: ReadonlyArray<Part> }>): Transcript => {
  let transcript = EMPTY;
  for (const { info, parts } of messages) {
    transcript = withRole(
      transcript,
      info.id,
      info.role,
      info.role === "assistant" ? { providerID: info.providerID, modelID: info.modelID } : undefined,
      info.role === "assistant" ? info.time : undefined,
    );
    for (const part of parts) {
      if (isRenderablePart(part)) transcript = withPart(transcript, part);
    }
  }
  return transcript;
};

/** Best transcript known without a request. `undefined` = worth fetching. */
const cachedTranscript = (id: string, updated: number): Transcript | undefined => {
  const fetched = cache.get(keyFor(id, updated));
  if (fetched !== undefined) return fetched;
  return transcriptCache.get(id);
};

const fetchPreview = async (client: OpencodeClient, id: string, updated: number): Promise<void> => {
  const key = keyFor(id, updated);
  if (cache.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const { data, error } = await client.session.messages({ path: { id }, query: { limit: TAIL_LIMIT } });
    if (error !== undefined) {
      console.warn("session preview fetch failed", error);
      return;
    }
    cache.set(key, toTranscript(data ?? []));
  } finally {
    inFlight.delete(key);
  }
};

/**
 * The session's preview transcript. Returns the cached value immediately, then
 * (while `enabled`) lazily fetches to fill/refresh it and updates when it lands.
 */
export const useSessionPreview = (
  client: OpencodeClient,
  id: string,
  updated: number,
  enabled: boolean,
): Transcript | undefined => {
  const [transcript, setTranscript] = React.useState<Transcript | undefined>(() => cachedTranscript(id, updated));

  React.useEffect(() => {
    const known = cachedTranscript(id, updated);
    setTranscript(known);
    // Only hit the network when nothing is cached at all: an open session's
    // transcript already answers, and a prior fetch is keyed by `updated`.
    if (!enabled || known !== undefined) return;
    let alive = true;
    void fetchPreview(client, id, updated).then(() => {
      if (alive) setTranscript(cachedTranscript(id, updated));
    });
    return () => {
      alive = false;
    };
  }, [client, id, updated, enabled]);

  return transcript;
};
