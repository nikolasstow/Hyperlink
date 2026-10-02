/**
 * Keeps the most recent conversations on the device whenever the app opens
 * or comes back, so whichever one is tapped opens on its messages
 * (Conversations.ts). Mounted once, inside the app's context.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "../AppContext";
import { withoutArchived } from "../sessionArchive";
import { fetchSessions } from "../sessions/fetchSessions";
import { preloadConversations } from "./useConversations";

/** The most recent sessions kept on opening: Home's lists and more. */
const RECENT_SESSIONS = 30;

export const ConversationPreloader = (): null => {
  const { address } = useAppContext();
  React.useEffect(() => {
    const preload = (): void => {
      fetchSessions(address)
        .then((sessions) =>
          preloadConversations(
            address,
            withoutArchived(sessions.filter((session) => session.parentID === undefined))
              .slice(0, RECENT_SESSIONS)
              .map((session) => ({ id: session.id, updated: session.time.updated })),
          ),
        )
        .catch((error: unknown) => console.error("[conversations] preloading the recent sessions failed", error));
    };
    preload();
    // Only "background" is a real background; "inactive" flaps constantly.
    let last = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      if (last === "background" && state === "active") preload();
      last = state;
    });
    return () => subscription.remove();
  }, [address]);
  return null;
};
