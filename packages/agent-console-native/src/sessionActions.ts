/**
 * Session actions shared across the surfaces that offer them (the chat's More
 * menu, the card long-press context menu), so the behavior can't drift between
 * them — one definition, one place.
 *
 * @internal
 */
import { Alert } from "react-native";
import type { OpencodeClient } from "./client";

/**
 * Prompt for a new session name and apply it via `session.update`. `onRenamed`
 * runs on success with the new title (update a local title, refresh a list, …);
 * failures are surfaced rather than swallowed.
 */
export const promptRenameSession = (
  client: OpencodeClient,
  sessionID: string,
  currentTitle: string,
  onRenamed: (title: string) => void,
): void => {
  Alert.prompt(
    "Rename session",
    undefined,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (text?: string) => {
          const next = (text ?? "").trim();
          if (next === "") return;
          void client.session
            .update({ path: { id: sessionID }, body: { title: next } })
            .then(({ error }) => {
              if (error !== undefined) {
                Alert.alert("Couldn't rename", "The server rejected the new name.");
                return;
              }
              onRenamed(next);
            })
            .catch(() => Alert.alert("Couldn't rename", "Couldn't reach the server."));
        },
      },
    ],
    "plain-text",
    currentTitle,
  );
};

/**
 * Abort the running agent for a session. `onAborted` runs on success (refresh a
 * list, …); failures are surfaced rather than swallowed — the SDK reports HTTP
 * errors on `.error`, so a resolved-but-failed response is checked explicitly.
 */
export const abortSession = (
  client: OpencodeClient,
  sessionID: string,
  onAborted?: () => void,
): void => {
  void client.session
    .abort({ path: { id: sessionID } })
    .then(({ error }) => {
      if (error !== undefined) {
        Alert.alert("Couldn't stop", "The server rejected the stop request.");
        return;
      }
      onAborted?.();
    })
    .catch(() => Alert.alert("Couldn't stop", "Couldn't reach the server."));
};

/**
 * Delete a session, after asking: it cannot be undone. `onDeleted` runs on
 * success (refresh a list, …); failures are surfaced rather than swallowed —
 * the SDK reports HTTP errors on `.error`, so a resolved-but-failed response is
 * checked explicitly.
 */
export const confirmDeleteSession = (
  client: OpencodeClient,
  sessionID: string,
  title: string,
  onDeleted?: () => void,
): void => {
  Alert.alert(`Delete “${title}”?`, "The session and its messages are deleted. This can’t be undone.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: () => {
        void client.session
          .delete({ path: { id: sessionID } })
          .then(({ error }) => {
            if (error !== undefined) {
              Alert.alert("Couldn't delete", "The server rejected the delete.");
              return;
            }
            onDeleted?.();
          })
          .catch(() => Alert.alert("Couldn't delete", "Couldn't reach the server."));
      },
    },
  ]);
};
