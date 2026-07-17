'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

/** @type {BrowserWindow | null} */
let mainWindow = null;

// A markdown file waiting to be opened once the renderer is ready (set when the
// app is launched by double-clicking an associated file).
let pendingFile = null;

const OPENABLE_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;

// Find a markdown/text file path among launch arguments. On Windows, opening a
// file via its association passes the path as a command-line argument.
function fileArgFrom(argv) {
  const candidate = argv.slice(1).find((arg) => {
    if (!arg || arg.startsWith('-') || arg === '.') return false;
    if (!OPENABLE_EXT.test(arg)) return false;
    try {
      return fsSync.statSync(arg).isFile();
    } catch {
      return false;
    }
  });
  return candidate ? path.resolve(candidate) : null;
}

// Tell the renderer to open a specific file.
function openInRenderer(filePath) {
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('file:open-path', filePath);
  } else {
    pendingFile = filePath;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#1e1e1e',
    title: 'Markdown Reader',
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Once the page is ready, hand off any file the app was launched to open.
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFile) {
      mainWindow.webContents.send('file:open-path', pendingFile);
      pendingFile = null;
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Application menu — wires standard shortcuts to renderer actions.
// ---------------------------------------------------------------------------

function send(channel) {
  if (mainWindow) mainWindow.webContents.send(channel);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:save-as') },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            { label: 'As HTML…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('menu:export-html') },
            { label: 'As PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('menu:export-pdf') }
          ]
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+P', click: () => send('menu:toggle-preview') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC handlers — file system access lives in the main process only.
// ---------------------------------------------------------------------------

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
];

// Open: show dialog, read the chosen file.
ipcMain.handle('dialog:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    properties: ['openFile'],
    filters: MD_FILTERS
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  const filePath = filePaths[0];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { canceled: false, filePath, content };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// Read a file by path (used by drag-and-drop opening).
ipcMain.handle('file:read', async (_event, { filePath }) => {
  if (!filePath) return { error: 'No file path provided.' };
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  } catch (err) {
    return { error: err.message };
  }
});

// Save to a known path.
ipcMain.handle('file:save', async (_event, { filePath, content }) => {
  if (!filePath) return { error: 'No file path provided.' };
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { filePath };
  } catch (err) {
    return { error: err.message };
  }
});

// Save As: prompt for a path, then write.
ipcMain.handle('dialog:save-as', async (_event, { content, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown File',
    defaultPath: defaultPath || 'untitled.md',
    filters: MD_FILTERS
  });
  if (canceled || !filePath) return { canceled: true };

  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// Ask the user how to handle unsaved changes. Returns 'save' | 'discard' | 'cancel'.
ipcMain.handle('dialog:confirm-discard', async (_event, { name }) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes you made to ${name || 'this document'}?`,
    detail: "Your changes will be lost if you don't save them."
  });
  return ['save', 'discard', 'cancel'][response];
});

// Export the rendered document as a standalone HTML file.
ipcMain.handle('dialog:export-html', async (_event, { html, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as HTML',
    defaultPath: defaultPath || 'document.html',
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fs.writeFile(filePath, html, 'utf-8');
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// Render the standalone HTML in an offscreen window and print it to PDF.
async function htmlToPdf(html) {
  const tmpFile = path.join(os.tmpdir(), `mdreader-export-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, 'utf-8');

  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, javascript: false }
  });
  try {
    await pdfWin.loadFile(tmpFile);
    return await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    });
  } finally {
    pdfWin.destroy();
    fs.unlink(tmpFile).catch(() => {});
  }
}

ipcMain.handle('dialog:export-pdf', async (_event, { html, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as PDF',
    defaultPath: defaultPath || 'document.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    const pdfData = await htmlToPdf(html);
    await fs.writeFile(filePath, pdfData);
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------

// Ensure a single instance: a second launch (e.g. double-clicking another .md
// file) is routed into the already-running window instead of opening anew.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // Capture a file passed on the initial launch.
  pendingFile = fileArgFrom(process.argv);

  app.on('second-instance', (_event, argv) => {
    const filePath = fileArgFrom(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (filePath) openInRenderer(filePath);
    }
  });

  // macOS delivers file-open requests through this event rather than argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openInRenderer(filePath);
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
