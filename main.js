'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

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

// Each window is an independent document. `filePath` (optional) is opened in
// the new window once its renderer has loaded.
function createWindow(filePath = null) {
  // Cascade new windows from the current one so they don't stack exactly.
  const from = BrowserWindow.getFocusedWindow();
  const offset = from ? { x: from.getBounds().x + 28, y: from.getBounds().y + 28 } : {};

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...offset,
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

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Once the page is ready, hand off the file this window was opened for.
  win.webContents.once('did-finish-load', () => {
    if (filePath) win.webContents.send('file:open-path', filePath);
  });

  // Links in the preview (target="_blank") open in the user's browser rather
  // than in a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}

// Dialogs are parented to whichever window asked for them.
function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

// ---------------------------------------------------------------------------
// Application menu — wires standard shortcuts to renderer actions.
// ---------------------------------------------------------------------------

// Menu commands act on the focused window.
function send(channel) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
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
        { label: 'Toggle Editor', accelerator: 'CmdOrCtrl+E', click: () => send('menu:toggle-editor') },
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
ipcMain.handle('dialog:open', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(senderWindow(event), {
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
ipcMain.handle('dialog:save-as', async (event, { content, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(senderWindow(event), {
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
ipcMain.handle('dialog:confirm-discard', async (event, { name }) => {
  const { response } = await dialog.showMessageBox(senderWindow(event), {
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
ipcMain.handle('dialog:export-html', async (event, { html, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(senderWindow(event), {
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

ipcMain.handle('dialog:export-pdf', async (event, { html, defaultPath }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(senderWindow(event), {
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

// One app process hosts every window. A second launch (starting the app again,
// or double-clicking another .md file) is routed here and gets its own window.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // Files requested before the app is ready (initial launch / macOS open-file).
  const launchFiles = [];
  const initialFile = fileArgFrom(process.argv);
  if (initialFile) launchFiles.push(initialFile);

  app.on('second-instance', (_event, argv) => {
    if (app.isReady()) createWindow(fileArgFrom(argv));
  });

  // macOS delivers file-open requests through this event rather than argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady()) createWindow(filePath);
    else launchFiles.push(filePath);
  });

  app.whenReady().then(() => {
    buildMenu();
    if (launchFiles.length === 0) createWindow();
    for (const filePath of launchFiles) createWindow(filePath);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
