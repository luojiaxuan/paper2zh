// README screenshots from an already-translated profile:
// E2E_PROFILE=... node scripts/screenshots.mjs <pdf> <outDir> <settingsJSON> <dualPage>
import { chromium } from 'playwright';
const [pdf, out, settingsJson, dualPage = '2'] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(process.env.E2E_PROFILE, { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript((s) => localStorage.setItem('paper2zh.settings.v1', s), settingsJson);
await page.goto('http://127.0.0.1:8765/index.html');
await page.screenshot({ path: `${out}/landing.png` });
await page.setInputFiles('#file-input', pdf);
await page.waitForFunction(() => /已译完/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#summary-body h3'), null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/summary.png` });
await page.click('#summary-close');
await page.click('.segmented button[data-mode="dual"]');
await page.waitForTimeout(1000);
await page.evaluate((n) => { const r = document.querySelector(`.page-row[data-page="${n}"]`); r.parentElement.scrollTop = r.offsetTop - 12; }, Number(dualPage));
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/dual.png` });
await ctx.close();
