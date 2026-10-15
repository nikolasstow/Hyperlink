export * as Command from "./command"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event"
import { optional } from "./schema"

const Updated = ephemeral({ type: "command.updated", schema: {} })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Command.Info" })

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
