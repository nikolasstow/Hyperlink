/**
 * Client for the projects and pages the API server keeps (`/projects`,
 * agent-console-protocol `Projects`): the projects, each project's pages, and
 * the URL a page is rendered at with the page SDK (`window.da`) injected.
 *
 * Same conventions as extensionsClient: plain `fetch` with the server's
 * token, `Schema`-decoded responses, a non-2xx surfaced with the server's
 * message.
 *
 * @internal
 */
import { Projects } from "agent-console-protocol";
import { Schema } from "effect";
import { base, request } from "./extensionsClient";

const decodeProjects = Schema.decodeUnknownSync(Schema.Array(Projects.Project));
const decodePages = Schema.decodeUnknownSync(Schema.Array(Projects.PageMeta));

/** Every project, pinned first, then by order and name (the server sorts). */
export const listProjects = (apiBase: string): Promise<ReadonlyArray<Projects.Project>> =>
  request(`${base(apiBase)}${Projects.path}`).then(decodeProjects);

/** A project's pages, by slug. */
export const listPages = (apiBase: string, project: string): Promise<ReadonlyArray<Projects.PageMeta>> =>
  request(`${base(apiBase)}${Projects.path}/${encodeURIComponent(project)}/pages`).then(decodePages);

/** Where the server renders a page as a full document for the app's WebView. */
export const pageViewUrl = (apiBase: string, project: string, slug: string): string =>
  `${base(apiBase)}${Projects.viewPath}?project=${encodeURIComponent(project)}&slug=${encodeURIComponent(slug)}&env=app`;

/** A `da:` link the page SDK hands the app, taken apart. */
export type DaLink =
  | { readonly kind: "page"; readonly project: string; readonly slug: string }
  | { readonly kind: "session"; readonly sessionID: string }
  | { readonly kind: "file"; readonly repo: string; readonly path: string };

/** Read a `da:` link (`da:page:<project>:<slug>`, `da:session:<id>`,
 * `da:file:<repo>:<path>`), or undefined for anything else. */
export const parseDaLink = (href: string): DaLink | undefined => {
  const page = /^da:page:([^:]+):(.+)$/.exec(href);
  if (page?.[1] !== undefined && page[2] !== undefined) return { kind: "page", project: page[1], slug: page[2] };
  const session = /^da:session:(.+)$/.exec(href);
  if (session?.[1] !== undefined) return { kind: "session", sessionID: session[1] };
  const file = /^da:file:([^:]+):(.+)$/.exec(href);
  if (file?.[1] !== undefined && file[2] !== undefined) return { kind: "file", repo: file[1], path: file[2] };
  return undefined;
};

/** A message the page SDK posts to the app over the WebView bridge. */
export const BridgeMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("navigate"),
    href: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("chrome"),
    mode: Schema.Literals(["fullscreen", "framed"]),
  }),
  Schema.Struct({
    type: Schema.Literal("context"),
    context: Schema.Unknown,
  }),
]);
export type BridgeMessage = typeof BridgeMessage.Type;

/** Decode a bridge message from the WebView's `onMessage` data, or undefined
 * when it is not one of ours. */
export const parseBridgeMessage = (data: string): BridgeMessage | undefined => {
  try {
    return Schema.decodeUnknownSync(BridgeMessage)(JSON.parse(data));
  } catch {
    return undefined;
  }
};
