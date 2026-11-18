// Toolbar button: open the current PDF in the paper2zh viewer (a page bundled
// with this extension). The viewer downloads the PDF itself; when the site
// needs the user's session, it asks this worker to fetch it from inside the
// original tab.

const viewerUrl = (src, tabId) => {
  const params = new URLSearchParams({ src });
  if (tabId !== undefined) params.set('tab', String(tabId));
  return chrome.runtime.getURL(`index.html?${params}`);
};

chrome.action.onClicked.addListener((tab) => {
  const url = tab.url || '';
  const target = /^(https?|file):/.test(url) ? viewerUrl(url, tab.id) : chrome.runtime.getURL('index.html');
  chrome.tabs.create({ url: target, index: tab.index + 1 });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'open-link', title: '用 paper2zh 打开这个 PDF', contexts: ['link'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-link' && info.linkUrl) {
    chrome.tabs.create({ url: viewerUrl(info.linkUrl, tab?.id), index: (tab?.index ?? 0) + 1 });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'grab-pdf') return false;
  grabFromTab(msg.tabId, msg.url).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

async function grabFromTab(tabId, url) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [url],
    func: async (u) => {
      const res = await fetch(u, { credentials: 'include' });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { ok: true, data: btoa(bin) };
    },
  });
  return injection?.result ?? { ok: false, error: 'no result' };
}
