export * as ConfigMCP from "./mcp"

import { Schema } from "effect"
import { Mcp } from "../mcp"
import { optional } from "../schema"

export const Timeout = Mcp.TimeoutConfig
export type Timeout = Mcp.TimeoutConfig
export const Local = Mcp.LocalConfig
export type Local = Mcp.LocalConfig
export const OAuth = Mcp.OAuthConfig
export type OAuth = Mcp.OAuthConfig
export const Remote = Mcp.RemoteConfig
export type Remote = Mcp.RemoteConfig
export const Server = Mcp.ServerConfig
export const Protocol = Mcp.Protocol
export type Protocol = Mcp.Protocol

export class Info extends Schema.Class<Info>("Config.MCP")({
  timeout: Timeout.pipe(optional),
  servers: Schema.Record(Schema.String, Server).pipe(optional),
}) {}
