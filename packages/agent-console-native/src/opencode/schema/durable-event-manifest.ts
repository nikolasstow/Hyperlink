export * as DurableEventManifest from "./durable-event-manifest"

import { Event } from "./event"
import { Worktree } from "./worktree"
import { SessionEvent } from "./session-event"

export const Durable = Event.durableMap([...SessionEvent.DurableDefinitions, Worktree.Event.Resolved])
