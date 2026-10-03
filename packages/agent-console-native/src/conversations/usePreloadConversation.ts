/**
 * For a button that opens a session: keeps that session's newest messages on
 * the device while the button is on screen, so the chat opens on them. The
 * button owns it; the page it sits on does not need to know (again whenever
 * the session changes on the server).
 *
 * @internal
 */
import * as React from "react";
import { useAppContext } from "../AppContext";
import { preloadConversations } from "./useConversations";

export const usePreloadConversation = (sessionID: string, updated: number, title: string): void => {
  const { address } = useAppContext();
  React.useEffect(() => {
    preloadConversations(address, [{ id: sessionID, updated, title }]).catch((error: unknown) =>
      console.error(`[conversations] preloading ${sessionID} failed`, error),
    );
  }, [address, sessionID, updated, title]);
};
