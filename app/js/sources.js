// Getting PDF bytes from a link: normalizes paper landing pages to their PDF,
// and inside the Chrome extension falls back to fetching from the original
// tab, which carries the user's session on the site (needed for OpenReview).

export function pdfUrlFor(input) {
  let s = input.trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) s = `https://arxiv.org/abs/${s}`;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (/(^|\.)arxiv\.org$/.test(u.hostname)) {
    const m = u.pathname.match(/^\/(abs|pdf|html)\/(.+?)(\.pdf)?$/);
    if (m) return `https://arxiv.org/pdf/${m[2]}`;
  }
  if (/(^|\.)openreview\.net$/.test(u.hostname) && u.pathname === '/forum') {
    return `https://openreview.net/pdf?${u.searchParams.toString()}`;
  }
  return u.href;
}

const isPdf = (bytes) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

export const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Match pattern for the site a PDF lives on, as used by chrome.permissions.
function sitePattern(url) {
  const u = new URL(url);
  return u.protocol === 'file:' ? 'file:///*' : `${u.protocol}//${u.host}/*`;
}

// The extension reads sites only with activeTab (the tab the user clicked the
// button on) or with access the user granted to that site.
const hasSiteAccess = (url) => chrome.permissions.contains({ origins: [sitePattern(url)] });

export function requestSiteAccess(site) {
  return chrome.permissions.request({ origins: [site.pattern] });
}

export async function fetchPdf(url, tabId) {
  const granted = inExtension && (await hasSiteAccess(url));
  let direct = null;
  try {
    const res = await fetch(url, { credentials: granted ? 'include' : 'omit' });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isPdf(bytes)) return bytes;
      direct = '链接返回的不是 PDF';
    } else {
      direct = `下载失败（HTTP ${res.status}）`;
    }
  } catch {
    direct = inExtension ? '下载失败' : '这个网站不允许网页直接读取它的 PDF（跨域限制）';
  }
  if (inExtension && tabId) {
    const reply = await chrome.runtime.sendMessage({ type: 'grab-pdf', tabId: Number(tabId), url });
    if (reply?.ok) {
      const bytes = fromBase64(reply.data);
      if (isPdf(bytes)) return bytes;
    }
  }
  if (inExtension && !granted) {
    const err = new Error(`${direct}。可以允许 paper2zh 读取这个网站后重试，或在原页面下载 PDF 后拖进来。`);
    err.site = { pattern: sitePattern(url), host: new URL(url).host || '本地文件' };
    throw err;
  }
  const hint = inExtension
    ? '可以在原页面下载 PDF 后拖进来。'
    : '可以安装 Chrome 扩展在 PDF 页面一键打开，或下载 PDF 后拖进来。';
  throw new Error(`${direct}。${hint}`);
}
