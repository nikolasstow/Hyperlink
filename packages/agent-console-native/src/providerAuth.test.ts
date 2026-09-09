/**
 * Pure-logic coverage for the provider sign-in data layer. Everything here
 * runs without a server: the SDK-shaped values are hand-built so the
 * narrowing, grouping and validation are exercised on exactly the payloads
 * opencode documents.
 */
import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  booleanCallOutcome,
  buildProviderRows,
  initialMethodIndex,
  isOpenableUrl,
  methodAt,
  methodsFor,
  normalizeApiKey,
  normalizeAuthCode,
  OAUTH_POLL_TIMEOUT_MS,
  pollExpired,
  toListItems,
  type ProviderAuthMenu,
  type ProviderRow,
} from "./providerAuth";

const row = (over: Partial<ProviderRow> & Pick<ProviderRow, "id" | "name">): ProviderRow => ({
  signedIn: false,
  env: [],
  methods: [],
  ...over,
});

describe("authErrorMessage", () => {
  it("reads opencode's BadRequestError shape", () => {
    const error = {
      name: "BadRequest",
      data: {
        message: "unknown provider",
        kind: "Params",
      },
    };
    expect(authErrorMessage(error, "fallback")).toBe("unknown provider");
  });

  it("reads a transport Error's message", () => {
    expect(authErrorMessage(new Error("Network request failed"), "fallback")).toBe("Network request failed");
  });

  it("reads a bare { message } body", () => {
    expect(authErrorMessage({ message: "nope" }, "fallback")).toBe("nope");
  });

  it("reads a plain string error", () => {
    expect(authErrorMessage("  boom  ", "fallback")).toBe("boom");
  });

  it("falls back for shapes it cannot read, never to an empty string", () => {
    expect(authErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(authErrorMessage(null, "fallback")).toBe("fallback");
    expect(authErrorMessage({}, "fallback")).toBe("fallback");
    expect(authErrorMessage({ data: { message: "   " } }, "fallback")).toBe("fallback");
    expect(authErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
  });
});

describe("booleanCallOutcome", () => {
  it("treats a true body as success", () => {
    expect(booleanCallOutcome({ data: true, error: undefined }, "fallback")).toEqual({ kind: "ok" });
  });

  it("treats a false body as a rejection, not a failure", () => {
    expect(booleanCallOutcome({ data: false, error: undefined }, "fallback")).toEqual({ kind: "rejected" });
  });

  it("surfaces an error body ahead of the data slot", () => {
    const result = booleanCallOutcome(
      { data: undefined, error: { name: "BadRequest", data: { message: "bad code" } } },
      "fallback",
    );
    expect(result).toEqual({ kind: "failed", message: "bad code" });
  });

  it("reports an empty response rather than defaulting to success", () => {
    const result = booleanCallOutcome({ data: undefined, error: undefined }, "Could not save.");
    expect(result).toEqual({ kind: "failed", message: "Could not save. The server sent an empty response." });
  });
});

describe("methodsFor", () => {
  const menu: ProviderAuthMenu = {
    anthropic: [
      { type: "oauth", label: "Claude Pro/Max" },
      { type: "api", label: "API key" },
    ],
  };

  it("returns the provider's methods in server order", () => {
    expect(methodsFor(menu, "anthropic").map((m) => m.label)).toEqual(["Claude Pro/Max", "API key"]);
  });

  it("returns empty for a provider absent from the menu", () => {
    expect(methodsFor(menu, "openai")).toEqual([]);
  });

  it("does not pick up inherited Object.prototype keys", () => {
    expect(methodsFor(menu, "constructor")).toEqual([]);
    expect(methodsFor(menu, "toString")).toEqual([]);
  });
});

describe("methodAt", () => {
  const methods = [
    { type: "oauth", label: "OAuth" },
    { type: "api", label: "API key" },
  ] as const;

  it("resolves an index to the method at that position", () => {
    expect(methodAt(methods, 0)?.label).toBe("OAuth");
    expect(methodAt(methods, 1)?.label).toBe("API key");
  });

  it("rejects out-of-range and non-integer indices", () => {
    expect(methodAt(methods, -1)).toBeUndefined();
    expect(methodAt(methods, 2)).toBeUndefined();
    expect(methodAt(methods, 0.5)).toBeUndefined();
    expect(methodAt(methods, Number.NaN)).toBeUndefined();
  });
});

describe("initialMethodIndex", () => {
  it("skips the menu when there is exactly one method", () => {
    expect(initialMethodIndex([{ type: "api", label: "API key" }])).toBe(0);
  });

  it("shows the menu for zero or several methods", () => {
    expect(initialMethodIndex([])).toBeUndefined();
    expect(
      initialMethodIndex([
        { type: "oauth", label: "OAuth" },
        { type: "api", label: "API key" },
      ]),
    ).toBeUndefined();
  });
});

describe("normalizeAuthCode / normalizeApiKey", () => {
  it("strips the whitespace a clipboard round-trip adds", () => {
    expect(normalizeAuthCode("  abc123\n")).toBe("abc123");
    expect(normalizeApiKey("\tsk-ant-xyz  ")).toBe("sk-ant-xyz");
  });

  it("keeps a composite code intact", () => {
    expect(normalizeAuthCode(" ac_123#state_456 ")).toBe("ac_123#state_456");
  });

  it("rejects blank input", () => {
    expect(normalizeAuthCode("")).toBeUndefined();
    expect(normalizeAuthCode("   \n ")).toBeUndefined();
    expect(normalizeApiKey("  ")).toBeUndefined();
  });
});

describe("isOpenableUrl", () => {
  it("accepts the http(s) URLs an authorize response returns", () => {
    expect(isOpenableUrl("https://claude.ai/oauth/authorize?x=1")).toBe(true);
    expect(isOpenableUrl("http://localhost:4096/auth")).toBe(true);
  });

  it("rejects anything that would dispatch to another app", () => {
    expect(isOpenableUrl("opencode://callback")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("")).toBe(false);
  });
});

describe("buildProviderRows", () => {
  const menu: ProviderAuthMenu = {
    anthropic: [{ type: "oauth", label: "Claude Pro/Max" }],
    openai: [{ type: "api", label: "API key" }],
  };

  const all = [
    { id: "openai", name: "OpenAI", env: ["OPENAI_API_KEY"] },
    { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"] },
    { id: "groq", name: "Groq", env: ["GROQ_API_KEY"] },
  ];

  it("marks a provider signed in from provider.list()'s connected list", () => {
    const rows = buildProviderRows({ all, connected: ["anthropic"], configured: [], menu });
    expect(rows.find((r) => r.id === "anthropic")?.signedIn).toBe(true);
    expect(rows.find((r) => r.id === "openai")?.signedIn).toBe(false);
  });

  it("also marks one signed in from config.providers()", () => {
    const rows = buildProviderRows({ all, connected: [], configured: [{ id: "groq" }], menu });
    expect(rows.find((r) => r.id === "groq")?.signedIn).toBe(true);
  });

  it("attaches each provider's own auth methods and env vars", () => {
    const rows = buildProviderRows({ all, connected: [], configured: [], menu });
    expect(rows.find((r) => r.id === "anthropic")?.methods).toEqual([{ type: "oauth", label: "Claude Pro/Max" }]);
    expect(rows.find((r) => r.id === "groq")?.methods).toEqual([]);
    expect(rows.find((r) => r.id === "groq")?.env).toEqual(["GROQ_API_KEY"]);
  });

  it("lists every provider the catalog reports, sorted by name", () => {
    const rows = buildProviderRows({ all, connected: [], configured: [], menu });
    expect(rows.map((r) => r.name)).toEqual(["Anthropic", "Groq", "OpenAI"]);
  });
});

describe("toListItems", () => {
  const rows = [
    row({ id: "anthropic", name: "Anthropic", signedIn: true, methods: [{ type: "oauth", label: "OAuth" }] }),
    row({ id: "openai", name: "OpenAI", methods: [{ type: "api", label: "API key" }] }),
    row({ id: "azure", name: "Azure", methods: [{ type: "api", label: "API key" }] }),
    row({ id: "groq", name: "Groq", env: ["GROQ_API_KEY"] }),
  ];

  it("groups into signed-in, signable, and env/config-only", () => {
    const sections = toListItems(rows).filter((item) => item.kind === "section");
    expect(sections.map((item) => item.title)).toEqual(["Signed in", "Sign in", "Other providers"]);
  });

  it("keeps every provider, each under exactly one section", () => {
    const listed = toListItems(rows).filter((item) => item.kind === "provider");
    expect(listed.map((item) => item.row.id).sort()).toEqual(["anthropic", "azure", "groq", "openai"]);
  });

  it("flags the first and last row of each section for corner rounding", () => {
    const providers = toListItems(rows).filter((item) => item.kind === "provider");
    const signable = providers.filter((item) => !item.row.signedIn && item.row.methods.length > 0);
    expect(signable.map((item) => [item.row.id, item.first, item.last])).toEqual([
      ["openai", true, false],
      ["azure", false, true],
    ]);
  });

  it("omits a section with no providers in it", () => {
    const onlySignedIn = [row({ id: "anthropic", name: "Anthropic", signedIn: true })];
    const sections = toListItems(onlySignedIn).filter((item) => item.kind === "section");
    expect(sections.map((item) => item.title)).toEqual(["Signed in"]);
  });

  it("gives every item a distinct key", () => {
    const keys = toListItems(rows).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns nothing for an empty list", () => {
    expect(toListItems([])).toEqual([]);
  });
});

describe("pollExpired", () => {
  it("keeps polling inside the window", () => {
    expect(pollExpired(1_000, 1_000)).toBe(false);
    expect(pollExpired(1_000, 1_000 + OAUTH_POLL_TIMEOUT_MS - 1)).toBe(false);
  });

  it("gives up once the window has passed", () => {
    expect(pollExpired(1_000, 1_000 + OAUTH_POLL_TIMEOUT_MS)).toBe(true);
  });
});
