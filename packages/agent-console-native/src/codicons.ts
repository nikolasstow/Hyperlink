/**
 * VS Code codicons as SF Symbols.
 *
 * Extensions name their icons by codicon (`$(play)`, `ThemeIcon("wrench")`);
 * the extension host passes them on as `codicon:<name>`. This is the lookup for
 * the ones extensions commonly use. A name not in it gets a neutral glyph
 * rather than an empty gap; add a mapping when a view shows one.
 *
 * @internal
 */
import type { SFSymbol } from "sf-symbols-typescript";

const byName: Readonly<Record<string, SFSymbol>> = {
  add: "plus",
  check: "checkmark",
  close: "xmark",
  debug: "ant",
  "debug-alt": "ant",
  "debug-start": "ant",
  edit: "pencil",
  error: "exclamationmark.circle",
  file: "doc",
  "file-code": "doc.text",
  folder: "folder",
  "folder-opened": "folder",
  gear: "gearshape",
  "go-to-file": "arrow.up.forward.square",
  info: "info.circle",
  "link-external": "arrow.up.right.square",
  package: "shippingbox",
  play: "play.fill",
  refresh: "arrow.clockwise",
  run: "play.fill",
  "run-all": "forward.fill",
  search: "magnifyingglass",
  settings: "gearshape",
  "stop-circle": "stop.circle",
  terminal: "terminal",
  trash: "trash",
  warning: "exclamationmark.triangle",
  wrench: "wrench.and.screwdriver",
};

/**
 * SF Symbols a plugin may name directly (`sf:<name>`). A name from a manifest
 * is a string from outside, and the symbol type is compile-time only, so it is
 * matched against this list rather than asserted; add names as plugins use them.
 */
const sfSymbols: ReadonlyArray<SFSymbol> = [
  ...Object.values(byName),
  "book",
  "cube",
  "folder.badge.gearshape",
  "hammer",
  "list.bullet.rectangle",
  "puzzlepiece.extension",
  "shippingbox",
  "shippingbox.fill",
  "square.stack.3d.up",
  "arrow.triangle.branch",
  "arrow.triangle.merge",
];

/** The SF Symbol for an icon the host sent: `codicon:<name>`, `sf:<name>`, or
 * a file path, which has no symbol. Anything unknown gets the neutral glyph. */
export const symbolForIcon = (icon: string | undefined): SFSymbol => {
  if (icon?.startsWith("sf:") === true) return sfSymbols.find((symbol) => symbol === icon.slice("sf:".length)) ?? "circle.dashed";
  const name = icon?.startsWith("codicon:") === true ? icon.slice("codicon:".length) : undefined;
  return (name === undefined ? undefined : byName[name]) ?? "circle.dashed";
};

/** Whether an action's icon means "run it", which is what gets the play button. */
export const isRunIcon = (icon: string | undefined): boolean => icon === "codicon:run" || icon === "codicon:play";
