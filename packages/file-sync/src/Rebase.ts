/**
 * Put my edits on top of someone else's.
 *
 * Both change sets were made against the same base. Their changes are
 * already in place (on disk, on the server); mine move to fit around them.
 * Two edits that touch a common line are a conflict: theirs is kept, and
 * mine is reported so the editor can offer it back (keep mine / keep
 * theirs). Edits on different lines merge. Lines, not characters, because a
 * rewritten line that an agent and a person both touched rarely merges into
 * anything either of them meant.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";
import * as TextChange from "./TextChange";

/**
 * Lines both sides changed. `from`/`to` are where their text sits in the
 * rebased result; `mine` is what my edit made of the same lines.
 *
 * @since 0.0.1
 */
export class Conflict extends Schema.Class<Conflict>("Conflict")({
  from: Schema.Int,
  to: Schema.Int,
  mine: Schema.String,
  theirs: Schema.String,
}) {}

/**
 * The outcome of a rebase.
 *
 * @since 0.0.1
 */
export interface Rebased {
  /** Base with their changes and my moved changes applied. */
  readonly text: string;
  /** My changes that survived, against their text (base + theirs). */
  readonly changes: TextChange.ChangeSet;
  /** Lines both sides changed, kept as theirs. */
  readonly conflicts: ReadonlyArray<Conflict>;
}

interface Side {
  readonly mine: boolean;
  readonly change: TextChange.TextChange;
  /** Lines touched, for grouping: inclusive, and `n - 0.5` for "between lines". */
  readonly start: number;
  readonly end: number;
  /** Base text the change and its lines cover. */
  readonly regionStart: number;
  readonly regionEnd: number;
}

interface Cluster {
  readonly start: number;
  end: number;
  regionStart: number;
  regionEnd: number;
  readonly mine: Array<TextChange.TextChange>;
  readonly theirs: Array<TextChange.TextChange>;
}

/**
 * Where a change sits, by line. An insert of whole lines (at a line's start
 * ending in a newline, or at a line's end starting with one) sits BETWEEN
 * lines, so it groups only with a change that spans that line break — not
 * with an edit to the line beside it.
 */
const sideOf = (text: string, mine: boolean, change: TextChange.TextChange): Side => {
  const { from, to, insert } = change;
  if (from === to) {
    const atLineStart = from === 0 || text[from - 1] === "\n";
    const atLineEnd = from === text.length || text[from] === "\n";
    const between = atLineStart && insert.endsWith("\n") ? from - 0.5 : atLineEnd && insert.startsWith("\n") ? from + 0.5 : undefined;
    if (between !== undefined) {
      return {
        mine,
        change,
        start: between,
        end: between,
        regionStart: from,
        regionEnd: from,
      };
    }
  }
  const start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  const newline = text.indexOf("\n", to);
  const end = newline === -1 ? text.length : newline;
  return {
    mine,
    change,
    start,
    end,
    regionStart: Math.min(start, from),
    regionEnd: Math.max(end, to),
  };
};

const delta = (changes: TextChange.ChangeSet): number =>
  changes.reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0);

/** Apply `changes` (base positions, all within `[start, end]`) to that slice of `base`. */
const applyWithin = (base: string, start: number, end: number, changes: TextChange.ChangeSet): string =>
  TextChange.apply(
    base.slice(start, end),
    changes.map(
      (change) =>
        new TextChange.TextChange({
          from: change.from - start,
          to: change.to - start,
          insert: change.insert,
        }),
    ),
  );

/**
 * Rebase `mine` onto `theirs`; both are change sets against `base`.
 *
 * @since 0.0.1
 */
export const rebase = (base: string, mine: TextChange.ChangeSet, theirs: TextChange.ChangeSet): Rebased => {
  const sides = [...mine.map((change) => sideOf(base, true, change)), ...theirs.map((change) => sideOf(base, false, change))].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );

  const clusters: Array<Cluster> = [];
  for (const side of sides) {
    const last = clusters.at(-1);
    if (last !== undefined && side.start <= last.end) {
      last.end = Math.max(last.end, side.end);
      last.regionStart = Math.min(last.regionStart, side.regionStart);
      last.regionEnd = Math.max(last.regionEnd, side.regionEnd);
      (side.mine ? last.mine : last.theirs).push(side.change);
      continue;
    }
    clusters.push({
      start: side.start,
      end: side.end,
      regionStart: side.regionStart,
      regionEnd: side.regionEnd,
      mine: side.mine ? [side.change] : [],
      theirs: side.mine ? [] : [side.change],
    });
  }

  const changes: Array<TextChange.TextChange> = [];
  const conflicts: Array<Conflict> = [];
  // Length change from their edits / my surviving edits in earlier clusters.
  let theirShift = 0;
  let myShift = 0;
  for (const cluster of clusters) {
    const theirDelta = delta(cluster.theirs);
    if (cluster.mine.length === 0) {
      theirShift += theirDelta;
      continue;
    }
    if (cluster.theirs.length === 0) {
      for (const change of cluster.mine) {
        changes.push(
          new TextChange.TextChange({
            from: change.from + theirShift,
            to: change.to + theirShift,
            insert: change.insert,
          }),
        );
      }
      myShift += delta(cluster.mine);
      continue;
    }
    const mineText = applyWithin(base, cluster.regionStart, cluster.regionEnd, cluster.mine);
    const theirsText = applyWithin(base, cluster.regionStart, cluster.regionEnd, cluster.theirs);
    // Both sides made the same edit: nothing to ask about.
    if (mineText !== theirsText) {
      const from = cluster.regionStart + theirShift + myShift;
      conflicts.push(
        new Conflict({
          from,
          to: from + theirsText.length,
          mine: mineText,
          theirs: theirsText,
        }),
      );
    }
    theirShift += theirDelta;
  }

  return {
    text: TextChange.apply(TextChange.apply(base, theirs), changes),
    changes,
    conflicts,
  };
};
