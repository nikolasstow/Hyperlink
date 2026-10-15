export * as Snapshot from "./snapshot"

import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("Snapshot.ID"), Schema.annotate({ identifier: "Snapshot.ID" }))
export type ID = typeof ID.Type
