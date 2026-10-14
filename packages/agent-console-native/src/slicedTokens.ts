/**
 * Colouring code a line at a time, in short slices of the JS thread, so a
 * large file never holds it (a whole file in one go took seconds). The grammar
 * state after every line is kept, so after an edit only the lines from the
 * change on are coloured again, until the state comes back to what it was and
 * the rest is as before (as VS Code does).
 *
 * The tokenizer itself is passed in (`line`): Shiki in the app, the same in the
 * tests.
 *
 * @internal
 */

/** A text coloured line by line, with what is needed to colour an edit of it. */
export interface Sliced<Token, State> {
  /** Each line's tokens. */
  readonly lines: ReadonlyArray<ReadonlyArray<Token>>;
  /** Each line's text. */
  readonly texts: ReadonlyArray<string>;
  /** The grammar state after each line. */
  readonly ends: ReadonlyArray<State | undefined>;
}

/** Raised when the colouring is no longer wanted (a newer text came). */
export class Superseded extends Error {
  constructor() {
    super("superseded by a newer text");
  }
}

/** Lines as Shiki splits them. */
export const linesOf = (code: string): ReadonlyArray<string> => code.split(/\r?\n/);

export const tokenizeInSlices = async <Token, State>(params: {
  readonly code: string;
  /** The last colouring of this document (same language and theme), if any. */
  readonly previous: Sliced<Token, State> | undefined;
  /** Colour one line, starting from the state after the line before it. */
  readonly line: (text: string, state: State | undefined) => { readonly tokens: ReadonlyArray<Token>; readonly state: State | undefined };
  /** Whether two states are the same (the rest of the text colours alike). */
  readonly sameState: (a: State | undefined, b: State | undefined) => boolean;
  /** How long a slice may hold the thread, ms. */
  readonly budgetMs: number;
  /** Give the thread back between slices. */
  readonly pause: () => Promise<void>;
  /** False once the colouring is no longer wanted. */
  readonly stillWanted: () => boolean;
}): Promise<Sliced<Token, State>> => {
  const texts = linesOf(params.code);
  const previous = params.previous;
  const old = previous?.texts ?? [];
  // The first line that changed, and how many at the end did not.
  let first = 0;
  while (first < texts.length && first < old.length && texts[first] === old[first]) first++;
  let same = 0;
  while (same < texts.length - first && same < old.length - first && texts[texts.length - 1 - same] === old[old.length - 1 - same]) same++;
  const shift = texts.length - old.length;

  const lines: Array<ReadonlyArray<Token>> = previous === undefined ? [] : previous.lines.slice(0, first);
  const ends: Array<State | undefined> = previous === undefined ? [] : previous.ends.slice(0, first);
  let state = first === 0 ? undefined : ends[first - 1];
  let sliceStart = Date.now();
  for (let index = lines.length; index < texts.length; index++) {
    const coloured = params.line(texts[index] ?? "", state);
    lines.push(coloured.tokens);
    ends.push(coloured.state);
    state = coloured.state;
    // In the unchanged end, and back in the state it had there: the rest
    // colours as before.
    if (previous !== undefined && index >= texts.length - same) {
      const was = index - shift;
      if (params.sameState(state, previous.ends[was])) {
        lines.push(...previous.lines.slice(was + 1));
        ends.push(...previous.ends.slice(was + 1));
        break;
      }
    }
    if (Date.now() - sliceStart >= params.budgetMs) {
      await params.pause();
      if (!params.stillWanted()) throw new Superseded();
      sliceStart = Date.now();
    }
  }
  return { lines, texts, ends };
};
