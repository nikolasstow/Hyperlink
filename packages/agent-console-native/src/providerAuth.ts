/**
 * The provider sign-in data layer — everything `opencode auth login` does in
 * the TUI, as functions the Providers screen can call.
 *
 * Two rules shape this file. First, the SDK client does **not** throw on HTTP
 * errors: every call returns `{ data, error }`, and `error` is typed `unknown`
 * on the endpoints that declare no error schema. So each call checks both
 * fields and turns the pair into an explicit result union — a failure is never
 * a silently empty list. Second, credentials live on the opencode server the
 * app is pointed at, not on the device: signing in here authenticates that
 * server, which is why there is nothing to persist locally.
 *
 * The pure parts (row building, grouping, response narrowing, code/URL
 * validation) are separated from the calls so they can be unit-tested without
 * a server — see `providerAuth.test.ts`.
 *
 * @internal
 */
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opencode-ai/sdk";
import type { OpencodeClient } from "./client";

export type { ProviderAuthAuthorization, ProviderAuthMethod };

/** The auth-method menu keyed by provider ID — `client.provider.auth()`. */
export type ProviderAuthMenu = Readonly<Record<string, ReadonlyArray<ProviderAuthMethod>>>;

/** One entry of `client.provider.list().data.all`, narrowed to what's used. */
export type ProviderCatalogEntry = {
  readonly id: string;
  readonly name: string;
  /** Environment variables that configure this provider without a sign-in. */
  readonly env: ReadonlyArray<string>;
};

export type ProviderRow = {
  readonly id: string;
  readonly name: string;
  readonly signedIn: boolean;
  readonly env: ReadonlyArray<string>;
  /** Empty when the provider has no interactive sign-in (env/config only). */
  readonly methods: ReadonlyArray<ProviderAuthMethod>;
};

/* ------------------------------------------------------------------ *
 * Error narrowing
 * ------------------------------------------------------------------ */

/** Same narrowing `push.ts` uses for unknown notification payloads. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads `key` off an unknown value. A narrowing to `Record<string, unknown>`,
 * where every read is itself `unknown`, so nothing here asserts a shape the
 * value might not have.
 */
const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/**
 * A human-readable message for whatever came back in `.error`. opencode's
 * documented failure shape is `{ name, data: { message } }` (BadRequestError),
 * but the error slot is typed `unknown` on several endpoints and a transport
 * failure surfaces as a plain `Error`, so all three are read before falling
 * back. The fallback is a real sentence, never an empty string.
 */
export const authErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return nonEmptyString(error.message) ?? fallback;
  return (
    nonEmptyString(field(field(error, "data"), "message")) ??
    nonEmptyString(field(error, "message")) ??
    nonEmptyString(error) ??
    fallback
  );
};

/* ------------------------------------------------------------------ *
 * Response narrowing
 * ------------------------------------------------------------------ */

/**
 * `auth.set` and `oauth.callback` both answer `200 boolean`. The three cases
 * are genuinely different and the caller decides what each means: a `false`
 * body is the server saying "not authenticated" — for a pasted code that is a
 * rejection, for the polled `auto` flow it just means "not yet".
 */
export type CallOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "rejected" }
  | { readonly kind: "failed"; readonly message: string };

/** The `{ data, error }` pair every SDK call resolves to, for a boolean body. */
export type BooleanCallResult = {
  readonly data: boolean | undefined;
  readonly error: unknown;
};

export const booleanCallOutcome = (result: BooleanCallResult, fallback: string): CallOutcome => {
  if (result.error !== undefined) return { kind: "failed", message: authErrorMessage(result.error, fallback) };
  if (result.data === true) return { kind: "ok" };
  if (result.data === false) return { kind: "rejected" };
  return { kind: "failed", message: `${fallback} The server sent an empty response.` };
};

/* ------------------------------------------------------------------ *
 * Method selection and input validation
 * ------------------------------------------------------------------ */

/**
 * `provider.auth()` is a plain JSON map, so a missing provider reads as
 * `undefined` at runtime even though the SDK's index signature types it as
 * present. Checked with `hasOwnProperty` rather than a `?? []` the type system
 * believes is dead code.
 */
export const methodsFor = (menu: ProviderAuthMenu, providerID: string): ReadonlyArray<ProviderAuthMethod> => {
  if (!Object.prototype.hasOwnProperty.call(menu, providerID)) return [];
  return menu[providerID];
};

/**
 * A method's index in this array *is* the `method` number the OAuth calls
 * take, so the index is never re-derived from the label.
 */
export const methodAt = (
  methods: ReadonlyArray<ProviderAuthMethod>,
  index: number,
): ProviderAuthMethod | undefined =>
  Number.isInteger(index) && index >= 0 && index < methods.length ? methods[index] : undefined;

/** One method means no menu — go straight into it. Several means pick first. */
export const initialMethodIndex = (methods: ReadonlyArray<ProviderAuthMethod>): number | undefined =>
  methods.length === 1 ? 0 : undefined;

/**
 * Pasted codes arrive with the whitespace and newlines a clipboard round-trip
 * adds. Only surrounding whitespace is stripped — the interior is left alone,
 * since some providers hand back a composite value (Anthropic's `code#state`)
 * that the server needs verbatim.
 */
export const normalizeAuthCode = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const normalizeApiKey = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * `Linking.openURL` hands the string to iOS, which will happily dispatch a
 * non-web scheme to another app. An authorization URL that isn't http(s) is a
 * server bug, and is reported rather than opened.
 */
export const isOpenableUrl = (url: string): boolean => url.startsWith("http://") || url.startsWith("https://");

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

/**
 * `provider.list()` is the full catalog; a provider counts as signed in when
 * either `connected` (same list) or `config.providers()` names it. Both are
 * consulted because they answer slightly different questions — `connected` is
 * what the server can route to right now, `config.providers()` is what it has
 * credentials or configuration for.
 */
export const buildProviderRows = (input: {
  readonly all: ReadonlyArray<ProviderCatalogEntry>;
  readonly connected: ReadonlyArray<string>;
  readonly configured: ReadonlyArray<{ readonly id: string }>;
  readonly menu: ProviderAuthMenu;
}): ReadonlyArray<ProviderRow> => {
  const signedIn = new Set(input.connected);
  for (const provider of input.configured) signedIn.add(provider.id);

  const rows = input.all.map(
    (entry): ProviderRow => ({
      id: entry.id,
      name: entry.name,
      signedIn: signedIn.has(entry.id),
      env: entry.env,
      methods: methodsFor(input.menu, entry.id),
    }),
  );

  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

export type ProviderListItem =
  | {
      readonly kind: "section";
      readonly key: string;
      readonly title: string;
      readonly hint: string | undefined;
    }
  | {
      readonly kind: "provider";
      readonly key: string;
      readonly row: ProviderRow;
      /** First/last in its section — the grouped-card corner rounding. */
      readonly first: boolean;
      readonly last: boolean;
    };

const OTHER_HINT = "Configured with an environment variable or in opencode's own config, not from here.";

/**
 * Three groups, because the catalog runs to hundreds of providers and only a
 * handful of them can actually be signed into from an app: what you already
 * have, what you can sign into, and the rest. Ordering is the only concession
 * to that size — every provider the server reports is still listed.
 */
export const toListItems = (rows: ReadonlyArray<ProviderRow>): ReadonlyArray<ProviderListItem> => {
  const groups = [
    {
      key: "signed-in",
      title: "Signed in",
      hint: undefined,
      rows: rows.filter((row) => row.signedIn),
    },
    {
      key: "available",
      title: "Sign in",
      hint: undefined,
      rows: rows.filter((row) => !row.signedIn && row.methods.length > 0),
    },
    {
      key: "other",
      title: "Other providers",
      hint: OTHER_HINT,
      rows: rows.filter((row) => !row.signedIn && row.methods.length === 0),
    },
  ];

  const items: Array<ProviderListItem> = [];
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    items.push({
      kind: "section",
      key: `section:${group.key}`,
      title: group.title,
      hint: group.hint,
    });
    group.rows.forEach((row, index) => {
      items.push({
        kind: "provider",
        key: `provider:${group.key}:${row.id}`,
        row,
        first: index === 0,
        last: index === group.rows.length - 1,
      });
    });
  }
  return items;
};

/* ------------------------------------------------------------------ *
 * Calls
 * ------------------------------------------------------------------ */

export type ProvidersLoad =
  | { readonly ok: true; readonly rows: ReadonlyArray<ProviderRow> }
  | { readonly ok: false; readonly message: string };

/**
 * The three reads the list needs, in parallel. Each is checked for `.error`
 * and for a missing body separately: `error` is `unknown` on these endpoints,
 * so it cannot discriminate the result union on its own, and an absent `data`
 * has to be reported rather than treated as "no providers".
 */
export const loadProviders = async (client: OpencodeClient): Promise<ProvidersLoad> => {
  const [catalog, configured, menu] = await Promise.all([
    client.provider.list(),
    client.config.providers(),
    client.provider.auth(),
  ]);

  if (catalog.error !== undefined) {
    return { ok: false, message: authErrorMessage(catalog.error, "Could not list providers.") };
  }
  if (catalog.data === undefined) return { ok: false, message: "The server sent no provider list." };

  if (configured.error !== undefined) {
    return { ok: false, message: authErrorMessage(configured.error, "Could not read configured providers.") };
  }
  if (configured.data === undefined) return { ok: false, message: "The server sent no configured-provider list." };

  if (menu.error !== undefined) {
    return { ok: false, message: authErrorMessage(menu.error, "Could not read provider sign-in methods.") };
  }
  if (menu.data === undefined) return { ok: false, message: "The server sent no sign-in methods." };

  return {
    ok: true,
    rows: buildProviderRows({
      all: catalog.data.all,
      connected: catalog.data.connected,
      configured: configured.data.providers,
      menu: menu.data,
    }),
  };
};

export const signInWithApiKey = async (
  client: OpencodeClient,
  providerID: string,
  key: string,
): Promise<CallOutcome> => {
  const result = await client.auth.set({
    path: { id: providerID },
    body: {
      type: "api",
      key,
    },
  });
  return booleanCallOutcome(result, "Could not save the API key.");
};

export type OauthStart =
  | { readonly ok: true; readonly authorization: ProviderAuthAuthorization }
  | { readonly ok: false; readonly message: string };

export const startOauth = async (
  client: OpencodeClient,
  providerID: string,
  method: number,
): Promise<OauthStart> => {
  const result = await client.provider.oauth.authorize({
    path: { id: providerID },
    body: { method },
  });

  if (result.error !== undefined) {
    return { ok: false, message: authErrorMessage(result.error, "Could not start the sign-in.") };
  }
  if (result.data === undefined) return { ok: false, message: "The server sent no authorization URL." };
  if (!isOpenableUrl(result.data.url)) {
    return { ok: false, message: `The server sent a sign-in URL this app cannot open: ${result.data.url}` };
  }
  return { ok: true, authorization: result.data };
};

/**
 * Completes an OAuth sign-in. `code` is the pasted value for the `code` flow
 * and `undefined` for the polled `auto` flow — `JSON.stringify` drops an
 * `undefined` field, so the same body shape sends `{ method }` alone, which is
 * exactly what the `auto` flow expects.
 */
export const completeOauth = async (
  client: OpencodeClient,
  providerID: string,
  method: number,
  code: string | undefined,
): Promise<CallOutcome> => {
  const result = await client.provider.oauth.callback({
    path: { id: providerID },
    body: {
      method,
      code,
    },
  });
  return booleanCallOutcome(result, "Could not complete the sign-in.");
};

/** How often the `auto` flow re-asks the server whether authorization landed. */
export const OAUTH_POLL_INTERVAL_MS = 2_000;
/** How long it keeps asking before giving up rather than spinning forever. */
export const OAUTH_POLL_TIMEOUT_MS = 5 * 60_000;

export const pollExpired = (startedAt: number, now: number): boolean =>
  now - startedAt >= OAUTH_POLL_TIMEOUT_MS;
