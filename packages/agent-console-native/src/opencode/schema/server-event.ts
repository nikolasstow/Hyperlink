export * as ServerEvent from "./server-event"

import { Event } from "./event"

export const Connected = Event.ephemeral({ type: "server.connected", schema: {} })
export const Disposed = Event.ephemeral({ type: "global.disposed", schema: {} })

export const Definitions = Event.inventory(Connected, Disposed)
