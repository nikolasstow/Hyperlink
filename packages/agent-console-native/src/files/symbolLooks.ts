/**
 * How a symbol looks in the breadcrumbs, as VS Code draws it: an icon for its
 * kind, coloured from the theme's `symbolIcon.*` keys with VS Code's own
 * defaults (the same in light and dark), and the crumbs' text from
 * `breadcrumb.foreground`.
 *
 * The icons are SF Symbols standing in for VS Code's codicons.
 *
 * @internal
 */
import type { SFSymbol } from "sf-symbols-typescript";
import type { SymbolKind } from "./stickyRanges";

interface Look {
  readonly icon: SFSymbol;
  /** The theme key for its colour. */
  readonly key: string;
  /** VS Code's default; undefined = the theme's foreground. */
  readonly fallback: string | undefined;
}

const PURPLE = "#B180D7";
const ORANGE = "#EE9D28";
const BLUE = "#75BEFF";

const looks: Record<SymbolKind, Look> = {
  function: { icon: "cube", key: "symbolIcon.functionForeground", fallback: PURPLE },
  method: { icon: "cube", key: "symbolIcon.methodForeground", fallback: PURPLE },
  constructor: { icon: "cube", key: "symbolIcon.constructorForeground", fallback: PURPLE },
  property: { icon: "wrench", key: "symbolIcon.propertyForeground", fallback: undefined },
  class: { icon: "square.stack.3d.up", key: "symbolIcon.classForeground", fallback: ORANGE },
  interface: { icon: "link", key: "symbolIcon.interfaceForeground", fallback: BLUE },
  enum: { icon: "list.number", key: "symbolIcon.enumeratorForeground", fallback: ORANGE },
  namespace: { icon: "curlybraces", key: "symbolIcon.namespaceForeground", fallback: undefined },
  type: { icon: "t.square", key: "symbolIcon.typeParameterForeground", fallback: undefined },
  variable: { icon: "x.square", key: "symbolIcon.variableForeground", fallback: BLUE },
  constant: { icon: "equal.square", key: "symbolIcon.constantForeground", fallback: undefined },
  heading: { icon: "number", key: "symbolIcon.stringForeground", fallback: undefined },
};

export interface SymbolLook<Color> {
  readonly icon: SFSymbol;
  readonly color: string | Color;
}

/** A kind's icon and colour, from the theme's `colors` (`foreground` for the
 * kinds VS Code draws in the text's colour). */
export const symbolLookOf = <Color>(kind: SymbolKind, colors: Readonly<Record<string, string>> | undefined, foreground: Color): SymbolLook<Color> => {
  const look = looks[kind];
  return {
    icon: look.icon,
    color: colors?.[look.key] ?? look.fallback ?? colors?.foreground ?? foreground,
  };
};

/** The crumbs' text colour: the theme's `breadcrumb.foreground`, else
 * `foreground`'s. */
export const crumbColorOf = <Color>(colors: Readonly<Record<string, string>> | undefined, foreground: Color): string | Color =>
  colors?.["breadcrumb.foreground"] ?? colors?.foreground ?? foreground;
