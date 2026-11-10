// Build: bundles src/main.js (all dynamic imports inlined) with esbuild and inlines it together with
// style.css into ONE self-contained, offline-capable file:
//   dist/nachtglut.html           — full document, works via file:// (double-click)
//   dist/nachtglut.artifact.html  — page FRAGMENT for a hosting skeleton (no doctype/html/head/body)
// Optional modules that do not exist yet are replaced by stubs that reject at import time, so the game's
// own fallbacks kick in exactly like in the dev build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('esbuild is missing – run `npm install` first.');
  process.exit(1);
}

/** Missing relative imports → a module that throws (dynamic import() then rejects and the caller falls back). */
const optionalModules = {
  name: 'optional-modules',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (args.kind !== 'dynamic-import') return undefined;
      const p = path.resolve(args.resolveDir, args.path);
      if (fs.existsSync(p)) return undefined;
      return { path: p, namespace: 'missing' };
    });
    b.onLoad({ filter: /.*/, namespace: 'missing' }, (args) => {
      console.log(`  (optional module not present, stubbed: ${path.relative(ROOT, args.path)})`);
      return { contents: `throw new Error(${JSON.stringify('module not bundled: ' + path.relative(ROOT, args.path))});`, loader: 'js' };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
  plugins: [optionalModules],
});
let js = result.outputFiles[0].text;
// never let the bundle close the inline <script> early
js = js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssPath = path.join(ROOT, 'style.css');
let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
if (!css) console.log('  (style.css not present – building without it)');
css = css.replace(/<\/(style)/gi, '<\\/$1');

// pieces of index.html
const headStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const bodyInner = (html.match(/<body>([\s\S]*?)<\/body>/) || [, ''])[1];
const markup = bodyInner.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/g, '').trim();
const fontLinks = [...html.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join('\n');

// css @import of web fonts must come first in a stylesheet; keep it (progressive enhancement, fallbacks in the css)
const imports = [];
css = css.replace(/@import\s+url\([^)]*\)[^;]*;|@import\s+["'][^"']*["'][^;]*;/g, (m) => { imports.push(m); return ''; });
const fullCss = [imports.join('\n'), headStyles, css].filter(Boolean).join('\n');

// ------------------------------------------------------------------ dist/nachtglut.html
let out = html
  .replace(/<link rel="stylesheet" href="style\.css">\s*/, '')
  .replace(/<style>[\s\S]*?<\/style>/, () => `<style>\n${fullCss}\n</style>`)
  .replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `<script>\n${js}\n</script>`);
if (out.includes('src/main.js')) throw new Error('could not inline the script into index.html');

// ------------------------------------------------------------------ dist/nachtglut.artifact.html (fragment)
const artifactCss = `${imports.join('\n')}
:root { color-scheme: dark; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #07050a; color: #e8e2d4; overscroll-behavior: none; }
body { position: fixed; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
${headStyles.replace(/:root\s*\{[^}]*\}/, '').replace(/html,\s*body\s*\{[^}]*\}/, '').replace(/body\s*\{[^}]*\}/, '')}
${css}`;
const artifact = `<title>Nachtglut</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fontLinks ? fontLinks + '\n' : ''}<style>
${artifactCss.trim()}
</style>
${markup}
<script>
${js}
</script>
`;

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'nachtglut.html'), out);
fs.writeFileSync(path.join(DIST, 'nachtglut.artifact.html'), artifact);

// ------------------------------------------------------------------ checks + report
const warn = [];
if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(js.replace(/\.prompt\(|prompt\s*:/g, ''))) warn.push('bundle may call alert/confirm/prompt');
const external = (out.match(/(?:src|href)=["']https?:\/\/[^"']+/g) || []).filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
if (external.length) warn.push('external references: ' + external.join(', '));
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KiB';
console.log(`bundle (js)                   ${kb(js)}`);
console.log(`dist/nachtglut.html           ${kb(out)}`);
console.log(`dist/nachtglut.artifact.html  ${kb(artifact)}`);
for (const w of warn) console.warn('WARNING: ' + w);
