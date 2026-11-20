// Page layout analysis: turns pdf.js text items into paragraph blocks and marks
// which blocks are prose (to translate) and which belong to figures, tables,
// formulas, code, margins or the bibliography (left exactly as typeset).
//
// All geometry is in viewport units at scale 1 (PDF points, origin top-left).

export const TRANSLATABLE = new Set(['text', 'heading', 'caption']);
// How far, in em, the image of an inline formula extends beyond its box.
export const FORMULA_REACH = 0.6;

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

// Extents of embedded figures (raster images, and everything a form XObject
// draws: LaTeX \includegraphics of a PDF figure becomes a form XObject), and
// the thin rules drawn on the page itself (fraction bars, overlines,
// underlines) with their operator index, so a render can leave them out.
export function pageGraphics(opList, OPS, viewport) {
  const { fnArray, argsArray } = opList;
  const imageOps = new Set(IMAGE_OPS.map((k) => OPS[k]).filter((v) => v !== undefined));
  const pageArea = viewport.width * viewport.height;
  let ctm = viewport.transform.slice();
  const stack = [];
  const forms = [];
  const regions = [];
  const rules = [];
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
      if (args[0] !== OPS.endPath && minMax && Number.isFinite(minMax[0])) {
        const r = rectThrough(ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
        if (forms.length) add(r);
        else if (Math.min(r[2] - r[0], r[3] - r[1]) < 2) rules.push({ i, rect: r });
      }
    } else if (imageOps.has(fn)) {
      add(rectThrough(ctm, 0, 0, 1, 1));
    }
  }
  // A region covering most of the page is a page background, not a figure.
  return { regions: regions.filter((r) => area(r) < 0.6 * pageArea), rules };
}

const BOLD_RE = /bold|black|heavy|semibold|demi|-medi|\bmedi|cmbx|cmbsy|sfbx|-bd\b|bd$|\.b$/i;
const MONO_RE = /mono|courier|typewriter|cmtt|inconsolata|consolas|menlo|sfmono|lmtt|sftt|txtt|\btt\d/i;
// Fonts that only typeset mathematics: TeX math italic, symbols and
// extensions, AMS and other math alphabets, OpenType math fonts.
const MATH_RE = /(^|\+)(cmmi|cmsy|cmex|cmbsy|cmmib|msam|msbm|eufm|eufb|eusm|eusb|eurm|eurb|rsfs|stmary|wasy|esint|bbm|dsrom|txmi|txsy|txex|pxmi|pxsy|pxex|ntxmi|ntxsy|zxmi|mtmi|mtsy|mtex)|math|symbol/i;

const clamp = (v, lo, hi, fallback) => (v >= lo && v <= hi ? v : fallback);

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
    const name = fontName(it.fontName);
    const math = MATH_RE.test(name);
    // Math extension fonts (big delimiters and operators) hang their glyphs
    // below the baseline, so their metrics are taken as given.
    const ascent = math ? clamp(style.ascent, 0, 1.5, 0.8) : clamp(style.ascent, 0.5, 1.2, 0.8);
    const descent = math ? clamp(style.descent, -1.5, 0, -0.2) : clamp(style.descent, -0.5, 0, -0.2);
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
      math,
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

// LaTeX's built-in operator names, set upright in the text font.
const OPERATOR_NAMES = new Set(['arccos', 'arcsin', 'arctan', 'arg', 'cos', 'cosh', 'cot', 'coth', 'csc', 'deg', 'det', 'dim',
  'exp', 'gcd', 'hom', 'inf', 'ker', 'lg', 'lim', 'liminf', 'limsup', 'ln', 'log', 'max', 'min', 'Pr', 'sec', 'sin', 'sinh',
  'sup', 'tan', 'tanh']);
const isProse = (str) => (str.match(/[A-Za-z]{2,}/g) || []).some((w) => !OPERATOR_NAMES.has(w));

// Inline formulas of a line, as a run index per item (-1 outside formulas).
// A run starts and ends at items in a math font and takes in everything
// between them that is not prose (operators, digits, brackets, sub- and
// superscripts set in the text font), plus such items touching its ends.
// Sentence punctuation after a formula stays with the text.
function mathRuns(its, roles, size) {
  const kind = its.map((it, k) => (it.math ? 'M' : !roles[k] && isProse(it.str) ? 'P' : 'N'));
  const runOf = new Array(its.length).fill(-1);
  const touches = (a, b) => b.x0 - a.x1 < 0.25 * size;
  let runs = 0;
  let i = 0;
  while (i < its.length) {
    if (kind[i] === 'P') {
      i++;
      continue;
    }
    let j = i;
    while (j < its.length && kind[j] !== 'P') j++;
    let a = -1, b = -1;
    for (let k = i; k < j; k++) {
      if (kind[k] !== 'M') continue;
      if (a < 0) a = k;
      b = k;
    }
    if (a >= 0) {
      while (a > i && touches(its[a - 1], its[a])) a--;
      while (b + 1 < j && touches(its[b], its[b + 1]) && !/^[.,;:!?]+$/.test(its[b + 1].str.trim())) b++;
      for (let k = a; k <= b; k++) runOf[k] = runs;
      runs++;
    }
    i = j;
  }
  return runOf;
}

const ROLE_OPEN = { sub: '_{', sup: '^{' };

function makeLine(its) {
  its.sort((a, b) => a.x0 - b.x0);
  const size = weightedMode(its.map((it) => [it.size, it.str.length]));
  const main = its.filter((it) => Math.abs(it.size - size) <= 0.12 * size);
  const base = median((main.length ? main : its).map((it) => it.base));
  const roles = its.map((it) => {
    if (it.size >= 0.88 * size) return null;
    const d = it.base - base;
    return d > 0.1 * size ? 'sub' : d < -0.15 * size ? 'sup' : null;
  });
  const runOf = mathRuns(its, roles, size);
  const spaced = (k) => k > 0 && its[k].x0 - its[k - 1].x1 > 0.15 * Math.min(its[k].size, its[k - 1].size);

  // Plain text, sub- and superscripts marked _{...} and ^{...}.
  let text = '';
  let role = null;
  for (const [k, it] of its.entries()) {
    if (roles[k] !== role) {
      text += (role ? '}' : '') + (ROLE_OPEN[roles[k]] || '');
      role = roles[k];
    }
    const s = role ? it.str.trim() : it.str;
    if (spaced(k) && !/\s$/.test(text) && !/^\s/.test(s)) text += ' ';
    text += s;
  }
  if (role) text += '}';

  // Text for translation: bold marked **...**, and each inline formula
  // replaced by a marker \u0000<run>\u0000 that the block numbers.
  let rich = '';
  let inBold = false;
  role = null;
  for (const [k, it] of its.entries()) {
    const run = runOf[k];
    if (run >= 0 && k > 0 && runOf[k - 1] === run) continue;
    const r = run >= 0 ? null : roles[k];
    const bold = run >= 0 ? inBold : it.bold && !r;
    const s = run >= 0 ? `\u0000${run}\u0000` : r ? it.str.trim() : it.str;
    // Markers hug the bold text; the space between items stays outside.
    if (inBold && !bold) {
      const t = rich.trimEnd();
      rich = `${t}**${t.length < rich.length ? ' ' : ''}`;
      inBold = false;
    }
    if (role && r !== role) rich += '}';
    if (spaced(k) && !/\s$/.test(rich) && !/^\s/.test(s)) rich += ' ';
    if (bold && !inBold) {
      rich += '**';
      inBold = true;
    }
    if (r !== role) {
      rich += ROLE_OPEN[r] || '';
      role = r;
    }
    rich += inBold ? s.trimStart() : s;
  }
  if (role) rich += '}';
  if (inBold) rich = rich.trimEnd() + '**';

  const runs = [];
  let chars = 0, boldChars = 0, monoChars = 0, mathChars = 0;
  for (const [k, it] of its.entries()) {
    const c = it.str.trim().length;
    chars += c;
    if (it.bold) boldChars += c;
    if (it.mono) monoChars += c;
    if (runOf[k] < 0) continue;
    mathChars += c;
    (runs[runOf[k]] ||= { base, items: [] }).items.push(it);
  }
  return {
    items: its,
    text: text.replace(/\s+/g, ' ').trim(),
    rich: rich.replace(/\s+/g, ' ').replace(/\*\*\s*\*\*/g, ' ').trim(),
    runs,
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
    // A line made (almost) only of formulas is display math.
    math: runs.length > 0 && mathChars >= 0.8 * chars,
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
      if (ln.mono !== last.mono || ln.math !== last.math || !!ln.table !== !!last.table) continue;
      const dy = ln.base - last.base;
      if (dy < 0.5 * s || dy > 1.75 * s) continue;
      const overlap = Math.min(ln.x1, b.x1) - Math.max(ln.x0, b.x0);
      const aligned = Math.abs(ln.x0 - b.x0) < 2 * s;
      if (overlap < 0.5 * Math.min(ln.x1 - ln.x0, b.x1 - b.x0) && !aligned) continue;
      // A line without letters inside the column (a fraction's numerator, an
      // equation number) is not a paragraph line.
      if (!aligned && !/[A-Za-z]/.test(ln.text)) continue;
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
  const allBold = lines.every((l) => l.allBold);
  // Inline formulas become numbered placeholders ⟦1⟧, ⟦2⟧, ...; a block that
  // is bold throughout carries its weight as a property, not as markers.
  const spans = [];
  const rich = lines.map((l) => ({
    rich: (allBold ? l.rich.replace(/\*\*/g, '') : l.rich).replace(/\u0000(\d+)\u0000/g, (_, i) => {
      spans.push({ kind: 'math', base: l.runs[i].base, items: [...l.runs[i].items] });
      return `⟦${spans.length}⟧`;
    }),
  }));
  return {
    lines,
    text: joinLines(lines, 'text'),
    rich: joinLines(rich, 'rich').replace(/\*\*\s*\*\*/g, ' '),
    spans,
    allBold,
    math: lines.every((l) => l.math),
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
  if (block.math) return 'math';
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

// Full-document analysis. `loadPage(n)` resolves {width, height, items, regions, rules}.
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
    const left = Math.min(...page.lines.map((l) => l.x0));
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
        spans: b.spans,
        bbox: [b.x0, b.top, b.x1, b.bottom],
        size: b.size,
        maxSize: Math.max(...b.lines.flatMap((l) => l.items.map((it) => it.size))),
        bold: b.bold,
        allBold: b.allBold,
        center: centered(b, page.width, left),
        lines: b.lines.length,
        lineHeight: b.lines.length > 1 ? (b.lines[b.lines.length - 1].base - b.lines[0].base) / (b.lines.length - 1) : b.size * 1.2,
      };
    });
    attachFragments(page, blocks);
    const pageItems = page.lines.flatMap((l) => l.items);
    for (const b of page.blocks) {
      if (!TRANSLATABLE.has(b.kind)) {
        delete b.spans;
        continue;
      }
      for (const span of b.spans) finishFormula(span, b.size, pageItems);
      const [x0, y0, x1, y1] = b.bbox;
      const rules = page.rules.filter(({ rect: r }) => r[0] >= x0 - 1 && r[2] <= x1 + 1 && r[1] >= y0 - 1 && r[3] <= y1 + 1);
      if (rules.length) b.rules = rules.map((r) => r.i);
    }
    delete page.lines;
    delete page.items;
    delete page.rules;
  }
  const refs = bibliography(pages);
  for (const page of pages) {
    for (const b of page.blocks) if (TRANSLATABLE.has(b.kind)) markCitations(b, refs);
  }
  return { bodySize, pages, refs: refs.entries };
}

const rectOf = (it) => [it.x0, it.top, it.x1, it.bottom];
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
// TeX breaks an inline formula only after a relation or a binary operator.
const BREAK_AFTER = /[=+−<>≤≥≈∼≃≡∝→←⇒⇐⇔∈∉⊂⊆⊃⊇×]\s*$/;

// Geometry of an inline formula: the boxes of its glyphs and their union,
// the x positions where it may wrap across lines, and the boxes of other
// text reaching into it (neighboring lines), which are cleared from its image.
function finishFormula(span, size, pageItems) {
  const own = new Set(span.items);
  const sorted = [...span.items].sort((a, b) => a.x0 - b.x0);
  span.rects = sorted.map(rectOf);
  span.box = span.rects.reduce(union);
  span.breaks = [];
  let right = -Infinity;
  for (const [k, it] of sorted.entries()) {
    right = Math.max(right, it.x1);
    const next = sorted[k + 1];
    if (next && next.x0 > right + 0.1 * size && it.size >= 0.88 * size && BREAK_AFTER.test(it.str)) span.breaks.push(next.x0);
  }
  // The image of a formula reaches above and below its box (big delimiters
  // are taller than their metrics), and other text there is cleared from it.
  const reach = [span.box[0] - 1, span.box[1] - FORMULA_REACH * size, span.box[2] + 1, span.box[3] + FORMULA_REACH * size];
  const halo = 0.1 * size;
  span.mask = pageItems.filter((it) => !own.has(it) && overlaps(rectOf(it), reach))
    .map((it) => [it.x0, it.top - halo, it.x1, it.bottom + halo]);
  delete span.items;
}

// Centered text: lines of one block share a center but not a left edge, or a
// single line sits in the middle of the page away from the left margin.
function centered(b, width, left) {
  const mid = (l) => (l.x0 + l.x1) / 2;
  if (b.lines.length > 1) {
    const c = mid(b.lines[0]);
    return b.lines.every((l) => Math.abs(mid(l) - c) < 0.5 * b.size) && b.lines.some((l) => Math.abs(l.x0 - b.x0) > b.size);
  }
  return Math.abs(mid(b) - width / 2) < 0.3 * b.size && b.x0 > left + 0.5 * b.size;
}

// Pieces of inline math (stacked sub/superscripts, limits, big delimiters)
// can end up in their own segments. Inside a translated block, such a piece
// joins the formula it belongs to; other small pieces are erased with the
// block.
function attachFragments(page, blocks) {
  const out = page.blocks;
  for (const [i, b] of blocks.entries()) {
    const block = out[i];
    if (!TRANSLATABLE.has(block.kind)) continue;
    const [x0, y0, x1, y1] = block.bbox;
    const boxes = block.spans.map((s) => s.items.map(rectOf).reduce(union));
    for (const [j, other] of blocks.entries()) {
      if (TRANSLATABLE.has(out[j].kind) || !['math', 'table', 'short'].includes(out[j].kind)) continue;
      for (const l of other.lines) {
        for (const it of l.items) {
          const cx = (it.x0 + it.x1) / 2, cy = (it.top + it.bottom) / 2;
          if (cx <= x0 || cx >= x1 || cy <= y0 - 0.3 * b.size || cy >= y1 + 0.3 * b.size) continue;
          const k = boxes.findIndex((r, n) => cx > r[0] - 0.6 * b.size && cx < r[2] + 0.6 * b.size &&
            Math.abs(cy - block.spans[n].base) < 1.2 * b.size);
          if (k >= 0) block.spans[k].items.push(it);
          else if (it.size <= 0.9 * b.size) (block.erase ||= []).push(rectOf(it));
        }
      }
    }
  }
}

// ---------- citations ----------

// Bibliography entries in reading order, for resolving citations. Numbered
// styles ("[12] A. Author, ...") are also keyed by their label.
function bibliography(pages) {
  const entries = [];
  const numbered = new Map();
  for (const p of pages) {
    for (const b of p.blocks) {
      if (b.kind !== 'reference') continue;
      const text = b.text.replace(/[_^]\{([^}]*)\}/g, '$1');
      for (const part of text.split(/(?=\[\d{1,3}\]\s)/)) {
        const label = part.match(/^\[(\d{1,3})\]\s/);
        if (label) numbered.set(Number(label[1]), entries.length);
        entries.push({ page: p.n, y: b.bbox[1], text: part.trim() });
      }
    }
  }
  return { entries, numbered };
}

const YEAR = '(?:19|20)\\d{2}[a-z]?';
const NUMERIC_CITE = /\[(\d{1,3}(?:\s*[–—-]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[–—-]\s*\d{1,3})?)*)\]/g;
const TEXTUAL_CITE = new RegExp(`([A-Z][\\w'’-]+)(?:\\s+et al\\.|\\s+(?:and|&)\\s+[A-Z][\\w'’-]+)?\\s+\\((${YEAR}(?:\\s*[,;]\\s*${YEAR})*)\\)`, 'g');
const PAREN_CITE = /\(([^()⟦⟧]{4,400}?)\)/g;
const CITE_PART = new RegExp(`^(?:(?:e\\.g\\.|i\\.e\\.|see|cf\\.)[,:]?\\s+)?(.*?[A-Za-z].*?),?\\s+(${YEAR}(?:\\s*,\\s*${YEAR})*)$`);
const SURNAME = /[A-Z][A-Za-z'’À-ɏ-]+/;

function numberedKeys(inner) {
  const keys = [];
  for (const part of inner.split(',')) {
    const [a, b = a] = part.split(/[–—-]/).map((x) => Number(x.trim()));
    if (b < a || b - a > 50) return [];
    for (let k = a; k <= b; k++) keys.push(k);
  }
  return keys;
}

// The entry citing `surname` and `year`, as {i, name}; a name hyphenated at
// a line end ("Rad-ford") is also tried joined.
function authorYearEntry(refs, surname, year) {
  for (const name of new Set([surname, surname.replace(/-/g, '')])) {
    const has = (e) => e.text.includes(name) && (e.text.includes(year) || e.text.includes(year.slice(0, 4)));
    let i = refs.entries.findIndex((e) => e.text.startsWith(name) && has(e));
    if (i < 0) i = refs.entries.findIndex(has);
    if (i >= 0) return { i, name };
  }
  return null;
}

// Citation labels wrap only between entries (thin spaces after ";" and ","),
// and justification never stretches them (no word spaces inside).
const citeLabel = (s) => s.replace(/([;,]) /g, '$1\u2009').replace(/ /g, '\u202f');

// Citations that resolve to bibliography entries become placeholders, shown
// as small superscripts: "[12, 3]", author-year groups shortened to
// "(Smith 2020; Lee 2021)", and the year of a textual "Smith et al. (2020)".
function markCitations(block, refs) {
  if (!refs.entries.length) return;
  const cite = (label, ids) => {
    block.spans.push({ kind: 'cite', label, refs: ids });
    return `⟦${block.spans.length}⟧`;
  };
  let s = block.rich;
  if (refs.numbered.size) {
    s = s.replace(NUMERIC_CITE, (m, inner) => {
      const ids = numberedKeys(inner).map((k) => refs.numbered.get(k));
      if (!ids.length || ids.some((i) => i === undefined)) return m;
      return cite(citeLabel(`[${inner.replace(/\s*,\s*/g, ', ').replace(/\s*[–—-]\s*/g, '–')}]`), ids);
    });
  }
  s = s.replace(TEXTUAL_CITE, (m, name, years) => {
    const found = years.split(/\s*[,;]\s*/).map((y) => authorYearEntry(refs, name, y));
    if (found.some((f) => !f)) return m;
    return `${m.slice(0, m.lastIndexOf('(')).trimEnd()} ${cite(citeLabel(`(${years})`), found.map((f) => f.i))}`;
  });
  s = s.replace(PAREN_CITE, (m, inner) => {
    const labels = [];
    const ids = [];
    for (const part of inner.split(/\s*;\s*/)) {
      const p = part.trim().match(CITE_PART);
      const surname = p?.[1].match(SURNAME)?.[0];
      if (!surname) return m;
      let name = surname;
      for (const y of p[2].split(/\s*,\s*/)) {
        const f = authorYearEntry(refs, surname, y);
        if (!f) return m;
        ids.push(f.i);
        name = f.name;
      }
      labels.push(`${name} ${p[2].replace(/\s*,\s*/g, ', ')}`);
    }
    return cite(citeLabel(`(${labels.join('; ')})`), ids);
  });
  // Number the placeholders in reading order.
  const spans = [];
  block.rich = s.replace(/⟦(\d+)⟧/g, (_, n) => {
    spans.push(block.spans[n - 1]);
    return `⟦${spans.length}⟧`;
  });
  block.spans = spans;
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
