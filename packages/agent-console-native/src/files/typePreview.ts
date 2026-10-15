/**
 * The type preview in the glass that expands from the breadcrumbs
 * (docs/handoffs/code-intelligence.md): what it asks the language server
 * about, and how it lays out what comes back. Pure.
 *
 * @internal
 */
import type { ScopeSymbol } from "./stickyRanges";

/** Where in `text` the innermost scope's name is: what the preview asks
 * about while no caret says otherwise. Undefined when no scope is named. */
export const scopeAnchor = (text: string, scopes: ReadonlyArray<ScopeSymbol>): number | undefined => {
  const scope = scopes.findLast((each) => each.line !== undefined);
  if (scope?.line === undefined) return undefined;
  let start = 0;
  for (let line = 0; line < scope.line; line++) {
    const next = text.indexOf("\n", start);
    if (next === -1) return undefined;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  const lineText = text.slice(start, end === -1 ? text.length : end);
  const word = new RegExp(`(?<![\\w$])${scope.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).exec(lineText);
  return word === null ? undefined : start + word.index;
};

/** A hover, as the preview shows it: its code (the type, compact), then its
 * docs (Markdown). */
export interface HoverParts {
  readonly code: ReadonlyArray<{ readonly lang: string; readonly text: string }>;
  readonly docs: string;
}

/** The fenced code at the top of a hover's Markdown, and the rest. */
export const hoverParts = (markdown: string): HoverParts => {
  const code: Array<{ readonly lang: string; readonly text: string }> = [];
  let rest = markdown.trimStart();
  for (;;) {
    const fence = /^```([\w-]*)\n([\s\S]*?)\n```\s*/.exec(rest);
    if (fence === null) break;
    code.push({ lang: fence[1] === "" ? "typescript" : (fence[1] ?? "typescript"), text: fence[2] ?? "" });
    rest = rest.slice(fence[0].length);
  }
  return { code, docs: rest.trim() };
};
