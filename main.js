/* OBSICITY - the Electron shell.
 *
 * This used to loadFile('index.html'), which serves the page from file://.
 * That was fine when the game was the whole product and never touched the
 * network, but it is not fine now: file:// gives the page a null origin, and
 * a null origin cannot hold a Privy session, cannot satisfy the CSP's
 * connect-src, and gets rejected by most RPC endpoints outright. The desktop
 * build would have silently been the only build with no chain layer.
 *
 * So the desktop app starts the same static host the web build uses and
 * loads the same URL. One code path, one origin, and anything verified in
 * the browser is verified here too.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
let server = null;

function start () {
  // tools/serve.js exports nothing and listens on require; run it in-process
  // so there is no second terminal to babysit and no orphan on quit.
  process.env.PORT = String(PORT);
  server = require(path.join(__dirname, 'tools', 'serve.js'));
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a0e18',
    title: 'OBSICITY',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win.show());

  /* Privy's login and any explorer link must open in the real browser, not
   * inside the game window where there is no address bar to trust. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL('http://localhost:' + PORT + '/');
  return win;
}

app.whenReady().then(() => {
  start();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (server && server.close) server.close();
  if (process.platform !== 'darwin') app.quit();
});
