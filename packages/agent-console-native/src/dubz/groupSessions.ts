/**
 * Groups the Dubz "View All" sessions for the recency view: unread first, then
 * by how long ago each session last changed — Today, Yesterday, N days ago,
 * then N months / N years ago. Pure over the session list, an `isUnread`
 * predicate, and `now`, so it's testable and known before render.
 *
 * Input is expected newest-first (as `sessionsForFile` returns); order is kept
 * within each group, and groups run newest → oldest with Unread pinned on top.
 *
 * @internal
 */
import type { SessionSummary } from "../sessions/sessionList";

export interface SessionGroup {
  readonly title: string;
  readonly sessions: ReadonlyArray<SessionSummary>;
}

const DAY_MS = 86_400_000;

/** Midnight (local) of the day containing `t`. */
const startOfDay = (t: number): number => {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** The recency bucket for a session's last-updated time: its label, and an
 * `order` (whole days ago) so buckets sort newest → oldest. */
const timeBucket = (updated: number, now: number): { readonly title: string; readonly order: number } => {
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(updated)) / DAY_MS));
  if (days <= 0) return { title: "Today", order: 0 };
  if (days === 1) return { title: "Yesterday", order: 1 };
  if (days < 30) return { title: `${days} days ago`, order: days };
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return { title: months === 1 ? "1 month ago" : `${months} months ago`, order: days };
  }
  const years = Math.max(1, Math.floor(days / 365));
  return { title: years === 1 ? "1 year ago" : `${years} years ago`, order: days };
};

export const groupSessions = (
  sessions: ReadonlyArray<SessionSummary>,
  isUnread: (session: SessionSummary) => boolean,
  now: number,
): ReadonlyArray<SessionGroup> => {
  const unread: Array<SessionSummary> = [];
  // key = bucket title; the first (newest) session sets the bucket's order.
  const buckets = new Map<string, { readonly order: number; readonly sessions: Array<SessionSummary> }>();

  for (const session of sessions) {
    if (isUnread(session)) {
      unread.push(session);
      continue;
    }
    const { title, order } = timeBucket(session.time.updated, now);
    const existing = buckets.get(title);
    if (existing === undefined) {
      buckets.set(title, { order, sessions: [session] });
    } else {
      existing.sessions.push(session);
    }
  }

  const groups: Array<SessionGroup> = [];
  if (unread.length > 0) groups.push({ title: "Unread", sessions: unread });
  for (const [title, bucket] of [...buckets.entries()].sort((a, b) => a[1].order - b[1].order)) {
    groups.push({ title, sessions: bucket.sessions });
  }
  return groups;
};
