export * as ConfigCommand from "./command"

import { Schema } from "effect"
import { optional } from "../schema"
import { ConfigModel } from "./model"

export class Info extends Schema.Class<Info>("Config.Command")({
  template: Schema.String,
  description: Schema.String.pipe(optional),
  agent: Schema.String.pipe(optional),
  model: ConfigModel.Selection.pipe(optional),
  subagent: Schema.Boolean.pipe(optional),
  subtask: Schema.Boolean.annotate({ description: "Deprecated alias for subagent." }).pipe(optional),
}) {}
