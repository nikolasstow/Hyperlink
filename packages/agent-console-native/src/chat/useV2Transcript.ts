/**
 * A v2 session's messages for React (v2Transcript.ts through the app
 * runtime), as the chat's view (fromV2.ts). Live while `enabled`; torn down
 * otherwise (the app in the background, the chat out of view), keeping what
 * it had.
 *
 * Snapshots arrive per event (a streamed reply sends many a second); React
 * gets at most one per frame, the latest.
 *
 * @internal
 */
import { Effect, Fiber, Stream } from "effect";
import * as React from "react";
import { forkApp } from "../effect/runtime";
import type { ServerAddress } from "../opencode/serverAddress";
import type { SessionID } from "../opencode/schema/session-id";
import type { SessionMessage } from "../opencode/schema/session-message";
import { chatMessagesOfV2 } from "./fromV2";
import type { ChatMessage } from "./model";
import { v2Transcript } from "./v2Transcript";

const NONE: ReadonlyArray<ChatMessage> = [];

export const useV2Transcript = (server: ServerAddress, sessionID: SessionID, enabled: boolean): ReadonlyArray<ChatMessage> => {
  const [messages, setMessages] = React.useState<ReadonlyArray<ChatMessage>>(NONE);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let latest: ReadonlyArray<SessionMessage.Message> | undefined;
    let frame: number | undefined;
    const flush = (): void => {
      frame = undefined;
      if (latest !== undefined) setMessages(chatMessagesOfV2(latest));
    };
    const fiber = forkApp(
      v2Transcript(server, sessionID).pipe(
        Stream.runForEach((snapshot) =>
          Effect.sync(() => {
            latest = snapshot;
            frame ??= requestAnimationFrame(flush);
          }),
        ),
      ),
    );
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      forkApp(Fiber.interrupt(fiber));
    };
  }, [server, sessionID, enabled]);
  return messages;
};
