/* Screenshot the demo city with a data overlay on. Run: npx electron tools/shot_overlay.js value */
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
const MODE = process.argv[2] || 'value';
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 920, show: false, backgroundColor: '#0a0e18' });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  const out = await win.webContents.executeJavaScript(`
    (function () {
      var r = MM.renderer, s = MM.state;
      s.tick = 13; s.speed = 0;
      var hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
      r.overlay = '${MODE}';
      r.centerOn(MM.GRID * 0.32, MM.GRID * 0.46);
      for (var i = 0; i < 80; i++) r.draw(s, 16);
      return 'overlay=' + r.overlay;
    })();
  `).catch(e => 'REJECTED: ' + e.message);
  console.log('  ' + out);
  await new Promise(r => setTimeout(r, 1200));
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'ov_' + MODE + '.png'),
    (await win.webContents.capturePage()).toPNG());
  console.log('  wrote build/ov_' + MODE + '.png');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
setTimeout(() => process.exit(1), 45000);
