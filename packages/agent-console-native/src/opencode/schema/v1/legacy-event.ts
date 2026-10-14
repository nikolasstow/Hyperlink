export * as LegacyEventV1 from "./legacy-event"

import { Schema } from "effect"
import { ephemeral, inventory } from "../event"
import { SessionID } from "../session-id"
import { SessionV1 } from "./session"

export const CommandExecuted = ephemeral({
  type: "command.executed",
  schema: {
    name: Schema.String,
    sessionID: SessionID,
    arguments: Schema.String,
    messageID: SessionV1.MessageID,
  },
})

export const Definitions = inventory(CommandExecuted)
