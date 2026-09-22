/**
 * Build the code surface asset: `webview/codeSurface.ts` bundled for a browser
 * and inlined into `assets/code-surface.html`.
 *
 *   node scripts/gen-code-surface.mjs
 *
 * Everything ends up in the one HTML file on purpose. Metro treats `.html` as
 * an asset and `.js` as source, so a script beside the page would be bundled
 * into the app rather than shipped next to it, and a WebView loading a
 * `file://` page cannot reliably pull sibling resources on iOS anyway. One
 * self-contained document sidesteps both, and means the surface renders with no
 * network of any kind.
 *
 * The output is committed, the same way `src/themeColorKeys.ts` is. An EAS
 * build runs `pnpm install` and then bundles; it does not run this. Re-run it
 * after changing `webview/codeSurface.ts` or bumping monaco, shiki or
 * `@shikijs/monaco`, and commit what changes.
 */
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const entry = resolve(projectRoot, "webview/codeSurface.ts");
/**
 * Monaco's own web worker, which backs word-based suggestions, link detection
 * and diffs. It is bundled separately and inlined as a Blob so the page can
 * start it with no URL to resolve: this document is loaded from `file://`, and
 * Monaco's default path builds a relative URL that throws there.
 */
const workerEntry = resolve(
  projectRoot,
  "node_modules/monaco-editor/esm/vs/editor/editor.worker.start.js",
);
const outFile = resolve(projectRoot, "assets/code-surface.html");

/**
 * Monaco's ESM build imports its own stylesheets, so esbuild emits JavaScript
 * and CSS as two files. Both are read back and inlined; a real output directory
 * is what lets esbuild resolve those CSS imports at all.
 */
/**
 * Two things `editor.main.js` drags in that this surface must not have.
 *
 * `../languages/definitions/<lang>/register.js` is Monaco's own Monarch grammar
 * for each of some ninety languages. Registering those would put a second
 * highlighting engine beside Shiki, which the code-highlighting decision rules
 * out: Shiki is the single source of truth, so a file and a chat block resolve
 * the same tokens. Stubbing them also keeps the asset from carrying ninety
 * grammars nothing reads.
 *
 * `monaco-lsp-client` is re-exported as `monaco.lsp` and used by nothing inside
 * Monaco. It builds worker URLs on load, which throws outright on a `file://`
 * page, so the surface would not boot at all with it in.
 *
 * Everything else in `editor.main.js` stays: find and replace, folding, the
 * comment shortcut, auto-indent, bracket matching, multiple cursors, suggest,
 * hover, rename, code actions. This surface becomes an editor, so it is built
 * on the whole thing rather than on a core that each later phase re-adds a
 * piece of.
 */
const STRIPPED = /(?:[\\/]languages[\\/]definitions[\\/][^\\/]+[\\/]register\.js$)|(?:monaco-lsp-client)/;

const stripMonacoExtras = {
  name: "strip-monaco-extras",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const full = args.path.startsWith(".") ? `${args.resolveDir}/${args.path}` : args.path;
      return STRIPPED.test(full) ? { path: args.path, namespace: "monaco-stub" } : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "monaco-stub" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

const stage = await mkdtemp(join(tmpdir(), "code-surface-"));
let script;
let css;
let worker;
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    outdir: stage,
    entryNames: "surface",
    // Monaco ships its codicon glyph font as a .ttf import. Inlining it keeps
    // the page self-contained; without this esbuild emits a third file.
    loader: { ".ttf": "dataurl" },
    plugins: [stripMonacoExtras],
    logLevel: "error",
  });
  await build({
    entryPoints: [workerEntry],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    outdir: stage,
    entryNames: "worker",
    plugins: [stripMonacoExtras],
    logLevel: "error",
  });
  script = await readFile(join(stage, "surface.js"), "utf8");
  css = await readFile(join(stage, "surface.css"), "utf8").catch(() => "");
  worker = await readFile(join(stage, "worker.js"), "utf8");
} finally {
  await rm(stage, { recursive: true, force: true });
}

/**
 * `</script` anywhere in the bundle would close the tag early. Escaping the
 * slash is inert inside a JavaScript string and stops the parser seeing an end
 * tag.
 */
const safeScript = script.replaceAll("</script", "<\\/script");

/**
 * The worker source travels as a JSON string literal rather than its own
 * script tag, so the page can hand it to `Blob` at startup. `MonacoEnvironment`
 * has to exist before Monaco loads, which is why this goes in first.
 */
const workerBootstrap = `
var __workerSource = ${JSON.stringify(worker)};
self.MonacoEnvironment = {
  getWorker: function () {
    return new Worker(URL.createObjectURL(new Blob([__workerSource], { type: "text/javascript" })));
  }
};
`.replaceAll("</script", "<\\/script");

// Nothing written into the literal parts of this template may contain a
// backtick: it would close the literal and this file would stop parsing. That
// has happened twice, and the syntax error is immediate, so it needs no further
// guard than this note.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<!-- No remote origin is reachable from this page. The app must render code
     with no network, so anything the surface needs is already inline. -->
<!-- blob: covers the inlined Monaco worker; no remote origin is reachable. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; child-src blob:; style-src 'unsafe-inline'; font-src data:; img-src data:;">
<title>Code surface</title>
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent;-webkit-text-size-adjust:100%;}
#surface{position:absolute;inset:0;}
</style>
<style>${css}</style>
<!-- After Monaco's own stylesheet, so these win on order as well as specificity. -->
<style>
/* Monaco marks a read-only editor no-user-select and takes selection over
   itself, which on a phone means the text cannot be selected at all and there
   is nothing for the system Copy callout to act on. While the surface is
   read-only the platform gets selection back, with its handles and its menu.
   The class comes off when editing starts and Monaco's own model takes over. */
body.surface-readonly .monaco-editor .lines-content,
body.surface-readonly .monaco-editor .view-line,
body.surface-readonly .monaco-editor .view-line span,
body.surface-readonly .monaco-editor .view-lines{user-select:text;-webkit-user-select:text;cursor:text;}
</style>
</head>
<body>
<div id="surface"></div>
<script>${workerBootstrap}</script>
<script>${safeScript}</script>
</body>
</html>
`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html, "utf8");

const bytes = Buffer.byteLength(html, "utf8");
process.stdout.write(`code-surface: wrote ${outFile} (${(bytes / 1024 / 1024).toFixed(2)} MB)\n`);
