'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const hljs = require('highlight.js/lib/core');
const markdownLang = require('highlight.js/lib/languages/markdown');

hljs.registerLanguage('markdown', markdownLang);

// DOMPurify needs a window. In the preload the renderer's window is available.
const DOMPurify = createDOMPurify(window);

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false
});

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
                   'menu:export-html', 'menu:export-pdf'];
    if (valid.includes(channel)) {
      ipcRenderer.on(channel, () => callback());
    }
  }
});
