/**
 * Generate src/themeColorKeys.ts — the bundled catalog of VS Code workbench
 * colour keys, unioned from every theme shiki ships. Bundled in-app so the
 * theme editor offers every key to add even on a blank theme (no server, no
 * import needed). Re-run: node scripts/gen-theme-color-keys.mjs
 */
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dir = require.resolve("shiki/themes/github-dark.mjs").replace(/\/github-dark\.mjs$/, "");
const keys = new Set();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
  const mod = await import(`${dir}/${f}`);
  const theme = mod.default ?? mod;
  for (const k of Object.keys(theme.colors ?? {})) keys.add(k);
}
const sorted = [...keys].sort();
const body = `/**
 * GENERATED — do not edit. The catalog of VS Code workbench colour keys, unioned
 * from every theme bundled with shiki (scripts/gen-theme-color-keys.mjs). Bundled
 * in the app so the theme editor can offer every key to add on any theme,
 * including a blank one — no server, no prior import needed.
 *
 * @internal
 */

export const THEME_COLOR_KEYS: ReadonlyArray<string> = [
${sorted.map((k) => `  ${JSON.stringify(k)},`).join("\n")}
];
`;
writeFileSync(new URL("../src/themeColorKeys.ts", import.meta.url), body);
console.log("wrote src/themeColorKeys.ts —", sorted.length, "keys");
