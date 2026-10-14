export * as VcsEvent from "./vcs-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"

export const BranchUpdated = Event.ephemeral({
  type: "vcs.branch.updated",
  schema: {
    branch: optional(Schema.String),
  },
})

export const Definitions = Event.inventory(BranchUpdated)
