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

/** The SF Symbol for an icon the host sent (`codicon:<name>`, or a file path,
 * which has no symbol and gets the neutral glyph). */
export const symbolForIcon = (icon: string | undefined): SFSymbol => {
  const name = icon?.startsWith("codicon:") === true ? icon.slice("codicon:".length) : undefined;
  return (name === undefined ? undefined : byName[name]) ?? "circle.dashed";
};

/** Whether an action's icon means "run it", which is what gets the play button. */
export const isRunIcon = (icon: string | undefined): boolean => icon === "codicon:run" || icon === "codicon:play";
