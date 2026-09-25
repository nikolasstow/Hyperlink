/**
 * Make `vscode` resolve to the shim, for both module systems an extension may be
 * written in.
 *
 * Effect has no service for Node's module loader, so this is the one place that
 * touches it, behind a single Effect (the platform-services rule's escape
 * hatch):
 *   - CommonJS (`require("vscode")`, e.g. the npm extension): the resolver maps
 *     the name to a cache entry holding the shim.
 *   - ES modules (`import … from "vscode"`, e.g. Prettier): a loader hook maps
 *     the specifier to generated source that re-exports the shim's members,
 *     since ESM named imports need real export bindings.
 */
import Module, { createRequire, register } from "node:module";
import { Data, Effect, Predicate } from "effect";

class LoaderError extends Data.TaggedError("LoaderError")<{
  readonly message: string;
}> {}

const shimGlobal = "__vscodeShim";
const shimUrl = "vscode-shim:vscode";

const hooksSource = (members: ReadonlyArray<string>): string => `
export async function resolve(specifier, context, next) {
  if (specifier === "vscode") return { url: "${shimUrl}", shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === "${shimUrl}") {
    return {
      format: "module",
      shortCircuit: true,
      source: "const v = globalThis.${shimGlobal}; export default v; export const { ${members.join(", ")} } = v;",
    };
  }
  return next(url, context);
}
`;

const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

/** The names an ES-module extension imports from `vscode`. Named imports are
 * bound when the module links, so each needs a real export: an unimplemented
 * one still gets a binding (to the shim's recorded stub) instead of a link error. */
export const importedNames = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']vscode["']/g)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? "")
      .filter(isIdentifier),
  );

export const installVscodeModule = (vscode: object, extraNames: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const original: unknown = Reflect.get(Module, "_resolveFilename");
    if (!Predicate.isFunction(original)) {
      return yield* new LoaderError({ message: "Module._resolveFilename is not a function in this Node version" });
    }
    yield* Effect.sync(() => {
      Reflect.set(globalThis, shimGlobal, vscode);

      const entry = new Module("vscode");
      entry.exports = vscode;
      entry.loaded = true;
      entry.filename = "vscode";
      createRequire(import.meta.url).cache["vscode"] = entry;
      Reflect.set(Module, "_resolveFilename", function (this: unknown, request: unknown, ...rest: ReadonlyArray<unknown>) {
        return request === "vscode" ? "vscode" : original.apply(this, [request, ...rest]);
      });

      const members = [...new Set([...Object.keys(vscode), ...extraNames])].filter(isIdentifier);
      register(`data:text/javascript,${encodeURIComponent(hooksSource(members))}`);
    });
  });
