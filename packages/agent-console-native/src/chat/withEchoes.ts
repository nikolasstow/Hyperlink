/**
 * Command messages as they were typed (CommandEchoes.ts): a message a
 * command made shows its `/name` chip and the arguments, not the command's
 * prompt. Each changed message is made once per message (its identity
 * kept), and a list with none to change is the same list.
 *
 * @internal
 */
import type { Echo } from "../commands/CommandEchoes";
import type { ChatMessage } from "./model";

const shown = new WeakMap<ChatMessage, ChatMessage>();

export const withEchoes = (messages: ReadonlyArray<ChatMessage>, echoes: Readonly<Record<string, Echo>>): ReadonlyArray<ChatMessage> => {
  if (!messages.some((message) => message.role === "user" && echoes[message.id] !== undefined)) return messages;
  return messages.map((message) => {
    const echo = message.role === "user" ? echoes[message.id] : undefined;
    if (echo === undefined) return message;
    const known = shown.get(message);
    if (known !== undefined) return known;
    const view: ChatMessage = { ...message, slash: { name: echo.name, source: "command" }, parts: [{ kind: "text", id: `${message.id}:text`, text: echo.args }] };
    shown.set(message, view);
    return view;
  });
};
