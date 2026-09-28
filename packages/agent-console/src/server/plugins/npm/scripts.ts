/**
 * How the NPM plugin reads a script: a title for people, and the categories
 * it goes in until the user sorts it themselves.
 *
 * Both come from the script's name and command by rule. A script no rule
 * places has no category; labeling those is the AI's job (§23.3).
 *
 * @internal
 */
import type { PluginCategory } from "../../plugin/api";

/** The categories the plugin assigns. */
export const scriptCategories: ReadonlyArray<PluginCategory> = [
  {
    id: "build",
    name: "Build",
    icon: "sf:hammer",
  },
  {
    id: "develop",
    name: "Develop",
    icon: "sf:play.circle",
  },
  {
    id: "test",
    name: "Test",
    icon: "sf:checkmark.seal",
  },
  {
    id: "lint",
    name: "Lint",
    icon: "sf:wand.and.stars",
  },
  {
    id: "format",
    name: "Format",
    icon: "sf:text.alignleft",
  },
  {
    id: "typecheck",
    name: "Typecheck",
    icon: "sf:checklist",
  },
  {
    id: "generate",
    name: "Generate",
    icon: "sf:sparkles",
  },
  {
    id: "release",
    name: "Release",
    icon: "sf:paperplane",
  },
  {
    id: "deploy",
    name: "Deploy",
    icon: "sf:icloud.and.arrow.up",
  },
  {
    id: "database",
    name: "Database",
    icon: "sf:cylinder",
  },
  {
    id: "docs",
    name: "Docs",
    icon: "sf:book",
  },
  {
    id: "setup",
    name: "Setup",
    icon: "sf:wrench.and.screwdriver",
  },
  {
    id: "clean",
    name: "Clean",
    icon: "sf:trash",
  },
];

/** Words in a script's name, and the category each means. */
const nameWords: Readonly<Record<string, string>> = {
  build: "build",
  compile: "build",
  bundle: "build",
  dev: "develop",
  start: "develop",
  serve: "develop",
  watch: "develop",
  preview: "develop",
  test: "test",
  tests: "test",
  e2e: "test",
  spec: "test",
  coverage: "test",
  lint: "lint",
  check: "lint",
  format: "format",
  fmt: "format",
  prettier: "format",
  typecheck: "typecheck",
  types: "typecheck",
  tsc: "typecheck",
  gen: "generate",
  generate: "generate",
  codegen: "generate",
  release: "release",
  publish: "release",
  version: "release",
  changeset: "release",
  pack: "release",
  deploy: "deploy",
  ship: "deploy",
  db: "database",
  migrate: "database",
  migration: "database",
  seed: "database",
  docs: "docs",
  doc: "docs",
  storybook: "docs",
  install: "setup",
  setup: "setup",
  bootstrap: "setup",
  prepare: "setup",
  clean: "clean",
  reset: "clean",
  purge: "clean",
};

/** Tools in a script's command, and the category running each means. */
const commandTools: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(vitest|jest|mocha|playwright test|cypress run|ava)\b/, "test"],
  [/\b(eslint|oxlint|biome lint|stylelint)\b/, "lint"],
  [/\b(prettier|biome format|dprint)\b/, "format"],
  [/\btsc\b[^|&;]*--noEmit\b/, "typecheck"],
  [/\b(vite build|next build|tsup|rollup|webpack|esbuild|tsc -b|tsc --build|expo export)\b/, "build"],
  [/\b(nodemon|tsx watch|next dev|expo start)\b/, "develop"],
  [/\bchangeset\b/, "release"],
  [/\b(rimraf|rm -rf)\b/, "clean"],
  [/\b(prisma|drizzle-kit|knex migrate)\b/, "database"],
];

/** A script name's words: `build:ios` is build, ios. npm runs `pre<x>` and
 * `post<x>` around `<x>`, so those count as `<x>` too. */
const wordsOf = (name: string): ReadonlyArray<string> =>
  name
    .toLowerCase()
    .split(/[:\-_./\s]+/)
    .filter((word) => word.length > 0)
    .flatMap((word) => {
      const lifecycle = /^(pre|post)(.+)$/.exec(word)?.[2];
      return lifecycle !== undefined && nameWords[lifecycle] !== undefined ? [word, lifecycle] : [word];
    });

/** The categories a script goes in by rule, in the order of `scriptCategories`.
 * A script can be in several (`test:watch` tests and watches). */
export const categorize = (name: string, command: string): ReadonlyArray<string> => {
  const found = new Set([
    ...wordsOf(name).flatMap((word) => {
      const category = nameWords[word];
      return category === undefined ? [] : [category];
    }),
    ...commandTools.flatMap(([pattern, category]) => (pattern.test(command) ? [category] : [])),
  ]);
  return scriptCategories.map((category) => category.id).filter((id) => found.has(id));
};

/** Words written a set way rather than capitalized. */
const spelled: Readonly<Record<string, string>> = {
  api: "API",
  ci: "CI",
  cli: "CLI",
  css: "CSS",
  db: "DB",
  e2e: "E2E",
  eas: "EAS",
  esm: "ESM",
  cjs: "CJS",
  html: "HTML",
  http: "HTTP",
  ios: "iOS",
  js: "JS",
  json: "JSON",
  lsp: "LSP",
  pr: "PR",
  pwa: "PWA",
  sdk: "SDK",
  sql: "SQL",
  ssr: "SSR",
  ts: "TS",
  tsc: "TSC",
  ui: "UI",
  url: "URL",
  macos: "macOS",
  tvos: "tvOS",
  watchos: "watchOS",
  vscode: "VS Code",
};

const wordTitle = (word: string): string => spelled[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/**
 * A script's title: `build:ios` is "Build iOS". `pre<x>` and `post<x>`, for a
 * script `<x>` the package has, are "Before <X>" and "After <X>", which is
 * when npm runs them.
 */
export const titleOf = (name: string, siblings: ReadonlySet<string>): string => {
  const lifecycle = /^(pre|post)(.+)$/.exec(name);
  const around = lifecycle?.[2];
  if (lifecycle !== null && around !== undefined && siblings.has(around)) {
    return `${lifecycle[1] === "pre" ? "Before" : "After"} ${titleOf(around, siblings)}`;
  }
  return name
    .split(/[:\-_./\s]+/)
    .filter((word) => word.length > 0)
    .map(wordTitle)
    .join(" ");
};
