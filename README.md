# Markdown Reader

A personal, lightweight markdown reader/editor built with Electron.

## Features

- **Dark mode UI** — easy on the eyes, VS Code–inspired palette.
- **Side-by-side editing** — raw markdown on the left, live rendered preview on the right.
- **Syntax highlighting** in the editor pane (markdown grammar via highlight.js).
- **Drag and drop** a `.md`/`.txt` file onto the window to open it.
- **Synced scrolling** — the two panes track each other proportionally as you scroll.
- **File management** — New, Open, Save, and Save As, with unsaved-changes prompts.
- **Export** — save the rendered document as a standalone **HTML** file or a **PDF**.
- **Cheatsheet** — a built-in markdown syntax guide (the **? Guide** button).
- **Draggable divider** to resize the editor/preview split.
- **Toggle preview** for distraction-free writing.
- Safe rendering: markdown is parsed with [marked](https://marked.js.org/) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify).

## Running

```bash
npm install
npm start
```

> On Windows, if the app exits immediately with a `Cannot read properties of undefined (reading 'handle')`
> error, make sure the `ELECTRON_RUN_AS_NODE` environment variable is **not** set to `1`.

## Building the installer

```bash
npm run dist
```

Produces `dist/Markdown Reader Setup <version>.exe` (a Windows NSIS installer).

## Cutting a release

```bash
npm run release
```

Reads the version from `package.json`, pushes the current commit, builds the
installer, then creates a GitHub release (tag `v<version>`) and uploads the
installer as a download. It authenticates with the GitHub token already stored
by Git Credential Manager (the one `git push` uses) — no `gh` CLI or manual
token needed.

To publish a new version: bump `version` in `package.json`, commit, then run
`npm run release`. Useful flags: `-- --no-build` (reuse an existing installer),
`-- --notes <file>` (custom notes), `-- --draft`.

## Keyboard shortcuts

| Action          | Shortcut          |
| --------------- | ----------------- |
| New             | `Ctrl+N`          |
| Open            | `Ctrl+O`          |
| Save            | `Ctrl+S`          |
| Save As         | `Ctrl+Shift+S`    |
| Export as HTML  | `Ctrl+Shift+E`    |
| Export as PDF   | `Ctrl+Shift+P`    |
| Toggle Preview  | `Ctrl+P`          |

## Architecture

| File                    | Role                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| `main.js`               | Electron main process: window, native menu, file dialogs, IPC.      |
| `preload.js`            | Secure `contextBridge` API — markdown rendering + file operations.  |
| `renderer/index.html`   | App layout with a strict Content-Security-Policy.                   |
| `renderer/styles.css`   | Dark theme and rendered-markdown styling.                           |
| `renderer/renderer.js`  | UI logic: live preview, dirty tracking, pane resizing.              |

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`; all
filesystem access is confined to the main process and reached through a small,
explicit IPC surface.
