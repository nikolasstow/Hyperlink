/**
 * The sessions around a file, for the Dubz session row and list. "Related" = the
 * sessions whose worktree contains the file (the file is under the session's
 * directory) — the count shown on the number pill. The full list is those
 * related sessions first (recency), then the rest (recency): recency and
 * relatedness order.
 *
 * Touched-file relatedness (which sessions actually edited this file) refines
 * this later; worktree membership is the cheap first pass over the session list
 * we already have.
 *
 * @internal
 */
import { under } from "../files/pathForms";
import type { SessionSummary } from "../sessions/sessionList";

export interface SessionsForFile {
  /** Sessions whose worktree contains the file, newest first. */
  readonly related: ReadonlyArray<SessionSummary>;
  /** Related first, then the rest — each newest first. */
  readonly all: ReadonlyArray<SessionSummary>;
}

export const sessionsForFile = (sessions: ReadonlyArray<SessionSummary>, filePath: string): SessionsForFile => {
  const byRecent = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
  const isRelated = (session: SessionSummary): boolean => under(filePath, session.directory) !== undefined;
  const related = byRecent.filter(isRelated);
  const rest = byRecent.filter((session) => !isRelated(session));
  return { related, all: [...related, ...rest] };
};
