// Page-level translation queue. Pages near the viewport go first; results are
// cached per block text, so a reopened paper costs nothing.

import { TRANSLATABLE } from './layout.js';
import { PROMPT_VERSION, createProvider } from './providers.js';
import * as store from './store.js';

const CHUNK_CHARS = { google: 4000, llm: 7000 };
const MAX_ATTEMPTS = 3;

export class Translator {
  constructor({ analysis, cfg, paper, priority, onPage, onState, onProgress }) {
    this.pages = analysis.pages;
    this.cfg = cfg;
    this.paper = paper;
    this.provider = createProvider(cfg);
    this.priority = priority;
    this.onPage = onPage;
    this.onState = onState;
    this.onProgress = onProgress;
    this.state = new Map();
    this.errors = new Map();
    this.attempts = new Map();
    this.controller = new AbortController();
    this.workers = 0;
    this.cachePrefix = `t|${cfg.id}|${cfg.kind === 'google' ? 'gtx' : cfg.translateModel}|v${PROMPT_VERSION}|`;
  }

  setState(n, state, error) {
    this.state.set(n, state);
    if (error) this.errors.set(n, error);
    else this.errors.delete(n);
    this.onState(n, state, error);
  }

  key(b) {
    return this.cachePrefix + store.hash(`${b.kind}\n${b.rich || b.text}`);
  }

  blocksOf(page) {
    return page.blocks.filter((b) => TRANSLATABLE.has(b.kind));
  }

  async start() {
    const all = this.pages.flatMap((p) => this.blocksOf(p));
    const cached = await store.getMany(all.map((b) => this.key(b)));
    for (const page of this.pages) {
      const blocks = this.blocksOf(page);
      for (const b of blocks) {
        const zh = cached.get(this.key(b));
        if (zh !== undefined) b.zh = zh;
      }
      const done = blocks.every((b) => b.zh !== undefined);
      this.setState(page.n, done ? 'done' : 'pending');
      if (done && blocks.length) this.onPage(page.n);
    }
    this.report();
    this.pump();
  }

  stop() {
    this.controller.abort();
  }

  retry(n) {
    if (this.state.get(n) !== 'error') return;
    this.attempts.delete(n);
    this.setState(n, 'pending');
    this.report();
    this.pump();
  }

  pump() {
    const limit = this.cfg.kind === 'google' ? Math.min(3, this.cfg.concurrency) : this.cfg.concurrency;
    while (this.workers < limit && this.next() !== null) {
      this.workers++;
      this.work().finally(() => {
        this.workers--;
        this.pump();
      });
    }
  }

  next() {
    let best = null;
    let bestScore = Infinity;
    for (const [n, s] of this.state) {
      if (s !== 'pending') continue;
      const score = this.priority(n);
      if (score < bestScore) {
        best = n;
        bestScore = score;
      }
    }
    return best;
  }

  async work() {
    const n = this.next();
    if (n === null || this.controller.signal.aborted) return;
    this.setState(n, 'running');
    this.report();
    const page = this.pages[n - 1];
    try {
      await this.translatePage(page);
      this.setState(n, 'done');
      this.onPage(n);
    } catch (e) {
      if (this.controller.signal.aborted) return;
      const attempts = (this.attempts.get(n) || 0) + 1;
      this.attempts.set(n, attempts);
      if (e.retryable && attempts < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempts));
        if (!this.controller.signal.aborted) this.setState(n, 'pending');
      } else {
        this.setState(n, 'error', e.message || String(e));
      }
    }
    this.report();
  }

  async translatePage(page) {
    const todo = this.blocksOf(page).filter((b) => b.zh === undefined);
    const limit = this.cfg.kind === 'google' ? CHUNK_CHARS.google : CHUNK_CHARS.llm;
    const chunks = [];
    let cur = [];
    let size = 0;
    for (const b of todo) {
      const len = (b.rich || b.text).length;
      if (cur.length && size + len > limit) {
        chunks.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(b);
      size += len;
    }
    if (cur.length) chunks.push(cur);
    for (const chunk of chunks) await this.translateChunk(chunk);
    // Blocks the model skipped stay in the original language.
    for (const b of todo) if (b.zh === undefined) b.zh = '';
  }

  // When the model rejects a request (a safety filter, malformed output),
  // bisect it so one problematic paragraph does not cost the whole page.
  // A single rejected paragraph stays in the original language.
  async translateChunk(chunk) {
    let result;
    try {
      result = await this.provider.translate(chunk, this.paper, this.controller.signal);
    } catch (e) {
      if (!e.content) throw e;
      if (chunk.length === 1) {
        chunk[0].zh = '';
        return;
      }
      const mid = Math.ceil(chunk.length / 2);
      await this.translateChunk(chunk.slice(0, mid));
      await this.translateChunk(chunk.slice(mid));
      return;
    }
    const entries = [];
    for (const b of chunk) {
      const zh = result.get(b.id);
      if (zh === null || zh === undefined) continue;
      b.zh = zh;
      entries.push([this.key(b), zh]);
    }
    store.putMany(entries);
  }

  report() {
    let done = 0, running = 0, errors = 0;
    for (const s of this.state.values()) {
      if (s === 'done') done++;
      else if (s === 'running') running++;
      else if (s === 'error') errors++;
    }
    this.onProgress({ done, running, errors, total: this.state.size, firstError: this.errors.values().next().value });
  }

}
