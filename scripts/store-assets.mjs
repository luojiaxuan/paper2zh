// Chrome Web Store images: store icon, four 1280x800 screenshots, and the
// small (440x280) and marquee (1400x560) promo tiles.
// Captures come from a profile that already holds the paper's translation
// and summary in its cache, served from app/ at 127.0.0.1:8765:
//   E2E_PROFILE=... node scripts/store-assets.mjs <pdf> <outDir> <settingsJSON>
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [pdf, out, settingsJson] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const raw = mkdtempSync(path.join(os.tmpdir(), 'p2z-store-'));

const SHOT = { width: 1280, height: 704 };
const ctx = await chromium.launchPersistentContext(process.env.E2E_PROFILE, { viewport: SHOT, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript((s) => localStorage.setItem('paper2zh.settings.v1', s), settingsJson);
await page.goto('http://127.0.0.1:8765/index.html');
await page.setInputFiles('#file-input', pdf);
await page.waitForFunction(() => /已译完/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#summary-body h3'), null, { timeout: 120000 });

const scrollTo = async (n, offset = 12) => {
  await page.evaluate(([n, offset]) => {
    const r = document.querySelector(`.page-row[data-page="${n}"]`);
    r.parentElement.scrollTop = r.offsetTop - offset;
  }, [n, offset]);
  await page.waitForTimeout(2500);
};

// 1. Translation with the summary panel.
await scrollTo(1);
await page.screenshot({ path: `${raw}/1-summary.png` });

// 2. Side by side on a page with a figure.
await page.click('#summary-close');
await page.click('.segmented button[data-mode="dual"]');
await page.waitForTimeout(800);
await scrollTo(2);
await page.screenshot({ path: `${raw}/2-dual.png` });

// 3. Hovering a paragraph shows the original.
await page.click('.segmented button[data-mode="zh"]');
await page.waitForTimeout(800);
await scrollTo(6, -40);
const box = await page.evaluate(() => {
  const view = document.querySelector('#pages').getBoundingClientRect();
  const blocks = [...document.querySelectorAll('.page-row[data-page="6"] .zh-block')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.top > view.top + 80 && r.bottom < view.top + 380 && r.height > 50);
  const r = blocks[0];
  return r && { x: r.left + r.width * 0.4, y: r.top + r.height * 0.4 };
});
await page.mouse.move(box.x, box.y);
await page.waitForTimeout(600);
await page.screenshot({ path: `${raw}/3-hover.png` });
await page.mouse.move(5, 5);

// 4. Settings: free Google Translate or a large model.
await page.click('.toolbar [data-open-settings]');
await page.selectOption('#s-provider', 'anthropic');
await page.waitForTimeout(400);
await page.screenshot({ path: `${raw}/4-settings.png` });
await page.click('#s-cancel');

// Page crop for the marquee tile.
await page.setViewportSize({ width: 900, height: 560 });
await scrollTo(1, -150);
await page.screenshot({ path: `${raw}/marquee-page.png` });
await ctx.close();

// ---------- compositions ----------

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "PingFang SC", "Hiragino Sans GB", sans-serif; color: #1f1e1c; background: #f3f1ec; }
`;
const icon = readFileSync('app/icons/icon.svg', 'utf8');
const img = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const svgIcon = (size) => icon.replace('<svg ', `<svg width="${size}" height="${size}" `);

const browser = await chromium.launch();
async function render(html, width, height, file, opts = {}) {
  const p = await browser.newPage({ viewport: { width, height } });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: file, ...opts });
  await p.close();
}

const captions = {
  '1-summary': '原版式中文译文，旁边附一份 AI 速读总结',
  '2-dual': '左右对照，图表和公式原样保留',
  '3-hover': '鼠标悬停任一段落，随时看原文',
  '4-settings': 'Google 翻译免费即用，也可接入 Claude、DeepSeek 等大模型',
};
for (const [name, caption] of Object.entries(captions)) {
  await render(`
    <div style="height:96px;display:flex;align-items:center;gap:16px;padding:0 40px;border-bottom:1px solid #e3e0d8">
      ${svgIcon(40)}
      <div style="font-size:30px;font-weight:600;letter-spacing:.5px">${caption}</div>
    </div>
    <img src="${img(`${raw}/${name}.png`)}" width="1280" height="704" style="display:block">`,
  1280, 800, `${out}/screenshot-${name}.jpg`, { type: 'jpeg', quality: 92 });
}

await render(`
  <div style="height:280px;display:flex;flex-direction:column;justify-content:center;padding:0 36px;gap:14px">
    <div style="display:flex;align-items:center;gap:12px">${svgIcon(52)}<span style="font-size:30px;font-weight:700">paper2zh</span></div>
    <div style="font-size:30px;font-weight:700;line-height:1.25">论文 PDF，一键变中文</div>
    <div style="font-size:17px;color:#6b6860">图表公式原样保留 · 附 AI 速读总结</div>
  </div>`,
440, 280, `${out}/promo-small-440x280.jpg`, { type: 'jpeg', quality: 92 });

await render(`
  <div style="height:560px;display:flex;align-items:center;overflow:hidden">
    <div style="flex:none;width:560px;padding:0 0 0 72px;display:flex;flex-direction:column;gap:20px">
      <div style="display:flex;align-items:center;gap:14px">${svgIcon(60)}<span style="font-size:34px;font-weight:700">paper2zh</span></div>
      <div style="font-size:46px;font-weight:700;line-height:1.2">论文 PDF<br>一键变中文</div>
      <div style="font-size:21px;color:#6b6860;line-height:1.6">在 arXiv、OpenReview 的 PDF 页面点一下，<br>图表公式不动，只换正文，附 AI 速读。</div>
    </div>
    <img src="${img(`${raw}/marquee-page.png`)}" style="width:840px;height:auto;display:block;margin-top:40px;border-radius:10px 0 0 0;box-shadow:0 8px 40px rgb(0 0 0 / 14%)">
  </div>`,
1400, 560, `${out}/promo-marquee-1400x560.jpg`, { type: 'jpeg', quality: 92 });

// Store icon: 96x96 artwork centered on a transparent 128x128 canvas.
await render(`<style>body{background:transparent}</style><div style="width:128px;height:128px;display:grid;place-items:center">${svgIcon(96)}</div>`,
  128, 128, `${out}/store-icon-128.png`, { omitBackground: true });
await browser.close();
rmSync(raw, { recursive: true, force: true });
