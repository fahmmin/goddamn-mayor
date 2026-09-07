/* Honest frame-cost profiler.
   Run: npx electron tools/perf.js  [--json]

   Three things make a naive canvas benchmark lie, and all three cost a lot of
   time to rediscover, so they are written down here.

   1. Canvas2D is QUEUED. A draw call returns long before the GPU process has
      done the work, so timing `R.draw()` on its own measures almost nothing -
      and then reports a four-second frame when the queue finally stalls. Every
      measurement here brackets a block of frames with getImageData(), which
      forces the pipeline to drain inside the timer.
   2. But the drain is NOT free, and on a nine-megapixel cache it costs more
      than a frame does. Drain once per block, never per frame, or every frame
      reads as a stall and the numbers are meaningless in the other direction.
   3. requestAnimationFrame is not the way out. Chromium throttles it to ~1Hz
      in any window it decides is covered, which silently turns every result
      into 1004ms.

   And the machine is noisy: blocks are timed repeatedly and the MEDIAN block
   is reported, never the mean, so one scheduler hiccup is not the headline.

   The static-city cache makes an A/B of a still frame nearly meaningless, so
   the scenarios are the ones that actually cost a player something: a lit day,
   a lit night, a drag right across the city, a wheel burst, and the two things
   that dirty the cache during normal play - placing tiles, and blocks levelling
   up on their own.                                                          */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const JSON_OUT = process.argv.includes('--json');

// Frames are driven by hand here, never by the display, so nothing should
// wait on a vblank.
app.commandLine.appendSwitch('disable-gpu-vsync');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 920, show: false,
    backgroundColor: '#0a0e18',
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));

  const out = await win.webContents.executeJavaScript(`
    (async function () {
      const s = MM.state, T = MM.TILE, R = MM.renderer;
      try { localStorage.clear(); } catch (e) {}

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

      const ctx = R.ctx;
      function flush () { ctx.getImageData(0, 0, 1, 1); }

      // Pin the clock. _daynight eases towards the tick, so hold the tick and
      // spin until the phase has actually arrived; otherwise "day" and "night"
      // drift between runs and nothing is comparable.
      function setHour (h) {
        s.tick = h;
        for (let i = 0; i < 90; i++) R.draw(s, 400);   // big dt: the ease converges fast
        for (let i = 0; i < 20; i++) R.draw(s, 16);
      }

      // One block = M frames, drained. Repeat, report the median block.
      function block (M, before) {
        flush();
        const t0 = performance.now();
        for (let f = 0; f < M; f++) { if (before) before(f); R.draw(s, 16); }
        flush();
        return (performance.now() - t0) / M;
      }
      // Pan scenarios walk the camera, so every block starts from the same
      // place: otherwise the later blocks are timing an empty sky.
      function scenario (M, blocks, before) {
        const v = [];
        const home = () => { R.centerOn(19, 25); R.draw(s, 16); };
        home(); block(M, before);               // warm
        for (let b = 0; b < blocks; b++) { home(); v.push(block(M, before)); }
        v.sort((a, b) => a - b);
        home();
        return { med: v[v.length >> 1], best: v[0], worst: v[v.length - 1] };
      }

      /* Interaction cost, without requestAnimationFrame.
         rAF looked like the honest measure - real presented frames - but
         Chromium throttles it to 1Hz whenever it decides the window is
         covered, which silently turns every number into 1004ms. So: run the
         interaction in small blocks and drain the GPU once per block. The
         drain is amortised over the block instead of being paid per frame
         (where it costs more than the frame does), and a stall inside a block
         still shows up, because it is the block that gets slow.            */
      function interact (M, before) {
        R.centerOn(19, 25); R.draw(s, 16); flush();
        for (let i = 0; i < 4; i++) { if (before) before(-1 - i); R.draw(s, 16); }
        flush();
        const B = 5, blocks = [];
        const t0 = performance.now();
        for (let f = 0; f < M; f += B) {
          const a = performance.now();
          for (let i = 0; i < B && f + i < M; i++) { if (before) before(f + i); R.draw(s, 16); }
          flush();
          blocks.push((performance.now() - a) / B);
        }
        const total = performance.now() - t0;
        const sorted = blocks.slice().sort((a, b) => a - b);
        return { mean: total / M, med: sorted[sorted.length >> 1],
                 worst: sorted[sorted.length - 1], total: total, n: M,
                 bad: blocks.filter(v => v > 33).length, nb: blocks.length };
      }

      const rows = [], data = {};
      function report (label, r) {
        data[label] = r.med;
        rows.push(label.padEnd(18) + r.med.toFixed(2).padStart(7) + ' ms/frame  (' +
          (1000 / r.med).toFixed(0).padStart(3) + ' fps)   best ' + r.best.toFixed(2) +
          '  worst ' + r.worst.toFixed(2));
      }

      setHour(12);
      report('idle noon',  scenario(24, 5, null));
      report('pan noon',   scenario(24, 5, () => R.panBy(7, 4)));
      setHour(0);
      report('idle midnight', scenario(24, 5, null));
      report('pan midnight',  scenario(24, 5, () => R.panBy(7, 4)));
      setHour(6);
      report('idle dawn',  scenario(24, 5, null));

      // ---- interaction, measured as presented frames ----------------
      setHour(12);
      R.scale = 1; R.centerOn(19, 25); R.draw(s, 16);
      rows.push('');
      rows.push('--- interaction: mean cost, and the worst run of 5 frames ---');
      function inter (label, r) {
        data[label] = r.mean; data[label + ' worst'] = r.worst;
        rows.push(label.padEnd(18) + r.mean.toFixed(1).padStart(6) + ' ms/frame' +
          r.worst.toFixed(1).padStart(9) + ' ms worst 5-frame block   ' +
          r.total.toFixed(0).padStart(6) + ' ms for ' + r.n + ' frames' +
          (r.bad ? '   (' + r.bad + '/' + r.nb + ' blocks stalled)' : ''));
      }
      // a drag right across the city: 160 frames at 8px is 1280px
      const buildStep = f => {
        if (f < 0) return;
        const i = MM.idx(14 + (f % 9), 22 + ((f / 9) | 0));
        s.grid[i] = f % 2 ? MM.TILE.PARK : MM.TILE.RES;
        s.level[i] = 1; s.rev = (s.rev | 0) + 1;
      };
      // Camera first, on a settled city - a build left half-finished in the
      // cache would show up as the drag's problem instead of its own.
      inter('drag across', interact(160, () => R.panBy(8, 0)));
      R.scale = 1; R.centerOn(19, 25); R.draw(s, 16);
      inter('zoom in and out', interact(40, f => R.zoomAt(713, 377, (f % 20) < 10 ? 1 : -1)));
      R.scale = 1; R.centerOn(19, 25); R.draw(s, 16);
      // Then the two things that dirty the cache in normal play. The first
      // pass over untouched ground regroups lots over a wide area and costs
      // several times what the same edits cost once the district has settled,
      // so both are worth seeing.
      inter('build (new ground)', interact(40, buildStep));
      inter('build (settled)', interact(40, buildStep));
      // and blocks levelling up on their own, which sim.js does constantly
      inter('blocks level up', interact(40, f => {
        if (f < 0) return;
        const i = MM.idx(9 + (f % 11), 17 + ((f / 11) | 0));
        if (MM.ZONES.indexOf(s.grid[i]) >= 0) s.level[i] = 1 + (f % 4);
        s.rev = (s.rev | 0) + 1;
      }));
      rows.push('');

      // How much does walking off the cache margin cost, on its own?
      setHour(12);
      R.centerOn(19, 25); R.draw(s, 16);
      const rs = [];
      for (let b = 0; b < 5; b++) { flush(); const a = performance.now();
        for (let i = 0; i < 4; i++) R._renderStatic(s); flush();
        rs.push((performance.now() - a) / 4); }
      rs.sort((a, b) => a - b);
      data['static rebuild'] = rs[2];
      rows.push('static rebuild'.padEnd(18) + rs[2].toFixed(2).padStart(7) + ' ms each');

      // ...and how much of the city does one buy? All of it means a pan
      // never triggers another. (Guarded: this tool is also run against
      // older builds whose cache was a fixed margin round the viewport.)
      if (typeof R._cityBox === 'function') {
        const box = R._cityBox();
        const whole = (R._covR - R._covL) >= (box.r - box.l) - 1 &&
                      (R._covB - R._covT) >= (box.b - box.t) - 1;
        data['whole city cached'] = whole ? 1 : 0;
        rows.push('cache holds'.padEnd(18) + (whole
          ? '    the whole city  -> a pan never rebuilds'
          : '    ' + Math.round(R._covR - R._covL) + 'x' + Math.round(R._covB - R._covT) +
            ' css px of a ' + Math.round(box.r - box.l) + 'x' + Math.round(box.b - box.t) + ' city'));
      } else {
        rows.push('cache holds'.padEnd(18) + '    the viewport + a 192px margin' +
          '  -> a rebuild every 23 frames of an 8px/frame drag');
      }

      const px = (R.canvas.width * R.canvas.height / 1e6);
      data['live Mpx'] = +px.toFixed(2);
      rows.push('');
      rows.push('viewport ' + Math.round(R.w) + 'x' + Math.round(R.h) + ' css, ' +
        R.canvas.width + 'x' + R.canvas.height + ' device (' + px.toFixed(2) + ' Mpx), dpr ' +
        (R.dpr || 1).toFixed(2) + ', scale ' + R.scale.toFixed(2) +
        ', ' + (R._nAll || 0) + ' visible tiles');
      rows.push('cache    ' + R._cc.width + 'x' + R._cc.height + ' (' +
        (R._cc.width * R._cc.height / 1e6).toFixed(2) + ' Mpx)');
      // Chromium keeps 2D canvases on the GPU only up to a memory budget and
      // drops the lot to software past it, at about 10x the cost. This is the
      // number that decides whether any of the above is fast.
      const mpx = (R._cc.width * R._cc.height + R._lc.width * R._lc.height +
        R._shc.width * R._shc.height + (R._shb ? R._shb.width * R._shb.height : 0) +
        R.canvas.width * R.canvas.height) / 1e6;
      data['canvas MB'] = +(mpx * 4).toFixed(0);
      rows.push('canvas   ' + mpx.toFixed(1) + ' Mpx total = ' + (mpx * 4).toFixed(0) + ' MB');

      return ${JSON_OUT ? 'JSON.stringify(data)' : "rows.join('\\n')"};
    })();
  `);
  console.log(JSON_OUT ? out : '\n' + out + '\n');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 900000);
