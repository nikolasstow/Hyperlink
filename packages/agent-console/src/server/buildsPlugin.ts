/**
 * Watches EAS builds and pushes a notification when one finishes.
 *
 * There's no need to scrape the Expo dashboard: `eas build:list --json` is a
 * first-class feed with status, profile, commit, timings and the artifact URL.
 * This polls it, and when a build crosses into a terminal state (finished /
 * errored / canceled) it fires a push — reusing the app's existing pipeline via
 * `/push/notify` — carrying a link to that build's page on expo.dev.
 *
 * Baseline-on-start: the first poll records current statuses and notifies
 * nothing, so a backlog of already-finished builds doesn't announce itself. Only
 * transitions observed while running are announced.
 *
 * `eas` resolves its project from the working directory, so the CLI is run in
 * the native app's directory (override with AGENT_CONSOLE_EAS_PROJECT_DIR). The
 * poller is best-effort: a missing CLI, a logged-out account or a network blip
 * just means no builds this tick.
 *
 * @internal
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { Connect, Plugin } from "vite";

const POLL_MS = 90_000;
const LIST_LIMIT = 20;
const TERMINAL = new Set(["FINISHED", "ERRORED", "CANCELED"]);

/** Where `eas` finds the project (app.json/eas.json). Defaults to the native app
 * package next to this one. */
const projectDir = process.env.AGENT_CONSOLE_EAS_PROJECT_DIR ?? resolve(process.cwd(), "../agent-console-native");
/** Same origin the app already registered its push token against. */
const notifyUrl = `http://127.0.0.1:${process.env.PORT ?? 5195}/push/notify`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type BuildRow = {
  readonly id: string;
  readonly status: string;
  readonly platform?: string;
  readonly buildProfile?: string;
  readonly appVersion?: string;
  readonly gitCommitMessage?: string;
  readonly artifacts?: { readonly buildUrl?: string };
  readonly app?: { readonly slug?: string; readonly ownerAccount?: { readonly name?: string } };
};

const asBuildRow = (value: unknown): BuildRow | undefined => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return undefined;
  const artifacts = isRecord(value.artifacts) ? value.artifacts : undefined;
  const app = isRecord(value.app) ? value.app : undefined;
  const owner = app !== undefined && isRecord(app.ownerAccount) ? app.ownerAccount : undefined;
  return {
    id: value.id,
    status: value.status,
    platform: typeof value.platform === "string" ? value.platform : undefined,
    buildProfile: typeof value.buildProfile === "string" ? value.buildProfile : undefined,
    appVersion: typeof value.appVersion === "string" ? value.appVersion : undefined,
    gitCommitMessage: typeof value.gitCommitMessage === "string" ? value.gitCommitMessage : undefined,
    artifacts: artifacts === undefined ? undefined : { buildUrl: typeof artifacts.buildUrl === "string" ? artifacts.buildUrl : undefined },
    app:
      app === undefined
        ? undefined
        : {
            slug: typeof app.slug === "string" ? app.slug : undefined,
            ownerAccount: owner === undefined ? undefined : { name: typeof owner.name === "string" ? owner.name : undefined },
          },
  };
};

const listBuilds = (): Promise<ReadonlyArray<BuildRow>> =>
  new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["eas-cli", "build:list", "--json", "--non-interactive", "--limit", String(LIST_LIMIT)],
      { cwd: projectDir },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    // eas prints progress to stderr; only stdout carries the --json payload.
    child.on("error", () => resolvePromise([]));
    child.on("close", () => {
      try {
        const parsed: unknown = JSON.parse(out);
        if (!Array.isArray(parsed)) {
          resolvePromise([]);
          return;
        }
        resolvePromise(parsed.map(asBuildRow).filter((b): b is BuildRow => b !== undefined));
      } catch {
        resolvePromise([]);
      }
    });
  });

/** Full detail for one build, straight from `eas build:view --json`. Returned
 * verbatim (the app reads what it needs) — this is the metadata the site shows. */
const viewBuild = (id: string): Promise<unknown> =>
  new Promise((resolvePromise) => {
    // `build:view` accepts only `--json` (no `--non-interactive`); an unknown
    // flag makes it error out with non-JSON output.
    const child = spawn("npx", ["eas-cli", "build:view", id, "--json"], { cwd: projectDir });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolvePromise(undefined));
    child.on("close", () => {
      try {
        resolvePromise(JSON.parse(out));
      } catch {
        resolvePromise(undefined);
      }
    });
  });

type LogLine = {
  readonly phase: string;
  readonly level: number;
  readonly msg: string;
  readonly time?: string;
};

/** Fetches a build's log files and parses the bunyan JSON-lines into ordered
 * entries. This is what lets the app reconstruct the site's phased log view
 * (group by `phase`, colour by `level`). The EAS log URLs are brotli/gzip on the
 * wire; global fetch (undici) decompresses by content-encoding, with a manual
 * fallback for a raw body. */
const fetchLogLines = async (url: string): Promise<ReadonlyArray<LogLine>> => {
  const response = await fetch(url).catch(() => undefined);
  if (response === undefined || !response.ok) return [];
  let text = await response.text().catch(() => "");
  // If decompression didn't happen, the text is binary garbage — recover the
  // raw bytes and decode by the declared encoding.
  if (text.includes("�")) {
    const encoding = response.headers.get("content-encoding");
    const buffer = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    try {
      text = (encoding === "br" ? brotliDecompressSync(buffer) : encoding === "gzip" ? gunzipSync(buffer) : buffer).toString("utf8");
    } catch {
      return [];
    }
  }
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) continue;
      lines.push({
        phase: typeof parsed.phase === "string" ? parsed.phase : "UNKNOWN",
        level: typeof parsed.level === "number" ? parsed.level : 30,
        msg: typeof parsed.msg === "string" ? parsed.msg : "",
        time: typeof parsed.time === "string" ? parsed.time : undefined,
      });
    } catch {
      // A non-JSON line (e.g. the xcode log) is passed through as a plain msg
      // so nothing is silently dropped.
      lines.push({ phase: "XCODE", level: 30, msg: raw });
    }
  }
  return lines;
};

const buildPageUrl = (build: BuildRow): string | undefined => {
  const owner = build.app?.ownerAccount?.name;
  const slug = build.app?.slug;
  if (owner === undefined || slug === undefined) return undefined;
  return `https://expo.dev/accounts/${owner}/projects/${slug}/builds/${build.id}`;
};

const titleFor = (build: BuildRow): string => {
  const platform = build.platform === "IOS" ? "iOS" : build.platform === "ANDROID" ? "Android" : "App";
  if (build.status === "FINISHED") return `${platform} build finished ✅`;
  if (build.status === "ERRORED") return `${platform} build failed ❌`;
  return `${platform} build canceled`;
};

const bodyFor = (build: BuildRow): string => {
  const commit = (build.gitCommitMessage ?? "").split("\n")[0].trim();
  const parts = [build.buildProfile, commit === "" ? undefined : commit].filter((p): p is string => p !== undefined && p !== "");
  return parts.length > 0 ? parts.join(" · ") : "Tap to view the build.";
};

const notify = async (build: BuildRow): Promise<void> => {
  const url = buildPageUrl(build);
  await fetch(notifyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: titleFor(build),
      body: bodyFor(build),
      // Tapping opens the build's page; the install artifact (when finished)
      // rides along so the app can offer it directly.
      url,
      data: {
        kind: "build",
        buildId: build.id,
        installUrl: build.status === "FINISHED" ? build.artifacts?.buildUrl : undefined,
      },
    }),
  }).catch(() => undefined);
};

export const buildsPlugin = (): Plugin => {
  // id -> last-seen status. Seeded on the first poll so the existing backlog is
  // never announced; only later transitions notify.
  const seen = new Map<string, string>();
  const notified = new Set<string>();
  let baselined = false;
  let polling = false;

  const tick = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      const builds = await listBuilds();
      if (builds.length === 0) return;

      if (!baselined) {
        for (const build of builds) seen.set(build.id, build.status);
        baselined = true;
        return;
      }

      for (const build of builds) {
        const previous = seen.get(build.id);
        seen.set(build.id, build.status);
        const reachedTerminal = TERMINAL.has(build.status) && previous !== build.status;
        if (reachedTerminal && !notified.has(build.id)) {
          notified.add(build.id);
          await notify(build);
        }
      }
    } finally {
      polling = false;
    }
  };

  // GET /builds, /builds/:id, /builds/:id/logs — the data the app's Builds page
  // renders (list, full detail, phase-grouped logs). Read-only.
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (url !== "/builds" && !url.startsWith("/builds/") && !url.startsWith("/builds?")) {
      next();
      return;
    }
    const path = (url.split("?")[0] ?? "").replace(/\/+$/, "");
    const json = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };

    void (async () => {
      if (req.method === "GET" && (path === "/builds" || path === "")) {
        json(200, { data: await listBuilds() });
        return;
      }

      const logsMatch = /^\/builds\/([^/]+)\/logs$/.exec(path);
      if (req.method === "GET" && logsMatch !== null) {
        const detail = await viewBuild(logsMatch[1]);
        const urls: string[] = [];
        if (isRecord(detail)) {
          if (Array.isArray(detail.logFiles)) {
            for (const entry of detail.logFiles) if (typeof entry === "string") urls.push(entry);
          }
          const artifacts = isRecord(detail.artifacts) ? detail.artifacts : undefined;
          if (artifacts !== undefined && typeof artifacts.xcodeBuildLogsUrl === "string") urls.push(artifacts.xcodeBuildLogsUrl);
        }
        const all = (await Promise.all(urls.map(fetchLogLines))).flat();
        // Group by phase, preserving first-seen order — the site's phased view.
        const order: string[] = [];
        const byPhase = new Map<string, LogLine[]>();
        for (const line of all) {
          let bucket = byPhase.get(line.phase);
          if (bucket === undefined) {
            bucket = [];
            byPhase.set(line.phase, bucket);
            order.push(line.phase);
          }
          bucket.push(line);
        }
        json(200, { phases: order.map((phase) => ({ phase, lines: byPhase.get(phase) ?? [] })) });
        return;
      }

      const idMatch = /^\/builds\/([^/]+)$/.exec(path);
      if (req.method === "GET" && idMatch !== null) {
        const detail = await viewBuild(idMatch[1]);
        if (detail === undefined) {
          json(404, { error: "Build not found" });
          return;
        }
        json(200, { data: detail });
        return;
      }

      next();
    })();
  };

  return {
    name: "agent-console-builds",
    configureServer(server) {
      server.middlewares.use(handler);
      // Kick off shortly after boot, then on an interval. `unref` so the timer
      // never keeps the process alive on its own.
      const timer = setInterval(() => void tick(), POLL_MS);
      timer.unref();
      setTimeout(() => void tick(), 3_000).unref();
    },
  };
};
