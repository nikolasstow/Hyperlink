/**
 * The conversations kept on the device, for React: a snapshot mirrored from
 * the store (Conversations.ts), read through `useSyncExternalStore`; a chat
 * re-renders only when its own conversation changes.
 *
 * `startConversations` (once, at launch) reads back what the device kept and
 * starts the mirror. `preloadConversations` keeps the sessions someone might
 * open next; `rememberConversation` hands back an open chat's newest messages.
 *
 * @internal
 */
import { Effect, Fiber, HashMap, Option, Stream } from "effect";
import * as React from "react";
import type { ChatMessage } from "../chat/model";
import { forkApp, runApp } from "../effect/runtime";
import { serverAddressOf, type ServerAddress } from "../opencode/serverAddress";
import type { Protocol } from "../outbox/model";
import type { SessionSummary } from "../sessions/sessionList";
import { conversationChanges, Conversations, type Wanted } from "./Conversations";
import { type Conversation, conversationKey } from "./model";

let kept: HashMap.HashMap<string, Conversation> = HashMap.empty();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;

/** Reads back what the device kept and mirrors it for React (once). */
export const startConversations = (): void => {
  if (started) return;
  started = true;
  forkApp(
    conversationChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          kept = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** A session's kept conversation (its newest messages, its protocol), or
 * undefined when none is kept. */
export const useKeptConversation = (server: ServerAddress, sessionID: string): Conversation | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(kept, conversationKey(server, sessionID))));

/** Starts keeping these sessions' newest messages (most recent first), in
 * the background. */
export const preloadConversations = (address: string, sessions: ReadonlyArray<Wanted>): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      yield* conversations.preload(serverAddressOf(address), sessions);
    }),
  );

/** Keeps the most recent sessions now and each time the app comes back,
 * until the returned stop is called. */
export const keepRecentConversations = (address: string, shown: (sessions: ReadonlyArray<SessionSummary>) => ReadonlyArray<SessionSummary>): (() => void) => {
  const fiber = forkApp(
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      yield* conversations.keepRecent(serverAddressOf(address), shown);
    }),
  );
  return () => {
    forkApp(Fiber.interrupt(fiber));
  };
};

/** Keeps an open chat's newest messages (once they stop changing). */
export const rememberConversation = (server: ServerAddress, sessionID: string, protocol: Protocol, messages: ReadonlyArray<ChatMessage>): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      yield* conversations.remember(server, sessionID, protocol, messages);
    }),
  );
