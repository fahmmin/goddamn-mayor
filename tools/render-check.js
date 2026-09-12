/* Two renderer invariants that are cheap to state and expensive to notice
   breaking, because both failures look like "the city is a bit odd at night"
   rather than like an error.

     1. every actor in sky.js is placed in the city, not in the window
     2. a lit window never shows through the building in front of it

   Run: npx electron tools/render-check.js
   Needs a real canvas, so it runs in Chromium rather than in node.          */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

async function checkInBrowser () {
  const checks = [];
  function need (condition, name) { if (!condition) throw new Error(name); checks.push(name); }
  if (MM.shell && MM.shell.open) MM.shell.play();
  const s = MM.state, r = MM.renderer;
  s.speed = 0; r.draw(s, 16);                       // establish the light

  // ---- 1. the sky belongs to the city -------------------------------------
  // Every actor in sky.js is placed in tile space plus an altitude, so panning
  // the camera must translate the whole layer by exactly the pan. An aircraft
  // left in screen space hangs still while the rooftops slide under it.
  let drift = 0;
  {
    const shift = 40, w = 640, h = 420, inset = 30;
    for (const clock of [87000, 640000, 1550000, 2900000]) {
      const pair = [0, shift].map(dx => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        MM.sky.draw(c.getContext('2d'), { s, clock, ox: 520 - dx, oy: 300,
          scale: 0.9, w, h, L: 1, N: 0, golden: 0 });
        return c.getContext('2d', { willReadFrequently: true })
          .getImageData(inset + (dx ? 0 : shift), inset, w - shift - inset * 2, h - inset * 2).data;
      });
      let moved = 0;
      for (let i = 3; i < pair[0].length; i += 4) if (Math.abs(pair[0][i] - pair[1][i]) > 8) moved++;
      if (moved > drift) drift = moved;
    }
    need(drift < 60, 'Sky actors pan with the city, not with the window');
  }

  // ---- 2. window lights respect what is in front of them ------------------
  // The light layer carries no walls of its own, so _paintWindows paints back
  // to front and every lot punches out what sits behind it. Two towers, one
  // squarely behind the other, are the whole test: the probe sits in the near
  // tower's blank strip between its top window row and its roofline, which is
  // exactly where a far building bleeds through (a far building is always
  // up-screen, so it can never reach the near tower's skirt).
  {
    const NX = 20, NY = 20, TN = 300, TF = 400;
    const keep = ['ctx', 'w', 'h', 'ox', 'oy', 'scale', '_lit', '_litN', '_litKey', '_clipR']
      .reduce((o, k) => (o[k] = r[k], o), {});
    function strip (lots) {
      const c = document.createElement('canvas'); c.width = 600; c.height = 520;
      const g = c.getContext('2d', { willReadFrequently: true });
      Object.assign(r, { ctx: g, w: c.width, h: c.height, scale: 1, _clipR: null,
        ox: 300, oy: 460 - (NX + NY) * 16,          // near tower's base lands at y 460
        _lit: new Float32Array(lots), _litN: lots.length,
        _litKey: (s.rev | 0) + '|' + MM.lots.lots.length });
      try { r._paintWindows(s); } finally { Object.assign(r, keep); }
      const band = g.getImageData(300, 169, 32, 16).data;
      let n = 0;
      for (let i = 3; i < band.length; i += 4) if (band[i] > 40) n++;
      return n;
    }
    const far = [NX - 2, NY - 2, 1, 1, TF];
    // positive control: without this, an empty strip would prove nothing
    need(strip(far) > 0, 'The tower behind does light that strip on its own');
    need(strip(far.concat([NX, NY, 1, 1, TN])) === 0,
      'A lit window never shows through the tower in front of it');
  }

  // ---- 3. trains stay on the track ---------------------------------------
  // _railDir picks a way out at every junction and reverses the consist at a
  // dead end. Both are easy to get subtly wrong in a way that does not throw:
  // the train simply walks off across the city and looks like a bug in the
  // drawing. Run a loop with a spur so junctions and a buffer stop both fire.
  {
    const T = MM.TILE;
    const s2 = MM.createState();
    const put = (x, y, t) => { s2.grid[MM.idx(x, y)] = t; };
    for (let x = 10; x <= 20; x++) { put(x, 10, T.RAIL); put(x, 18, T.RAIL); }
    for (let y = 10; y <= 18; y++) { put(10, y, T.RAIL); put(20, y, T.RAIL); }
    for (let y = 4; y < 10; y++) put(15, y, T.RAIL);        // spur to a dead end
    put(15, 10, T.STATION);
    s2.rev = 1;
    const keep = { k: r._railKey, n: r._railNet, t: r._trn };
    r._railKey = ''; r._trn = null;
    let off = 0, seen = 0, moved = 0, x0 = -1;
    for (let i = 0; i < 800; i++) {
      r._trains(s2, 120);
      for (const v of r._trn) {
        const t = s2.grid[MM.idx(v.x, v.y)];
        if (t !== T.RAIL && t !== T.STATION) off++;
        if (x0 < 0) x0 = v.x; else if (v.x !== x0) moved++;
        seen++;
      }
    }
    r._railKey = keep.k; r._railNet = keep.n; r._trn = keep.t;
    need(seen > 100 && moved > 0, 'Trains run, and run along a laid line');
    need(off === 0, 'A train never leaves the track');
  }

  return { checks, skyDrift: drift };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(path.join(__dirname, '..', 'index.html'), { query: { diorama: '' } });
    const out = await win.webContents.executeJavaScript('(' + checkInBrowser.toString() + ')()');
    console.log(out.checks.map(c => '  ok  ' + c).join('\n'));
    console.log('\n  ' + out.checks.length + ' checks passed  (sky drift ' + out.skyDrift + 'px)');
    app.exit(0);
  } catch (e) { console.error('\n  FAILED: ' + (e.message || e)); app.exit(1); }
});
