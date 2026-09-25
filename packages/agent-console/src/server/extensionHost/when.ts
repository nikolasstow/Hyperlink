/**
 * VS Code `when` clauses, evaluated against a context.
 *
 * Manifests decide where a command shows with these: a menu entry carrying
 * `view == npm && viewItem == script` belongs on the npm view's script rows and
 * nowhere else. Supported: `||`, `&&`, `!`, parentheses, `==`, `!=`,
 * `=~ /regex/flags`, bare keys (truthy), `true` / `false`, and values bare or
 * quoted. A clause outside that is a parse failure, reported rather than
 * guessed at, because guessing would put an action on rows it was never meant
 * for.
 *
 * Pure: no Effect, since there is nothing to run.
 *
 * @internal
 */
import { Result } from "effect";

export type WhenContext = ReadonlyMap<string, unknown>;

type Token =
  | { readonly kind: "and" | "or" | "not" | "open" | "close" | "eq" | "neq" | "match" }
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "regex"; readonly source: string; readonly flags: string };

const symbols: ReadonlyArray<readonly [string, "and" | "or" | "eq" | "neq" | "match" | "not" | "open" | "close"]> = [
  ["&&", "and"],
  ["||", "or"],
  ["==", "eq"],
  ["!=", "neq"],
  ["=~", "match"],
  ["!", "not"],
  ["(", "open"],
  [")", "close"],
];

/** Scan from `at`, accumulating tokens. Clauses are a line long, so the
 * recursion depth is bounded by one short string. */
const scan = (input: string, at: number, acc: ReadonlyArray<Token>): Result.Result<ReadonlyArray<Token>, string> => {
  if (at >= input.length) return Result.succeed(acc);
  const rest = input.slice(at);
  const ch = input[at] ?? "";
  if (/\s/.test(ch)) return scan(input, at + 1, acc);
  const symbol = symbols.find(([text]) => rest.startsWith(text));
  if (symbol !== undefined) return scan(input, at + symbol[0].length, [...acc, { kind: symbol[1] }]);
  if (ch === "/" && acc.at(-1)?.kind === "match") {
    const regex = /^\/((?:\\.|[^/\\])*)\/([a-z]*)/.exec(rest);
    if (regex === null) return Result.fail(`unterminated regex at ${at}`);
    return scan(input, at + regex[0].length, [...acc, { kind: "regex", source: regex[1] ?? "", flags: regex[2] ?? "" }]);
  }
  if (ch === "'" || ch === '"') {
    const end = input.indexOf(ch, at + 1);
    if (end < 0) return Result.fail(`unterminated string at ${at}`);
    return scan(input, end + 1, [...acc, { kind: "word", text: input.slice(at + 1, end) }]);
  }
  const word = /^[^\s()!=&|~]+/.exec(rest);
  if (word === null) return Result.fail(`unexpected '${ch}' at ${at}`);
  return scan(input, at + word[0].length, [...acc, { kind: "word", text: word[0] }]);
};

const tokenize = (input: string) => scan(input, 0, []);

type Node =
  | { readonly kind: "or" | "and"; readonly left: Node; readonly right: Node }
  | { readonly kind: "not"; readonly operand: Node }
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "literal"; readonly value: boolean }
  | { readonly kind: "eq" | "neq"; readonly key: string; readonly value: string }
  | { readonly kind: "match"; readonly key: string; readonly regex: RegExp };

interface Parsed {
  readonly node: Node;
  readonly next: number;
}

const parseOr = (tokens: ReadonlyArray<Token>, at: number): Result.Result<Parsed, string> =>
  parseAnd(tokens, at).pipe(
    Result.flatMap(function loop(left): Result.Result<Parsed, string> {
      if (tokens[left.next]?.kind !== "or") return Result.succeed(left);
      return parseAnd(tokens, left.next + 1).pipe(
        Result.flatMap((right) => loop({ node: { kind: "or", left: left.node, right: right.node }, next: right.next })),
      );
    }),
  );

const parseAnd = (tokens: ReadonlyArray<Token>, at: number): Result.Result<Parsed, string> =>
  parseUnary(tokens, at).pipe(
    Result.flatMap(function loop(left): Result.Result<Parsed, string> {
      if (tokens[left.next]?.kind !== "and") return Result.succeed(left);
      return parseUnary(tokens, left.next + 1).pipe(
        Result.flatMap((right) => loop({ node: { kind: "and", left: left.node, right: right.node }, next: right.next })),
      );
    }),
  );

const parseUnary = (tokens: ReadonlyArray<Token>, at: number): Result.Result<Parsed, string> => {
  const token = tokens[at];
  if (token === undefined) return Result.fail("unexpected end of clause");
  if (token.kind === "not") {
    return parseUnary(tokens, at + 1).pipe(Result.map((inner) => ({ node: { kind: "not", operand: inner.node }, next: inner.next })));
  }
  if (token.kind === "open") {
    return parseOr(tokens, at + 1).pipe(
      Result.flatMap((inner) =>
        tokens[inner.next]?.kind === "close" ? Result.succeed({ node: inner.node, next: inner.next + 1 }) : Result.fail("missing )"),
      ),
    );
  }
  if (token.kind !== "word") return Result.fail(`unexpected ${token.kind}`);
  if (token.text === "true" || token.text === "false") {
    return Result.succeed({ node: { kind: "literal", value: token.text === "true" }, next: at + 1 });
  }
  const operator = tokens[at + 1];
  const operand = tokens[at + 2];
  if ((operator?.kind === "eq" || operator?.kind === "neq") && operand?.kind === "word") {
    return Result.succeed({ node: { kind: operator.kind, key: token.text, value: operand.text }, next: at + 3 });
  }
  if (operator?.kind === "match" && operand?.kind === "regex") {
    return Result.try({
      try: () => new RegExp(operand.source, operand.flags),
      catch: () => `invalid regex /${operand.source}/`,
    }).pipe(Result.map((regex) => ({ node: { kind: "match", key: token.text, regex }, next: at + 3 })));
  }
  return Result.succeed({ node: { kind: "key", key: token.text }, next: at + 1 });
};

const evaluate = (node: Node, context: WhenContext): boolean => {
  switch (node.kind) {
    case "or":
      return evaluate(node.left, context) || evaluate(node.right, context);
    case "and":
      return evaluate(node.left, context) && evaluate(node.right, context);
    case "not":
      return !evaluate(node.operand, context);
    case "literal":
      return node.value;
    case "key":
      return Boolean(context.get(node.key));
    case "eq":
      return String(context.get(node.key) ?? "") === node.value;
    case "neq":
      return String(context.get(node.key) ?? "") !== node.value;
    case "match":
      return node.regex.test(String(context.get(node.key) ?? ""));
  }
};

/** Whether `clause` holds in `context`. An absent clause always holds. */
export const matchesWhen = (clause: string | undefined, context: WhenContext): Result.Result<boolean, string> =>
  clause === undefined || clause.trim() === ""
    ? Result.succeed(true)
    : tokenize(clause).pipe(
        Result.flatMap((list) =>
          parseOr(list, 0).pipe(
            Result.flatMap((parsed) =>
              parsed.next === list.length ? Result.succeed(evaluate(parsed.node, context)) : Result.fail(`trailing input in "${clause}"`),
            ),
          ),
        ),
      );
