// Renders pages and lays the Chinese translation over them. The translated
// sheet is the original page with the original text of translated blocks
// erased (copied from a text-free render, so backgrounds, rules and figures
// stay pixel-identical) and an HTML layer of fitted Chinese text on top.

import { inline } from './richtext.js';

const MAX_CANVAS_PIXELS = 6e6;
const KEEP_PAGES = 3;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];
const LINE_HEIGHTS = ['1.36', '1.28', '1.2'];
// The text box of a block spans from the top of its first line's glyphs to
// the bottom of its last; CSS line boxes add half of the leading above and
// below, so the box is padded by that much.
const HALF_LEADING = 0.2;
const fontSizeOf = (b) => (b.kind === 'heading' ? b.maxSize : b.size);

export class Viewer {
  constructor({ root, pdf, OPS, pages, tooltip, onRetry, getFont }) {
    this.root = root;
    this.pdf = pdf;
    this.pages = pages;
    this.tooltip = tooltip;
    this.onRetry = onRetry;
    this.getFont = getFont;
    this.textOps = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
    this.mode = 'zh';
    this.zoom = null;
    this.current = 1;
    this.visible = new Set();
    this.status = new Map();
    this.rows = pages.map((p) => this.makeRow(p));
    for (const r of this.rows) root.appendChild(r.row);
    this.layout();
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { root, rootMargin: '120% 0px' });
    for (const r of this.rows) this.observer.observe(r.row);
    this.resizeObserver = new ResizeObserver(() => this.scheduleRelayout());
    this.resizeObserver.observe(root);
    root.addEventListener('scroll', () => this.updateCurrent(), { passive: true });
    root.addEventListener('mouseover', (e) => this.showOriginal(e));
    root.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('.zh-block')) this.tooltip.hidden = true;
    });
  }

  makeRow(p) {
    const row = document.createElement('div');
    row.className = 'page-row';
    row.dataset.page = p.n;
    const sheetEn = document.createElement('div');
    sheetEn.className = 'sheet en';
    const sheetZh = document.createElement('div');
    sheetZh.className = 'sheet zh';
    for (const [sheet, label] of [[sheetEn, '原文'], [sheetZh, '译文']]) {
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = `第 ${p.n} 页`;
      sheet.appendChild(ph);
      const tag = document.createElement('div');
      tag.className = 'sheet-label';
      tag.textContent = label;
      tag.hidden = true;
      sheet.appendChild(tag);
    }
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.hidden = true;
    badge.addEventListener('click', () => {
      if (badge.classList.contains('err')) this.onRetry(p.n);
    });
    sheetZh.appendChild(badge);
    row.append(sheetEn, sheetZh);
    return { p, row, sheetEn, sheetZh, badge, token: 0, rendered: false, cssW: 0, cssH: 0 };
  }

  // ----- geometry -----

  sheetWidth(p) {
    const style = getComputedStyle(this.root);
    const avail = this.root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = 16;
    const per = this.mode === 'dual' ? (avail - gap) / 2 : avail;
    if (this.zoom) return Math.round(p.width * (96 / 72) * this.zoom);
    return Math.max(200, Math.floor(Math.min(per, this.mode === 'dual' ? 820 : 920)));
  }

  layout() {
    for (const r of this.rows) {
      const w = this.sheetWidth(r.p);
      const h = Math.round((w * r.p.height) / r.p.width);
      r.cssW = w;
      r.cssH = h;
      for (const s of [r.sheetEn, r.sheetZh]) {
        s.style.width = `${w}px`;
        s.style.height = `${h}px`;
      }
      if (r.layer) r.layer.style.transform = `scale(${w / r.p.width})`;
    }
  }

  scheduleRelayout() {
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = setTimeout(() => this.relayout(), 120);
  }

  relayout() {
    const anchor = this.current;
    const before = this.rows.map((r) => r.cssW).join();
    this.layout();
    if (this.rows.map((r) => r.cssW).join() === before) return;
    this.scrollToPage(anchor);
    for (const r of this.rows) {
      if (r.rendered) this.render(r);
    }
  }

  scrollToPage(n) {
    const r = this.rows[n - 1];
    if (r) this.root.scrollTop = r.row.offsetTop - 12;
  }

  setMode(mode) {
    this.mode = mode;
    this.root.classList.remove('mode-zh', 'mode-en', 'mode-dual');
    this.root.classList.add(`mode-${mode}`);
    for (const r of this.rows) {
      for (const s of [r.sheetEn, r.sheetZh]) s.querySelector('.sheet-label').hidden = mode !== 'dual';
    }
    this.relayout();
    for (const r of this.rows) if (r.needsFit) this.fitLayer(r);
  }

  stepZoom(dir) {
    const cur = this.zoom ?? this.rows[0].cssW / (this.rows[0].p.width * (96 / 72));
    let next;
    if (dir > 0) next = ZOOMS.find((z) => z > cur + 0.01) ?? ZOOMS[ZOOMS.length - 1];
    else next = [...ZOOMS].reverse().find((z) => z < cur - 0.01) ?? ZOOMS[0];
    this.zoom = next;
    this.relayout();
    return this.zoomLabel();
  }

  zoomLabel() {
    return this.zoom ? `${Math.round(this.zoom * 100)}%` : '适宽';
  }

  // ----- visibility -----

  onIntersect(entries) {
    for (const e of entries) {
      const n = Number(e.target.dataset.page);
      if (e.isIntersecting) this.visible.add(n);
      else this.visible.delete(n);
    }
    this.updateCurrent();
    for (const n of this.visible) {
      const r = this.rows[n - 1];
      if (!r.rendered) this.render(r);
    }
    for (const r of this.rows) {
      if (r.rendered && !this.visible.has(r.p.n) && Math.abs(r.p.n - this.current) > KEEP_PAGES) this.release(r);
    }
  }

  updateCurrent() {
    const mid = this.root.scrollTop + this.root.clientHeight / 3;
    let lo = 0, hi = this.rows.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.rows[m].row.offsetTop <= mid) lo = m;
      else hi = m - 1;
    }
    this.current = lo + 1;
  }

  // Translation order: the page in view first, then pages after it, then before.
  priority(n) {
    const d = n - this.current;
    return d >= 0 ? d : -d + 0.5;
  }

  // ----- rendering -----

  async render(r) {
    const token = ++r.token;
    r.rendered = true;
    const { p } = r;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let scale = (r.cssW / p.width) * dpr;
    const pixels = p.width * p.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const page = await this.pdf.getPage(p.n);
    const viewport = page.getViewport({ scale });
    const en = makeCanvas(viewport);
    try {
      await page.render({ canvas: en, viewport }).promise;
    } catch (e) {
      if (token === r.token) console.error(`page ${p.n} render failed`, e);
      return;
    }
    if (token !== r.token) return;
    replaceCanvas(r.sheetEn, r.canvasEn, en);
    r.canvasEn = en;
    r.page = page;
    r.viewport = viewport;
    await this.compose(r, token);
  }

  // Build the translated sheet from the original render.
  async compose(r, token = r.token) {
    if (!r.canvasEn) return;
    const { p, page, viewport } = r;
    const zh = makeCanvas(viewport);
    const ctx = zh.getContext('2d');
    ctx.drawImage(r.canvasEn, 0, 0);
    const blocks = p.blocks.filter((b) => b.zh);
    if (blocks.length) {
      const bare = makeCanvas(viewport);
      try {
        await page.render({
          canvas: bare,
          viewport,
          operationsFilter: (i, ops) => !this.textOps.has(ops.fnArray[i]),
        }).promise;
      } catch (e) {
        console.error(`page ${p.n} text-free render failed`, e);
        return;
      }
      if (token !== r.token) return;
      const k = viewport.scale;
      for (const b of blocks) {
        for (const rect of [b.bbox, ...(b.erase || [])]) {
          const pad = 1.2;
          const x = Math.max(0, Math.floor((rect[0] - pad) * k));
          const y = Math.max(0, Math.floor((rect[1] - pad) * k));
          const w = Math.min(zh.width - x, Math.ceil((rect[2] - rect[0] + 2 * pad) * k));
          const h = Math.min(zh.height - y, Math.ceil((rect[3] - rect[1] + 2 * pad) * k));
          if (w > 0 && h > 0) ctx.drawImage(bare, x, y, w, h, x, y, w, h);
        }
      }
      bare.width = bare.height = 0;
    }
    if (token !== r.token) return;
    replaceCanvas(r.sheetZh, r.canvasZh, zh);
    r.canvasZh = zh;
    this.buildLayer(r, blocks);
  }

  buildLayer(r, blocks) {
    r.layer?.remove();
    r.layer = null;
    if (!blocks.length) return;
    const layer = document.createElement('div');
    layer.className = 'zh-layer';
    layer.style.width = `${r.p.width}px`;
    layer.style.height = `${r.p.height}px`;
    layer.style.transform = `scale(${r.cssW / r.p.width})`;
    for (const b of blocks) {
      const el = document.createElement('div');
      const pad = HALF_LEADING * fontSizeOf(b);
      el.className = `zh-block ${b.kind}`;
      el.dataset.id = b.id;
      el.style.left = `${b.bbox[0]}px`;
      el.style.top = `${b.bbox[1] - pad}px`;
      el.style.width = `${b.bbox[2] - b.bbox[0]}px`;
      el.style.height = `${b.bbox[3] - b.bbox[1] + 2 * pad}px`;
      el.innerHTML = inline(b.zh);
      layer.appendChild(el);
    }
    r.sheetZh.appendChild(layer);
    r.layer = layer;
    this.fitLayer(r);
  }

  // Fit the Chinese text into the original block box. Keeping the original
  // font size matters most for a page that reads evenly, so line spacing is
  // tightened first and the font shrinks only when that is not enough.
  fitLayer(r) {
    if (!r.layer) return;
    if (r.sheetZh.offsetParent === null) {
      r.needsFit = true;
      return;
    }
    r.needsFit = false;
    const font = this.getFont();
    const byId = new Map(r.p.blocks.map((b) => [b.id, b]));
    for (const el of r.layer.children) {
      const b = byId.get(el.dataset.id);
      if (b.fit?.font === font && b.fit.zh === b.zh) {
        el.style.fontSize = `${b.fit.size}px`;
        el.style.lineHeight = b.fit.lineHeight;
        continue;
      }
      const size = fontSizeOf(b);
      const boxH = b.bbox[3] - b.bbox[1] + 2 * HALF_LEADING * size;
      const fits = (s, lh) => {
        el.style.fontSize = `${s}px`;
        el.style.lineHeight = lh;
        return el.scrollHeight <= boxH + 0.6;
      };
      let fit = null;
      for (const lh of LINE_HEIGHTS) {
        if (fits(size, lh)) {
          fit = { size, lineHeight: lh };
          break;
        }
      }
      if (!fit) {
        const lh = LINE_HEIGHTS[LINE_HEIGHTS.length - 1];
        let lo = size * 0.45;
        let hi = size;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid, lh)) lo = mid;
          else hi = mid;
        }
        fit = { size: lo, lineHeight: lh };
        fits(lo, lh);
      }
      b.fit = { font, zh: b.zh, ...fit };
    }
  }

  refit() {
    for (const p of this.pages) for (const b of p.blocks) delete b.fit;
    for (const r of this.rows) if (r.layer) this.fitLayer(r);
  }

  release(r) {
    r.token++;
    r.rendered = false;
    for (const key of ['canvasEn', 'canvasZh']) {
      if (r[key]) {
        r[key].width = r[key].height = 0;
        r[key].remove();
        r[key] = null;
      }
    }
    r.layer?.remove();
    r.layer = null;
    r.page = null;
  }

  // Called when a page's translation arrives.
  pageTranslated(n) {
    const r = this.rows[n - 1];
    if (r?.rendered && r.canvasEn) this.compose(r);
  }

  setPageStatus(n, state, error) {
    const r = this.rows[n - 1];
    if (!r) return;
    const { badge } = r;
    badge.className = 'badge';
    if (state === 'running') {
      badge.innerHTML = '<span class="spin"></span>翻译中';
      badge.hidden = false;
    } else if (state === 'pending') {
      badge.textContent = '排队中';
      badge.hidden = false;
    } else if (state === 'error') {
      badge.classList.add('err');
      badge.textContent = '翻译失败，点此重试';
      badge.title = error || '';
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  showOriginal(e) {
    const el = e.target.closest?.('.zh-block');
    if (!el) return;
    const n = Number(el.closest('.page-row').dataset.page);
    const b = this.pages[n - 1].blocks.find((x) => x.id === el.dataset.id);
    if (!b) return;
    const tip = this.tooltip;
    tip.textContent = b.text.replace(/[_^]\{([^}]*)\}/g, '$1');
    tip.hidden = false;
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - tipRect.height - 8);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - tipRect.width - 8);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  destroy() {
    this.observer.disconnect();
    this.resizeObserver.disconnect();
    for (const r of this.rows) this.release(r);
    this.root.replaceChildren();
  }
}

function makeCanvas(viewport) {
  const c = document.createElement('canvas');
  c.width = Math.floor(viewport.width);
  c.height = Math.floor(viewport.height);
  return c;
}

function replaceCanvas(sheet, old, next) {
  if (old) {
    old.width = old.height = 0;
    old.remove();
  }
  sheet.querySelector('.placeholder')?.remove();
  sheet.insertBefore(next, sheet.firstChild);
}
