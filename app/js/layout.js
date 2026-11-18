// Page layout analysis: turns pdf.js text items into paragraph blocks and marks
// which blocks are prose (to translate) and which belong to figures, tables,
// formulas, code, margins or the bibliography (left exactly as typeset).
//
// All geometry is in viewport units at scale 1 (PDF points, origin top-left).

export const TRANSLATABLE = new Set(['text', 'heading', 'caption']);

const IMAGE_OPS = [
  'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject',
  'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat',
  'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintSolidColorImageMask',
];

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function rectThrough(m, x0, y0, x1, y1) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const u = m[0] * x + m[2] * y + m[4], v = m[1] * x + m[3] * y + m[5];
    minX = Math.min(minX, u); maxX = Math.max(maxX, u);
    minY = Math.min(minY, v); maxY = Math.max(maxY, v);
  }
  return [minX, minY, maxX, maxY];
}

const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);

// Extents of embedded figures: raster images, and everything a form XObject
// draws (LaTeX \includegraphics of a PDF figure becomes a form XObject).
export function figureRegions(opList, OPS, viewport) {
  const { fnArray, argsArray } = opList;
  const imageOps = new Set(IMAGE_OPS.map((k) => OPS[k]).filter((v) => v !== undefined));
  const pageArea = viewport.width * viewport.height;
  let ctm = viewport.transform.slice();
  const stack = [];
  const forms = [];
  const regions = [];
  const add = (r) => {
    if (forms.length) {
      for (const f of forms) f.rect = f.rect ? union(f.rect, r) : r;
    } else {
      regions.push(r);
    }
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      if (stack.length) ctm = stack.pop();
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args);
    } else if (fn === OPS.beginGroup) {
      stack.push(ctm);
      if (args?.[0]?.matrix) ctm = mul(ctm, args[0].matrix);
    } else if (fn === OPS.endGroup) {
      if (stack.length) ctm = stack.pop();
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args?.[0]) ctm = mul(ctm, args[0]);
      forms.push({ rect: null });
    } else if (fn === OPS.paintFormXObjectEnd) {
      if (stack.length) ctm = stack.pop();
      const f = forms.pop();
      if (f?.rect && !forms.length) regions.push(f.rect);
    } else if (fn === OPS.constructPath) {
      const minMax = args?.[2];
      if (forms.length && args[0] !== OPS.endPath && minMax && Number.isFinite(minMax[0])) {
        add(rectThrough(ctm, minMax[0], minMax[1], minMax[2], minMax[3]));
      }
    } else if (imageOps.has(fn)) {
      add(rectThrough(ctm, 0, 0, 1, 1));
    }
  }
  // A region covering most of the page is a page background, not a figure.
  return regions.filter((r) => area(r) < 0.6 * pageArea);
}

const BOLD_RE = /bold|black|heavy|semibold|demi|-medi|\bmedi|cmbx|cmbsy|sfbx|-bd\b|bd$|\.b$/i;
const MONO_RE = /mono|courier|typewriter|cmtt|inconsolata|consolas|menlo|sfmono|lmtt|sftt|txtt|\btt\d/i;

// Text items with upright boxes in viewport coordinates.
export function textItems(textContent, viewport, fontName) {
  const items = [];
  for (const it of textContent.items) {
    if (it.str === undefined || !it.str.trim()) continue;
    const m = mul(viewport.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (size < 1) continue;
    const upright = Math.abs(m[1]) < 1e-3 * size && Math.abs(m[2]) < 1e-3 * size && m[0] > 0 && m[3] < 0;
    const style = textContent.styles[it.fontName] || {};
    const ascent = style.ascent > 0.5 && style.ascent < 1.2 ? style.ascent : 0.8;
    const descent = style.descent < 0 && style.descent > -0.5 ? style.descent : -0.2;
    const name = fontName(it.fontName);
    const width = it.width * viewport.scale;
    items.push({
      str: it.str,
      x0: m[4],
      x1: m[4] + width,
      base: m[5],
      top: m[5] - ascent * size,
      bottom: m[5] - descent * size,
      size,
      upright,
      bold: BOLD_RE.test(name),
      mono: MONO_RE.test(name),
    });
  }
  return items;
}

// Line numbers of review templates: a vertical run of short numerals sharing
// one x position. They are dropped from analysis (and stay on the page).
export function dropLineNumbers(items) {
  const numeric = items.filter((it) => /^\d{1,4}$/.test(it.str.trim()));
  const columns = new Map();
  for (const it of numeric) {
    const key = Math.round(it.x1 / 3);
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(it);
  }
  const drop = new Set();
  for (const col of columns.values()) if (col.length >= 8) for (const it of col) drop.add(it);
  return drop.size ? items.filter((it) => !drop.has(it)) : items;
}

const SECTION_NUMBER = /^(\d+(\.\d+)*\.?|[A-Z](\.\d+)*\.?)$/;

// Largest horizontal gap that still joins two items of one line. Words are
// about a third of an em apart, while column gutters and table columns are
// wider than an em. LaTeX separates section numbers and run-in paragraph
// headings from the following text by a quad, so those get a wider allowance.
function maxGap(a, b) {
  const [left, right] = a.x0 <= b.x0 ? [a, b] : [b, a];
  const em = Math.max(a.size, b.size);
  const l = left.str.trim();
  if (SECTION_NUMBER.test(l)) return 2.5 * em;
  if (left.bold && !right.bold && (/[.:]$/.test(l) || /^[A-Z]/.test(right.str.trim()))) return 1.8 * em;
  return 0.9 * em;
}

// Union-find grouping of items into line segments: items that share a text
// line and sit close together horizontally.
export function buildLines(items) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const order = [...parent.keys()].sort((a, b) => items[a].top - items[b].top);
  for (let oi = 0; oi < n; oi++) {
    const a = items[order[oi]];
    for (let oj = oi + 1; oj < n; oj++) {
      const b = items[order[oj]];
      if (b.top >= a.bottom) break;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap < 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top)) continue;
      const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (gap > maxGap(a, b)) continue;
      parent[find(order[oi])] = find(order[oj]);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(items[i]);
  }
  return mergeJustified([...groups.values()].map(makeLine));
}

// A justified line stretched by long words or sentence spacing can have gaps
// wider than the word-gap limit and split into pieces. Rejoin a run of pieces
// in one row when the run spans exactly the extent of a plain paragraph line
// just above or below it (the signature of a justified line) and its gaps
// are even.
function mergeJustified(lines) {
  const plain = (l) => (l.text.match(/\S+/g) || []).length >= 4;
  const rows = [];
  for (const l of [...lines].sort((a, b) => a.top - b.top || a.x0 - b.x0)) {
    const row = rows.find((r) => Math.abs(r[0].base - l.base) < 0.2 * l.size && Math.abs(r[0].size - l.size) < 0.1 * l.size);
    if (row) row.push(l);
    else rows.push([l]);
  }
  const spansLikeNeighbor = (row, x0, x1) => lines.some((l) => !row.includes(l) && plain(l) &&
    Math.abs(l.base - row[0].base) > 0.8 * l.size && Math.abs(l.base - row[0].base) < 2.6 * l.size &&
    Math.abs(l.x0 - x0) < 2 && Math.abs(l.x1 - x1) < 2);
  const out = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    let i = 0;
    while (i < row.length) {
      let j = row.length - 1;
      for (; j > i; j--) {
        const run = row.slice(i, j + 1);
        const gaps = run.slice(1).map((l, k) => l.x0 - run[k].x1);
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (gaps.some((g) => g > 4 * row[0].size || Math.abs(g - mean) > 0.2 * mean + 0.5)) continue;
        if (spansLikeNeighbor(row, run[0].x0, run[run.length - 1].x1)) break;
      }
      if (j > i) out.push(makeLine(row.slice(i, j + 1).flatMap((l) => l.items)));
      else out.push(row[i]);
      i = j > i ? j + 1 : i + 1;
    }
  }
  return out;
}

function weightedMode(pairs) {
  const w = new Map();
  for (const [value, weight] of pairs) {
    const k = Math.round(value * 10) / 10;
    w.set(k, (w.get(k) || 0) + weight);
  }
  let best = 0, bestW = -1;
  for (const [k, v] of w) if (v > bestW) { best = k; bestW = v; }
  return best;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function makeLine(its) {
  its.sort((a, b) => a.x0 - b.x0);
  const size = weightedMode(its.map((it) => [it.size, it.str.length]));
  const main = its.filter((it) => Math.abs(it.size - size) <= 0.12 * size);
  const base = median((main.length ? main : its).map((it) => it.base));
  let text = '';
  let rich = '';
  let role = null;
  let prev = null;
  let inBold = false;
  let chars = 0, boldChars = 0, monoChars = 0;
  const allBold = its.every((it) => it.bold);
  for (const it of its) {
    let r = null;
    if (it.size < 0.88 * size) {
      const d = it.base - base;
      if (d > 0.1 * size) r = 'sub';
      else if (d < -0.15 * size) r = 'sup';
    }
    const bold = it.bold && !allBold && !r;
    if (bold !== inBold) {
      rich = inBold ? rich.trimEnd() + '** ' : rich + ' **';
      inBold = bold;
    }
    if (r !== role) {
      const mark = role ? '}' : '';
      const open = r ? (r === 'sub' ? '_{' : '^{') : '';
      text += mark + open;
      rich += mark + open;
      role = r;
    }
    const s = role ? it.str.trim() : it.str;
    if (prev && it.x0 - prev.x1 > 0.15 * Math.min(it.size, prev.size) && !/\s$/.test(text) && !/^\s/.test(s)) {
      text += ' ';
      rich += ' ';
    }
    text += s;
    rich += inBold ? s.trimStart() : s;
    prev = it;
    const c = it.str.trim().length;
    chars += c;
    if (it.bold) boldChars += c;
    if (it.mono) monoChars += c;
  }
  if (role) {
    text += '}';
    rich += '}';
  }
  if (inBold) rich = rich.trimEnd() + '**';
  return {
    items: its,
    text: text.replace(/\s+/g, ' ').trim(),
    rich: rich.replace(/\s+/g, ' ').replace(/\*\*\s*\*\*/g, ' ').trim(),
    x0: Math.min(...its.map((i) => i.x0)),
    x1: Math.max(...its.map((i) => i.x1)),
    top: Math.min(...its.map((i) => i.top)),
    bottom: Math.max(...its.map((i) => i.bottom)),
    base,
    size,
    chars,
    bold: boldChars >= 0.6 * chars,
    allBold: chars > 0 && boldChars === chars,
    mono: monoChars >= 0.6 * chars,
    upright: its.every((i) => i.upright),
  };
}

// Rows with three or more narrow segments side by side are table rows (or
// author lists, sub-figure labels): they are marked and never translated.
export function markTableCells(lines, pageWidth) {
  const narrow = (l) => l.x1 - l.x0 < 0.25 * pageWidth;
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const band = [a];
    for (let j = 0; j < sorted.length; j++) {
      const b = sorted[j];
      if (b === a) continue;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap >= 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top)) band.push(b);
    }
    const cells = band.filter(narrow);
    if (cells.length >= 3) for (const c of cells) c.table = true;
  }
}

// Bounding boxes of tables: clusters of table-cell segments. Any text whose
// center falls inside is part of the table (e.g. a row whose cells merged).
export function tableRegions(lines) {
  const cells = lines.filter((l) => l.table).sort((a, b) => a.top - b.top);
  const regions = [];
  for (const c of cells) {
    const r = regions.find((g) => c.top - g.rect[3] < 2.5 * c.size &&
      Math.min(c.x1, g.rect[2]) - Math.max(c.x0, g.rect[0]) > -0.25 * (g.rect[2] - g.rect[0]));
    if (r) {
      r.rect = union(r.rect, [c.x0, c.top, c.x1, c.bottom]);
      r.count++;
    } else {
      regions.push({ rect: [c.x0, c.top, c.x1, c.bottom], count: 1 });
    }
  }
  return regions.filter((g) => g.count >= 4).map((g) => g.rect);
}

// Stack lines into blocks: same font size, consecutive baselines, horizontal overlap.
export function buildBlocks(lines) {
  const sorted = [...lines].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const blocks = [];
  for (const ln of sorted) {
    let best = null;
    let bestDy = Infinity;
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      const s = Math.max(ln.size, last.size);
      if (Math.abs(ln.size - last.size) > 0.07 * s) continue;
      if (ln.mono !== last.mono || !!ln.table !== !!last.table) continue;
      const dy = ln.base - last.base;
      if (dy < 0.5 * s || dy > 1.75 * s) continue;
      const overlap = Math.min(ln.x1, b.x1) - Math.max(ln.x0, b.x0);
      const aligned = Math.abs(ln.x0 - b.x0) < 2 * s;
      if (overlap < 0.5 * Math.min(ln.x1 - ln.x0, b.x1 - b.x0) && !aligned) continue;
      if (dy < bestDy) {
        best = b;
        bestDy = dy;
      }
    }
    if (best) {
      best.lines.push(ln);
      best.x0 = Math.min(best.x0, ln.x0);
      best.x1 = Math.max(best.x1, ln.x1);
    } else {
      blocks.push({ lines: [ln], x0: ln.x0, x1: ln.x1 });
    }
  }
  return blocks.flatMap(splitParagraphs);
}

const SENTENCE_END = /[.!?:;]["'”’)\]]?$/;
const LIST_START = /^(•|·|∙|◦|▪|‣|–|—|\*|\(?\d{1,2}[.)]|\(?[a-z][.)]|\((?:[ivx]+)\))\s/;

// A block may hold several paragraphs, list items, or a run-in heading line.
// Split after a fully bold heading line, and before a line when the previous
// line stops short and closes a sentence or the line starts a list item.
function splitParagraphs(block) {
  const { lines } = block;
  const right = Math.max(...lines.map((l) => l.x1));
  const groups = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1];
    const l = lines[i];
    const short = p.x1 < right - 2.5 * l.size;
    const split = (p.allBold && !l.bold) || (short && (SENTENCE_END.test(p.text) || LIST_START.test(l.text)));
    if (split) groups.push([l]);
    else groups[groups.length - 1].push(l);
  }
  return groups.map(finishBlock);
}

function joinLines(lines, key) {
  let text = '';
  for (const l of lines) {
    if (!text) text = l[key];
    else if (/[A-Za-z]-$/.test(text)) text += l[key];
    else text += ' ' + l[key];
  }
  return text;
}

function finishBlock(lines) {
  const chars = lines.reduce((s, l) => s + l.chars, 0);
  return {
    lines,
    text: joinLines(lines, 'text'),
    rich: joinLines(lines, 'rich'),
    x0: Math.min(...lines.map((l) => l.x0)),
    x1: Math.max(...lines.map((l) => l.x1)),
    top: Math.min(...lines.map((l) => l.top)),
    bottom: Math.max(...lines.map((l) => l.bottom)),
    size: weightedMode(lines.map((l) => [l.size, l.chars])),
    bold: lines.reduce((s, l) => s + (l.bold ? l.chars : 0), 0) >= 0.6 * chars,
    mono: lines.every((l) => l.mono),
    upright: lines.every((l) => l.upright),
    table: lines.filter((l) => l.table).length >= 0.5 * lines.length,
  };
}

const CAPTION_RE = /^(figure|fig\.|table|tab\.|algorithm|listing|box|exhibit)\s*[A-Z]?\d+(\.\d+)*\s*[.:|]/i;
const REFS_RE = /^(\d+\.?|[A-Z]\.)?\s*(references|bibliography|reference list|literature cited)$/i;

function insideFraction(block, regions) {
  if (!regions.length) return 0;
  let inside = 0, total = 0;
  for (const l of block.lines) {
    for (const it of l.items) {
      const cx = (it.x0 + it.x1) / 2, cy = (it.top + it.bottom) / 2;
      const w = it.str.length;
      total += w;
      if (regions.some((r) => cx >= r[0] - 1 && cx <= r[2] + 1 && cy >= r[1] - 1 && cy <= r[3] + 1)) inside += w;
    }
  }
  return total ? inside / total : 0;
}

function classify(block, page, bodySize) {
  const t = block.text;
  const nonSpace = t.replace(/\s/g, '').length || 1;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const words = (t.match(/[A-Za-z]{2,}/g) || []).length;
  if (!block.upright) return 'rotated';
  if (block.mono) return 'code';
  if (insideFraction(block, page.regions) >= 0.5) return 'figure';
  if (block.table) return 'table';
  const cx = (block.x0 + block.x1) / 2, cy = (block.top + block.bottom) / 2;
  if (page.tables.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) return 'table';
  const inMargin = block.top < 0.065 * page.height || block.bottom > 0.95 * page.height;
  if (inMargin && words <= 15) return 'margin';
  if (letters / nonSpace < 0.5) return 'math';
  if (CAPTION_RE.test(t)) return 'caption';
  const upper = (t.match(/[A-Z]/g) || []).length;
  const headingLike = !/[,;]$/.test(t) && (
    (block.lines.length === 1 && words <= 14 && !/\.$/.test(t) &&
      ((/^(\d+(\.\d+)*|[A-Z](\.\d+)*)\.?\s+[A-Z]/.test(t) && (block.bold || upper >= 0.5 * letters || block.size > 1.05 * bodySize)) ||
        upper >= 0.7 * letters)) ||
    (block.lines.length <= 2 && words <= 16 && (block.bold || block.size > 1.1 * bodySize)) ||
    (block.lines.length <= 4 && words <= 40 && block.size > 1.25 * bodySize));
  if (headingLike) return 'heading';
  if (words < 4) return 'short';
  return 'text';
}

// Full-document analysis. `loadPage(n)` resolves {width, height, items, regions}.
export async function analyzeDocument(numPages, loadPage) {
  const pages = [];
  for (let n = 1; n <= numPages; n++) {
    const p = await loadPage(n);
    const lines = buildLines(dropLineNumbers(p.items.filter((it) => it.upright)));
    markTableCells(lines, p.width);
    pages.push({ ...p, n, lines, tables: tableRegions(lines) });
  }
  const bodySize = weightedMode(pages.flatMap((p) => p.lines.map((l) => [l.size, l.chars])));
  let inRefs = false;
  for (const page of pages) {
    const blocks = orderBlocks(buildBlocks(page.lines), page.width);
    page.blocks = blocks.map((b, i) => {
      b.index = i;
      let kind = classify(b, page, bodySize);
      if (kind === 'heading' && REFS_RE.test(b.text.trim())) {
        inRefs = true;
      } else if (kind === 'heading' && inRefs && (b.size > 1.05 * bodySize || /^(appendix|[A-Z](\.\d+)*\s)/i.test(b.text))) {
        inRefs = false;
      } else if (inRefs && (kind === 'text' || kind === 'short' || kind === 'heading')) {
        kind = 'reference';
      }
      return {
        id: `${page.n}-${i}`,
        kind,
        text: b.text,
        rich: b.rich,
        bbox: [b.x0, b.top, b.x1, b.bottom],
        size: b.size,
        maxSize: Math.max(...b.lines.flatMap((l) => l.items.map((it) => it.size))),
        bold: b.bold,
        lines: b.lines.length,
        lineHeight: b.lines.length > 1 ? (b.lines[b.lines.length - 1].base - b.lines[0].base) / (b.lines.length - 1) : b.size * 1.2,
      };
    });
    attachFragments(page, blocks);
    delete page.lines;
    delete page.items;
  }
  return { bodySize, pages };
}

// Small pieces of inline math (stacked sub/superscripts, limits) can end up
// in their own segments. When such a piece sits inside a translated block, it
// is erased together with the block, since the translation restates the math.
function attachFragments(page, blocks) {
  const out = page.blocks;
  for (const [i, b] of blocks.entries()) {
    if (!TRANSLATABLE.has(out[i].kind)) continue;
    const [x0, y0, x1, y1] = out[i].bbox;
    const erase = [];
    for (const [j, other] of blocks.entries()) {
      if (TRANSLATABLE.has(out[j].kind) || !['math', 'table', 'short'].includes(out[j].kind)) continue;
      for (const l of other.lines) {
        for (const it of l.items) {
          if (it.size > 0.9 * b.size) continue;
          const cx = (it.x0 + it.x1) / 2, cy = (it.top + it.bottom) / 2;
          if (cx > x0 && cx < x1 && cy > y0 - 0.3 * b.size && cy < y1 + 0.3 * b.size) erase.push([it.x0, it.top, it.x1, it.bottom]);
        }
      }
    }
    if (erase.length) out[i].erase = erase;
  }
}

// Reading order: full-width blocks break the flow; between them, the left
// column is read before the right column (two-column layouts).
function orderBlocks(blocks, width) {
  const spans = (b) => b.x0 < 0.45 * width && b.x1 > 0.55 * width;
  const out = [];
  let left = [], right = [];
  const flush = () => { out.push(...left, ...right); left = []; right = []; };
  for (const b of [...blocks].sort((a, c) => a.top - c.top || a.x0 - c.x0)) {
    if (spans(b)) { flush(); out.push(b); }
    else if ((b.x0 + b.x1) / 2 < width / 2) left.push(b);
    else right.push(b);
  }
  flush();
  return out;
}
