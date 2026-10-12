import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../sessions/sessionList";
import { groupSessions } from "./groupSessions";

const DAY = 86_400_000;
// A fixed "now" at midday so day-boundary rounding is stable.
const NOW = new Date("2026-02-15T12:00:00").getTime();

const session = (id: string, daysAgo: number): SessionSummary => ({
  id,
  title: id,
  directory: "/app",
  time: { created: 0, updated: NOW - daysAgo * DAY },
});

describe("groupSessions", () => {
  const none = (): boolean => false;

  it("buckets read sessions by recency, newest group first", () => {
    const groups = groupSessions([session("today", 0), session("yest", 1), session("three", 3)], none, NOW);
    expect(groups.map((g) => g.title)).toEqual(["Today", "Yesterday", "3 days ago"]);
  });

  it("pins unread to the top, out of the time buckets", () => {
    const sessions = [session("a", 0), session("b", 2), session("c", 2)];
    const groups = groupSessions(sessions, (s) => s.id === "a", NOW);
    expect(groups.map((g) => g.title)).toEqual(["Unread", "2 days ago"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("rolls older sessions up into months then years", () => {
    const groups = groupSessions([session("m", 60), session("y", 800)], none, NOW);
    expect(groups.map((g) => g.title)).toEqual(["2 months ago", "2 years ago"]);
  });

  it("omits the Unread group when everything is read", () => {
    const groups = groupSessions([session("a", 0)], none, NOW);
    expect(groups.map((g) => g.title)).toEqual(["Today"]);
  });
});
