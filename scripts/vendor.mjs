// Copies browser builds of pdf.js and KaTeX into app/vendor and bundles the
// Anthropic SDK as one ES module (the Chrome extension cannot load remote code).
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

const out = 'app/vendor';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/pdfjs`, { recursive: true });
const pdf = 'node_modules/pdfjs-dist';
cpSync(`${pdf}/build/pdf.min.mjs`, `${out}/pdfjs/pdf.min.mjs`);
cpSync(`${pdf}/build/pdf.worker.min.mjs`, `${out}/pdfjs/pdf.worker.min.mjs`);
cpSync(`${pdf}/cmaps`, `${out}/pdfjs/cmaps`, { recursive: true });
cpSync(`${pdf}/standard_fonts`, `${out}/pdfjs/standard_fonts`, { recursive: true });
mkdirSync(`${out}/pdfjs/wasm`);
for (const f of readdirSync(`${pdf}/wasm`)) if (!f.includes('quickjs')) cpSync(`${pdf}/wasm/${f}`, `${out}/pdfjs/wasm/${f}`);
cpSync(`${pdf}/LICENSE`, `${out}/pdfjs/LICENSE`);

mkdirSync(`${out}/katex/fonts`, { recursive: true });
const katex = 'node_modules/katex/dist';
cpSync(`${katex}/katex.mjs`, `${out}/katex/katex.mjs`);
cpSync(`${katex}/katex.min.css`, `${out}/katex/katex.min.css`);
for (const f of readdirSync(`${katex}/fonts`)) if (f.endsWith('.woff2')) cpSync(`${katex}/fonts/${f}`, `${out}/katex/fonts/${f}`);
cpSync('node_modules/katex/LICENSE', `${out}/katex/LICENSE`);

await build({
  stdin: { contents: "export { default as Anthropic } from '@anthropic-ai/sdk';", resolveDir: '.', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  target: 'es2022',
  outfile: `${out}/anthropic-sdk.mjs`,
  legalComments: 'none',
});
cpSync('node_modules/@anthropic-ai/sdk/LICENSE', `${out}/anthropic-sdk.LICENSE`);
console.log('vendored into', out);
