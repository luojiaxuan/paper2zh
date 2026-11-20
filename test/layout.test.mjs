import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildLines, buildBlocks, dropLineNumbers } from '../app/js/layout.js';

// One text item in viewport coordinates (y grows downward).
const item = (str, x0, base, { size = 10, bold = false, math = false, width } = {}) => ({
  str, x0, x1: x0 + (width ?? str.length * size * 0.5), base, top: base - 0.75 * size, bottom: base + 0.25 * size,
  size, upright: true, bold, mono: false, math,
});

test('a section number and its title join one line across the quad', () => {
  const lines = buildLines([item('3', 100, 100, { size: 12 }), item('METHOD', 114, 100, { size: 12 })]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '3 METHOD');
});

test('two columns on the same baseline stay separate lines', () => {
  const lines = buildLines([item('left column text here', 72, 100, { width: 200 }), item('right column text', 307, 100, { width: 200 })]);
  assert.equal(lines.length, 2);
});

test('subscripts are marked for the model', () => {
  const lines = buildLines([item('x', 100, 100), item('t', 105, 102, { size: 7 }), item('is the state', 110, 100)]);
  assert.equal(lines[0].text, 'x_{t} is the state');
});

test('a run of review line numbers is dropped', () => {
  const nums = Array.from({ length: 10 }, (_, i) => item(String(i).padStart(3, '0'), 73, 100 + 12 * i, { size: 8 }));
  const kept = dropLineNumbers([...nums, item('Body text', 108, 100)]);
  assert.deepEqual(kept.map((i) => i.str), ['Body text']);
});

test('a short line ending a sentence closes the paragraph', () => {
  const lines = buildLines([
    item('This paragraph is long enough to fill the line.', 72, 100, { width: 400 }),
    item('It ends here.', 72, 112, { width: 80 }),
    item('A new paragraph starts on the next line and runs on.', 72, 124, { width: 400 }),
  ]);
  const blocks = buildBlocks(lines);
  assert.equal(blocks.length, 2);
  assert.match(blocks[1].text, /^A new paragraph/);
});

test('an inline formula becomes a placeholder covering its sub- and superscripts', () => {
  const [block] = buildBlocks(buildLines([
    item('where the policy', 72, 100, { width: 80 }),
    item('π', 155, 100, { math: true, width: 6 }),
    item('ref', 161, 102, { size: 7, width: 9 }),
    item('(', 170, 100, { width: 3 }),
    item('y', 173, 100, { math: true, width: 5 }),
    item(')', 178, 100, { width: 3 }),
    item('is fixed.', 184, 100, { width: 40 }),
  ]));
  assert.equal(block.rich, 'where the policy ⟦1⟧ is fixed.');
  assert.equal(block.spans.length, 1);
  assert.deepEqual(block.spans[0].items.map((it) => it.x0), [155, 161, 170, 173, 178]);
});

test('a display equation stays out of the paragraphs around it', () => {
  const blocks = buildBlocks(buildLines([
    item('The objective is written as follows for all inputs', 72, 100, { width: 400 }),
    item('L', 200, 113, { math: true, width: 6 }),
    item('=', 210, 113, { width: 6 }),
    item('x', 220, 113, { math: true, width: 6 }),
    item('where the loss is minimized over the whole dataset', 72, 126, { width: 400 }),
  ]));
  assert.deepEqual(blocks.map((b) => b.math), [false, true, false]);
});

test('bold markers hug the bold letters', () => {
  const [line] = buildLines([item('B', 72, 100, { bold: true, width: 6 }), item('idirectional encoder', 78, 100, { width: 90 })]);
  assert.equal(line.rich, '**B**idirectional encoder');
});

test('citations that resolve to the bibliography become superscript placeholders', async () => {
  const items = [
    item('Prior work [2] and the original study (Smith et al., 2020; Lee, 2021) show this.', 72, 100, { width: 400 }),
    item('References', 72, 300, { size: 12, bold: true, width: 60 }),
    item('[1] A. Smith. A study of things. 2020.', 72, 330, { width: 200 }),
    item('[2] B. Lee. Another study of things. 2021.', 72, 360, { width: 220 }),
    item('Values lie in [0, 1] for every input we tried here.', 72, 390, { width: 400 }),
  ];
  const { pages, refs } = await analyzeDocument(1, async () => ({ width: 612, height: 792, items, regions: [], rules: [] }));
  const [body, , , , tail] = pages[0].blocks;
  assert.equal(body.rich, 'Prior work ⟦1⟧ and the original study ⟦2⟧ show this.');
  assert.deepEqual(body.spans.map((s) => s.label), ['[2]', '(Smith\u202f2020;\u2009Lee\u202f2021)']);
  assert.deepEqual(body.spans[1].refs.map((i) => refs[i].text.slice(0, 10)), ['[1] A. Smi', '[2] B. Lee']);
  assert.equal(tail.rich, 'Values lie in [0, 1] for every input we tried here.');
});
