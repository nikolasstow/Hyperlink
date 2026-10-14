/**
 * Session actions shared across the surfaces that offer them (the chat's More
 * menu, the card long-press context menu), so the behavior can't drift between
 * them — one definition, one place.
 *
 * @internal
 */
import { Alert } from "react-native";
import { runApp } from "./effect/runtime";
import { SessionID } from "./opencode/schema/session-id";
import type { ServerAddress } from "./opencode/serverAddress";
import { interruptSession, removeSession, renameSession } from "./sessions/sessionCommands";

/** Says a failed action, and logs why. */
const failed = (title: string) => (error: unknown) => {
  console.error(`[sessions] ${title}`, error);
  Alert.alert(title, error instanceof Error ? error.message : "The server could not do it.");
};

/**
 * Prompt for a new session name and apply it (`session.update`). `onRenamed`
 * runs on success with the new title (update a local title, refresh a list, …);
 * failures are surfaced rather than swallowed.
 */
export const promptRenameSession = (
  server: ServerAddress,
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
          runApp(renameSession(server, SessionID.make(sessionID), next)).then(() => onRenamed(next), failed("Couldn't rename"));
        },
      },
    ],
    "plain-text",
    currentTitle,
  );
};

/**
 * Abort the running agent for a session. `onAborted` runs on success (refresh a
 * list, …); failures are surfaced rather than swallowed.
 */
export const abortSession = (
  server: ServerAddress,
  sessionID: string,
  onAborted?: () => void,
): void => {
  runApp(interruptSession(server, SessionID.make(sessionID))).then(() => onAborted?.(), failed("Couldn't stop"));
};

/**
 * Delete a session, after asking: it cannot be undone. `onDeleted` runs on
 * success (refresh a list, …); failures are surfaced rather than swallowed.
 */
export const confirmDeleteSession = (
  server: ServerAddress,
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
        runApp(removeSession(server, SessionID.make(sessionID))).then(() => onDeleted?.(), failed("Couldn't delete"));
      },
    },
  ]);
};
