/**
 * Scope ranges for sticky scroll / folding, from a REAL parser — not an
 * indentation heuristic:
 *
 * - TS / TSX / JS / JSX / JSON → the TypeScript compiler's AST
 *   (`ts.createSourceFile`, parser only — no type checker, no file system).
 * - Markdown → ATX heading levels.
 * - anything else → none (remote / tree-sitter is the later universal path;
 *   see docs/handoffs/code-intelligence.md).
 *
 * The native editor renders the sticky overlay from these ranges (passed as a
 * JSON prop), so this algorithm stays improvable over Metro with no rebuild.
 * Lines are 0-based, matching the native side.
 *
 * `typescript` is imported lazily, so its weight only lands when a TS/JS file is
 * opened, not at app start.
 *
 * @internal
 */
import type TS from "typescript";

/** A nestable scope: its header line (the `function foo() {` line), the line
 * span it covers, and how deeply nested it is. */
export interface StickyRange {
  readonly header: number;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
  /** A concise signature for the glass pill (`func doSomething`, `class Foo`, a
   * heading's text). Absent for anonymous scopes (bare `if`/`for`/object
   * literals), which don't earn a pill. */
  readonly label?: string;
}

/** `langFromFilename` hands us the raw extension (`ts`, `md`, …); map it to a
 * canonical id the way the highlighter aliases do, so `.ts`/`.md` aren't missed. */
const CANONICAL: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
};

const TS_CANON = new Set(["typescript", "tsx", "javascript", "jsx", "json"]);

let tsModule: typeof TS | undefined;
const loadTs = async (): Promise<typeof TS> => {
  if (tsModule === undefined) tsModule = (await import("typescript")).default ?? (await import("typescript"));
  return tsModule;
};

/** A `const`/`let`/`var` statement whose value is itself a function or class gets
 * its sticky from that inner node (labelled `func foo`/`class Foo`), so the
 * statement itself shouldn't double up. Everything else (`const x = { … }`,
 * `const x: { … } = …`, a long call, etc.) does earn one. */
const initializerIsOwnScope = (ts: typeof TS, node: TS.VariableStatement): boolean => {
  const init = node.declarationList.declarations[0]?.initializer;
  return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init));
};

/** Node kinds that get a sticky header — declarations and multi-line blocks, the
 * things you lose the top of when scrolling through a big body. */
const isContainer = (ts: typeof TS, node: TS.Node): boolean => {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.ModuleDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.TryStatement:
    case ts.SyntaxKind.ObjectLiteralExpression:
      return true;
    case ts.SyntaxKind.VariableStatement:
      return ts.isVariableStatement(node) && !initializerIsOwnScope(ts, node);
    default:
      return false;
  }
};

/** A short pill label for a scope — kind + name — or undefined for anonymous
 * scopes that shouldn't get a pill. Uses `ts.isX` guards (no casts). */
const labelFor = (ts: typeof TS, node: TS.Node): string | undefined => {
  const named = (name: TS.Node | undefined): string | undefined =>
    name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
  if (ts.isFunctionDeclaration(node)) return named(node.name) === undefined ? undefined : `func ${named(node.name)}`;
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return named(node.name);
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isGetAccessorDeclaration(node)) return named(node.name) === undefined ? undefined : `get ${named(node.name)}`;
  if (ts.isSetAccessorDeclaration(node)) return named(node.name) === undefined ? undefined : `set ${named(node.name)}`;
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return named(node.name) === undefined ? undefined : `class ${named(node.name)}`;
  if (ts.isInterfaceDeclaration(node)) return `interface ${node.name.text}`;
  if (ts.isEnumDeclaration(node)) return `enum ${node.name.text}`;
  if (ts.isModuleDeclaration(node)) return `namespace ${node.name.getText()}`;
  if (ts.isTypeAliasDeclaration(node)) return `type ${node.name.text}`;
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    const keyword = (node.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const" : (node.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var";
    return decl !== undefined && ts.isIdentifier(decl.name) ? `${keyword} ${decl.name.text}` : undefined;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return `func ${parent.name.text}`;
    if (parent !== undefined && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return `func ${parent.name.text}`;
    return undefined;
  }
  return undefined;
};

const tsRanges = (ts: typeof TS, text: string, scriptKind: TS.ScriptKind): ReadonlyArray<StickyRange> => {
  const sourceFile = ts.createSourceFile("sticky", text, ts.ScriptTarget.Latest, true, scriptKind);
  const out: Array<StickyRange> = [];
  const visit = (node: TS.Node, depth: number): void => {
    let childDepth = depth;
    if (isContainer(ts, node)) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
      // Only multi-line scopes are worth pinning.
      if (end > start) {
        const label = labelFor(ts, node);
        out.push(label === undefined ? { header: start, start, end, depth } : { header: start, start, end, depth, label });
        childDepth = depth + 1;
      }
    }
    ts.forEachChild(node, (child) => visit(child, childDepth));
  };
  visit(sourceFile, 0);
  return out;
};

/** ATX markdown headings: a heading's block runs until the next heading of the
 * same or higher level; depth is the heading level minus one. */
const markdownRanges = (text: string): ReadonlyArray<StickyRange> => {
  const lines = text.split("\n");
  const headings: Array<{ readonly line: number; readonly level: number }> = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (match !== null) headings.push({ line: i, level: match[1].length });
  }
  const out: Array<StickyRange> = [];
  for (let i = 0; i < headings.length; i++) {
    const here = headings[i];
    let end = lines.length - 1;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= here.level) {
        end = headings[j].line - 1;
        break;
      }
    }
    if (end > here.line) {
      const label = lines[here.line].replace(/^#{1,6}\s+/, "").trim();
      out.push({ header: here.line, start: here.line, end, depth: here.level - 1, label });
    }
  }
  return out;
};

/** Sticky ranges for `text` in `lang` (the id from `langFromFilename`). Empty
 * for languages without an on-device parser yet. */
export const stickyRanges = async (text: string, lang: string): Promise<ReadonlyArray<StickyRange>> => {
  const canonical = CANONICAL[lang] ?? lang;
  if (canonical === "markdown") return markdownRanges(text);
  if (!TS_CANON.has(canonical)) return [];
  const ts = await loadTs();
  const scriptKind =
    canonical === "tsx"
      ? ts.ScriptKind.TSX
      : canonical === "jsx"
        ? ts.ScriptKind.JSX
        : canonical === "javascript"
          ? ts.ScriptKind.JS
          : canonical === "json"
            ? ts.ScriptKind.JSON
            : ts.ScriptKind.TS;
  return tsRanges(ts, text, scriptKind);
};
