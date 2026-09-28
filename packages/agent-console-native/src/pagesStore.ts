/**
 * Plugin pages (sectionPages and collections), prefetched and cached like
 * extension views, so no page waits on the host.
 *
 * When a workspace's views load (extensionViewsStore), each sectioned and
 * collection page in its menu is fetched here, and a page's linked pages
 * after it. Screens render from here at once and revalidate behind it.
 *
 * A collection is two things: the plugin's items, and the user's categories
 * and pins, which only change through `changeCollection` (and come back from
 * the server whole, so what is shown is always what was saved).
 *
 * @internal
 */
import * as React from "react";
import type { Load } from "./extensionViewsStore";
import type { PageKind, TreeRefresh } from "./extensionViewsClient";
import {
  changeCollectionState,
  fetchCollection,
  fetchCollectionState,
  fetchSections,
  type CollectionChange,
  type CollectionContent,
  type CollectionState,
  type PageLink,
  type PageParams,
  type PageSections,
} from "./pagesClient";

const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
const inflight = new Map<string, Promise<void>>();

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Loads by `workspace page`, one map per kind of thing. */
interface Cache<A> {
  readonly get: (key: string) => Load<A> | undefined;
  readonly set: (key: string, load: Load<A>) => void;
}

const makeCache = <A,>(): Cache<A> => {
  let entries: ReadonlyMap<string, Load<A>> = new Map();
  return {
    get: (key) => entries.get(key),
    set: (key, load) => {
      entries = new Map([...entries, [key, load]]);
      emit();
    },
  };
};

const sectionPages = makeCache<PageSections>();
const contents = makeCache<CollectionContent>();
const states = makeCache<CollectionState>();

const keyOf = (workspace: string, page: string): string => `${workspace} ${page}`;

const once = (key: string, run: () => Promise<void>): Promise<void> => {
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const started = run().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
};

/** Fetch into a cache. With a value already there, it stays on screen while
 * this runs, and a failure is attached to it instead of replacing it. Calls
 * with the same `request` share one fetch. */
const loadInto = <A,>(cache: Cache<A>, key: string, request: string, fetch: () => Promise<A>): Promise<void> =>
  once(request, async () => {
    const current = cache.get(key);
    cache.set(key, current?.kind === "ready" ? { ...current, refreshing: true } : { kind: "loading" });
    try {
      cache.set(key, { kind: "ready", value: await fetch(), refreshing: false });
    } catch (error: unknown) {
      const latest = cache.get(key);
      cache.set(
        key,
        latest?.kind === "ready" ? { kind: "ready", value: latest.value, refreshing: false, error: messageOf(error) } : { kind: "failed", message: messageOf(error) },
      );
    }
  });

/** A collection's items and its state, together. */
export const loadCollection = (apiBase: string, workspace: string, page: string, refresh: TreeRefresh): Promise<void> => {
  const key = keyOf(workspace, page);
  return once(`collection ${key} ${refresh}`, async () => {
    await Promise.all([
      loadInto(contents, key, `content ${key} ${refresh}`, () => fetchCollection(apiBase, workspace, page, refresh)),
      loadInto(states, key, `state ${key}`, () => fetchCollectionState(apiBase, workspace, page)),
    ]);
  });
};

/** A page's cache key: its workspace, id and params, the params in any
 * order being the same page. */
const sectionsKey = (workspace: string, page: string, params: PageParams): string =>
  `${keyOf(workspace, page)} ${Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join("&")}`;

/** A page organized into blocks, then the pages its blocks open (its
 * buttons, pins and cards), so they are warm before a tap. */
export const loadSections = (apiBase: string, workspace: string, page: string, params: PageParams, refresh: TreeRefresh): Promise<void> => {
  const key = sectionsKey(workspace, page, params);
  return once(`sections ${key} ${refresh}`, async () => {
    await loadInto(sectionPages, key, `fetch sections ${key} ${refresh}`, () => fetchSections(apiBase, workspace, page, params, refresh));
    const loaded = sectionPages.get(key);
    if (loaded?.kind !== "ready") return;
    const linked = loaded.value.blocks.flatMap((block): ReadonlyArray<PageLink> =>
      block._tag === "Facts"
        ? block.links
        : block._tag === "Link"
          ? [block.link]
          : block._tag === "Pinned"
            ? [block.collection]
            : block._tag === "Card" && block.opens !== undefined
              ? [block.opens]
              : [],
    );
    await Promise.all(linked.map((link) => prefetchLink(apiBase, workspace, link)));
  });
};

/** Warm the page a link opens. A page opened with params warms only its
 * content, not what it links to in turn, so warming stays one level deep. */
const prefetchLink = (apiBase: string, workspace: string, link: PageLink): Promise<void> =>
  link.kind === "collection"
    ? loadCollection(apiBase, workspace, link.page, "none")
    : link.kind === "sections"
      ? loadInto(sectionPages, sectionsKey(workspace, link.page, link.params), `fetch sections ${sectionsKey(workspace, link.page, link.params)} none`, () =>
          fetchSections(apiBase, workspace, link.page, link.params, "none"),
        )
      : Promise.resolve();

/** Bring a menu page into the cache, if it is one kept here. */
export const prefetchPage = (apiBase: string, workspace: string, page: string, kind: PageKind): Promise<void> =>
  kind === "sections" ? loadSections(apiBase, workspace, page, {}, "none") : kind === "collection" ? loadCollection(apiBase, workspace, page, "none") : Promise.resolve();

/**
 * Change a collection's state on the server; the state it answers with
 * replaces what is shown. Rejects with the server's message, for the caller
 * to show.
 */
export const changeCollection = async (apiBase: string, workspace: string, page: string, change: CollectionChange): Promise<CollectionState> => {
  const next = await changeCollectionState(apiBase, workspace, page, change);
  states.set(keyOf(workspace, page), { kind: "ready", value: next, refreshing: false });
  return next;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const loading: { readonly kind: "loading" } = { kind: "loading" };

export const useSections = (workspace: string, page: string, params: PageParams): Load<PageSections> =>
  React.useSyncExternalStore(subscribe, () => sectionPages.get(sectionsKey(workspace, page, params)) ?? loading);

/** A collection with its state: ready once both are, failed if either is. */
export interface CollectionData {
  readonly content: CollectionContent;
  readonly state: CollectionState;
}

export const useCollection = (workspace: string, page: string): Load<CollectionData> => {
  const content = React.useSyncExternalStore(subscribe, () => contents.get(keyOf(workspace, page)) ?? loading);
  const state = React.useSyncExternalStore(subscribe, () => states.get(keyOf(workspace, page)) ?? loading);
  return React.useMemo((): Load<CollectionData> => {
    if (content.kind === "failed") return content;
    if (state.kind === "failed") return state;
    if (content.kind === "loading" || state.kind === "loading") return loading;
    const error = [content.error, state.error].filter((message) => message !== undefined).join("; ");
    return {
      kind: "ready",
      value: {
        content: content.value,
        state: state.value,
      },
      refreshing: content.refreshing || state.refreshing,
      ...(error.length === 0 ? {} : { error }),
    };
  }, [content, state]);
};
