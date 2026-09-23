import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './src/server.js';

const root = path.dirname(fileURLToPath(import.meta.url));
let server;
app.whenReady().then(async () => {
  const labDir = app.isPackaged ? path.join(process.resourcesPath, 'lab') : path.join(root, 'lab');
  server = await startServer({ dataDir: app.getPath('userData'), labDir });
  const win = new BrowserWindow({ width: 1280, height: 850, minWidth: 900, minHeight: 650,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const url = `http://127.0.0.1:${server.address().port}`;
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: requested }) => {
    if (requested.startsWith('https://')) shell.openExternal(requested);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, requested) => {
    if (!requested.startsWith(url)) event.preventDefault();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());
