// AI summary panel: streams a short Chinese digest of the whole paper.

import { markdown } from './richtext.js';
import { createProvider } from './providers.js';
import * as store from './store.js';

const MAX_CHARS = 200000;

export class Summary {
  constructor({ body, modelLabel, onNeedSettings }) {
    this.body = body;
    this.modelLabel = modelLabel;
    this.onNeedSettings = onNeedSettings;
    this.text = '';
    this.controller = null;
  }

  render(streaming) {
    this.body.innerHTML = markdown(this.text) || '';
    if (streaming) {
      const last = this.body.lastElementChild || this.body;
      last.classList.add('cursor');
    }
  }

  message(html) {
    this.body.innerHTML = `<p class="muted">${html}</p>`;
  }

  async run({ cfg, paperText, fingerprint, force = false }) {
    this.controller?.abort();
    this.text = '';
    if (cfg.kind === 'google') {
      this.modelLabel.textContent = '';
      this.message('AI 总结需要大模型服务。Google 翻译只做翻译。<br><br><button class="btn small" type="button" data-open-settings>配置模型</button>');
      return;
    }
    this.modelLabel.textContent = cfg.summaryModel;
    const key = `s|${cfg.id}|${cfg.summaryModel}|${fingerprint}`;
    if (!force) {
      const cached = await store.get(key);
      if (cached) {
        this.text = cached;
        this.render(false);
        return;
      }
    }
    const controller = new AbortController();
    this.controller = controller;
    this.message('正在通读全文…');
    const provider = createProvider(cfg);
    const text = paperText.length > MAX_CHARS ? paperText.slice(0, MAX_CHARS) : paperText;
    let frame = 0;
    try {
      await provider.summarize(text, (delta) => {
        this.text += delta;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            this.render(true);
          });
        }
      }, controller.signal);
      if (controller.signal.aborted) return;
      cancelAnimationFrame(frame);
      this.render(false);
      if (this.text.trim()) store.put(key, this.text);
    } catch (e) {
      if (controller.signal.aborted) return;
      cancelAnimationFrame(frame);
      const note = `<span style="color:var(--accent)">总结失败：${escape(e.message || String(e))}</span>`;
      this.body.innerHTML = (this.text ? markdown(this.text) : '') + `<p>${note}</p>`;
    }
  }

  stop() {
    this.controller?.abort();
  }
}

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
