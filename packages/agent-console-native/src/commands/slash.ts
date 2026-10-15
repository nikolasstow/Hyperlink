/**
 * The `/` word in a composer (docs/handoffs/slash-commands.md): what it
 * offers while typed, what space does with it, and what a sent message's
 * leading `/name` runs. Pure: the composer and the send path call these.
 *
 * Only a `/` at the very start counts, as in opencode's own clients.
 *
 * @internal
 */
import type { Commands } from "agent-console-protocol";

/** Rows the list shows at most. */
export const MAX_ROWS = 6;

/** The name typed after a leading `/`, while it is still being typed (no
 * space yet); undefined otherwise. */
export const slashQuery = (text: string): string | undefined => {
  const typed = /^\/(\S*)$/.exec(text);
  return typed?.[1];
};

/** The entries `query` offers: names starting with it first, then names
 * holding it, each group in the list's order. */
export const matches = (entries: ReadonlyArray<Commands.Entry>, query: string): ReadonlyArray<Commands.Entry> => {
  const wanted = query.toLowerCase();
  const starts = entries.filter((entry) => entry.name.toLowerCase().startsWith(wanted));
  const holds = entries.filter((entry) => !entry.name.toLowerCase().startsWith(wanted) && entry.name.toLowerCase().includes(wanted));
  return [...starts, ...holds].slice(0, MAX_ROWS);
};

/** The text once `entry` is accepted: its name after the `/`, then a space. */
export const accepted = (entry: Commands.Entry): string => `/${entry.name} `;

/**
 * What a space typed straight after the `/` word becomes (owner's rule):
 * the top match accepted (`/re` + space → `/review `), unless the word is
 * already an exact name or nothing matches (or it is a bare `/`); then it is
 * a plain space. Undefined when `next` is not such a space.
 */
export const spaceAccepts = (previous: string, next: string, entries: ReadonlyArray<Commands.Entry>): string | undefined => {
  const query = slashQuery(previous);
  if (query === undefined || query.length === 0 || next !== `${previous} `) return undefined;
  if (entries.some((entry) => entry.name === query)) return undefined;
  const top = matches(entries, query)[0];
  return top === undefined ? undefined : accepted(top);
};

/** A message's leading `/name`, when it names an entry: the entry, where the
 * word ends, and the text after it (the arguments). */
export interface Invocation {
  readonly entry: Commands.Entry;
  /** The `/name` word's length (it starts at 0). */
  readonly end: number;
  readonly args: string;
}

/** The entry a message's leading `/name` runs, if any. */
export const invocationOf = (text: string, entries: ReadonlyArray<Commands.Entry>): Invocation | undefined => {
  const head = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  const name = head?.[1];
  if (name === undefined) return undefined;
  const entry = entries.find((each) => each.name === name);
  return entry === undefined ? undefined : { entry, end: name.length + 1, args: (head?.[2] ?? "").trim() };
};
