/**
 * How a symbol looks in the breadcrumbs, as VS Code draws it: an icon for its
 * kind, coloured from the theme's `symbolIcon.*` keys with VS Code's own
 * defaults (the same in light and dark), and the crumbs' text from
 * `breadcrumb.foreground`.
 *
 * The icons are VS Code's own codicons (codiconGlyphs.ts), as it maps the kinds.
 *
 * @internal
 */
import type { CodiconName } from "../codiconGlyphs";
import type { SymbolKind } from "./stickyRanges";

interface Look {
  readonly icon: CodiconName;
  /** The theme key for its colour. */
  readonly key: string;
  /** VS Code's default; undefined = the theme's foreground. */
  readonly fallback: string | undefined;
}

const PURPLE = "#B180D7";
const ORANGE = "#EE9D28";
const BLUE = "#75BEFF";

const looks: Record<SymbolKind, Look> = {
  function: { icon: "symbol-method", key: "symbolIcon.functionForeground", fallback: PURPLE },
  method: { icon: "symbol-method", key: "symbolIcon.methodForeground", fallback: PURPLE },
  constructor: { icon: "symbol-method", key: "symbolIcon.constructorForeground", fallback: PURPLE },
  property: { icon: "symbol-property", key: "symbolIcon.propertyForeground", fallback: undefined },
  class: { icon: "symbol-class", key: "symbolIcon.classForeground", fallback: ORANGE },
  interface: { icon: "symbol-interface", key: "symbolIcon.interfaceForeground", fallback: BLUE },
  enum: { icon: "symbol-enum", key: "symbolIcon.enumeratorForeground", fallback: ORANGE },
  namespace: { icon: "symbol-namespace", key: "symbolIcon.namespaceForeground", fallback: undefined },
  type: { icon: "symbol-parameter", key: "symbolIcon.typeParameterForeground", fallback: undefined },
  variable: { icon: "symbol-variable", key: "symbolIcon.variableForeground", fallback: BLUE },
  constant: { icon: "symbol-constant", key: "symbolIcon.constantForeground", fallback: undefined },
  heading: { icon: "symbol-string", key: "symbolIcon.stringForeground", fallback: undefined },
};

export interface SymbolLook<Color> {
  readonly icon: CodiconName;
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
