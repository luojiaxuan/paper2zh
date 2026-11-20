import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Translator } from '../app/js/translate.js';
import { ProviderError } from '../app/js/providers.js';

const page = (n, texts) => ({ n, blocks: texts.map((text, i) => ({ id: `${n}-${i}`, kind: 'text', text })) });

test('a rejected paragraph is isolated by bisection and stays in English', async () => {
  const analysis = { pages: [page(1, ['alpha', 'beta', 'exploit prompt', 'delta', 'epsilon'])] };
  const calls = [];
  const states = [];
  const t = new Translator({
    analysis,
    cfg: { id: 'fake', kind: 'openai', translateModel: 'm', concurrency: 1 },
    paper: 'p',
    priority: (n) => n,
    onPage: () => {},
    onState: (n, s) => states.push(s),
    onProgress: () => {},
  });
  t.provider = {
    async translate(blocks) {
      calls.push(blocks.length);
      if (blocks.some((b) => b.text === 'exploit prompt')) throw new ProviderError('flagged', { content: true });
      return new Map(blocks.map((b) => [b.id, `中文:${b.text}`]));
    },
  };
  await t.start();
  await new Promise((r) => setTimeout(r, 50));
  const zh = analysis.pages[0].blocks.map((b) => b.zh);
  assert.deepEqual(zh, ['中文:alpha', '中文:beta', '', '中文:delta', '中文:epsilon']);
  assert.equal(states.at(-1), 'done');
  assert.deepEqual(calls, [5, 3, 2, 1, 2]);
});

test('transport errors are retried at page level, not bisected', async () => {
  const analysis = { pages: [page(1, ['a', 'b'])] };
  let calls = 0;
  const t = new Translator({
    analysis,
    cfg: { id: 'fake', kind: 'openai', translateModel: 'm', concurrency: 1 },
    paper: 'p',
    priority: (n) => n,
    onPage: () => {},
    onState: () => {},
    onProgress: () => {},
  });
  t.provider = {
    async translate() {
      calls++;
      throw new ProviderError('API Key 无效（401）');
    },
  };
  await t.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 1);
  assert.equal(t.state.get(1), 'error');
});

test('a service-level refusal stops the queue and retryFailed resumes it', async () => {
  const analysis = { pages: [1, 2, 3, 4, 5].map((n) => page(n, [`p${n}`])) };
  let blocked = true;
  let calls = 0;
  let last;
  const t = new Translator({
    analysis,
    cfg: { id: 'fake', kind: 'google', concurrency: 1 },
    paper: 'p',
    priority: (n) => n,
    onPage: () => {},
    onState: () => {},
    onProgress: (p) => { last = p; },
  });
  t.provider = {
    async translate(blocks) {
      calls++;
      if (blocked) throw new ProviderError('blocked', { fatal: true });
      return new Map(blocks.map((b) => [b.id, `中文:${b.text}`]));
    },
  };
  await t.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 1);
  assert.deepEqual([...t.state.values()], ['error', 'error', 'error', 'error', 'error']);
  assert.equal(last.fatal, 'blocked');
  blocked = false;
  t.retryFailed();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 6);
  assert.deepEqual([...t.state.values()], ['done', 'done', 'done', 'done', 'done']);
  assert.equal(last.fatal, null);
});

test('a translation that loses a placeholder is asked again alone, then keeps the original', async () => {
  const analysis = { pages: [page(1, ['where ⟦1⟧ holds', 'plain', 'with ⟦1⟧ and ⟦2⟧'])] };
  const calls = [];
  const t = new Translator({
    analysis,
    cfg: { id: 'fake', kind: 'openai', translateModel: 'm', concurrency: 1 },
    paper: 'p',
    priority: (n) => n,
    onPage: () => {},
    onState: () => {},
    onProgress: () => {},
  });
  let first = true;
  t.provider = {
    async translate(blocks) {
      calls.push(blocks.length);
      const out = new Map(blocks.map((b) => [b.id, `中文 ${b.text}`]));
      // The first answer drops ⟦2⟧ and spaces ⟦1⟧; the retry fixes the first block only.
      out.set('1-2', '中文 ⟦1⟧');
      if (first) out.set('1-0', '中文 ⟦ 1 ⟧ 成立');
      else out.set('1-0', '其中 ⟦1⟧ 成立');
      first = false;
      return out;
    },
  };
  await t.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(analysis.pages[0].blocks.map((b) => b.zh), ['中文 ⟦1⟧ 成立', '中文 plain', '']);
  assert.deepEqual(calls, [3, 1]);
});
