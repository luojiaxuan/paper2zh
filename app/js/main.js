import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { analyzeDocument, figureRegions, textItems, TRANSLATABLE } from './layout.js';
import { Viewer } from './viewer.js';
import { Translator } from './translate.js';
import { Summary } from './summary.js';
import { PROVIDERS, configProblem, getSettings, providerConfig, saveSettings } from './settings.js';
import { createProvider } from './providers.js';
import { fetchPdf, inExtension, pdfUrlFor, requestSiteAccess } from './sources.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;

const $ = (id) => document.getElementById(id);
const pagesRoot = $('pages');

const state = {
  doc: null,
  analysis: null,
  viewer: null,
  translator: null,
  title: '',
  fingerprint: '',
  paperText: '',
  cfgKey: '',
};

const summary = new Summary({ body: $('summary-body'), modelLabel: $('summary-model') });

// ---------- UI helpers ----------

function toast(text, ms = 4000) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

function showApp() {
  $('landing').hidden = true;
  $('app').hidden = false;
}

function showLoading(text, isError = false) {
  state.viewer?.destroy();
  state.viewer = null;
  pagesRoot.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'loading-doc';
  box.innerHTML = isError ? '<div class="err"></div><a class="btn" href="./">返回首页</a>' : '<div><div class="spin"></div><div class="msg"></div></div>';
  box.querySelector(isError ? '.err' : '.msg').textContent = text;
  pagesRoot.appendChild(box);
}

function cfgKey(cfg) {
  return [cfg.id, cfg.key, cfg.baseURL, cfg.translateModel, cfg.summaryModel].join('|');
}

// ---------- opening documents ----------

async function openUrl(input, tabId) {
  const url = pdfUrlFor(input);
  if (!url) {
    toast('这不像一个链接');
    return;
  }
  showApp();
  $('doc-title').textContent = url;
  showLoading('正在下载 PDF…');
  let bytes;
  try {
    bytes = await fetchPdf(url, tabId);
  } catch (e) {
    showLoading(e.message, true);
    if (e.site) offerSiteAccess(e.site, () => openUrl(url, tabId));
    return;
  }
  const params = new URLSearchParams({ src: url });
  history.replaceState(null, '', `${location.pathname}?${params}`);
  await openBytes(bytes, decodeURIComponent(url.split('/').pop() || url));
}

function offerSiteAccess(site, retry) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary';
  btn.textContent = `允许读取 ${site.host} 并重试`;
  btn.addEventListener('click', async () => {
    if (await requestSiteAccess(site)) retry();
  });
  pagesRoot.querySelector('.loading-doc .err').after(btn);
}

async function openFile(file) {
  if (!file) return;
  history.replaceState(null, '', location.pathname);
  showApp();
  await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

function closeDoc() {
  state.translator?.stop();
  state.translator = null;
  summary.stop();
  state.viewer?.destroy();
  state.viewer = null;
  state.doc?.destroy();
  state.doc = null;
}

async function openBytes(bytes, name) {
  closeDoc();
  showApp();
  $('doc-title').textContent = name;
  showLoading('正在解析版面…');
  try {
    const doc = await pdfjsLib.getDocument({
      data: bytes,
      cMapUrl: `${VENDOR}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${VENDOR}standard_fonts/`,
      wasmUrl: `${VENDOR}wasm/`,
      fontExtraProperties: true,
    }).promise;
    state.doc = doc;
    state.fingerprint = doc.fingerprints.filter(Boolean).join('-');
    state.analysis = await analyzeDocument(doc.numPages, async (n) => {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const [tc, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const fontName = (id) => {
        try {
          return page.commonObjs.get(id)?.name || '';
        } catch {
          return '';
        }
      };
      return { width: viewport.width, height: viewport.height, items: textItems(tc, viewport, fontName), regions: figureRegions(ops, pdfjsLib.OPS, viewport) };
    });
  } catch (e) {
    console.error(e);
    showLoading(`打不开这个 PDF：${e.message || e}`, true);
    return;
  }
  const meta = await state.doc.getMetadata().catch(() => null);
  state.titleBlocks = null;
  const heading = guessTitle(state.analysis);
  state.title = metaTitle(meta) || heading || name;
  state.paperText = paperText(state.analysis);
  showTitle();
  pagesRoot.innerHTML = '';
  state.viewer = new Viewer({
    root: pagesRoot,
    pdf: state.doc,
    OPS: pdfjsLib.OPS,
    pages: state.analysis.pages,
    tooltip: $('tooltip'),
    onRetry: (n) => state.translator?.retry(n),
    getFont: () => getSettings().font,
  });
  state.viewer.setMode(currentMode());
  $('zoom-label').textContent = state.viewer.zoomLabel();
  startTranslation();
  startSummary();
}

function guessTitle(analysis) {
  const first = analysis.pages[0];
  if (!first) return '';
  const top = first.blocks.filter((b) => b.bbox[1] < first.height * 0.4 && /[A-Za-z]{3}/.test(b.text));
  if (!top.length) return '';
  const size = Math.max(...top.map((b) => b.size));
  if (size < analysis.bodySize * 1.15) return '';
  // A title can span several blocks (each centered line on its own).
  state.titleBlocks = top.filter((b) => Math.abs(b.size - size) < 0.02 * size);
  return joinText(state.titleBlocks.map((b) => b.text.replace(/[_^]\{([^}]*)\}/g, '$1')));
}

const joinText = (parts) => parts.join(' ').replace(/\s+/g, ' ').trim();

function metaTitle(meta) {
  const t = (meta?.info?.Title || '').trim();
  return t.length > 8 && !/\.(pdf|docx?|tex)$|^untitled|^microsoft/i.test(t) ? t : '';
}

function showTitle() {
  const blocks = state.titleBlocks || [];
  const zh = blocks.length && blocks.every((b) => b.zh) ? joinText(blocks.map((b) => b.zh)) : '';
  const el = $('doc-title');
  el.textContent = zh || state.title;
  el.title = state.title;
  document.title = `${zh || state.title} · paper2zh`;
}

function paperText(analysis) {
  const parts = [];
  for (const p of analysis.pages) {
    for (const b of p.blocks) {
      if (!TRANSLATABLE.has(b.kind)) continue;
      parts.push(b.kind === 'heading' ? `\n## ${b.text}` : b.text);
    }
  }
  return parts.join('\n');
}

// ---------- translation & summary ----------

function startTranslation() {
  state.translator?.stop();
  state.translator = null;
  $('notice').hidden = true;
  const cfg = providerConfig();
  state.cfgKey = cfgKey(cfg);
  const problem = configProblem(cfg);
  const status = $('status');
  if (problem) {
    status.innerHTML = `<span class="err">${problem}</span> <button class="btn small" type="button" data-open-settings>去设置</button>`;
    return;
  }
  if (!state.analysis.pages.some((p) => p.blocks.some((b) => TRANSLATABLE.has(b.kind)))) {
    status.textContent = '没有找到可翻译的文字（扫描版 PDF 需要先做 OCR）';
    return;
  }
  const viewer = state.viewer;
  state.translator = new Translator({
    analysis: state.analysis,
    cfg,
    paper: state.title,
    priority: (n) => viewer.priority(n),
    onPage: (n) => {
      viewer.pageTranslated(n);
      if (n === 1) showTitle();
    },
    onState: (n, s, err) => viewer.setPageStatus(n, s, err),
    onProgress: updateProgress,
  });
  state.translator.start();
}

function updateProgress({ done, total, errors, firstError, fatal }) {
  const bar = $('progress');
  bar.querySelector('.bar').style.width = `${total ? (100 * done) / total : 0}%`;
  bar.classList.toggle('done', done === total);
  const status = $('status');
  status.textContent = done === total ? `已译完 ${total} 页` : `${fatal ? '已停止' : '翻译中'} ${done}/${total} 页`;
  if (errors && !fatal) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'err';
    retry.textContent = ` · ${errors} 页失败，重试`;
    retry.title = firstError || '';
    retry.addEventListener('click', () => state.translator?.retryFailed());
    status.appendChild(retry);
  }
  $('notice').hidden = !fatal;
  if (fatal) $('notice-text').textContent = fatal;
}

function startSummary(force = false) {
  if (!state.analysis) return;
  summary.run({ cfg: providerConfig(), paperText: state.paperText, fingerprint: state.fingerprint, force });
}

function resetTranslations() {
  for (const p of state.analysis?.pages || []) {
    for (const b of p.blocks) {
      delete b.zh;
      delete b.fit;
    }
  }
  for (const r of state.viewer?.rows || []) if (r.rendered) state.viewer.compose(r);
}

// ---------- toolbar ----------

function currentMode() {
  return document.querySelector('.segmented button.active')?.dataset.mode || 'zh';
}

function setupToolbar() {
  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.segmented button')) b.classList.toggle('active', b === btn);
      state.viewer?.setMode(btn.dataset.mode);
    });
  }
  for (const btn of document.querySelectorAll('[data-zoom]')) {
    btn.addEventListener('click', () => {
      if (state.viewer) $('zoom-label').textContent = state.viewer.stepZoom(Number(btn.dataset.zoom));
    });
  }
  $('zoom-label').addEventListener('click', () => {
    if (!state.viewer) return;
    state.viewer.zoom = null;
    state.viewer.relayout();
    $('zoom-label').textContent = state.viewer.zoomLabel();
  });
  const panel = $('summary');
  if (window.innerWidth < 1100) panel.classList.add('collapsed');
  $('toggle-summary').addEventListener('click', () => panel.classList.toggle('collapsed'));
  $('notice-retry').addEventListener('click', () => state.translator?.retryFailed());
  $('summary-close').addEventListener('click', () => panel.classList.add('collapsed'));
  $('summary-regen').addEventListener('click', () => startSummary(true));
  $('summary-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summary.text);
      toast('已复制总结');
    } catch {
      toast('复制失败');
    }
  });
  new ResizeObserver(() => state.viewer?.scheduleRelayout()).observe(panel);
}

// ---------- landing ----------

function setupLanding() {
  const zone = $('dropzone');
  $('file-input').addEventListener('change', (e) => openFile(e.target.files[0]));
  $('url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('url-input').value.trim();
    if (v) openUrl(v);
  });
  zone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === zone) $('file-input').click();
  });
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    depth++;
    zone.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('dragging');
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (file) openFile(file);
    else if (e.dataTransfer?.files?.length) toast('请拖入 PDF 文件');
  });
  updateProviderNote();
}

function updateProviderNote() {
  const cfg = providerConfig();
  const note = $('provider-note');
  if (cfg.kind === 'google') {
    note.innerHTML = '现在用的是免费的 Google 翻译。接入 Claude、DeepSeek 等大模型，译文更好，还有 AI 总结。<button type="button" data-open-settings>模型设置</button>';
  } else {
    const problem = configProblem(cfg);
    note.textContent = '';
    note.append(`现在用的是 ${cfg.label}${cfg.translateModel ? ` · ${cfg.translateModel}` : ''}`);
    if (problem) note.append(`（${problem}）`);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.openSettings = '';
    b.textContent = '修改';
    note.append(' ', b);
  }
}

// ---------- settings dialog ----------

function setupSettings() {
  const dlg = $('settings');
  const sel = $('s-provider');
  for (const [id, p] of Object.entries(PROVIDERS)) sel.add(new Option(p.label, id));
  let draft = null;

  const fill = (id) => {
    const p = PROVIDERS[id];
    const llm = p.kind !== 'google';
    $('s-llm-fields').hidden = !llm;
    $('s-base-field').hidden = p.kind !== 'openai';
    $('s-provider-hint').textContent = p.hint || '';
    $('s-key').value = draft.keys[id] || '';
    $('s-base').value = draft.baseURL[id] ?? p.baseURL ?? '';
    $('s-model').value = draft.translateModel[id] || p.translateModel || '';
    $('s-summary-model').value = draft.summaryModel[id] || p.summaryModel || '';
    setModelOptions(p.models || []);
    $('s-test-result').textContent = '';
  };

  const capture = () => {
    const id = sel.value;
    draft.keys = { ...draft.keys, [id]: $('s-key').value.trim() };
    if (PROVIDERS[id].kind === 'openai') draft.baseURL = { ...draft.baseURL, [id]: $('s-base').value.trim() };
    draft.translateModel = { ...draft.translateModel, [id]: $('s-model').value.trim() };
    draft.summaryModel = { ...draft.summaryModel, [id]: $('s-summary-model').value.trim() };
    draft.provider = id;
    draft.concurrency = Number($('s-concurrency').value) || 4;
    draft.font = $('s-font').value;
  };

  const draftConfig = () => {
    capture();
    return providerConfig(draft);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-open-settings]')) return;
    const s = getSettings();
    draft = JSON.parse(JSON.stringify(s));
    sel.value = s.provider in PROVIDERS ? s.provider : 'google';
    $('s-concurrency').value = s.concurrency;
    $('s-font').value = s.font;
    fill(sel.value);
    dlg.showModal();
  });

  let lastProvider = null;
  sel.addEventListener('focus', () => { lastProvider = sel.value; });
  sel.addEventListener('change', () => {
    if (lastProvider && lastProvider !== sel.value) {
      const keep = sel.value;
      sel.value = lastProvider;
      capture();
      sel.value = keep;
    }
    lastProvider = sel.value;
    fill(sel.value);
  });

  $('s-cancel').addEventListener('click', () => dlg.close());

  $('s-list-models').addEventListener('click', async () => {
    const out = $('s-test-result');
    out.className = 'test-result';
    out.textContent = '获取中…';
    try {
      const ids = await createProvider(draftConfig()).listModels();
      setModelOptions(ids);
      out.className = 'test-result ok';
      out.textContent = `共 ${ids.length} 个模型，可在输入框里选`;
    } catch (e) {
      out.className = 'test-result err';
      out.textContent = e.message;
    }
  });

  $('s-test').addEventListener('click', async () => {
    const out = $('s-test-result');
    const cfg = draftConfig();
    const problem = configProblem(cfg);
    if (problem) {
      out.className = 'test-result err';
      out.textContent = problem;
      return;
    }
    out.className = 'test-result';
    out.textContent = '测试中…';
    try {
      await createProvider(cfg).test();
      out.className = 'test-result ok';
      out.textContent = '连接正常';
    } catch (e) {
      out.className = 'test-result err';
      out.textContent = e.message;
    }
  });

  $('settings-form').addEventListener('submit', () => {
    capture();
    const before = getSettings();
    const fontChanged = before.font !== draft.font;
    saveSettings(draft);
    pagesRoot.classList.toggle('font-sans', draft.font === 'sans');
    updateProviderNote();
    if (!state.analysis) return;
    if (fontChanged) state.viewer?.refit();
    const cfg = providerConfig();
    if (cfgKey(cfg) !== state.cfgKey) {
      resetTranslations();
      startTranslation();
      startSummary();
    }
  });
}

function setModelOptions(ids) {
  const list = $('s-models');
  list.replaceChildren(...ids.map((id) => new Option(id, id)));
}

// ---------- boot ----------

setupSettings();
setupLanding();
setupToolbar();
pagesRoot.classList.toggle('font-sans', getSettings().font === 'sans');
if (inExtension) document.querySelector('.extension').hidden = true;

const params = new URLSearchParams(location.search);
const src = params.get('src') || params.get('url');
if (src) openUrl(src, params.get('tab'));
