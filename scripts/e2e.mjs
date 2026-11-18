// Headless end-to-end check: node scripts/e2e.mjs <pdf> <outDir> [pages=1,2] [settingsJSON] [waitSeconds]
import { chromium } from 'playwright';
const [pdf, out, pagesArg = '1,2', settingsJson = '', waitArg = '60'] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(process.env.E2E_PROFILE || `${out}/profile`, { viewport: { width: 1500, height: Number(process.env.E2E_HEIGHT || 1000) }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
if (settingsJson) await page.addInitScript((s) => localStorage.setItem('paper2zh.settings.v1', s), settingsJson);
await page.goto('http://127.0.0.1:8765/index.html');
await page.screenshot({ path: `${out}/landing.png` });
await page.setInputFiles('#file-input', pdf);
await page.waitForSelector('.page-row', { timeout: 60000 });
const t0 = Date.now();
const wanted = pagesArg.split(',').map(Number);
for (const n of wanted) {
  await page.evaluate((n) => document.querySelector(`.page-row[data-page="${n}"]`).scrollIntoView(), n);
  const deadline = Date.now() + Number(waitArg) * 1000;
  while (Date.now() < deadline) {
    const ok = await page.evaluate((n) => {
      const row = document.querySelector(`.page-row[data-page="${n}"]`);
      return !!row.querySelector('.sheet.zh canvas') && row.querySelector('.badge').hidden;
    }, n);
    if (ok) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  const row = await page.$(`.page-row[data-page="${n}"]`);
  await row.screenshot({ path: `${out}/page${n}-zh.png` });
}
console.log('status:', await page.textContent('#status'), 'elapsed', ((Date.now() - t0) / 1000).toFixed(1), 's');
console.log('summary:', (await page.textContent('#summary-body')).slice(0, 300));
await page.click('.segmented button[data-mode="dual"]');
await page.waitForTimeout(1500);
await page.evaluate((n) => document.querySelector(`.page-row[data-page="${n}"]`).scrollIntoView(), wanted[0]);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/dual.png` });
console.log(logs.slice(0, 30).join('\n') || 'no console errors');
await ctx.close();
