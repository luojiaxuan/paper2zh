// Inline rich text: escapes HTML, renders $...$ with KaTeX and **...** as bold.
// Also a small Markdown renderer for the summary panel.

import katex from '../vendor/katex/katex.mjs';

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function math(tex) {
  try {
    return katex.renderToString(tex, { throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    return escapeHtml(`$${tex}$`);
  }
}

export function inline(text) {
  const parts = [];
  const re = /\$([^$\n]{1,400}?)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    parts.push(formatText(text.slice(last, m.index)));
    parts.push(math(m[1]));
    last = m.index + m[0].length;
  }
  parts.push(formatText(text.slice(last)));
  return parts.join('');
}

function formatText(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

// Headings (###), bullet and numbered lists, paragraphs.
export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const html = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) {
      flushPara();
      flushList();
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flushPara();
      flushList();
      html.push(`<h3>${inline(m[1])}</h3>`);
    } else if ((m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const kind = /^\d/.test(line) ? 'ol' : 'ul';
      if (list !== kind) {
        flushList();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline(m[1])}</li>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return html.join('');
}
