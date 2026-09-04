/* Wiring layer. Owned by lead. Module agents must NOT edit this file. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  const canvas = document.getElementById('city');
  const hud = document.getElementById('hud');

  const state = MM.loadState() || MM.createState();
  const renderer = new MM.Renderer(canvas);
  renderer.resize();
  renderer.centerOn(MM.GRID * 0.28, MM.GRID * 0.46);

  const ui = new MM.UI(hud, state, {
    onSelect: function (tile) { state.selected = tile; MM.audio.play('ui'); },
    onPolicy: function (id) {
      const r = MM.togglePolicy(state, id);
      MM.audio.play(r && r.ok === false ? 'error' : 'coin');
      if (r && r.msg) ui.toast(r.msg, r.ok === false ? 'bad' : 'good');
    },
    onSpeed: function (n) { state.speed = n; MM.audio.play('ui'); },
    onOverlay: function (name) { renderer.overlay = name; MM.audio.play('ui'); },
    onTax: function (kind, val) { state.taxRate[kind] = val; },
    onSave: function () { ui.toast(MM.saveState(state) ? 'City saved.' : 'Save failed.', MM.saveState(state) ? 'good' : 'bad'); },
    onReset: function () { MM.clearSave(); location.reload(); },
    onMute: function () { MM.audio.setMuted(!MM.audio.muted); ui.setMuted(MM.audio.muted); }
  });

  // ---- input ------------------------------------------------------------
  let painting = false, panning = false, lastX = 0, lastY = 0, movedWhilePanning = false;

  function place (px, py) {
    if (state.pending || state.gameOver) return;
    const t = renderer.screenToTile(px, py);
    if (!t) return;
    const res = MM.build(state, t.x, t.y, state.selected);
    if (res.ok) MM.audio.play(state.selected === MM.TILE.BULLDOZE ? 'bulldoze' : 'place');
    else if (res.msg) { MM.audio.play('error'); ui.toast(res.msg, 'bad'); }
  }

  canvas.addEventListener('mousedown', function (e) {
    if (e.button === 0) { painting = true; place(e.clientX, e.clientY); }
    else { panning = true; movedWhilePanning = false; }
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('mousemove', function (e) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    renderer.hover = renderer.screenToTile(e.clientX, e.clientY);
    if (panning) { movedWhilePanning = movedWhilePanning || Math.abs(dx) + Math.abs(dy) > 2; renderer.panBy(dx, dy); }
    else if (painting) place(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function () { painting = false; panning = false; });
  canvas.addEventListener('mouseleave', function () { painting = false; panning = false; renderer.hover = null; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  const keyToTile = {};
  MM.BUILDABLE.forEach(function (t) { keyToTile[MM.TILE_INFO[t].key] = t; });

  window.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (keyToTile[k] !== undefined) { state.selected = keyToTile[k]; ui.update(state); MM.audio.play('ui'); return; }
    if (k === ' ') { e.preventDefault(); state.speed = state.speed === 0 ? 1 : 0; ui.update(state); MM.audio.play('ui'); return; }
    if (k === '+' || k === '=') { state.speed = Math.min(3, state.speed + 1); MM.audio.play('ui'); return; }
    if (k === '-') { state.speed = Math.max(0, state.speed - 1); MM.audio.play('ui'); return; }
    if (k === 'm') { MM.audio.setMuted(!MM.audio.muted); ui.setMuted(MM.audio.muted); return; }
    const pan = { arrowleft: [60, 0], arrowright: [-60, 0], arrowup: [0, 60], arrowdown: [0, -60] }[k];
    if (pan) { e.preventDefault(); renderer.panBy(pan[0], pan[1]); }
  });

  window.addEventListener('resize', function () { renderer.resize(); });

  // ---- build / bulldoze -------------------------------------------------
  function build (s, x, y, tile) {
    if (!MM.inBounds(x, y)) return { ok: false };
    const i = MM.idx(x, y);
    const cur = s.grid[i];
    if (cur === MM.TILE.WATER) return { ok: false, msg: 'That is the East River, Mr. Mayor.' };

    if (tile === MM.TILE.BULLDOZE) {
      if (cur === MM.TILE.EMPTY) return { ok: false };
      if (s.treasury < MM.TILE_INFO[MM.TILE.BULLDOZE].cost) return { ok: false, msg: 'No budget left to demolish.' };
      s.treasury -= MM.TILE_INFO[MM.TILE.BULLDOZE].cost;
      s.grid[i] = MM.TILE.EMPTY; s.level[i] = 0;
      s.rev = (s.rev || 0) + 1;          // invalidates the renderer's static cache
      return { ok: true };
    }
    if (cur === tile) return { ok: false };
    const info = MM.TILE_INFO[tile];
    if (s.treasury < info.cost) return { ok: false, msg: 'Treasury is empty. Tax the rich or cut a program.' };
    s.treasury -= info.cost;
    s.grid[i] = tile;
    s.level[i] = MM.ZONES.indexOf(tile) >= 0 ? 1 : 0;
    s.rev = (s.rev || 0) + 1;            // invalidates the renderer's static cache
    return { ok: true };
  }
  MM.build = build;

  // ---- main loop --------------------------------------------------------
  const TICK_MS = 420;                       // one game hour at speed 1
  const SPEED_MULT = [0, 1, 3, 8];
  let acc = 0, last = performance.now(), autosave = 0;

  function frame (now) {
    let dt = now - last; last = now;
    if (dt > 250) dt = 250;                   // don't fast-forward after a stall

    if (!state.pending && !state.gameOver && state.speed > 0) {
      acc += dt * SPEED_MULT[state.speed];
      while (acc >= TICK_MS) { acc -= TICK_MS; MM.sim.step(state); }
    } else { acc = 0; }

    if (state.pending && !ui.eventOpen) {
      const evt = state.pending;
      MM.audio.play('event');
      ui.showEvent(evt, function (choice) {
        if (choice && choice.apply) choice.apply(state);
        MM.log(state, evt.title + ' - ' + (choice ? choice.label : 'ignored'), 'event');
        state.pending = null;
      });
    }

    renderer.draw(state, dt);
    ui.update(state);

    autosave += dt;
    if (autosave > 20000) { autosave = 0; MM.saveState(state); }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('beforeunload', function () { MM.saveState(state); });

  MM.state = state; MM.renderer = renderer; MM.ui = ui;  // handy in devtools
})(window.MM);
