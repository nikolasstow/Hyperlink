#!/usr/bin/env python3
"""Generate the VS Code codicons the app draws, for react-native-svg.

Reads Cursor's bundled codicon.ttf (VS Code's own icon font) and emits a TS
module of the named glyphs as SVG paths in font units (y-up; the em square is
the whole icon, as the font draws it). Only the icons the app uses are kept.

    OUT=src/codiconGlyphs.ts python3 scripts/gen-codicons.py
"""
import os

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

FONT = "/Applications/Cursor.app/Contents/Resources/app/out/media/codicon.ttf"
OUT = os.environ["OUT"]

# The breadcrumbs' separator and VS Code's symbol icons (SymbolKinds.toIcon).
NAMES = [
    "chevron-right",
    "symbol-class",
    "symbol-constant",
    "symbol-enum",
    "symbol-interface",
    "symbol-method",
    "symbol-namespace",
    "symbol-parameter",
    "symbol-property",
    "symbol-string",
    "symbol-variable",
]

font = TTFont(FONT)
upm = font["head"].unitsPerEm
glyph_set = font.getGlyphSet()

paths = {}
for name in NAMES:
    pen = SVGPathPen(glyph_set)
    glyph_set[name].draw(pen)
    paths[name] = pen.getCommands()

lines = [
    "/**",
    " * VS Code's codicons the app draws (the breadcrumbs' chevron and symbol",
    " * icons), extracted to SVG paths.",
    " *",
    " * GENERATED — do not edit by hand. Source: Cursor's bundled `codicon.ttf`,",
    " * converted by scripts/gen-codicons.py. Each path is in font units (y-up;",
    " * flip when drawing), the em square being the whole icon.",
    " *",
    " * @internal",
    " */",
    "",
    f"export const CODICON_UNITS_PER_EM = {upm};",
    "",
    "export type CodiconName =",
]
lines += [f'  | "{name}"' for name in NAMES]
lines[-1] += ";"
lines += ["", "export const codicons: Record<CodiconName, string> = {"]
lines += [f'  "{name}": "{paths[name]}",' for name in NAMES]
lines += ["};", ""]

with open(OUT, "w") as out:
    out.write("\n".join(lines))
