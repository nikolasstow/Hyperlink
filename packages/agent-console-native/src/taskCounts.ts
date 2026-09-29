/**
 * How many open tasks a repo has, by kind. A task is a GitHub issue
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §25), read through
 * the backend's `/github` proxy (githubPlugin.ts), so the phone never holds a
 * GitHub credential.
 *
 * A task's kind is its GitHub issue type when the repo uses them; else the
 * GitHub default labels say (`bug` → Bug, `enhancement` → Feature); else it
 * is a Task.
 *
 * @internal
 */
import { Schema } from "effect";
import { base, request } from "./extensionsClient";
import type { GitHubRepo } from "./repoScan";

const Issue = Schema.Struct({
  number: Schema.Number,
  /** Present on pull requests, which the issues list includes. */
  pull_request: Schema.optional(Schema.Unknown),
  type: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
});
type Issue = typeof Issue.Type;
const Issues = Schema.Array(Issue);

/** One kind of task and how many are open. */
export interface TaskCount {
  readonly kind: string;
  readonly count: number;
}

/** The default labels GitHub gives every repo, as kinds. */
const KIND_BY_LABEL: Readonly<Record<string, string>> = {
  bug: "Bug",
  enhancement: "Feature",
};
const DEFAULT_KIND = "Task";

export const kindOf = (issue: Issue): string =>
  issue.type?.name ?? issue.labels.map((label) => KIND_BY_LABEL[label.name.toLowerCase()]).find((kind) => kind !== undefined) ?? DEFAULT_KIND;

/** Open issues (not pull requests) counted by kind, most first. */
export const countByKind = (issues: ReadonlyArray<Issue>): ReadonlyArray<TaskCount> => {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (issue.pull_request !== undefined) continue;
    const kind = kindOf(issue);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, count]): TaskCount => ({
      kind,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
};

/** The repo's open tasks by kind (the first 100 open issues). */
export const fetchTaskCounts = async (apiBase: string, repo: GitHubRepo): Promise<ReadonlyArray<TaskCount>> => {
  const url = `${base(apiBase)}/github/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues?state=open&per_page=100`;
  return countByKind(Schema.decodeUnknownSync(Issues)(await request(url)));
};
