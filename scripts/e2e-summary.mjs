// Waits for the AI summary and for all pages, then screenshots: node scripts/e2e-summary.mjs <pdf> <outDir> <settingsJSON> [maxSeconds]
import { chromium } from 'playwright';
const [pdf, out, settingsJson, maxArg = '900'] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(process.env.E2E_PROFILE || `${out}/profile`, { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.addInitScript((s) => localStorage.setItem('paper2zh.settings.v1', s), settingsJson);
await page.goto('http://127.0.0.1:8765/index.html');
await page.setInputFiles('#file-input', pdf);
await page.waitForSelector('.page-row', { timeout: 60000 });
const t0 = Date.now();
let summaryAt = null, doneAt = null;
while (Date.now() - t0 < Number(maxArg) * 1000) {
  const st = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, sum: document.querySelector('#summary-body').innerText, streaming: !!document.querySelector('#summary-body .cursor') }));
  if (!summaryAt && st.sum.length > 100 && !st.streaming && !/正在通读/.test(st.sum)) { summaryAt = (Date.now() - t0) / 1000; console.log('summary ready at', summaryAt, 's'); await page.screenshot({ path: `${out}/with-summary.png` }); }
  if (!doneAt && /已译完/.test(st.status)) { doneAt = (Date.now() - t0) / 1000; console.log('all pages at', doneAt, 's', st.status); }
  if (summaryAt && doneAt) break;
  await page.waitForTimeout(3000);
}
console.log('final status:', await page.textContent('#status'));
console.log('SUMMARY>>>\n' + await page.evaluate(() => document.querySelector('#summary-body').innerText));
console.log(logs.slice(0, 20).join('\n') || 'no console errors');
await ctx.close();
