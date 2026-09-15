#!/usr/bin/env python3
"""Generate a Seti (VS Code default) file-icon map for react-native-svg.

Reads Cursor's bundled theme-seti (seti.woff + vs-seti-icon-theme.json), extracts
each referenced glyph as an SVG path, and emits a TS module: deduped glyph paths
keyed by icon-definition name, plus filename/extension -> definition lookups and
a default. Colors come straight from the theme.
"""
import json
import os

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

SETI = "/Applications/Cursor.app/Contents/Resources/app/extensions/theme-seti/icons"
OUT = os.environ["OUT"]

# Common extension -> VS Code languageId, so language-mapped icons (ts, js, py…)
# resolve even though the theme keys those by language, not extension. Extensions
# the theme already lists directly take precedence over this table.
EXT_TO_LANG = {
    "ts": "typescript", "mts": "typescript", "cts": "typescript",
    "tsx": "typescriptreact",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript",
    "jsx": "javascriptreact",
    "json": "json", "jsonc": "jsonc", "jsonl": "jsonl",
    "md": "markdown", "markdown": "markdown",
    "py": "python", "pyi": "python", "pyw": "python",
    "go": "go", "rs": "rust",
    "c": "c", "cpp": "cpp", "cc": "cpp", "cxx": "cpp", "hpp": "cpp", "hh": "cpp",
    "m": "objective-c", "mm": "objective-cpp",
    "java": "java", "cs": "csharp",
    "css": "css", "scss": "scss", "less": "less", "postcss": "postcss",
    "html": "html", "htm": "html", "xml": "xml",
    "yaml": "yaml", "yml": "yaml",
    "sh": "shellscript", "bash": "shellscript", "zsh": "shellscript", "fish": "shellscript",
    "sql": "sql", "swift": "swift",
    "rb": "ruby", "php": "php", "lua": "lua", "dart": "dart",
    "pl": "perl", "pm": "perl", "ps1": "powershell",
    "ini": "properties", "cfg": "properties", "conf": "properties",
    "clj": "clojure", "coffee": "coffeescript",
    "fs": "fsharp", "fsx": "fsharp",
    "jl": "julia", "tex": "latex",
    "bat": "bat", "cmd": "bat",
    "vue": "vue", "svelte": "svelte",
    "dockerfile": "dockerfile",
}

# Well-known filenames VS Code resolves to a language (so they carry a language
# icon) that the theme keys by languageId, not by filename. Merged into the
# filename map unless the theme already lists the name directly.
NAME_TO_LANG = {
    "dockerfile": "dockerfile",
    "makefile": "makefile",
    "gnumakefile": "makefile",
    "gemfile": "ruby",
    "rakefile": "ruby",
    "vagrantfile": "ruby",
    "brewfile": "ruby",
    ".gitignore": "ignore",
    ".gitattributes": "ignore",
    ".gitmodules": "ignore",
    ".npmignore": "ignore",
    ".dockerignore": "dockerfile",
}

theme = json.load(open(os.path.join(SETI, "vs-seti-icon-theme.json")))
defs = theme["iconDefinitions"]

font = TTFont(os.path.join(SETI, "seti.woff"))
upm = font["head"].unitsPerEm
cmap = font.getBestCmap()  # codepoint -> glyphName
glyph_set = font.getGlyphSet()


def codepoint_of(def_name):
    ch = defs[def_name]["fontCharacter"]  # e.g. "\\E001"
    return int(ch.lstrip("\\").lstrip("u"), 16)


def path_and_box(def_name):
    cp = codepoint_of(def_name)
    gname = cmap.get(cp)
    if gname is None:
        return None
    pen = SVGPathPen(glyph_set)
    glyph_set[gname].draw(pen)
    path = pen.getCommands()
    bp = BoundsPen(glyph_set)
    glyph_set[gname].draw(bp)
    if not path or bp.bounds is None:
        return None
    return path, [round(v) for v in bp.bounds]


# Resolve which icon-definition each lookup key uses.
by_name = {name.lower(): d for name, d in theme["fileNames"].items()}
for name, lang in NAME_TO_LANG.items():
    if name in by_name:
        continue
    d = theme["languageIds"].get(lang)
    if d is not None:
        by_name[name] = d
by_ext = dict(theme["fileExtensions"])  # ext -> def
for ext, lang in EXT_TO_LANG.items():
    if ext in by_ext:
        continue
    d = theme["languageIds"].get(lang)
    if d is not None:
        by_ext[ext] = d
default_def = theme["file"]

# Collect the definitions we actually need, extract paths, drop any without one.
needed = set(by_name.values()) | set(by_ext.values()) | {default_def}
glyphs = {}
for d in sorted(needed):
    pb = path_and_box(d)
    if pb is None:
        continue
    path, box = pb
    glyphs[d] = {"path": path, "color": defs[d].get("fontColor", "#d4d7d6"), "box": box}

by_name = {k: v for k, v in by_name.items() if v in glyphs}
by_ext = {k: v for k, v in by_ext.items() if v in glyphs}


def ts_obj(d, indent):
    pad = " " * indent
    lines = []
    for k in sorted(d):
        v = d[k]
        lines.append(f'{pad}{json.dumps(k)}: {json.dumps(v)},')
    return "\n".join(lines)


glyph_lines = []
for d in sorted(glyphs):
    g = glyphs[d]
    box = "[" + ", ".join(str(v) for v in g["box"]) + "]"
    glyph_lines.append(
        f'  {json.dumps(d)}: {{ path: {json.dumps(g["path"])}, color: {json.dumps(g["color"])}, box: {box} }},'
    )

out = f'''/**
 * Seti (the VS Code default) file-icon glyphs, extracted to SVG paths.
 *
 * GENERATED — do not edit by hand. Source: Cursor's bundled `theme-seti`
 * (`seti.woff` + `vs-seti-icon-theme.json`), converted by scripts/gen-seti.py.
 * Each glyph is an SVG path in font units ({upm} per em, y-up — flip when
 * drawing); `byName`/`byExt` map a lowercased filename or extension to a glyph
 * key, with `defaultGlyph` as the fallback. Colors are the theme's own.
 *
 * This is the concrete first instance of the general "VS Code icon theme"
 * shape we'll reuse when extension-provided themes are extracted.
 *
 * @internal
 */

export const SETI_UNITS_PER_EM = {upm};

export interface SetiGlyph {{
  readonly path: string;
  readonly color: string;
  /** Tight glyph bounds in font units (y-up): [xMin, yMin, xMax, yMax]. Used
   * to frame each glyph so it fills the icon; SetiIcon flips y when drawing. */
  readonly box: readonly [number, number, number, number];
}}

export const setiGlyphs: Record<string, SetiGlyph> = {{
{chr(10).join(glyph_lines)}
}};

/** Lowercased full filename → glyph key (e.g. "package.json", "dockerfile"). */
export const setiByName: Record<string, string> = {{
{ts_obj(by_name, 2)}
}};

/** Lowercased extension chain → glyph key (e.g. "ts", "spec.ts", "tf.json"). */
export const setiByExt: Record<string, string> = {{
{ts_obj(by_ext, 2)}
}};

export const setiDefaultGlyph = {json.dumps(default_def)};
'''

open(OUT, "w").write(out)
print(f"glyphs={len(glyphs)} byName={len(by_name)} byExt={len(by_ext)} upm={upm} bytes={len(out)}")
