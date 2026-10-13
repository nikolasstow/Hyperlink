/**
 * A chat message's parts rendered — text as markdown, reasoning and tool calls
 * as their own blocks. Shared by MessageBubble (the full-screen chat) and the
 * Dubz in-window chat, so both render the same way and improvements to any part
 * reach both (single source of truth).
 *
 * `textWidth` is the width markdown/HTML lays out in (its container's inside).
 *
 * @internal
 */
import * as React from "react";
import { Markdown } from "../Markdown";
import { ReasoningBlock } from "../ReasoningBlock";
import { ToolCallBubble } from "../ToolCallBubble";
import type { ChatPart } from "./model";

export const MessageParts = (props: { readonly parts: ReadonlyArray<ChatPart>; readonly textWidth: number }): React.ReactElement => (
  <>
    {props.parts.map((part) => {
      switch (part.kind) {
        case "text":
          return <Markdown key={part.id} text={part.text} width={props.textWidth} />;
        case "reasoning":
          return <ReasoningBlock key={part.id} part={part} />;
        case "tool":
          return <ToolCallBubble key={part.id} part={part} />;
      }
    })}
  </>
);
