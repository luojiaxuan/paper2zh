// Loads app/ as an unpacked extension in Chromium and checks how the viewer
// gets a PDF under activeTab:
//   1. without a toolbar click, the source tab is off limits and the viewer
//      offers to request access to the site;
//   2. a toolbar click (CDP Extensions.triggerAction) opens the viewer, which
//      fetches the PDF from inside the source tab when the server only serves
//      it to its own pages;
//   3. arXiv works with a plain fetch.
// Usage: node scripts/e2e-extension.mjs <pdf> <outDir>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
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
  res.writeHead(404);
  res.end();
}).listen(8766, '127.0.0.1');

const ext = path.resolve('app');
const profile = mkdtempSync(path.join(os.tmpdir(), 'p2z-ext-'));
const port = 9333;
const proc = spawn(chromium.executablePath(), [
  '--headless=new',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--enable-unsafe-extension-debugging',
  `--disable-extensions-except=${ext}`,
  `--load-extension=${ext}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

let browser;
for (let i = 0; i < 50 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 200));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
const ctx = browser.contexts()[0];
const cdp = await browser.newBrowserCDPSession();
const { extensions } = await cdp.send('Extensions.getExtensions');
const { id } = extensions.find((e) => e.path === ext);
const isOurs = (w) => new URL(w.url()).host === id;
const worker = ctx.serviceWorkers().find(isOurs) || (await ctx.waitForEvent('serviceworker', { predicate: isOurs }));
console.log('extension id', id);

const logs = [];
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error') logs.push(`${tag} console: ${m.text()}`); });
  p.on('pageerror', (e) => logs.push(`${tag} pageerror: ${e.message}`));
};
const viewer = (src, tab) => `chrome-extension://${id}/index.html?${new URLSearchParams(tab ? { src, tab } : { src })}`;

async function waitLoaded(page, label) {
  try {
    await page.waitForSelector('.page-row', { timeout: 90000 });
    await page.waitForFunction(() => /页/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 30000 });
    console.log(label, 'OK | title:', await page.textContent('#doc-title'), '| status:', await page.textContent('#status'));
  } catch {
    console.log(label, 'FAILED:', (await page.textContent('#pages')).slice(0, 300));
  }
}

// Source tab: the PDF opened by navigation, like an OpenReview PDF tab.
const source = await ctx.newPage();
await source.goto('http://127.0.0.1:8766/paper.pdf').catch(() => {});
await source.waitForTimeout(1500);
// Without the tabs permission URLs are hidden; the source is the newest tab.
const tabId = await worker.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));
console.log('source tab', tabId, source.url());

// 1. No toolbar click yet: no access to the tab.
const denied = await ctx.newPage();
watch(denied, 'denied');
await denied.goto(viewer('http://127.0.0.1:8766/paper.pdf', tabId));
await denied.waitForSelector('.loading-doc .err', { timeout: 30000 });
console.log('without click:', await denied.textContent('.loading-doc .err'));
console.log('access button:', await denied.textContent('.loading-doc .btn.primary').catch(() => 'MISSING'));
await denied.screenshot({ path: `${out}/ext-denied.png` });
await denied.close();

// 2. Toolbar click on the source tab.
const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
const target = targetInfos.find((t) => t.url.startsWith('http://127.0.0.1:8766/'));
const opened = ctx.waitForEvent('page');
await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
const v1 = await opened;
watch(v1, 'click');
await v1.waitForLoadState();
console.log('opened', v1.url());
await waitLoaded(v1, 'toolbar click, in-tab fetch');
await v1.screenshot({ path: `${out}/ext-click.png` });

// 3. arXiv, fetched directly by the extension page.
const v2 = await ctx.newPage();
watch(v2, 'arxiv');
await v2.goto(viewer('https://arxiv.org/abs/1810.04805'));
await waitLoaded(v2, 'arxiv direct');
await v2.waitForTimeout(3000);
console.log('notice:', await v2.$eval('#notice', (n) => (n.hidden ? 'hidden' : n.textContent.trim())));
await v2.screenshot({ path: `${out}/ext-arxiv.png` });

console.log(logs.join('\n') || 'no console errors');
const exited = new Promise((r) => proc.once('exit', r));
await browser.close();
proc.kill();
await exited;
server.close();
rmSync(profile, { recursive: true, force: true });
