'use strict';

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const fileNameEl = document.getElementById('file-name');
const dirtyDot = document.getElementById('dirty-dot');
const statusPath = document.getElementById('status-path');
const statusCounts = document.getElementById('status-counts');
const togglePreviewBtn = document.getElementById('btn-toggle-preview');
const divider = document.getElementById('divider');
const workspace = document.getElementById('workspace');
const editorPane = document.getElementById('editor-pane');
const previewPane = document.getElementById('preview-pane');
const toastEl = document.getElementById('toast');
const highlightLayer = document.getElementById('highlight');
const highlightCode = document.getElementById('highlight-code');

// ---------------------------------------------------------------------------
// Document state
// ---------------------------------------------------------------------------
const state = {
  filePath: null,       // absolute path, or null for an untitled doc
  savedContent: '',     // content as last saved/opened — used for dirty check
  dirty: false
};

function baseName(p) {
  if (!p) return 'Untitled';
  return p.replace(/\\/g, '/').split('/').pop();
}

function setDirty(isDirty) {
  state.dirty = isDirty;
  dirtyDot.classList.toggle('hidden', !isDirty);
}

function updateTitleBar() {
  const name = baseName(state.filePath);
  fileNameEl.textContent = name;
  document.title = `${state.dirty ? '● ' : ''}${name} — Markdown Reader`;
  statusPath.textContent = state.filePath || 'No file';
}

function updateCounts() {
  const text = editor.value;
  const words = (text.match(/\S+/g) || []).length;
  statusCounts.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} chars`;
}

// Transient notification in the lower-center of the window.
let toastTimer = null;
function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.remove('hidden');
  // Force reflow so the transition runs on repeated calls.
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.classList.add('hidden'), 250);
  }, isError ? 4000 : 2500);
}

// ---------------------------------------------------------------------------
// Syntax highlighting layer (sits behind the transparent textarea)
// ---------------------------------------------------------------------------
function updateHighlight() {
  // The trailing newline keeps the highlight layer's height in step with the
  // textarea when the document ends on a blank line.
  highlightCode.innerHTML = window.api.highlightMarkdown(editor.value) + '\n';
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
}

// Keep the highlight layer aligned 1:1 with the textarea while scrolling.
editor.addEventListener('scroll', () => {
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
});

// ---------------------------------------------------------------------------
// Live preview (debounced)
// ---------------------------------------------------------------------------
let renderTimer = null;
function renderPreview() {
  preview.innerHTML = window.api.renderMarkdown(editor.value);
}

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 120);
}

editor.addEventListener('input', () => {
  setDirty(editor.value !== state.savedContent);
  updateTitleBar();
  updateCounts();
  updateHighlight();
  scheduleRender();
});

// Insert a real tab character instead of moving focus.
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('\t', start, end, 'end');
    editor.dispatchEvent(new Event('input'));
  }
});

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
function loadDocument(filePath, content) {
  state.filePath = filePath;
  state.savedContent = content;
  editor.value = content;
  setDirty(false);
  updateTitleBar();
  updateCounts();
  updateHighlight();
  renderPreview();
  editor.focus();
}

// Returns true if it's safe to proceed (i.e. changes handled or discarded).
async function confirmProceed() {
  if (!state.dirty) return true;
  const choice = await window.api.confirmDiscard(baseName(state.filePath));
  if (choice === 'cancel') return false;
  if (choice === 'save') return await saveDocument();
  return true; // discard
}

async function newDocument() {
  if (!(await confirmProceed())) return;
  loadDocument(null, '');
}

async function openDocument() {
  if (!(await confirmProceed())) return;
  const result = await window.api.openFile();
  if (result.canceled) return;
  if (result.error) {
    alert(`Could not open file:\n${result.error}`);
    return;
  }
  loadDocument(result.filePath, result.content);
}

// Open a file by absolute path (used by file associations and drag-and-drop).
async function openDocumentPath(filePath) {
  if (!filePath) return;
  if (!(await confirmProceed())) return;
  const result = await window.api.readFile(filePath);
  if (result.error) {
    showToast(`Could not open: ${result.error}`, true);
    return;
  }
  loadDocument(filePath, result.content);
  showToast(`Opened ${baseName(filePath)}`);
}

// Returns true on a successful save, false if canceled/failed.
async function saveDocument() {
  if (!state.filePath) return await saveDocumentAs();
  const result = await window.api.saveFile(state.filePath, editor.value);
  if (result.error) {
    alert(`Could not save file:\n${result.error}`);
    return false;
  }
  state.savedContent = editor.value;
  setDirty(false);
  updateTitleBar();
  return true;
}

async function saveDocumentAs() {
  const result = await window.api.saveFileAs(editor.value, baseName(state.filePath));
  if (result.canceled) return false;
  if (result.error) {
    alert(`Could not save file:\n${result.error}`);
    return false;
  }
  state.filePath = result.filePath;
  state.savedContent = editor.value;
  setDirty(false);
  updateTitleBar();
  return true;
}

// ---------------------------------------------------------------------------
// Preview toggle
// ---------------------------------------------------------------------------
function togglePreview() {
  const hidden = document.body.classList.toggle('preview-hidden');
  togglePreviewBtn.classList.toggle('active', !hidden);
}
togglePreviewBtn.classList.add('active'); // preview visible by default

// ---------------------------------------------------------------------------
// Draggable divider to resize panes
// ---------------------------------------------------------------------------
let dragging = false;
divider.addEventListener('mousedown', () => {
  dragging = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = workspace.getBoundingClientRect();
  let ratio = (e.clientX - rect.left) / rect.width;
  ratio = Math.min(0.85, Math.max(0.15, ratio));
  editorPane.style.flex = `0 0 ${ratio * 100}%`;
  previewPane.style.flex = `1 1 auto`;
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// ---------------------------------------------------------------------------
// Synced scrolling between the editor and preview panes
// ---------------------------------------------------------------------------
// A lock prevents the programmatic scroll of one pane from echoing back.
let scrollLock = false;

function linkScroll(source, target) {
  source.addEventListener('scroll', () => {
    if (scrollLock) return;
    if (document.body.classList.contains('preview-hidden')) return;
    scrollLock = true;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const ratio = sourceRange > 0 ? source.scrollTop / sourceRange : 0;
    const targetRange = target.scrollHeight - target.clientHeight;
    target.scrollTop = ratio * targetRange;
    // Release on the next frame, after the target's scroll event has fired.
    requestAnimationFrame(() => { scrollLock = false; });
  });
}

// The textarea scrolls internally; the preview scrolls on its pane.
linkScroll(editor, previewPane);
linkScroll(previewPane, editor);

// ---------------------------------------------------------------------------
// Export to HTML / PDF
// ---------------------------------------------------------------------------

// Print-friendly stylesheet embedded into exported documents (light theme).
const EXPORT_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65; color: #24292f; background: #ffffff;
    max-width: 820px; margin: 0 auto; padding: 40px 24px;
  }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.6em; font-weight: 600; }
  h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; } h4 { font-size: 1.05em; }
  p { margin: 0.8em 0; }
  a { color: #0969da; text-decoration: none; }
  code {
    font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
    background: #f0f1f2; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em;
  }
  pre {
    background: #f6f8fa; padding: 14px 16px; border-radius: 6px;
    overflow-x: auto; border: 1px solid #d0d7de;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    margin: 0.8em 0; padding: 0.2em 1em;
    border-left: 3px solid #d0d7de; color: #57606a;
  }
  ul, ol { padding-left: 1.6em; margin: 0.6em 0; }
  li { margin: 0.25em 0; }
  table { border-collapse: collapse; margin: 0.8em 0; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
  th { background: #f6f8fa; }
  tr:nth-child(even) td { background: #f6f8fa; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
`;

function documentTitle() {
  return baseName(state.filePath).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') || 'Untitled';
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Assemble a self-contained HTML document from the current markdown.
function buildStandaloneHtml() {
  const body = window.api.renderMarkdown(editor.value);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(documentTitle())}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function exportFileName(ext) {
  return `${documentTitle()}.${ext}`;
}

async function exportAsHtml() {
  showToast('Exporting HTML…');
  const result = await window.api.exportHtml(buildStandaloneHtml(), exportFileName('html'));
  if (result.canceled) { toastEl.classList.remove('show'); return; }
  if (result.error) { showToast(`Export failed: ${result.error}`, true); return; }
  showToast(`Exported to ${baseName(result.filePath)}`);
}

async function exportAsPdf() {
  showToast('Generating PDF…');
  const result = await window.api.exportPdf(buildStandaloneHtml(), exportFileName('pdf'));
  if (result.canceled) { toastEl.classList.remove('show'); return; }
  if (result.error) { showToast(`Export failed: ${result.error}`, true); return; }
  showToast(`Exported to ${baseName(result.filePath)}`);
}

// ---------------------------------------------------------------------------
// Drag and drop a file onto the window to open it
// ---------------------------------------------------------------------------
const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;

// A depth counter keeps the overlay stable as drag events fire on children.
let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  document.body.classList.add('drag-over');
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drag-over');

  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;

  const filePath = window.api.getPathForFile(file);
  if (!filePath) {
    showToast('Could not read the dropped file.', true);
    return;
  }
  if (!MD_EXT.test(filePath)) {
    showToast('Not a markdown/text file.', true);
    return;
  }

  await openDocumentPath(filePath);
});

// ---------------------------------------------------------------------------
// Markdown cheatsheet modal
// ---------------------------------------------------------------------------
const cheatsheet = document.getElementById('cheatsheet');
const cheatBody = document.getElementById('cheat-body');

// Each entry: `el` label, `md` the syntax shown, `block` for multi-line syntax,
// and an optional `render` override for what the Result column actually renders.
const IMG_DEMO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='24'%3E%3Crect width='44' height='24' rx='4' fill='%234ea1f3'/%3E%3C/svg%3E";

const CHEATS = [
  { el: 'Heading', md: '# Heading 1\n## Heading 2', block: true },
  { el: 'Bold', md: '**bold text**' },
  { el: 'Italic', md: '*italic text*' },
  { el: 'Bold + Italic', md: '***both***' },
  { el: 'Strikethrough', md: '~~struck~~' },
  { el: 'Inline code', md: '`inline code`' },
  { el: 'Code block', md: '```js\nconst x = 1;\n```', block: true },
  { el: 'Blockquote', md: '> quoted text' },
  { el: 'Unordered list', md: '- item one\n- item two', block: true },
  { el: 'Ordered list', md: '1. first\n2. second', block: true },
  { el: 'Task list', md: '- [x] done\n- [ ] to do', block: true },
  { el: 'Link', md: '[title](https://example.com)' },
  { el: 'Image', md: '![alt text](image.png)', render: `![alt text](${IMG_DEMO})` },
  { el: 'Horizontal rule', md: 'above\n\n---\n\nbelow', block: true },
  { el: 'Table', md: '| A | B |\n| - | - |\n| 1 | 2 |', block: true }
];

function buildCheatsheet() {
  cheatBody.innerHTML = CHEATS.map((c) => {
    const syntax = c.block ? `<pre>${escapeHtml(c.md)}</pre>` : `<code>${escapeHtml(c.md)}</code>`;
    const result = window.api.renderMarkdown(c.render || c.md);
    return `<tr><td>${escapeHtml(c.el)}</td>` +
           `<td>${syntax}</td>` +
           `<td class="cheat-result markdown-body">${result}</td></tr>`;
  }).join('');
}
buildCheatsheet();

function openCheatsheet() { cheatsheet.classList.remove('hidden'); }
function closeCheatsheet() { cheatsheet.classList.add('hidden'); }

document.getElementById('btn-guide').addEventListener('click', openCheatsheet);
document.getElementById('btn-close-cheatsheet').addEventListener('click', closeCheatsheet);
// Close when clicking the backdrop (outside the modal box).
cheatsheet.addEventListener('click', (e) => {
  if (e.target === cheatsheet) closeCheatsheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cheatsheet.classList.contains('hidden')) closeCheatsheet();
});

// ---------------------------------------------------------------------------
// Wire up buttons + menu events
// ---------------------------------------------------------------------------
document.getElementById('btn-new').addEventListener('click', newDocument);
document.getElementById('btn-open').addEventListener('click', openDocument);
document.getElementById('btn-save').addEventListener('click', saveDocument);
document.getElementById('btn-save-as').addEventListener('click', saveDocumentAs);
document.getElementById('btn-export-html').addEventListener('click', exportAsHtml);
document.getElementById('btn-export-pdf').addEventListener('click', exportAsPdf);
togglePreviewBtn.addEventListener('click', togglePreview);

window.api.onMenu('menu:new', newDocument);
window.api.onMenu('menu:open', openDocument);
window.api.onMenu('menu:save', saveDocument);
window.api.onMenu('menu:save-as', saveDocumentAs);
window.api.onMenu('menu:toggle-preview', togglePreview);
window.api.onMenu('menu:export-html', exportAsHtml);
window.api.onMenu('menu:export-pdf', exportAsPdf);

// Open a file when launched via a file association (or a second launch).
window.api.onOpenFile(openDocumentPath);

// Warn before closing/reloading with unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
loadDocument(null, '# Welcome to Markdown Reader\n\n' +
  'Type on the **left**, see the rendered preview on the **right**.\n\n' +
  '- Live preview\n- Dark mode\n- New / Open / Save / Save As\n\n' +
  '> Use `Ctrl+P` to toggle the preview pane.\n');
setDirty(false);
