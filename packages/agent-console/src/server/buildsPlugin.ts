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
import type { Plugin } from "vite";

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

  return {
    name: "agent-console-builds",
    configureServer() {
      // Kick off shortly after boot, then on an interval. `unref` so the timer
      // never keeps the process alive on its own.
      const timer = setInterval(() => void tick(), POLL_MS);
      timer.unref();
      setTimeout(() => void tick(), 3_000).unref();
    },
  };
};
