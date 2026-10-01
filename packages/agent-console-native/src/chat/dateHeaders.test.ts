import { describe, expect, it } from "vitest";
import { dateHeaderLabel, dateHeaders } from "./dateHeaders";
import type { ChatMessage } from "./model";

const at = (id: string, created: number | undefined): ChatMessage => ({
  id,
  role: "user",
  parts: [],
  time: created === undefined ? undefined : { created },
});

/** September 2026 (the 31st rolls over to October 1st). */
const day = (date: number, hours: number, minutes = 0): number => new Date(2026, 8, date, hours, minutes).getTime();

describe("dateHeaders", () => {
  it("heads the first message, a new day, and an hour's quiet", () => {
    const headers = dateHeaders([
      at("a", day(30, 9)),
      at("b", day(30, 9, 20)),
      at("c", day(30, 10, 20)),
      at("d", day(30, 10, 25)),
      at("e", day(30, 23, 59)),
      // Six minutes on, but a new day.
      at("f", day(31, 0, 5)),
    ]);
    expect([...headers.keys()]).toEqual(["a", "c", "e", "f"]);
    expect(headers.get("c")).toBe(day(30, 10, 20));
  });

  it("skips a message without a time, keeping the one before", () => {
    expect([...dateHeaders([at("a", day(30, 9)), at("b", undefined), at("c", day(30, 9, 30))]).keys()]).toEqual(["a"]);
  });

  it("takes seconds as seconds", () => {
    expect(dateHeaders([at("a", 1_700_000_000)]).get("a")).toBe(1_700_000_000_000);
  });
});

describe("dateHeaderLabel", () => {
  const now = new Date(2026, 9, 1, 15, 0).getTime();
  const time = (when: number): string => new Date(when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("says Today and Yesterday with the time", () => {
    const today = new Date(2026, 9, 1, 9, 5).getTime();
    expect(dateHeaderLabel(today, now)).toEqual({ day: "Today", time: time(today) });
    const yesterday = new Date(2026, 8, 30, 18, 51).getTime();
    expect(dateHeaderLabel(yesterday, now)).toEqual({ day: "Yesterday", time: time(yesterday) });
  });

  it("says the weekday within the week, then the date", () => {
    const weekday = new Date(2026, 8, 27, 12, 0);
    expect(dateHeaderLabel(weekday.getTime(), now).day).toBe(weekday.toLocaleDateString([], { weekday: "long" }));
    const thisYear = new Date(2026, 5, 3, 12, 0);
    expect(dateHeaderLabel(thisYear.getTime(), now).day).toBe(thisYear.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }));
    const lastYear = new Date(2025, 5, 3, 12, 0);
    expect(dateHeaderLabel(lastYear.getTime(), now).day).toBe(lastYear.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }));
  });
});
