export * as EventManifest from "./event-manifest"

import { Schema } from "effect"
import { Agent } from "./agent"
import { Command } from "./command"
import { Config } from "./config"
import { Credential } from "./credential"
import { Durable } from "./durable-event-manifest"
import { Event } from "./event"
import { FileSystem } from "./filesystem"
import { FileSystemV1 } from "./filesystem-v1"
import { Form } from "./form"
import { InstallationEvent } from "./installation-event"
import { Integration } from "./integration"
import { LegacyEventV1 } from "./legacy-event"
import { LspEvent } from "./lsp-event"
import { LocationEvent } from "./location-event"
import { McpEvent } from "./mcp-event"
import { Model } from "./model"
import { ModelsDev } from "./models-dev"
import { Permission } from "./permission"
import { PersistentPty } from "./persistent-pty"
import { Plugin } from "./plugin"
import { Project } from "./project"
import { Provider } from "./provider"
import { Worktree } from "./worktree"
import { Pty } from "./pty"
import { Reference } from "./reference"
import { ServerEvent } from "./server-event"
import { Shell } from "./shell"
import { Skill } from "./skill"
import { SessionCompactionEvent } from "./session-compaction-event"
import { SessionEvent } from "./session-event"
import { SessionStatusEvent } from "./session-status-event"
import { TuiEvent } from "./tui-event"
import { VcsEvent } from "./vcs-event"
import { WorkspaceEvent } from "./workspace-event"
import { WorktreeEvent } from "./worktree-event"
import { WebSearch } from "./websearch"

const coreDefinitions = Event.inventory(...SessionEvent.Definitions)

const foundationDefinitions = Event.inventory(
  ...LocationEvent.Definitions,
  ...ModelsDev.Event.Definitions,
  ...Credential.Event.Definitions,
  ...Integration.Event.Definitions,
  ...Provider.Event.Definitions,
  ...Model.Event.Definitions,
  ...Agent.Event.Definitions,
  ...coreDefinitions,
)

const featureDefinitions = Event.inventory(
  ...FileSystem.Event.Definitions,
  ...Reference.Event.Definitions,
  ...Permission.Event.Definitions,
  ...Plugin.Event.Definitions,
  ...Project.Event.Definitions,
  ...Worktree.Event.Definitions,
  ...Command.Event.Definitions,
  ...Config.Event.Definitions,
  ...Skill.Event.Definitions,
  ...Pty.Event.Definitions,
  ...PersistentPty.Event.Definitions,
  ...Shell.Event.Definitions,
  ...Form.Event.Definitions,
  ...WebSearch.Event.Definitions,
)

export const ServerDefinitions = Event.inventory(
  ...foundationDefinitions,
  ...featureDefinitions,
  // Current events the TUI consumes from the public stream.
  ...SessionStatusEvent.Definitions,
  ...TuiEvent.Definitions,
  ...InstallationEvent.Definitions,
  ...VcsEvent.Definitions,
  McpEvent.StatusChanged,
  McpEvent.ResourcesChanged,
)
export const Server = Event.latest(ServerDefinitions)
export type ServerEvent = Schema.Schema.Type<(typeof ServerDefinitions)[number]>
export const isServer = (event: { readonly type: string }): event is ServerEvent => Server.has(event.type)

export const Definitions = Event.inventory(
  ...foundationDefinitions,
  ...InstallationEvent.Definitions,
  ...featureDefinitions,
  ...LspEvent.Definitions,
  ...TuiEvent.Definitions,
  ...McpEvent.Definitions,
  ...LegacyEventV1.Definitions,
  ...FileSystemV1.Event.Definitions,
  ...SessionStatusEvent.Definitions,
  ...SessionCompactionEvent.Definitions,
  ...VcsEvent.Definitions,
  ...WorkspaceEvent.Definitions,
  ...WorktreeEvent.Definitions,
  ...ServerEvent.Definitions,
)
export const Latest = Event.latest(Definitions)
export { Durable }
