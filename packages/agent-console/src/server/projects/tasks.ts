/**
 * A project's tasks are the open GitHub issues of its `githubRepos`.
 *
 * The owner wants work organized as tasks, and a task is a GitHub issue
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §25). This
 * module reads the open issues of each repo a project names and returns them
 * as the trimmed `Task` shape.
 *
 * The call uses the Effect `HttpClient` (serve.ts provides `FetchHttpClient`).
 * It sends a token from `GITHUB_TOKEN` or `GH_TOKEN` when one is set, so
 * private repos and higher rate limits work; without one it still reads
 * public repos. A project with no `githubRepos` has no tasks, so the result
 * is an empty list — that is not an error.
 *
 * @internal
 */
import { Array as Arr, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Project, Task } from "./model";
import { ProjectsError } from "./store";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "doubleagent-projects";

/** The issue fields GitHub returns that a task needs. A pull request also
 * comes back from the issues endpoint, marked by `pull_request`, so it is
 * read and then left out. */
const GithubIssue = Schema.Struct({
  id: Schema.Number,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  html_url: Schema.String,
  pull_request: Schema.optional(Schema.Unknown),
});

const token = (): string | undefined => {
  const fromGithub = process.env.GITHUB_TOKEN;
  if (fromGithub !== undefined && fromGithub.length > 0) return fromGithub;
  const fromGh = process.env.GH_TOKEN;
  return fromGh !== undefined && fromGh.length > 0 ? fromGh : undefined;
};

/** The open issues of one `owner/name` repo, as tasks. */
const issuesOf = (repo: string): Effect.Effect<ReadonlyArray<Task>, ProjectsError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const bearer = token();
    const request = HttpClientRequest.get(`${GITHUB_API}/repos/${repo}/issues`).pipe(
      HttpClientRequest.setUrlParams({ state: "open", per_page: "50" }),
      HttpClientRequest.setHeaders({
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      }),
      bearer === undefined ? (self) => self : HttpClientRequest.bearerToken(bearer),
    );
    const issues = yield* client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(GithubIssue))),
      Effect.mapError((cause) => new ProjectsError({ message: `reading issues of ${repo}: ${cause instanceof Error ? cause.message : String(cause)}` })),
    );
    return issues
      .filter((issue) => issue.pull_request === undefined)
      .map(
        (issue): Task => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.html_url,
          repo,
        }),
      );
  });

/** Every open task across a project's GitHub repos. */
export const tasksOf = (project: Project): Effect.Effect<ReadonlyArray<Task>, ProjectsError, HttpClient.HttpClient> =>
  Effect.forEach(project.githubRepos, issuesOf, { concurrency: 4 }).pipe(Effect.map(Arr.flatten));
