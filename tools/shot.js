/* Launches the real app, builds a district, runs the sim, screenshots, exits.
   Visual verification through the actual render pipeline, not a mock.
   Run: npx electron tools/shot.js [outfile] [--night]                        */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'build', process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : 'shot.png');
const HOUR = (function () {
  const a = process.argv.find(v => v.startsWith('--hour='));
  return a ? parseInt(a.slice(7), 10) : -1;      // -1 = leave the clock alone
})();
const SHOWCASE = process.argv.indexOf('--showcase') >= 0;
const DEMO = process.argv.indexOf('--demo') >= 0;   // shoot the city demo.js boots
const AT = (function () {
  const a = process.argv.find(v => v.startsWith('--at='));
  return a ? a.slice(5).split(',').map(Number) : null;
})();
const ZOOM = (function () {
  const a = process.argv.find(v => v.startsWith('--zoom='));
  return a ? parseFloat(a.slice(7)) : 0;
})();

app.commandLine.appendSwitch('disable-gpu-vsync');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 920, show: false,
    backgroundColor: '#0a0e18',
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false }
  });

  await win.loadFile(path.join(__dirname, '..', 'index.html'));

  win.webContents.on('console-message', (_e, lvl, msg) => console.log('  console[' + lvl + '] ' + msg));
  const err = await win.webContents.executeJavaScript(`
    (function () {
      try {
        if (!window.MM || !MM.state) return 'MM.state missing - game.js did not boot';
        const s = MM.state, T = MM.TILE;

        if (${DEMO}) {
          // demo.js already built the showcase city into MM.state at boot.
          // Do not touch the grid - the point is to shoot exactly what a
          // player sees when they run npm start.
          ${HOUR >= 0 ? 's.tick = ' + HOUR + ';' : ''}
          s.speed = 0;
          var dh = document.getElementById('hud');
          if (dh) dh.style.display = 'none';        // let the city fill the frame
          MM.renderer.centerOn(${AT ? AT[0] : 'MM.GRID * 0.32'}, ${AT ? AT[1] : 'MM.GRID * 0.46'});
          ${('MM.renderer.zoomAt(720, 460, ' + (ZOOM < 0 ? -1 : 1) + ');').repeat(Math.abs(ZOOM))}
          for (let w = 0; w < 150; w++) MM.renderer.draw(s, 16);
          var d0 = performance.now();
          for (var df = 0; df < 60; df++) MM.renderer.draw(s, 16);
          var dms = (performance.now() - d0) / 60;
          var d1 = performance.now();
          for (var dg = 0; dg < 6; dg++) { MM.renderer._cacheKey = 'x' + dg; MM.renderer.draw(s, 16); }
          var drb = (performance.now() - d1) / 6;
          MM.lots.plan(s);
          return 'demo: ' + MM.lots.lots.length + ' lots, pop ' + s.pop +
            ', jobs ' + s.jobs + ' | draw ' + dms.toFixed(2) + 'ms/frame | rebuild ' +
            drb.toFixed(0) + 'ms';
        }

        localStorage.clear();
        // game.js has already booted and may have loaded an autosave, so every
        // run would start from the last run's city. Reset in place to keep
        // screenshots and timings comparable between runs.
        const fresh = MM.createState();
        Object.keys(fresh).forEach(k => { s[k] = fresh[k]; });
        function put (t, x0, y0, w, h) {
          for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
            if (!MM.inBounds(x, y)) continue;
            const i = MM.idx(x, y);
            if (s.grid[i] === T.WATER) continue;
            s.grid[i] = t;
            s.level[i] = MM.ZONES.indexOf(t) >= 0 ? 1 : 0;
          }
        }
        if (${SHOWCASE}) {
          // One lot per archetype, on a 3-wide grid with roads between, so a
          // single frame shows every model in the library side by side.
          const NAMES = ['podium', 'curve', 'atrium', 'court', 'campus', 'rotunda',
            'mall', 'strip', 'row', 'perim', 'towers', 'shed', 'plant', 'yard',
            'green', 'pond', 'sport', 'plaza', 'school', 'clinic', 'market',
            'creche', 'social',
            'airport', 'stadium', 'depot', 'power', 'solar', 'wind',
            'marina', 'port', 'funfair', 'fire', 'police', 'hospital'];
          const KIND = { podium: T.COM, curve: T.COM, atrium: T.COM, court: T.COM,
            campus: T.COM, rotunda: T.COM, mall: T.COM, strip: T.COM,
            row: T.RES, perim: T.RES, towers: T.RES,
            shed: T.IND, plant: T.IND, yard: T.IND,
            green: T.PARK, pond: T.PARK, sport: T.PARK, plaza: T.PARK,
            school: T.SCHOOL, clinic: T.CLINIC, market: T.GROCERY,
            creche: T.CHILDCARE, social: T.TOWER,
            airport: T.PARK, stadium: T.PARK, depot: T.PARK, power: T.IND,
            solar: T.IND, wind: T.PARK, marina: T.PARK, port: T.IND,
            funfair: T.PARK, fire: T.PARK, police: T.PARK, hospital: T.CLINIC };
          const COLS = 6, STEP = 4;            // 3x3 lot + 1 road lane
          const X0 = 4, Y0 = 4;
          NAMES.forEach((nm, k) => {
            const bx = X0 + (k % COLS) * STEP, by = Y0 + ((k / COLS) | 0) * STEP;
            put(KIND[nm], bx, by, 3, 3);
            for (let d = 0; d < 4; d++) {      // ring the block with road
              put(T.ROAD, bx - 1, by - 1 + d, 1, 1);
              put(T.ROAD, bx + 3, by - 1 + d, 1, 1);
              put(T.ROAD, bx - 1 + d, by - 1, 1, 1);
              put(T.ROAD, bx - 1 + d, by + 3, 1, 1);
            }
          });
          for (let i = 0; i < s.grid.length; i++) if (MM.ZONES.indexOf(s.grid[i]) >= 0) s.level[i] = 4;
          s.rev = (s.rev | 0) + 1;
          s.speed = 0;
          MM.lots.plan(s);
          const byOrigin = {};
          MM.lots.lots.forEach(L => { byOrigin[L.x0 + ',' + L.y0] = L; });
          NAMES.forEach((nm, k) => {
            const bx = X0 + (k % COLS) * STEP, by = Y0 + ((k / COLS) | 0) * STEP;
            const L = byOrigin[bx + ',' + by];
            if (L) { L.arch = nm; L.lv = 4; }
          });
          s.day = 1; s.tick = 9; s.gameOver = false; s.pending = null;
          var hud = document.getElementById('hud');
          if (hud) hud.style.display = 'none';       // let the models fill the frame
          MM.renderer.centerOn(${AT ? AT[0] : 'X0 + 9'}, ${AT ? AT[1] : 'Y0 + 7'});
          ${('MM.renderer.zoomAt(720, 460, ' + (ZOOM < 0 ? -1 : 1) + ');').repeat(Math.abs(ZOOM))}
          for (let w = 0; w < 60; w++) MM.renderer.draw(s, 16);
          return 'showcase: ' + NAMES.length + ' archetypes, ' +
            MM.lots.lots.length + ' lots planned';
        }

        // road grid over a 26x22 district
        for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++) {
          if (y % 5 === 4 || x % 5 === 1) put(T.ROAD, x, y, 1, 1);
        }
        for (let y = 14; y < 36; y++) for (let x = 6; x < 32; x++) {
          const i = MM.idx(x, y);
          if (s.grid[i] !== T.EMPTY) continue;
          if (y >= 32 && x >= 24) put(T.IND, x, y, 1, 1);
          else if (x >= 20) put(T.COM, x, y, 1, 1);
          else put(T.RES, x, y, 1, 1);
        }
        [[9,17],[16,22],[24,18],[12,29],[22,31],[28,24]].forEach(p => put(T.PARK, p[0], p[1], 1, 1));
        [[13,16],[18,27],[26,21]].forEach(p => put(T.BUS, p[0], p[1], 1, 1));
        put(T.GROCERY, 11, 22, 1, 1); put(T.GROCERY, 21, 28, 1, 1);
        put(T.SCHOOL, 14, 33, 1, 1);  put(T.SCHOOL, 23, 16, 1, 1);
        put(T.CLINIC, 17, 19, 1, 1);  put(T.CHILDCARE, 9, 26, 1, 1);
        put(T.TOWER, 8, 21, 2, 2);
        s.treasury = 90000;

        for (let d = 0; d < 70 * MM.TICKS_PER_DAY; d++) { MM.sim.step(s); s.pending = null; }
        ${HOUR >= 0 ? 's.tick = Math.floor(s.tick / MM.TICKS_PER_DAY) * MM.TICKS_PER_DAY + ' + HOUR + ';' : ''}
        s.speed = 0;
        MM.renderer.centerOn(19, 25);
        ${('MM.renderer.zoomAt(720, 460, ' + (ZOOM < 0 ? -1 : 1) + ');').repeat(Math.abs(ZOOM))}
        // The phase lerps toward the target over ~50 frames; timing before it
        // settles measures the dawn transition, not steady state.
        for (var w = 0; w < 150; w++) MM.renderer.draw(s, 16);
        var t0 = performance.now();
        for (var f = 0; f < 60; f++) MM.renderer.draw(s, 16);
        var ms = (performance.now() - t0) / 60;
        // and the cost of a full static rebuild - what a build click pays for
        var t1 = performance.now();
        for (var g2 = 0; g2 < 8; g2++) { MM.renderer._cacheKey = 'x' + g2; MM.renderer.draw(s, 16); }
        var rb = (performance.now() - t1) / 8;

        return 'ok pop=' + Math.round(s.pop) + ' jobs=' + s.jobs +
               ' $' + Math.round(s.treasury) + ' appr=' + Math.round(s.approval) +
               ' | draw ' + ms.toFixed(2) + 'ms/frame (' + Math.round(1000 / ms) +
               ' fps headroom) | rebuild ' + rb.toFixed(1) + 'ms';
      } catch (e) { return 'THREW: ' + e.message + '\\n' + e.stack; }
    })();
  `).catch(e => 'REJECTED: ' + e.message);
  console.log('  page: ' + err);

  const logs = [];
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) logs.push(msg); });

  await new Promise(r => setTimeout(r, 2500));   // let a few frames land
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('  wrote ' + OUT);
  if (logs.length) console.log('  console errors:\n' + logs.map(l => '    ' + l).join('\n'));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
setTimeout(() => { console.error('  TIMEOUT'); process.exit(1); }, 60000);
