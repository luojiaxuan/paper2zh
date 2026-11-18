import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { textItems, buildLines, dropLineNumbers } from '../app/js/layout.js';
const [file, pn, y0, y1] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableFontFace: true, fontExtraProperties: true, verbosity: 0 }).promise;
const page = await doc.getPage(+pn); const vp = page.getViewport({ scale: 1 });
const [tc] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
const lines = buildLines(dropLineNumbers(textItems(tc, vp, f => page.commonObjs.get(f)?.name || '')));
for (const l of lines.sort((a, b) => a.top - b.top || a.x0 - b.x0)) if (l.top >= +y0 && l.top <= +y1) console.log(l.x0.toFixed(1), l.x1.toFixed(1), 'base', l.base.toFixed(2), 's', l.size, 'items', l.items.length, '|', l.text.slice(0, 70));
