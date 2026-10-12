/**
 * An edit to a text, as ranges replaced in it.
 *
 * Positions are UTF-16 offsets: what a JS string index counts, and what
 * Runestone's `NSString` ranges count on the native side. A change set is a
 * list of changes against the SAME base text, sorted by position and not
 * overlapping, so applying one never shifts the next.
 *
 * @since 0.0.1
 */
import fastDiff from "fast-diff";
import { Schema } from "effect";

/**
 * Replace `[from, to)` of the base text with `insert`.
 *
 * @since 0.0.1
 */
export class TextChange extends Schema.Class<TextChange>("TextChange")({
  from: Schema.Int,
  to: Schema.Int,
  insert: Schema.String,
}) {}

/**
 * Changes against one base text: sorted, non-overlapping.
 *
 * @since 0.0.1
 */
export type ChangeSet = ReadonlyArray<TextChange>;

/**
 * Whether `changes` is a change set `apply` can take for a text of
 * `length`: in bounds, each range forward, sorted, not overlapping.
 *
 * @since 0.0.1
 */
export const isValid = (length: number, changes: ChangeSet): boolean => {
  let end = 0;
  for (const change of changes) {
    if (change.from < end) return false;
    if (change.to < change.from) return false;
    if (change.to > length) return false;
    end = change.to;
  }
  return true;
};

/**
 * Apply a change set to the text it was made against. The set must be
 * valid for the text (`isValid`).
 *
 * @since 0.0.1
 */
export const apply = (text: string, changes: ChangeSet): string => {
  let out = "";
  let at = 0;
  for (const change of changes) {
    out += text.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + text.slice(at);
};

/**
 * The change set that turns `before` into `after`, as few changes as the
 * diff finds (adjacent deletes and inserts merge into one change).
 *
 * @since 0.0.1
 */
export const diff = (before: string, after: string): ChangeSet => {
  if (before === after) return [];
  const changes: Array<TextChange> = [];
  let at = 0;
  let open: { from: number; to: number; insert: string } | undefined;
  const close = (): void => {
    if (open === undefined) return;
    changes.push(
      new TextChange({
        from: open.from,
        to: open.to,
        insert: open.insert,
      }),
    );
    open = undefined;
  };
  for (const [op, text] of fastDiff(before, after)) {
    if (op === fastDiff.EQUAL) {
      close();
      at += text.length;
      continue;
    }
    open ??= {
      from: at,
      to: at,
      insert: "",
    };
    if (op === fastDiff.DELETE) {
      at += text.length;
      open.to = at;
    } else {
      open.insert += text;
    }
  }
  close();
  return changes;
};

/**
 * Where position `at` of the base text lands once `changes` are applied.
 * At the start of a replaced range it stays at the start; inside or at the
 * end of one it moves to the end of the insert. At a pure insert it stays
 * before the inserted text unless `after` is set.
 *
 * @since 0.0.1
 */
export const mapPosition = (changes: ChangeSet, at: number, after = false): number => {
  let shift = 0;
  for (const change of changes) {
    const delta = change.insert.length - (change.to - change.from);
    if (change.to < at) {
      shift += delta;
      continue;
    }
    if (change.from > at) break;
    if (change.from === change.to) {
      if (!after) break;
      shift += delta;
      continue;
    }
    if (change.from === at) return change.from + shift;
    return change.from + shift + change.insert.length;
  }
  return at + shift;
};

/**
 * The total length change of everything in `changes` that starts before
 * `at`.
 *
 * @since 0.0.1
 */
export const shiftBefore = (changes: ChangeSet, at: number): number => {
  let shift = 0;
  for (const change of changes) {
    if (change.from >= at) break;
    shift += change.insert.length - (change.to - change.from);
  }
  return shift;
};
