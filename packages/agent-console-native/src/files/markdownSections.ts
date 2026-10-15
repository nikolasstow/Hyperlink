/**
 * A Markdown file cut at its headings, for the rendered view
 * (MarkdownReader.tsx): each section is drawn on its own, so the view knows
 * which heading is at the top as it scrolls, for the breadcrumbs. The
 * headings are the parser's (stickyRanges.ts), so a `#` in a code fence is
 * not one.
 *
 * @internal
 */
import type { StickyRange } from "./stickyRanges";

/** A run of the file: from a heading (or the top) to the next heading. */
export interface MarkdownSection {
  /** Its first line (0-based). */
  readonly line: number;
  readonly text: string;
}

/** `text` cut before each heading line in `ranges`. The part above the first
 * heading is a section too, when it holds anything. */
export const markdownSections = (text: string, ranges: ReadonlyArray<StickyRange>): ReadonlyArray<MarkdownSection> => {
  const lines = text.split("\n");
  const cuts = [...new Set([0, ...ranges.map((range) => range.header)])].filter((line) => line < lines.length).sort((a, b) => a - b);
  return cuts.flatMap((line, index) => {
    const section = lines.slice(line, cuts[index + 1] ?? lines.length).join("\n");
    return section.trim() === "" ? [] : [{ line, text: section }];
  });
};

/** The line at the top of the view: the first line of the last section whose
 * top is at or above `y` (`tops` by section, as laid out). */
export const lineAtTop = (sections: ReadonlyArray<MarkdownSection>, tops: ReadonlyArray<number | undefined>, y: number): number => {
  let line = sections[0]?.line ?? 0;
  sections.forEach((section, index) => {
    const top = tops[index];
    if (top !== undefined && top <= y) line = section.line;
  });
  return line;
};
