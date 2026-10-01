/**
 * Calendar helpers for the chat's times (receipts, date headers), in the
 * device's locale and time zone.
 *
 * @internal
 */

const startOfDay = (time: number): number => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days from `at` to `now` (0 the same day, 1 the day before). */
export const daysBetween = (at: number, now: number): number => Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);

/** "6:51 PM". */
export const clockTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
