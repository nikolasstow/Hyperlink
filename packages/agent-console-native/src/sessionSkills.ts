/**
 * The skills active in a session, newest first, each once: the ones you sent
 * (a leading `/skill`, or a skill chip with a message) and the ones the agent
 * loaded itself (its `skill` tool). opencode keeps an active skill in the
 * session's context, so these show over the bar beside its files
 * (FileChips.tsx), to look at or send again.
 *
 * @internal
 */
import type { ChatMessage } from "./chat/model";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The skills a message brought in, in order. */
const skillsOf = (message: ChatMessage): ReadonlyArray<string> =>
  message.role === "user"
    ? [...(message.slash?.source === "skill" ? [message.slash.name] : []), ...(message.skills ?? [])]
    : message.parts.flatMap((part) => (part.kind === "tool" && part.name === "skill" && isRecord(part.input) && typeof part.input.id === "string" ? [part.input.id] : []));

/** The session's active skills, by id, newest first. */
export const sessionSkills = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  for (const message of [...messages].reverse()) {
    for (const id of [...skillsOf(message)].reverse()) seen.add(id);
  }
  return [...seen];
};
