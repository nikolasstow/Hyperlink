export * as ConfigReference from "./reference"

import { Schema } from "effect"
import { optional } from "../schema"

export class Git extends Schema.Class<Git>("Config.Reference.Git")({
  repository: Schema.String,
  branch: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}) {}

export class Local extends Schema.Class<Local>("Config.Reference.Local")({
  path: Schema.String,
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}) {}

export const Entry = Schema.Union([Schema.String, Git, Local])
export type Entry = typeof Entry.Type

export const Info = Schema.Record(Schema.String, Entry)
export type Info = typeof Info.Type
