/**
 * File-type icons, keyed by extension (and a few special filenames), in the
 * spirit of VS Code's Seti theme — a category glyph tinted with the language's
 * brand colour. Every file resolves to something: an unknown extension falls back
 * to a plain document.
 *
 * This is the pragmatic first pass using SF Symbols (safe, already in the binary,
 * theme-adaptive) rather than bundling VS Code's actual SVG/font icon set — that
 * exact-glyph swap is a later step; only `iconForFile` and the renderer change,
 * not the callers.
 *
 * @internal
 */
import type { SFSymbol } from "sf-symbols-typescript";

export type FileIconSpec = {
  readonly symbol: SFSymbol;
  readonly color: string;
};

const CODE: SFSymbol = "chevron.left.forwardslash.chevron.right";
const DATA: SFSymbol = "curlybraces";
const DOC: SFSymbol = "doc.fill";
const GREY = "#8E8E93";

/** Brand-coloured code files all share the `</>` glyph; colour tells them apart,
 * the way Seti leans on colour. */
const codeIcon = (color: string): FileIconSpec => ({ symbol: CODE, color });
const dataIcon = (color: string): FileIconSpec => ({ symbol: DATA, color });

/** Exact filenames VS Code recognises regardless of extension. */
const BY_NAME: Record<string, FileIconSpec> = {
  "package.json": { symbol: "shippingbox.fill", color: "#CB3837" },
  "package-lock.json": { symbol: "lock.fill", color: "#CB3837" },
  "pnpm-lock.yaml": { symbol: "lock.fill", color: "#F69220" },
  "yarn.lock": { symbol: "lock.fill", color: "#2C8EBB" },
  "tsconfig.json": { symbol: DATA, color: "#3178C6" },
  "dockerfile": { symbol: "shippingbox.fill", color: "#2496ED" },
  "makefile": { symbol: "gearshape.fill", color: GREY },
  "cargo.toml": { symbol: "shippingbox.fill", color: "#CE6A2C" },
  "go.mod": { symbol: "shippingbox.fill", color: "#00ADD8" },
  ".gitignore": { symbol: "arrow.triangle.branch", color: "#F05032" },
  ".gitattributes": { symbol: "arrow.triangle.branch", color: "#F05032" },
  ".env": { symbol: "gearshape.fill", color: "#ECD53F" },
  "readme.md": { symbol: "book.fill", color: "#519ABA" },
  "license": { symbol: "checkmark.seal.fill", color: GREY },
};

/** Extension → icon. Grouped by category; colours follow the languages' own. */
const BY_EXT: Record<string, FileIconSpec> = {
  ts: codeIcon("#3178C6"),
  tsx: codeIcon("#3178C6"),
  mts: codeIcon("#3178C6"),
  cts: codeIcon("#3178C6"),
  js: codeIcon("#E8D44E"),
  jsx: codeIcon("#E8D44E"),
  mjs: codeIcon("#E8D44E"),
  cjs: codeIcon("#E8D44E"),
  py: codeIcon("#3572A5"),
  rs: codeIcon("#CE6A2C"),
  go: codeIcon("#00ADD8"),
  rb: codeIcon("#CC342D"),
  java: codeIcon("#B07219"),
  kt: codeIcon("#A97BFF"),
  swift: codeIcon("#F05138"),
  c: codeIcon("#5B6673"),
  h: codeIcon("#A074C4"),
  cpp: codeIcon("#F34B7D"),
  cc: codeIcon("#F34B7D"),
  hpp: codeIcon("#A074C4"),
  cs: codeIcon("#178600"),
  php: codeIcon("#7377AD"),
  lua: codeIcon("#000080"),
  dart: codeIcon("#00B4AB"),
  scala: codeIcon("#C22D40"),
  ex: codeIcon("#6E4A7E"),
  exs: codeIcon("#6E4A7E"),
  html: { symbol: CODE, color: "#E34F26" },
  vue: { symbol: CODE, color: "#41B883" },
  svelte: { symbol: CODE, color: "#FF3E00" },
  css: { symbol: "paintbrush.fill", color: "#2965F1" },
  scss: { symbol: "paintbrush.fill", color: "#CF649A" },
  sass: { symbol: "paintbrush.fill", color: "#CF649A" },
  less: { symbol: "paintbrush.fill", color: "#1D365D" },
  json: dataIcon("#CB8B00"),
  jsonc: dataIcon("#CB8B00"),
  yaml: dataIcon("#CB171E"),
  yml: dataIcon("#CB171E"),
  toml: dataIcon("#9C4221"),
  xml: dataIcon("#E37933"),
  sql: dataIcon("#E38C00"),
  graphql: dataIcon("#E10098"),
  gql: dataIcon("#E10098"),
  md: { symbol: "text.alignleft", color: "#519ABA" },
  mdx: { symbol: "text.alignleft", color: "#519ABA" },
  txt: { symbol: "doc.text.fill", color: GREY },
  rtf: { symbol: "doc.text.fill", color: GREY },
  pdf: { symbol: "doc.richtext.fill", color: "#E5252A" },
  sh: { symbol: "terminal.fill", color: "#89E051" },
  bash: { symbol: "terminal.fill", color: "#89E051" },
  zsh: { symbol: "terminal.fill", color: "#89E051" },
  fish: { symbol: "terminal.fill", color: "#89E051" },
  png: { symbol: "photo.fill", color: "#26C281" },
  jpg: { symbol: "photo.fill", color: "#26C281" },
  jpeg: { symbol: "photo.fill", color: "#26C281" },
  gif: { symbol: "photo.fill", color: "#26C281" },
  webp: { symbol: "photo.fill", color: "#26C281" },
  svg: { symbol: "photo.fill", color: "#FFB13B" },
  ico: { symbol: "photo.fill", color: "#26C281" },
  mp3: { symbol: "music.note", color: "#EC407A" },
  wav: { symbol: "music.note", color: "#EC407A" },
  m4a: { symbol: "music.note", color: "#EC407A" },
  flac: { symbol: "music.note", color: "#EC407A" },
  mp4: { symbol: "film.fill", color: "#F06292" },
  mov: { symbol: "film.fill", color: "#F06292" },
  mkv: { symbol: "film.fill", color: "#F06292" },
  webm: { symbol: "film.fill", color: "#F06292" },
  zip: { symbol: "doc.zipper", color: "#F0A030" },
  tar: { symbol: "doc.zipper", color: "#F0A030" },
  gz: { symbol: "doc.zipper", color: "#F0A030" },
  tgz: { symbol: "doc.zipper", color: "#F0A030" },
  rar: { symbol: "doc.zipper", color: "#F0A030" },
  lock: { symbol: "lock.fill", color: GREY },
  log: { symbol: "doc.text.fill", color: GREY },
  env: { symbol: "gearshape.fill", color: "#ECD53F" },
};

/** The icon for a file by its name. Special-cases a few whole filenames, then
 * falls back to the extension, then to a plain document. */
export const iconForFile = (name: string): FileIconSpec => {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName !== undefined) return byName;

  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  return BY_EXT[ext] ?? { symbol: DOC, color: GREY };
};
