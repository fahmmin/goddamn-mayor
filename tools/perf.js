/* Honest frame-cost profiler. The static-city cache makes a naive A/B
   meaningless, so this measures the cases that actually cost: a full day/night
   cycle (dawn and dusk repaint the cache) and a sustained pan.
   Run: npx electron tools/perf.js                                           */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 920, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));

  const out = await win.webContents.executeJavaScript(`
    (function () {
      const s = MM.state, T = MM.TILE, R = MM.renderer;
      localStorage.clear();
      function put (t, x0, y0, w, h) {
        for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
          if (!MM.inBounds(x, y)) continue;
          const i = MM.idx(x, y);
          if (s.grid[i] === T.WATER) continue;
          s.grid[i] = t; s.level[i] = MM.ZONES.indexOf(t) >= 0 ? 1 : 0;
        }
      }
      for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++)
        if (y % 5 === 4 || x % 5 === 1) put(T.ROAD, x, y, 1, 1);
      for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++) {
        const i = MM.idx(x, y);
        if (s.grid[i] !== T.EMPTY) continue;
        if (y >= 32 && x >= 24) put(T.IND, x, y, 1, 1);
        else if (x >= 20) put(T.COM, x, y, 1, 1);
        else put(T.RES, x, y, 1, 1);
      }
      [[9,17],[16,22],[24,18],[12,29],[22,31],[28,24]].forEach(p => put(T.PARK, p[0], p[1], 1, 1));
      [[13,16],[18,27],[26,21]].forEach(p => put(T.BUS, p[0], p[1], 1, 1));
      put(T.GROCERY,11,22,1,1); put(T.SCHOOL,14,33,1,1); put(T.CLINIC,17,19,1,1);
      s.treasury = 90000;
      for (let d = 0; d < 70 * MM.TICKS_PER_DAY; d++) { MM.sim.step(s); s.pending = null; }
      s.speed = 0;
      R.centerOn(19, 25);
      for (let w = 0; w < 200; w++) R.draw(s, 16);       // settle the day/night phase

      const rows = [];
      function run (label, frames, before) {
        let worst = 0, total = 0, repaints = 0, last = R._cacheKey;
        for (let f = 0; f < frames; f++) {
          if (before) before(f);
          const t0 = performance.now();
          R.draw(s, 16);
          const ms = performance.now() - t0;
          total += ms; if (ms > worst) worst = ms;
          if (R._cacheKey !== last) { repaints++; last = R._cacheKey; }
        }
        rows.push(label.padEnd(16) + (total / frames).toFixed(1).padStart(6) + ' ms mean' +
          worst.toFixed(0).padStart(6) + ' ms worst' + String(repaints).padStart(5) +
          ' repaints / ' + frames + ' frames');
      }

      run('idle', 120, null);
      // a whole game day: dawn and dusk move the light enough to repaint
      run('full day cycle', 900, () => { s.tick += 1 / 12; });
      run('panning', 240, () => R.panBy(6, 3));
      run('zooming', 60, f => R.zoomAt(720, 460, f % 2 ? 1 : -1));

      return 'visible tiles: ' + (R._nAll || 0) + '\\n' + rows.join('\\n');
    })();
  `);
  console.log('\n' + out + '\n');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
setTimeout(() => process.exit(1), 120000);
