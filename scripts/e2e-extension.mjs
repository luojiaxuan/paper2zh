// Loads app/ as an unpacked extension in Chromium and checks both ways the
// viewer gets a PDF: direct fetch (arXiv) and fetching from inside the source
// tab when the server only serves the PDF to its own pages.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [pdfPath, out] = process.argv.slice(2);
const pdf = readFileSync(pdfPath);
const server = http.createServer((req, res) => {
  if (req.url === '/paper.pdf') {
    const ok = req.headers['sec-fetch-site'] === 'same-origin' || req.headers['sec-fetch-mode'] === 'navigate';
    console.log('server /paper.pdf', req.headers['sec-fetch-site'], req.headers['sec-fetch-mode'], ok ? 200 : 403);
    res.writeHead(ok ? 200 : 403, { 'Content-Type': ok ? 'application/pdf' : 'text/html' });
    return res.end(ok ? pdf : 'challenge required');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>paper landing page</h1>');
}).listen(8766, '127.0.0.1');

const ext = path.resolve('app');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1400, height: 900 },
});
let [worker] = ctx.serviceWorkers();
worker ||= await ctx.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
console.log('extension id', id);

const logs = [];
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error') logs.push(`${tag} console: ${m.text()}`); });
  p.on('pageerror', (e) => logs.push(`${tag} pageerror: ${e.message}`));
};

async function waitTranslated(page, label) {
  try {
    await page.waitForSelector('.page-row', { timeout: 90000 });
    await page.waitForFunction(() => /已译完|翻译中 [1-9]/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 90000 });
    console.log(label, 'OK:', await page.textContent('#status'), '| title:', await page.textContent('#doc-title'));
  } catch (e) {
    console.log(label, 'FAILED:', (await page.textContent('#pages')).slice(0, 200));
  }
}

// 1. Source tab whose server rejects cross-site fetches.
const source = await ctx.newPage();
await source.goto('http://127.0.0.1:8766/');
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1:8766/*' }))[0].id);
const v1 = await ctx.newPage();
watch(v1, 'grab');
await v1.goto(`chrome-extension://${id}/index.html?src=${encodeURIComponent('http://127.0.0.1:8766/paper.pdf')}&tab=${tabId}`);
await waitTranslated(v1, 'in-tab fetch');
await v1.screenshot({ path: `${out}/ext-grab.png` });

// 2. arXiv, fetched directly by the extension page.
const v2 = await ctx.newPage();
watch(v2, 'arxiv');
await v2.goto(`chrome-extension://${id}/index.html?src=${encodeURIComponent('https://arxiv.org/abs/1810.04805')}`);
await waitTranslated(v2, 'arxiv direct');
await v2.waitForTimeout(3000);
await v2.screenshot({ path: `${out}/ext-arxiv.png` });

console.log(logs.join('\n') || 'no console errors');
await ctx.close();
server.close();
