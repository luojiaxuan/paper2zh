// User settings, stored in this browser only.

export const PROVIDERS = {
  google: {
    label: 'Google 翻译（免费，无需 Key）',
    kind: 'google',
    hint: '免费、无需配置，适合先试试。译文质量一般，公式不会整理，也没有 AI 总结；想要更好的译文请选大模型服务。',
  },
  anthropic: {
    label: 'Claude（Anthropic）',
    kind: 'anthropic',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    translateModel: 'claude-opus-5-5',
    summaryModel: 'claude-opus-5-5',
    hint: 'Key 在 platform.claude.com 创建。Opus 质量最好；整篇论文想省钱可把翻译模型换成 claude-haiku-5-5 或 claude-sonnet-5-5。',
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    jsonMode: true,
    hint: '填好 Key 后点“获取模型列表”选模型。',
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    translateModel: 'deepseek-chat',
    summaryModel: 'deepseek-chat',
    jsonMode: true,
    hint: '中文质量好、价格低。',
  },
  gemini: {
    label: 'Gemini',
    kind: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hint: 'Key 在 Google AI Studio 创建，填好后点“获取模型列表”。',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    hint: '一个 Key 用多家模型。',
  },
  custom: {
    label: '其他 OpenAI 兼容接口',
    kind: 'openai',
    baseURL: '',
    hint: '任何兼容 /chat/completions 的服务，例如本地 Ollama（http://localhost:11434/v1，需设置 OLLAMA_ORIGINS 允许跨域）。',
  },
};

const STORE_KEY = 'paper2zh.settings.v1';

const DEFAULTS = {
  provider: 'google',
  keys: {},
  baseURL: {},
  translateModel: {},
  summaryModel: {},
  concurrency: 4,
  font: 'serif',
};

function read() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = read();
const listeners = new Set();

export function getSettings() {
  return current;
}

export function saveSettings(next) {
  current = { ...current, ...next };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(current));
  } catch {
    // Private mode or blocked storage: settings last for this page only.
  }
  for (const fn of listeners) fn(current);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
}

// Effective configuration of the selected provider.
export function providerConfig(s = current) {
  const id = s.provider in PROVIDERS ? s.provider : 'google';
  const p = PROVIDERS[id];
  return {
    id,
    kind: p.kind,
    label: p.label,
    jsonMode: !!p.jsonMode,
    key: s.keys[id] || '',
    baseURL: (s.baseURL[id] ?? p.baseURL ?? '').replace(/\/+$/, ''),
    translateModel: s.translateModel[id] || p.translateModel || '',
    summaryModel: s.summaryModel[id] || p.summaryModel || s.translateModel[id] || p.translateModel || '',
    concurrency: Math.min(8, Math.max(1, Number(s.concurrency) || 4)),
  };
}

export function isLLM(cfg = providerConfig()) {
  return cfg.kind !== 'google';
}

export function configProblem(cfg = providerConfig()) {
  if (cfg.kind === 'google') return '';
  if (!cfg.key && cfg.id !== 'custom') return '还没有填 API Key';
  if (cfg.kind === 'openai' && !cfg.baseURL) return '还没有填接口地址';
  if (!cfg.translateModel) return '还没有选翻译模型';
  return '';
}
