export * as ConfigWebSearch from "./websearch"

import { Schema } from "effect"
import { WebSearch } from "../websearch"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([
    Schema.Literal("random").annotate({
      description:
        "Reuse a randomly selected provider until it is rate limited, then switch to another available provider.",
    }),
    WebSearch.ID,
  ]),
}) {}

export const Selection = Schema.Union([Schema.Literal(false), Info])
export type Selection = typeof Selection.Type
