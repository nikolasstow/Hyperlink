/**
 * Keeps the most recent conversations on the device whenever the app opens
 * or comes back, so whichever one is tapped opens on its messages
 * (Conversations.ts `keepRecent`). Mounted once, inside the app's context.
 *
 * @internal
 */
import * as React from "react";
import { useAppContext } from "../AppContext";
import { withoutArchived } from "../sessionArchive";
import { keepRecentConversations } from "./useConversations";

export const ConversationPreloader = (): null => {
  const { address } = useAppContext();
  React.useEffect(() => keepRecentConversations(address, withoutArchived), [address]);
  return null;
};
