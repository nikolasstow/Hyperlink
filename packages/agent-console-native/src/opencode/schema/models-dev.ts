export * as ModelsDev from "./models-dev"

import { ephemeral, inventory } from "./event"

const Refreshed = ephemeral({
  type: "models-dev.refreshed",
  schema: {},
})
export const Event = { Refreshed, Definitions: inventory(Refreshed) }
