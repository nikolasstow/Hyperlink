/**
 * What of a model's answer becomes the suggestion, as the best editors shape
 * it: one line in the middle of a line; on an empty line, a block of lines up
 * to where the code steps out of the block the caret is in. Pure.
 *
 * @internal
 */

/** Lines a block suggestion has at most. */
const MOST_LINES = 10;

const indentOf = (line: string): number => (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;

/** Whether the caret is on a line of its own (only space before and after
 * it): then a block fits. */
export const isOwnLine = (prefix: string, suffix: string): boolean =>
  /^[ \t]*$/.test(prefix.slice(prefix.lastIndexOf("\n") + 1)) && /^[ \t]*$/.test(suffix.split("\n", 1)[0] ?? "");

/** The suggestion made of `answer`, for a caret after `prefix`. */
export const shape = (answer: string, prefix: string, ownLine: boolean): string => {
  const lines = answer.split("\n");
  if (!ownLine) return (lines[0] ?? "").replace(/\s+$/, "");
  // The caret's line is indented as far as what was typed before it there.
  const base = indentOf(prefix.slice(prefix.lastIndexOf("\n") + 1) + (lines[0] ?? ""));
  const kept: Array<string> = [lines[0] ?? ""];
  for (const line of lines.slice(1)) {
    if (kept.length >= MOST_LINES) break;
    if (line.trim() !== "" && indentOf(line) < base) break;
    kept.push(line);
  }
  return kept.join("\n").replace(/\s+$/, "");
};
