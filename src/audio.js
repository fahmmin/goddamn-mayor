/* src/audio.js - WebAudio synthesis. Owned by the audio agent. */
window.MM = window.MM || {};
(function (MM) {
  'use strict';

  var KEY = 'mamdani.muted';
  var MASTER = 0.22;      // master trim - everything is quiet by design
  var MAX_VOICES = 48;    // concurrent node-groups; levelup alone is 8, cheer 6
  var RATE_MAX = 8;       // same sound, max hits...
  var RATE_MS = 100;      // ...per this window (stops road-dragging machine-gun)
  var FADE = 0.08;        // mute ramp, long enough to avoid a click

  var ctx = null, master = null, busted = false;
  var voices = 0, hits = {}, noiseBuf = null, amb = null;
  var muted = false;

  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  // ---- context ----------------------------------------------------------
  // Never built at load time: Chromium would create it suspended and warn.
  function ac () {
    if (busted) return null;
    if (ctx) { resume(); return ctx; }
    try {
      var C = (typeof AudioContext !== 'undefined' && AudioContext) ||
              (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
      if (!C) { busted = true; return null; }
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
    } catch (e) { busted = true; ctx = null; master = null; return null; }
    resume();
    return ctx;
  }

  function resume () {
    try { if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) {}
  }

  // ---- plumbing ---------------------------------------------------------
  function rnd (cents) { return (Math.random() * 2 - 1) * cents; }

  // Stop + disconnect every node of a one-shot once it has rung out, so an
  // hour-long session does not leak hundreds of oscillators.
  function reap (nodes, endTime) {
    voices++;
    var ms = Math.max(0, (endTime - ctx.currentTime) * 1000) + 80;
    setTimeout(function () {
      voices--;
      for (var i = 0; i < nodes.length; i++) {
        try { if (nodes[i].stop) nodes[i].stop(); } catch (e) {}
        try { nodes[i].disconnect(); } catch (e) {}
      }
    }, ms);
  }

  function gainEnv (t0, peak, attack, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(master);
    return g;
  }

  function filt (type, freq, q) {
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  // One tone. o.glide bends the pitch toward that frequency over the decay.
  function tone (o) {
    var t0 = o.t, dur = o.dur, extra = [];
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t0 + dur * 0.7);
    try { osc.detune.setValueAtTime((o.det || 0) + rnd(4), t0); } catch (e) {}

    var g = gainEnv(t0, o.peak, o.attack == null ? 0.008 : o.attack, dur);
    var head = g;
    if (o.cut) { var f = filt('lowpass', o.cut, o.q); f.connect(g); head = f; extra.push(f); }
    osc.connect(head);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    reap([osc, g].concat(extra), t0 + dur + 0.03);
  }

  // Brown noise, generated once and reused by place / bulldoze / ambient.
  function noise () {
    if (noiseBuf) return noiseBuf;
    try {
      var len = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = b.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.2;
      }
      noiseBuf = b;
    } catch (e) { noiseBuf = null; }
    return noiseBuf;
  }

  function noiseHit (t0, dur, type, freq, q, peak, attack, sweepTo) {
    var buf = noise();
    if (!buf) return;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    var f = filt(type, freq, q);
    if (sweepTo) {
      f.frequency.setValueAtTime(freq, t0);          // anchor, or the ramp starts from "now"
      f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    }
    var g = gainEnv(t0, peak, attack, dur);
    src.connect(f); f.connect(g);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.03);
    reap([src, f, g], t0 + dur + 0.03);
  }

  // ---- the palette ------------------------------------------------------
  // Soft attacks, low-passed, short. These have to survive the 500th hearing
  // while someone is trying to concentrate on something else.
  var SOUNDS = {
    // soft woody click with a quick pitch drop
    place: function (t, d) {
      tone({ t: t, f: 430, glide: 186, dur: 0.09, peak: 0.42, attack: 0.004, type: 'triangle', cut: 1700, det: d });
      noiseHit(t, 0.035, 'bandpass', 1900, 1.1, 0.10, 0.002);
    },
    // short low-passed thud
    bulldoze: function (t, d) {
      noiseHit(t, 0.19, 'lowpass', 520, 0.9, 0.5, 0.006, 150);
      tone({ t: t, f: 108, glide: 62, dur: 0.16, peak: 0.28, attack: 0.005, type: 'sine', det: d });
    },
    // two-note major third, bright but gentle
    coin: function (t, d) {
      tone({ t: t, f: 880, dur: 0.075, peak: 0.20, attack: 0.005, type: 'triangle', cut: 4200, det: d });
      tone({ t: t + 0.055, f: 1108.7, dur: 0.11, peak: 0.17, attack: 0.005, type: 'triangle', cut: 4600, det: d });
    },
    // low buzz - clearly negative, never startling
    error: function (t, d) {
      tone({ t: t, f: 150, glide: 104, dur: 0.24, peak: 0.30, attack: 0.014, type: 'sawtooth', cut: 420, q: 0.7, det: d });
      tone({ t: t, f: 153, glide: 106, dur: 0.22, peak: 0.18, attack: 0.016, type: 'sine', det: d });
    },
    // 3-note rising motif - allowed to be a bit more present
    event: function (t, d) {
      var n = [523.25, 659.25, 783.99];
      for (var i = 0; i < 3; i++) {
        tone({ t: t + i * 0.085, f: n[i], dur: i === 2 ? 0.3 : 0.13, peak: 0.30,
               attack: 0.008, type: 'triangle', cut: 3000, det: d });
      }
    },
    // warm arpeggio
    levelup: function (t, d) {
      var n = [261.63, 329.63, 392.0, 523.25];
      for (var i = 0; i < 4; i++) {
        tone({ t: t + i * 0.075, f: n[i], dur: i === 3 ? 0.5 : 0.2, peak: 0.24,
               attack: 0.012, type: 'triangle', cut: 2200, det: d });
        tone({ t: t + i * 0.075, f: n[i] * 2, dur: 0.14, peak: 0.06, attack: 0.012, type: 'sine', det: d });
      }
    },
    // very quiet tick
    ui: function (t, d) {
      tone({ t: t, f: 1380, dur: 0.035, peak: 0.085, attack: 0.003, type: 'sine', det: d });
    },
    // mellow honk, two detuned sines
    bus: function (t, d) {
      tone({ t: t, f: 168, dur: 0.34, peak: 0.26, attack: 0.03, type: 'sine', cut: 900, det: d });
      tone({ t: t, f: 168, dur: 0.32, peak: 0.20, attack: 0.03, type: 'triangle', cut: 700, det: d + 11 });
    },
    // slow two-tone pulse
    alarm: function (t, d) {
      for (var i = 0; i < 2; i++) {
        tone({ t: t + i * 0.52, f: 622.25, dur: 0.24, peak: 0.26, attack: 0.02, type: 'sine', cut: 2400, det: d });
        tone({ t: t + i * 0.52 + 0.26, f: 466.16, dur: 0.24, peak: 0.26, attack: 0.02, type: 'sine', cut: 2400, det: d });
      }
    },
    // bright shimmer chord (Cmaj9)
    cheer: function (t, d) {
      var n = [523.25, 659.25, 783.99, 987.77, 1174.66];
      for (var i = 0; i < n.length; i++) {
        tone({ t: t + i * 0.035, f: n[i], dur: 0.55 + i * 0.06, peak: 0.13 - i * 0.012,
               attack: 0.02, type: 'sine', det: d + rnd(6) });
      }
      noiseHit(t + 0.02, 0.45, 'highpass', 3600, 0.7, 0.045, 0.12);
    }
  };

  // ---- api --------------------------------------------------------------
  function throttled (name) {
    var now = Date.now(), h = hits[name] || (hits[name] = []);
    while (h.length && now - h[0] > RATE_MS) h.shift();
    if (h.length >= RATE_MAX) return true;
    h.push(now);
    return false;
  }

  function play (name) {
    try {
      var fn = SOUNDS[name];
      if (!fn || muted) return;
      if (throttled(name)) return;
      if (voices >= MAX_VOICES) return;
      if (!ac()) return;
      fn(ctx.currentTime + 0.005, rnd(14));
    } catch (e) { /* silence beats breaking the game loop */ }
  }

  function setMuted (on) {
    muted = !!on;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
    try {
      if (!ctx || !master) return;
      resume();
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0.0001 : MASTER, t + FADE);
    } catch (e) {}
  }

  // Quiet city bed: filtered brown noise plus two slowly detuning low
  // oscillators, roughly -30dB against the effects.
  function ambient (on) {
    try {
      if (!on) {
        if (!amb || !ctx) return;
        var dying = amb; amb = null;
        var t = ctx.currentTime;
        try {
          dying.bus.gain.cancelScheduledValues(t);
          dying.bus.gain.setValueAtTime(dying.bus.gain.value, t);
          dying.bus.gain.linearRampToValueAtTime(0.0001, t + 1);
        } catch (e) {}
        setTimeout(function () {
          for (var i = 0; i < dying.nodes.length; i++) {
            try { if (dying.nodes[i].stop) dying.nodes[i].stop(); } catch (e2) {}
            try { dying.nodes[i].disconnect(); } catch (e2) {}
          }
        }, 1150);
        return;
      }

      if (amb || !ac()) return;
      var buf = noise();
      if (!buf) return;
      var t0 = ctx.currentTime, nodes = [];

      var bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, t0);
      bus.gain.linearRampToValueAtTime(0.05, t0 + 2.5);
      bus.connect(master);
      nodes.push(bus);

      var src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = 0.55;
      var nf = filt('lowpass', 320, 0.6);
      var ng = ctx.createGain(); ng.gain.value = 0.3;
      src.connect(nf); nf.connect(ng); ng.connect(bus);
      src.start(t0);
      nodes.push(src, nf, ng);

      [55, 82.4].forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        var g = ctx.createGain(); g.gain.value = 0.15;
        var lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.04 + Math.random() * 0.05;
        var lg = ctx.createGain(); lg.gain.value = 9;   // +/- 9 cents, very slow
        lfo.connect(lg);
        try { lg.connect(o.detune); } catch (e) {}
        o.connect(g); g.connect(bus);
        o.start(t0); lfo.start(t0);
        nodes.push(o, g, lfo, lg);
      });

      amb = { bus: bus, nodes: nodes };
    } catch (e) {}
  }

  var audio = { play: play, setMuted: setMuted, ambient: ambient };
  Object.defineProperty(audio, 'muted', { get: function () { return muted; }, enumerable: true });

  MM.audio = audio;
})(window.MM);
