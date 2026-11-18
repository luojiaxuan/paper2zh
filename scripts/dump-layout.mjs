// Prints the block analysis of a PDF: node scripts/dump-layout.mjs file.pdf [fromPage] [toPage]
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { analyzeDocument, textItems, figureRegions, TRANSLATABLE } from '../app/js/layout.js';

const [file, from = '1', to = '999'] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableFontFace: true, fontExtraProperties: true, verbosity: 0 }).promise;
const t0 = Date.now();
const { bodySize, pages } = await analyzeDocument(doc.numPages, async (n) => {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const [tc, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const name = (f) => { try { return page.commonObjs.get(f)?.name || ''; } catch { return ''; } };
  return { width: viewport.width, height: viewport.height, items: textItems(tc, viewport, name), regions: figureRegions(ops, pdfjs.OPS, viewport) };
});
console.log('analysis ms', Date.now() - t0, 'bodySize', bodySize);
const counts = {};
for (const p of pages) {
  if (p.n < +from || p.n > +to) { for (const b of p.blocks) counts[b.kind] = (counts[b.kind] || 0) + 1; continue; }
  console.log(`\n=== page ${p.n}  regions=${p.regions.map(r => r.map(Math.round).join(',')).join(' | ')}`);
  for (const b of p.blocks) {
    counts[b.kind] = (counts[b.kind] || 0) + 1;
    const mark = TRANSLATABLE.has(b.kind) ? '*' : ' ';
    console.log(`${mark}${b.kind.padEnd(9)} [${b.bbox.map(Math.round).join(',')}] s=${b.size} L=${b.lines} ${b.bold ? 'B ' : ''}| ${b.text.slice(0, 110)}`);
  }
}
console.log('\nkinds', counts, 'chars to translate', pages.flatMap(p => p.blocks).filter(b => TRANSLATABLE.has(b.kind)).reduce((s, b) => s + b.text.length, 0));
