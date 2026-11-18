// Bundles the game (three.js included) into one self-contained HTML file.
//   node tools/build.js                 -> dist/index.html (open it straight from disk)
//   node tools/build.js --fragment out  -> also writes a <body>-only fragment for embedding
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html
  .replace(/<!-- dev entry[\s\S]*?-->\s*/, '')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<script type="module" src="\.\/src\/main\.js"><\/script>\s*/, '');
const banner = '/* Port Solana. Bundles three.js (MIT License, Copyright 2010-2023 three.js authors). */\n';
const full = html.replace('</body>', () => `<script>${banner}${js}</script>\n</body>`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), full);
console.log(`dist/index.html  ${(full.length / 1024).toFixed(0)} KB`);

const fi = process.argv.indexOf('--fragment');
if (fi > 0) {
  const out = process.argv[fi + 1];
  const head = full.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = full.match(/<body>([\s\S]*?)<\/body>/)[1];
  const titleTag = head.match(/<title>[\s\S]*?<\/title>/)[0];
  const rest = head.replace(titleTag, '');
  writeFileSync(out, `${titleTag}\n${rest}\n${body}`);
  console.log(`${out}  fragment written`);
}
