'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const hljs = require('highlight.js/lib/core');
const markdownLang = require('highlight.js/lib/languages/markdown');
const { mathExtension } = require('./math');

hljs.registerLanguage('markdown', markdownLang);

// DOMPurify needs a window. In the preload the renderer's window is available.
const DOMPurify = createDOMPurify(window);

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false
});
marked.use(mathExtension);

// KaTeX stylesheet with its fonts inlined as data URIs, so exported HTML/PDF
// files render math correctly without the app or a network connection.
// Built lazily on the first export that actually contains math.
let inlinedKatexCss = null;
function katexCssForExport() {
  if (inlinedKatexCss) return inlinedKatexCss;
  const distDir = path.dirname(require.resolve('katex/dist/katex.min.css'));
  const css = fs.readFileSync(path.join(distDir, 'katex.min.css'), 'utf-8');
  // Keep only the woff2 source of each @font-face; every Chromium supports it.
  inlinedKatexCss = css.replace(/src:([^;}]*)/g, (decl) => {
    const m = decl.match(/url\((fonts\/[^)]+\.woff2)\)/);
    if (!m) return decl;
    const data = fs.readFileSync(path.join(distDir, m[1])).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
  return inlinedKatexCss;
}

// Open external links in the user's browser rather than inside the app.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

contextBridge.exposeInMainWorld('api', {
  // Markdown -> sanitized HTML. Runs entirely locally.
  renderMarkdown: (text) => {
    const raw = marked.parse(text || '');
    return DOMPurify.sanitize(raw);
  },

  // Self-contained KaTeX CSS for exported documents.
  katexCss: () => katexCssForExport(),

  // Markdown source -> syntax-highlighted (and HTML-escaped) markup.
  highlightMarkdown: (text) =>
    hljs.highlight(text || '', { language: 'markdown', ignoreIllegals: true }).value,

  // Resolve the absolute path of a File dropped onto the window.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // File operations (delegated to the main process).
  openFile: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', { filePath }),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', { filePath, content }),
  saveFileAs: (content, defaultPath) => ipcRenderer.invoke('dialog:save-as', { content, defaultPath }),
  confirmDiscard: (name) => ipcRenderer.invoke('dialog:confirm-discard', { name }),

  // Export operations.
  exportHtml: (html, defaultPath) => ipcRenderer.invoke('dialog:export-html', { html, defaultPath }),
  exportPdf: (html, defaultPath) => ipcRenderer.invoke('dialog:export-pdf', { html, defaultPath }),

  // Main asks the renderer to open a specific file (file association / drag onto icon).
  onOpenFile: (callback) => {
    ipcRenderer.on('file:open-path', (_event, filePath) => callback(filePath));
  },

  // Menu -> renderer events.
  onMenu: (channel, callback) => {
    const valid = ['menu:new', 'menu:open', 'menu:save', 'menu:save-as', 'menu:toggle-preview',
                   'menu:toggle-editor', 'menu:export-html', 'menu:export-pdf'];
    if (valid.includes(channel)) {
      ipcRenderer.on(channel, () => callback());
    }
  }
});
