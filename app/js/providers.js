// Translation and summary backends: Claude through the Anthropic SDK, any
// OpenAI-compatible chat endpoint, and the free Google Translate endpoint.

export const PROMPT_VERSION = 3;

const TRANSLATE_SYSTEM = `You translate academic papers into Simplified Chinese for researchers who read Chinese faster than English.

Input is JSON {"paper": title, "blocks": [{"id", "type", "text"}]}: the text blocks of one PDF page, in reading order. The text comes from PDF extraction: line breaks are removed, a word broken at a line end may appear as "represen-tation", **...** marks bold text, and remaining subscripts and superscripts are marked _{...} and ^{...}. Formulas and citations have been cut out and replaced by placeholders ⟦1⟧, ⟦2⟧, ...; they are typeset from the original page.

Return JSON {"translations": [{"id", "zh"}]} with exactly one entry per input block, using the same ids.

How to translate:
- Faithful, fluent academic Chinese. Do not summarize, shorten, explain or add anything.
- Copy every placeholder ⟦n⟧ exactly once and unchanged to where its formula or citation belongs in the Chinese sentence. Never translate, drop or merge placeholders, and never put them inside $...$.
- Keep in English: names of models, datasets, benchmarks, methods, systems and people; code, file paths, URLs; citations such as (Smith et al., 2023) or [12]; abbreviations. A key technical term may carry its English in parentheses the first time it appears in a block, e.g. 奖励欺骗（reward hacking）.
- Write any other mathematics as LaTeX inside $...$, e.g. $x_t \\in \\mathbb{R}^d$, repairing the broken extraction when the intended formula is clear. Keep numbers and units unchanged.
- Keep the **bold** markers: each bold span of the input stays bold, around the corresponding Chinese words.
- type "heading": translate the heading and keep its numbering (3.1, A.2, ...).
- type "caption": render the label in Chinese, e.g. "Figure 3:" becomes "图 3：" and "Table 2:" becomes "表 2：". Sub-figure captions such as "(a) Accuracy by model size" are captions too: translate them.
- Use "" as zh for blocks that should stay in English: author names, affiliations, email addresses, bibliography entries, code, pseudocode, prompts or program output shown verbatim, standalone formulas, page headers and footers, and fragments of figures or tables.`;

const SUMMARY_SYSTEM = '你是一位资深研究员，帮读者快速判断一篇论文讲了什么、值不值得细读。用简体中文写，准确、具体、克制，不吹捧。';

const SUMMARY_PROMPT = (text) => `下面是一篇论文的全文（从 PDF 抽取，可能有断词和公式乱码）：

<paper>
${text}
</paper>

用 Markdown 写一份速读总结，总长 300 到 500 字，严格按下面的小标题，不要开场白和结束语：

### 一句话
用一句话说清这篇论文做了什么、得到什么结论。

### 要解决的问题
1 到 2 句。

### 方法
2 到 4 条要点，说清核心想法和与已有做法的区别。

### 主要结果
2 到 4 条，带上论文里的关键数字（数据集、指标、对比对象）。

### 局限与疑点
1 到 3 条，包括论文自己承认的和你读出来的。

### 值得细看
最值得看的 1 到 3 个图、表或章节，各用半句话说明看点。

数学公式写在 $...$ 里。`;

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, zh: { type: 'string' } },
        required: ['id', 'zh'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

// retryable: worth repeating as is (rate limits, outages, network).
// content: the model rejected or garbled this input; a smaller input may pass.
// fatal: the service refuses every request (bad key, blocked network), so the
// remaining pages would fail the same way.
export class ProviderError extends Error {
  constructor(message, { retryable = false, content = false, fatal = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.content = content;
    this.fatal = fatal;
  }
}

function translationRequest(blocks, paper) {
  return JSON.stringify({
    paper,
    blocks: blocks.map((b) => ({ id: b.id, type: b.kind, text: b.rich || b.text })),
  });
}

function parseTranslations(raw, blocks) {
  let text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new ProviderError('模型没有返回 JSON', { content: true });
  text = text.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError('模型返回的 JSON 不完整', { content: true });
  }
  const list = Array.isArray(data) ? data : data.translations;
  if (!Array.isArray(list)) throw new ProviderError('模型返回的格式不对', { content: true });
  const out = new Map();
  for (const item of list) {
    if (item && typeof item.id === 'string' && typeof item.zh === 'string') out.set(item.id, item.zh.trim());
  }
  for (const b of blocks) if (!out.has(b.id)) out.set(b.id, null);
  return out;
}

// ---------- Claude ----------

let sdkPromise = null;
function loadSdk() {
  sdkPromise ||= import('../vendor/anthropic-sdk.mjs').then((m) => m.Anthropic);
  return sdkPromise;
}

// Server-side refusal fallback is available on the Claude 5 Opus/Sonnet/Fable models.
function fallbackParams(model) {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};
}

function anthropicError(e) {
  const status = e?.status;
  if (status === 401) return new ProviderError('API Key 无效（401）', { fatal: true });
  if (status === 403) return new ProviderError('这个 Key 没有权限使用该模型（403）', { fatal: true });
  if (status === 404) return new ProviderError('模型不存在，请检查模型名（404）', { fatal: true });
  if (status === 429) return new ProviderError('请求太频繁或额度不足（429）', { retryable: true });
  if (status >= 500) return new ProviderError(`服务暂时不可用（${status}）`, { retryable: true });
  if (status === 400) return new ProviderError(`请求被拒绝：${e?.error?.error?.message || e.message}`, { content: true });
  return new ProviderError(e?.message || String(e), { retryable: !status });
}

class ClaudeProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.name = cfg.translateModel;
  }

  async client() {
    const Anthropic = await loadSdk();
    this._client ||= new Anthropic({ apiKey: this.cfg.key, dangerouslyAllowBrowser: true, maxRetries: 3 });
    return this._client;
  }

  async translate(blocks, paper, signal) {
    const client = await this.client();
    const model = this.cfg.translateModel;
    let msg;
    try {
      msg = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: TRANSLATE_SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: TRANSLATION_SCHEMA } },
        messages: [{ role: 'user', content: translationRequest(blocks, paper) }],
        ...fallbackParams(model),
      }, { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw anthropicError(e);
    }
    if (msg.stop_reason === 'refusal') throw new ProviderError('模型拒绝翻译这段内容', { content: true });
    if (msg.stop_reason === 'max_tokens') throw new ProviderError('输出超长被截断', { content: true });
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    return parseTranslations(text, blocks);
  }

  async summarize(paperText, onDelta, signal) {
    const client = await this.client();
    const model = this.cfg.summaryModel;
    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 64000,
        system: SUMMARY_SYSTEM,
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: SUMMARY_PROMPT(paperText) }],
        ...fallbackParams(model),
      }, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onDelta(event.delta.text);
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new ProviderError('模型拒绝总结这篇论文');
    } catch (e) {
      if (signal?.aborted || e instanceof ProviderError) throw e;
      throw anthropicError(e);
    }
  }

  async listModels() {
    const client = await this.client();
    const ids = [];
    try {
      for await (const m of client.models.list()) ids.push(m.id);
    } catch (e) {
      throw anthropicError(e);
    }
    return ids;
  }

  async test() {
    const client = await this.client();
    try {
      await client.messages.create({
        model: this.cfg.translateModel,
        max_tokens: 64,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      });
    } catch (e) {
      throw anthropicError(e);
    }
  }
}

// ---------- OpenAI-compatible ----------

class OpenAICompatibleProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.name = cfg.translateModel;
    this.jsonMode = cfg.jsonMode;
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.cfg.key) h.Authorization = `Bearer ${this.cfg.key}`;
    return h;
  }

  async post(path, body, signal) {
    let res;
    try {
      res = await fetch(`${this.cfg.baseURL}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ProviderError(`连不上 ${this.cfg.baseURL}（网络错误或该服务不允许浏览器直接访问）`, { retryable: true });
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 401) throw new ProviderError('API Key 无效（401）', { fatal: true });
      if (res.status === 404) throw new ProviderError(`接口或模型不存在（404）：${detail}`, { fatal: true });
      if (res.status === 429) throw new ProviderError('请求太频繁或额度不足（429）', { retryable: true });
      const flagged = /flagged|safety|policy|content_filter|refus/i.test(detail);
      if (res.status >= 500 && !flagged) throw new ProviderError(`服务暂时不可用（${res.status}）`, { retryable: true });
      const err = new ProviderError(`请求失败（${res.status}）：${detail}`, { content: flagged || res.status === 400 || res.status === 422 });
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    return res;
  }

  async translate(blocks, paper, signal) {
    const body = {
      model: this.cfg.translateModel,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM },
        { role: 'user', content: translationRequest(blocks, paper) },
      ],
    };
    if (this.jsonMode) body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await this.post('/chat/completions', body, signal);
    } catch (e) {
      if (this.jsonMode && e.status === 400 && /response_format|json/i.test(e.detail || '')) {
        this.jsonMode = false;
        return this.translate(blocks, paper, signal);
      }
      throw e;
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError('输出超长被截断', { content: true });
    if (choice?.finish_reason === 'content_filter') throw new ProviderError('模型拒绝翻译这段内容', { content: true });
    return parseTranslations(choice?.message?.content || '', blocks);
  }

  async summarize(paperText, onDelta, signal) {
    const res = await this.post('/chat/completions', {
      model: this.cfg.summaryModel,
      stream: true,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: SUMMARY_PROMPT(paperText) },
      ],
    }, signal);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) onDelta(delta);
        } catch {
          // Keep-alive comments and partial events carry no text.
        }
      }
    }
  }

  async listModels() {
    let res;
    try {
      res = await fetch(`${this.cfg.baseURL}/models`, { headers: this.headers() });
    } catch {
      throw new ProviderError(`连不上 ${this.cfg.baseURL}`);
    }
    if (!res.ok) throw new ProviderError(`获取模型列表失败（${res.status}）`);
    const data = await res.json();
    return (data.data || data.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  }

  async test() {
    await this.post('/chat/completions', {
      model: this.cfg.translateModel,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    });
  }
}

// ---------- Google Translate (free endpoint, no key) ----------

const plain = (s) => s.replace(/\*\*/g, '').replace(/[_^]\{([^}]*)\}/g, '$1').trim();

// Text pieces sent for one block. A leading bold sentence (a run-in heading
// such as "Results.") goes on its own line so its bold can be restored.
function googlePieces(b) {
  const src = b.rich || b.text;
  const runIn = src.match(/^\*\*([^*]+?[.:?!])\*\*\s*(\S[\s\S]*)$/);
  return runIn ? [plain(runIn[1]), plain(runIn[2])] : [plain(src)];
}

const GOOGLE_BLOCKED =
  'Google 翻译暂时拦下了来自你这个网络的请求：短时间内请求太多，被当成了异常流量，通常几小时内恢复。可以稍后点“重试”，或换成大模型服务。';
const GOOGLE_UNREACHABLE =
  '连不上 Google 翻译。可能是短时间内请求太多，被 Google 暂时拦截（通常几小时内恢复），也可能是网络到不了 Google。可以稍后点“重试”，或换成大模型服务。';

class GoogleProvider {
  constructor() {
    this.name = 'Google 翻译';
  }

  async request(texts, signal) {
    const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${encodeURIComponent(texts.join('\n'))}`,
      redirect: 'manual',
      signal,
    }).catch((e) => {
      if (signal?.aborted) throw e;
      throw new ProviderError(GOOGLE_UNREACHABLE, { fatal: true });
    });
    // Traffic Google considers abusive is redirected to its CAPTCHA page.
    if (res.type === 'opaqueredirect' || res.status === 429 || res.status === 403) {
      throw new ProviderError(GOOGLE_BLOCKED, { fatal: true });
    }
    if (!res.ok) throw new ProviderError(`Google 翻译失败（${res.status}）`, { retryable: true });
    const data = await res.json();
    return (data[0] || []).map((seg) => seg[0] || '').join('').split('\n');
  }

  async translate(blocks, _paper, signal) {
    const pieces = blocks.map(googlePieces);
    const texts = pieces.flat();
    let parts = await this.request(texts, signal);
    if (parts.length !== texts.length) {
      parts = [];
      for (const t of texts) parts.push((await this.request([t], signal)).join(' '));
    }
    let k = 0;
    return new Map(blocks.map((b, i) => {
      const zh = pieces[i].map(() => parts[k++].trim());
      return [b.id, zh.length === 2 ? `**${zh[0]}** ${zh[1]}` : zh[0]];
    }));
  }
}

export function createProvider(cfg) {
  if (cfg.kind === 'anthropic') return new ClaudeProvider(cfg);
  if (cfg.kind === 'openai') return new OpenAICompatibleProvider(cfg);
  return new GoogleProvider();
}
