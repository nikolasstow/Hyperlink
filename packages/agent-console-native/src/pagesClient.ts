/**
 * Client for plugin pages the app draws natively (`/pages/*` on the Effect API
 * server): a page organized into sections, and a collection with the user's categories and pins
 * beside it.
 *
 * Same conventions as extensionViewsClient: plain `fetch`, `Schema`-decoded
 * responses, a non-2xx surfaced with the server's message. The schemas mirror
 * `packages/agent-console/src/server/extensionHost/protocol.ts` and
 * `collections/state.ts`, the wire contract's source of truth.
 *
 * @internal
 */
import { Schema } from "effect";
import { base, request } from "./extensionsClient";
import { invokeResult, pageKind, type InvokeResult, type TreeRefresh } from "./extensionViewsClient";

const viewAction = Schema.Struct({
  command: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  inline: Schema.Boolean,
  destructive: Schema.optionalKey(Schema.Boolean),
});
export type PageAction = typeof viewAction.Type;

/** What a page is about beyond the workspace (which package); for a
 * collection, `group` and `category` open it on that filter. */
export type PageParams = Readonly<Record<string, string>>;

const pageLink = Schema.Struct({
  page: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: pageKind,
});
export type PageLink = typeof pageLink.Type;

const formField = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["text", "code", "choice", "group"]),
  value: Schema.String,
  placeholder: Schema.optionalKey(Schema.String),
  options: Schema.Array(
    Schema.Struct({
      value: Schema.String,
      label: Schema.String,
    }),
  ),
});
export type FormField = typeof formField.Type;

const formSpec = Schema.Struct({
  command: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  submitTitle: Schema.String,
  fields: Schema.Array(formField),
});
export type FormSpec = typeof formSpec.Type;

const sectionRow = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  mono: Schema.Boolean,
  stacked: Schema.Boolean,
});
export type SectionRow = typeof sectionRow.Type;

const pageBlock = Schema.Union([
  Schema.TaggedStruct("Facts", {
    title: Schema.optionalKey(Schema.String),
    rows: Schema.Array(sectionRow),
    links: Schema.Array(pageLink),
    opens: Schema.optionalKey(pageLink),
  }),
  Schema.TaggedStruct("Link", {
    link: pageLink,
  }),
  Schema.TaggedStruct("Pinned", {
    collection: pageLink,
    title: Schema.String,
    viewAll: Schema.String,
    group: Schema.optionalKey(Schema.String),
    suggestions: Schema.Array(Schema.String),
  }),
  Schema.TaggedStruct("Card", {
    key: Schema.String,
    title: Schema.String,
    icon: Schema.optionalKey(Schema.String),
    rows: Schema.Array(sectionRow),
    opens: Schema.optionalKey(pageLink),
    actions: Schema.Array(viewAction),
  }),
  Schema.TaggedStruct("Actions", {
    key: Schema.String,
    title: Schema.optionalKey(Schema.String),
    actions: Schema.Array(viewAction),
  }),
]);
export type PageBlock = typeof pageBlock.Type;

const pageSections = Schema.Struct({
  title: Schema.String,
  blocks: Schema.Array(pageBlock),
  menu: Schema.Array(formSpec),
  add: Schema.Array(formSpec),
});

/** The block a page's 3-dot menu forms are addressed by. */
export const pageMenuBlock = "menu";
export type PageSections = typeof pageSections.Type;

const collectionGroup = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  resource: Schema.optionalKey(Schema.String),
  actions: Schema.Array(viewAction),
});
export type CollectionGroup = typeof collectionGroup.Type;

const collectionItem = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  name: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  group: Schema.String,
  categories: Schema.Array(Schema.String),
  run: Schema.optionalKey(viewAction),
  open: Schema.optionalKey(viewAction),
  opens: Schema.optionalKey(pageLink),
  actions: Schema.Array(viewAction),
  forms: Schema.Array(formSpec),
});
export type CollectionItem = typeof collectionItem.Type;

const collectionContent = Schema.Struct({
  groups: Schema.Array(collectionGroup),
  items: Schema.Array(collectionItem),
  categories: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      icon: Schema.optionalKey(Schema.String),
    }),
  ),
  groupsTitle: Schema.String,
  search: Schema.optionalKey(
    Schema.Struct({
      placeholder: Schema.String,
      inCollection: Schema.String,
      beyond: Schema.String,
    }),
  ),
  create: Schema.optionalKey(formSpec),
});
export type CollectionContent = typeof collectionContent.Type;

const pin = Schema.Union([
  Schema.TaggedStruct("PinnedItem", {
    id: Schema.String,
    item: Schema.String,
  }),
  Schema.TaggedStruct("PinnedFilter", {
    id: Schema.String,
    name: Schema.optionalKey(Schema.String),
    group: Schema.optionalKey(Schema.String),
    category: Schema.optionalKey(Schema.String),
  }),
]);
export type Pin = typeof pin.Type;
export type PinnedFilter = Extract<Pin, { readonly _tag: "PinnedFilter" }>;

const collectionState = Schema.Struct({
  categories: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
  assignments: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  pins: Schema.Array(pin),
});
export type CollectionState = typeof collectionState.Type;

/** One change to a collection's state (collections/state.ts `CollectionChange`). */
export type CollectionChange =
  | { readonly _tag: "CreateCategory"; readonly name: string }
  | { readonly _tag: "RenameCategory"; readonly id: string; readonly name: string }
  | { readonly _tag: "DeleteCategory"; readonly id: string }
  | { readonly _tag: "Assign"; readonly assignments: Readonly<Record<string, ReadonlyArray<string>>> }
  | { readonly _tag: "PinItem"; readonly item: string }
  | { readonly _tag: "PinFilter"; readonly name?: string; readonly group?: string; readonly category?: string }
  | { readonly _tag: "UpdateFilter"; readonly id: string; readonly name: string; readonly group?: string; readonly category?: string }
  | { readonly _tag: "Unpin"; readonly id: string };

/** What a collection action belongs to. */
export type CollectionTarget = { readonly _tag: "Item"; readonly key: string } | { readonly _tag: "Group"; readonly key: string } | { readonly _tag: "Whole" };

const post = (url: string, body: object) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const fetchSections = async (apiBase: string, workspace: string, page: string, params: PageParams, refresh: TreeRefresh): Promise<PageSections> =>
  Schema.decodeUnknownSync(pageSections)(
    await post(`${base(apiBase)}/pages/sections`, {
      workspace,
      page,
      params,
      refresh,
    }),
  );

export const fetchCollection = async (apiBase: string, workspace: string, page: string, refresh: TreeRefresh): Promise<CollectionContent> =>
  Schema.decodeUnknownSync(collectionContent)(
    await post(`${base(apiBase)}/pages/collection`, {
      workspace,
      page,
      params: {},
      refresh,
    }),
  );

export const fetchCollectionState = async (apiBase: string, workspace: string, page: string): Promise<CollectionState> =>
  Schema.decodeUnknownSync(collectionState)(
    await post(`${base(apiBase)}/pages/collection/state`, {
      workspace,
      page,
    }),
  );

export const changeCollectionState = async (apiBase: string, workspace: string, page: string, change: CollectionChange): Promise<CollectionState> =>
  Schema.decodeUnknownSync(collectionState)(
    await post(`${base(apiBase)}/pages/collection/change`, {
      workspace,
      page,
      change,
    }),
  );

/** Run a collection action (with a form's values) and learn what it asked for. */
export const invokeCollection = async (
  apiBase: string,
  workspace: string,
  page: string,
  target: CollectionTarget,
  command: string,
  values: Readonly<Record<string, string>>,
): Promise<InvokeResult> =>
  Schema.decodeUnknownSync(invokeResult)(
    await post(`${base(apiBase)}/pages/collection/invoke`, {
      workspace,
      page,
      target,
      command,
      values,
    }),
  );

/** Run a page's action (a card's, an actions block's, or a menu form with
 * its values) and learn what it asked for. */
export const invokeSections = async (
  apiBase: string,
  workspace: string,
  page: string,
  params: PageParams,
  block: string,
  command: string,
  values: Readonly<Record<string, string>>,
): Promise<InvokeResult> =>
  Schema.decodeUnknownSync(invokeResult)(
    await post(`${base(apiBase)}/pages/sections/invoke`, {
      workspace,
      page,
      params,
      block,
      command,
      values,
    }),
  );

/** Search beyond a collection (a package registry). */
export const searchCollection = async (apiBase: string, workspace: string, page: string, query: string): Promise<ReadonlyArray<CollectionItem>> =>
  Schema.decodeUnknownSync(Schema.Array(collectionItem))(
    await post(`${base(apiBase)}/pages/collection/search`, {
      workspace,
      page,
      query,
    }),
  );
