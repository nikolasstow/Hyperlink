export * as LocationEvent from "./location-event"

import { ephemeral, inventory } from "./event"

/** The location's cached services were shut down; clients must revalidate its reads. */
export const Shutdown = ephemeral({ type: "location.shutdown", schema: {} })

export const Definitions = inventory(Shutdown)
