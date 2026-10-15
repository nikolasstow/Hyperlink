/**
 * A file's problems where they are in the text you see. The server found them
 * in the hub's copy (the file as last saved); edits you have not saved yet
 * move the text after them, so each offset is carried through those edits.
 *
 * @internal
 */
import type { Language } from "agent-console-protocol";
import { TextChange } from "file-sync";

/** `offset` in `base`, carried through `changes` (sorted, against `base`). An
 * offset inside a replaced span stays inside its replacement. */
export const carry = (offset: number, changes: TextChange.ChangeSet): number => {
  let shift = 0;
  for (const change of changes) {
    if (change.to <= offset && !(change.from === change.to && change.from === offset)) {
      shift += change.insert.length - (change.to - change.from);
      continue;
    }
    if (change.from < offset) return change.from + shift + Math.min(offset - change.from, change.insert.length);
    break;
  }
  return offset + shift;
};

/** `found` (offsets into `base`) where they are in `text`. */
export const shownDiagnostics = (found: ReadonlyArray<Language.Diagnostic>, base: string, text: string): ReadonlyArray<Language.Diagnostic> => {
  if (base === text) return found;
  const changes = TextChange.diff(base, text);
  return found.map((diagnostic) => ({ ...diagnostic, start: carry(diagnostic.start, changes), end: carry(diagnostic.end, changes) }));
};
