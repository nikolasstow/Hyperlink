/**
 * Which lines an outside change added, changed or deleted, the way VS Code
 * marks them in the gutter: added and changed lines as ranges of the new
 * text, deleted lines as the point between two lines where they were.
 *
 * The character changes say roughly where; each place is widened to whole
 * lines and the lines that came out the same at either end are dropped, so
 * "a new line after `count`" is one added line, not a changed `count`.
 *
 * @internal
 */
import { TextChange } from "file-sync";

export type ChangeKind = "added" | "modified" | "deleted";

/** Lines of the new text, `[from, to)` from the first line's start to the
 * last line's end; a deletion is the point `from === to` at the start of the
 * line that follows it (or the end of the text). */
export interface ChangeMark {
  readonly kind: ChangeKind;
  readonly from: number;
  readonly to: number;
}

/** Where each line starts. */
const lineStarts = (text: string): ReadonlyArray<number> => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
};

/** The line `offset` is on. */
const lineAt = (starts: ReadonlyArray<number>, offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const start = starts[middle] ?? 0;
    if (start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

/** Line `index` of the text, without its newline. */
const lineText = (text: string, starts: ReadonlyArray<number>, index: number): string => {
  const start = starts[index] ?? text.length;
  const next = starts[index + 1];
  return text.slice(start, next === undefined ? text.length : next - 1);
};

/** The end of line `index`, before its newline. */
const lineEnd = (text: string, starts: ReadonlyArray<number>, index: number): number => {
  const next = starts[index + 1];
  return next === undefined ? text.length : next - 1;
};

/** Lines `[first, last]` before and after, touched by the same change. */
interface Region {
  readonly oldFirst: number;
  readonly oldLast: number;
  readonly newFirst: number;
  readonly newLast: number;
}

export const changeMarks = (before: string, after: string): ReadonlyArray<ChangeMark> => {
  if (before === after) return [];
  const oldStarts = lineStarts(before);
  const newStarts = lineStarts(after);
  const regions: Array<Region> = [];
  let shift = 0;
  for (const change of TextChange.diff(before, after)) {
    const from = change.from + shift;
    shift += change.insert.length - (change.to - change.from);
    const region = {
      oldFirst: lineAt(oldStarts, change.from),
      oldLast: lineAt(oldStarts, change.to),
      newFirst: lineAt(newStarts, from),
      newLast: lineAt(newStarts, from + change.insert.length),
    };
    // Changes on the same or neighbouring lines are one place.
    const last = regions.at(-1);
    if (last !== undefined && region.oldFirst <= last.oldLast + 1) {
      regions[regions.length - 1] = {
        oldFirst: last.oldFirst,
        oldLast: Math.max(last.oldLast, region.oldLast),
        newFirst: last.newFirst,
        newLast: Math.max(last.newLast, region.newLast),
      };
    } else {
      regions.push(region);
    }
  }
  const marks: Array<ChangeMark> = [];
  for (const region of regions) {
    let { oldFirst, oldLast, newFirst, newLast } = region;
    while (oldFirst <= oldLast && newFirst <= newLast && lineText(before, oldStarts, oldFirst) === lineText(after, newStarts, newFirst)) {
      oldFirst += 1;
      newFirst += 1;
    }
    while (oldFirst <= oldLast && newFirst <= newLast && lineText(before, oldStarts, oldLast) === lineText(after, newStarts, newLast)) {
      oldLast -= 1;
      newLast -= 1;
    }
    const removed = oldLast - oldFirst + 1;
    const added = newLast - newFirst + 1;
    if (added <= 0 && removed <= 0) continue;
    if (added <= 0) {
      const at = newStarts[newFirst] ?? after.length;
      marks.push({
        kind: "deleted",
        from: at,
        to: at,
      });
      continue;
    }
    marks.push({
      kind: removed <= 0 ? "added" : "modified",
      from: newStarts[newFirst] ?? after.length,
      to: lineEnd(after, newStarts, newLast),
    });
  }
  return marks;
};
