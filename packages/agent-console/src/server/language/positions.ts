/**
 * Places in a text both ways: the language server's (line, character), and the
 * app's offset. Both count UTF-16 code units, as JavaScript strings do.
 *
 * @internal
 */

export interface Position {
  readonly line: number;
  readonly character: number;
}

/** Where each line of `text` starts. */
export const lineStarts = (text: string): ReadonlyArray<number> => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
};

/** `position` as an offset, kept inside the text (a server may name the end
 * of a line, or of the file, loosely). */
export const offsetOf = (text: string, starts: ReadonlyArray<number>, position: Position): number => {
  const line = Math.min(Math.max(position.line, 0), starts.length - 1);
  const lineStart = starts[line] ?? 0;
  const lineEnd = line + 1 < starts.length ? (starts[line + 1] ?? text.length) - 1 : text.length;
  return Math.min(lineStart + Math.max(position.character, 0), lineEnd);
};

/** `offset` as a (line, character). */
export const positionOf = (starts: ReadonlyArray<number>, offset: number): Position => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: offset - (starts[low] ?? 0) };
};
