/**
 * One file kept in step with the file hub, as plain values: what the hub has
 * (`base` at `version`), what the app has (`text`: base plus the edits not
 * yet written), and the lines where an outside change met an edit of ours
 * (`conflicts`). Each function takes the file and what happened and returns
 * the new file and, when the text changed under the editor, what the editor
 * must apply. The service (LiveFiles.ts) runs them; nothing here talks to
 * the network or the device.
 *
 * Outside changes win on disk: where one meets an edit of ours, the hub's
 * text is kept and ours is held as a conflict to offer back.
 * Decisions: docs/handoffs/live-file-sync.md.
 *
 * @internal
 */
import { FileSync, Rebase, TextChange } from "file-sync";

export interface LiveFile {
  /** The hub run `version` counts in. */
  readonly epoch: string;
  readonly version: number;
  /** The hub's text at `version`. */
  readonly base: string;
  /** The app's text: `base` plus our edits not yet written. */
  readonly text: string;
  /** Lines in `text` where an outside change met an edit of ours. */
  readonly conflicts: ReadonlyArray<Rebase.Conflict>;
  /** The file is gone from disk. */
  readonly deleted: boolean;
}

/** A range of the text, `[from, to)`. */
export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/** What an open editor must do after the text changed under it. */
export interface EditorUpdate {
  /** Turns the editor's text (the file's `text` before) into the new text. */
  readonly changes: TextChange.ChangeSet;
  readonly text: string;
  /** Whole lines the outside change touched, in the new text, to light. */
  readonly highlights: ReadonlyArray<TextRange>;
  readonly author: FileSync.Author | undefined;
}

export interface Received {
  readonly file: LiveFile;
  readonly editor: EditorUpdate | undefined;
}

/** What is kept on the device for a file: the hub's text as last seen, and an
 * edit not yet written. */
export interface Kept {
  readonly base: string | undefined;
  readonly edit: string | undefined;
}

/** The whole lines around each inserted span of `changes`, in the new text. */
const changedLines = (text: string, changes: TextChange.ChangeSet): ReadonlyArray<TextRange> => {
  const ranges: Array<TextRange> = [];
  let shift = 0;
  for (const change of changes) {
    const from = change.from + shift;
    const to = from + change.insert.length;
    shift += change.insert.length - (change.to - change.from);
    // A pure deletion has nothing to light but the line it closed up.
    const start = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", to > from && text[to - 1] === "\n" ? to - 1 : to);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const last = ranges.at(-1);
    if (last !== undefined && start <= last.to) {
      ranges[ranges.length - 1] = {
        from: last.from,
        to: Math.max(last.to, end),
      };
    } else {
      ranges.push({
        from: start,
        to: end,
      });
    }
  }
  return ranges;
};

/** Move conflict ranges along with `changes` to the text. */
const mapConflicts = (conflicts: ReadonlyArray<Rebase.Conflict>, changes: TextChange.ChangeSet): ReadonlyArray<Rebase.Conflict> =>
  changes.length === 0
    ? conflicts
    : conflicts.map(
        (conflict) =>
          new Rebase.Conflict({
            from: TextChange.mapPosition(changes, conflict.from),
            to: TextChange.mapPosition(changes, conflict.to, true),
            mine: conflict.mine,
            theirs: conflict.theirs,
          }),
      );

/** `light`: the change came from outside, so its lines are lit. */
const editorUpdate = (before: string, after: string, author: FileSync.Author | undefined, light: boolean): EditorUpdate | undefined => {
  if (before === after) return undefined;
  const changes = TextChange.diff(before, after);
  return {
    changes,
    text: after,
    highlights: light ? changedLines(after, changes) : [],
    author,
  };
};

/**
 * The hub's text, first on following and again after reconnecting. Our
 * edits (in memory, or kept on the device from before) are rebased onto it.
 */
export const synced = (previous: LiveFile | undefined, kept: Kept, event: FileSync.Synced): Received => {
  const base = previous?.base ?? kept.base ?? event.text;
  const text = previous?.text ?? kept.edit ?? base;
  const rebased = Rebase.rebase(base, TextChange.diff(base, text), TextChange.diff(base, event.text));
  const shownChanges = TextChange.diff(text, rebased.text);
  return {
    file: {
      epoch: event.epoch,
      version: event.version,
      base: event.text,
      text: rebased.text,
      conflicts: [...mapConflicts(previous?.conflicts ?? [], shownChanges), ...rebased.conflicts],
      deleted: false,
    },
    // Whatever changed while we were away is lit, by no one in particular.
    editor: editorUpdate(text, rebased.text, undefined, true),
  };
};

/** A change the hub sent. `undefined` when it does not follow on from the
 * file's version: follow again to resync. */
export const changed = (file: LiveFile, event: FileSync.Changed, clientID: string): Received | undefined => {
  if (event.version <= file.version) {
    return {
      file,
      editor: undefined,
    };
  }
  if (event.version !== file.version + 1) return undefined;
  const base = TextChange.apply(file.base, event.changes);
  // Our own write coming back: the hub has what we have.
  if (event.author instanceof FileSync.Client && event.author.clientID === clientID) {
    return {
      file: {
        ...file,
        version: event.version,
        base,
        deleted: false,
      },
      editor: undefined,
    };
  }
  const rebased = Rebase.rebase(file.base, TextChange.diff(file.base, file.text), event.changes);
  const shownChanges = TextChange.diff(file.text, rebased.text);
  return {
    file: {
      ...file,
      version: event.version,
      base,
      text: rebased.text,
      conflicts: [...mapConflicts(file.conflicts, shownChanges), ...rebased.conflicts].sort((a, b) => a.from - b.from),
      deleted: false,
    },
    editor: editorUpdate(file.text, rebased.text, event.author, true),
  };
};

/** The hub says the file is gone. Our text stays, to save elsewhere. */
export const deleted = (file: LiveFile, event: FileSync.Deleted): LiveFile =>
  event.version <= file.version
    ? file
    : {
        ...file,
        version: event.version,
        deleted: true,
      };

/** The hub took our write of `changes` (against `base`) as `version`. */
export const accepted = (file: LiveFile, changes: TextChange.ChangeSet, version: number): LiveFile =>
  version <= file.version
    ? file
    : {
        ...file,
        version,
        base: TextChange.apply(file.base, changes),
      };

/** Typing in the editor. */
export const edited = (file: LiveFile, text: string): LiveFile => ({
  ...file,
  text,
  conflicts: mapConflicts(file.conflicts, TextChange.diff(file.text, text)),
});

/** The write that would bring the hub up to the app's text. */
export const pendingWrite = (file: LiveFile): TextChange.ChangeSet => TextChange.diff(file.base, file.text);

/**
 * Settle the conflict at `index`: keep theirs (what is in the text now) or
 * put ours back over it.
 */
export const resolve = (file: LiveFile, index: number, keep: "Mine" | "Theirs"): Received => {
  const conflict = file.conflicts[index];
  if (conflict === undefined) {
    return {
      file,
      editor: undefined,
    };
  }
  const rest = file.conflicts.filter((_, at) => at !== index);
  if (keep === "Theirs") {
    return {
      file: {
        ...file,
        conflicts: rest,
      },
      editor: undefined,
    };
  }
  const text = TextChange.apply(file.text, [
    new TextChange.TextChange({
      from: conflict.from,
      to: conflict.to,
      insert: conflict.mine,
    }),
  ]);
  const shownChanges = TextChange.diff(file.text, text);
  return {
    file: {
      ...file,
      text,
      conflicts: mapConflicts(rest, shownChanges),
    },
    editor: editorUpdate(file.text, text, undefined, false),
  };
};
