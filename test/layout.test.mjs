import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, buildBlocks, dropLineNumbers } from '../app/js/layout.js';

// One text item in viewport coordinates (y grows downward).
const item = (str, x0, base, { size = 10, bold = false, width } = {}) => ({
  str, x0, x1: x0 + (width ?? str.length * size * 0.5), base, top: base - 0.75 * size, bottom: base + 0.25 * size,
  size, upright: true, bold, mono: false,
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
