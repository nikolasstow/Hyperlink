/**
 * What an inline suggestion is given of the other open files, as the best
 * editors do (Copilot's neighboring tabs): the chunks of them most like the
 * code at the caret, by the names they share. Pure.
 *
 * @internal
 */

/** A chunk of another file. */
export interface Snippet {
  readonly path: string;
  readonly text: string;
}

/** Lines in a chunk, and how far apart chunks start. */
const CHUNK_LINES = 20;
const CHUNK_STEP = 10;
/** Chunks given at most, and how alike one must be. */
const MOST = 3;
const LEAST_ALIKE = 0.1;

/** Words every file has: they say nothing about which code is alike. */
const KEYWORDS: ReadonlySet<string> = new Set(
  "const let var function return export import from default class extends implements interface type readonly async await yield new this true false null undefined void string number boolean any unknown never if else for while switch case break continue try catch finally throw typeof instanceof".split(" "),
);

const namesOf = (text: string): ReadonlySet<string> => new Set((text.match(/[A-Za-z_$][\w$]{2,}/g) ?? []).filter((name) => !KEYWORDS.has(name)));

/** How alike two sets of names are: shared over all (Jaccard). */
const alike = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const name of a) if (b.has(name)) shared++;
  return shared / (a.size + b.size - shared);
};

/** The chunks of `files` (not the one at `path`) most like the end of `prefix`. */
export const snippetsFor = (path: string, prefix: string, files: ReadonlyArray<{ readonly path: string; readonly text: string }>): ReadonlyArray<Snippet> => {
  const near = namesOf(prefix.split("\n").slice(-CHUNK_LINES).join("\n"));
  const scored: Array<{ readonly snippet: Snippet; readonly score: number }> = [];
  for (const file of files) {
    if (file.path === path) continue;
    const lines = file.text.split("\n");
    for (let start = 0; start < Math.max(lines.length - CHUNK_LINES + CHUNK_STEP, 1); start += CHUNK_STEP) {
      const text = lines.slice(start, start + CHUNK_LINES).join("\n");
      const score = alike(near, namesOf(text));
      if (score >= LEAST_ALIKE) scored.push({ snippet: { path: file.path, text }, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MOST)
    .map((each) => each.snippet);
};
