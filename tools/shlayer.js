/* Render the city, then dump the cast-shadow silhouettes on their own so the
   direction and shape can be judged without the city on top of them.       */
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 920, show: false });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  const out = await win.webContents.executeJavaScript(`
    (function () {
      try {
        var r = MM.renderer, s = MM.state;
        s.tick = 13; s.speed = 0;
        var hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
        r.centerOn(17, 22);
        for (var i = 0; i < 3; i++) r.zoomAt(720, 460, 1);
        for (i = 0; i < 60; i++) r.draw(s, 16);
        // replay the collect the static pass does, with its margin offsets
        var M = 192, ox0 = r.ox, oy0 = r.oy, w0 = r.w, h0 = r.h;
        r.ox += M; r.oy += M; r.w += 2 * M; r.h += 2 * M;
        r._collect(s);
        var c = document.createElement('canvas');
        c.width = r.w; c.height = r.h;
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#20304f';
        g.beginPath();
        r._shadowPaths(g, s, 1);
        g.fill();
        g.strokeStyle = '#e0004b'; g.lineWidth = 1.2;
        g.beginPath(); r._shadowPaths(g, s, 0); g.stroke();
        r.ox = ox0; r.oy = oy0; r.w = w0; r.h = h0;
        return c.toDataURL('image/png').slice(22);
      } catch (e) { return 'THREW: ' + e.message + '\\n' + e.stack; }
    })();
  `).catch(e => 'REJECTED: ' + e.message);
  if (out.startsWith('THREW') || out.startsWith('REJECTED')) { console.log(out); app.quit(); return; }
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'shlayer.png'), Buffer.from(out, 'base64'));
  console.log('  wrote build/shlayer.png');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
setTimeout(() => process.exit(1), 45000);
