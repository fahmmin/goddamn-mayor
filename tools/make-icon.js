/* Generates build/icon.ico from scratch — no dependencies, no image files.
   Software-rasterises an isometric skyline, encodes PNG by hand, wraps it in
   an ICO container (Vista+ PNG-in-ICO). Run: node tools/make-icon.js         */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'build');

// --- tiny RGBA canvas ------------------------------------------------------
function Surface (w, h) {
  this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4);
}
Surface.prototype.blend = function (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
  const i = (y * this.w + x) * 4, p = this.px;
  const sa = a, da = p[i + 3] / 255, out = sa + da * (1 - sa);
  if (out <= 0) return;
  p[i]     = (r * sa + p[i]     * da * (1 - sa)) / out;
  p[i + 1] = (g * sa + p[i + 1] * da * (1 - sa)) / out;
  p[i + 2] = (b * sa + p[i + 2] * da * (1 - sa)) / out;
  p[i + 3] = out * 255;
};
// 3x3 supersampled convex-polygon fill — cheap antialiasing, no libraries
Surface.prototype.poly = function (pts, col) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
  }
  const S = 3, inv = 1 / (S * S);
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(this.w - 1, Math.ceil(maxX)); x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        if (inside(pts, x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++;
      }
      if (hits) this.blend(x, y, col[0], col[1], col[2], (col[3] === undefined ? 1 : col[3]) * hits * inv);
    }
  }
};
function inside (pts, px, py) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
Surface.prototype.roundRect = function (x, y, w, h, r, col) {
  const S = 3, inv = 1 / (S * S);
  for (let py = Math.max(0, y | 0); py < Math.min(this.h, y + h); py++) {
    for (let px = Math.max(0, x | 0); px < Math.min(this.w, x + w); px++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const ax = px + (sx + 0.5) / S, ay = py + (sy + 0.5) / S;
        const cx = Math.min(Math.max(ax, x + r), x + w - r);
        const cy = Math.min(Math.max(ay, y + r), y + h - r);
        if ((ax - cx) ** 2 + (ay - cy) ** 2 <= r * r) hits++;
      }
      if (hits) this.blend(px, py, col[0], col[1], col[2], (col[3] === undefined ? 1 : col[3]) * hits * inv);
    }
  }
};

// --- the artwork -----------------------------------------------------------
function draw (N) {
  const s = new Surface(N, N);
  const u = N / 256;                                     // design at 256, scale down

  // dark rounded plate with a vertical dusk gradient
  s.roundRect(0, 0, N, N, 56 * u, [10, 14, 24, 1]);
  for (let y = 0; y < N; y++) {
    const t = y / N;
    const a = 0.30 * (1 - t) + 0.05;
    for (let x = 0; x < N; x++) {
      if (s.px[(y * N + x) * 4 + 3] > 8) s.blend(x, y, 38, 52, 92, a * 0.55);
    }
  }

  // isometric block: top face + two side faces
  const TW = 62 * u, TH = 31 * u;
  function block (gx, gy, hgt, top, left, right, lit) {
    const ox = N / 2, oy = N * 0.585;
    const sx = ox + (gx - gy) * TW / 2;
    const sy = oy + (gx + gy) * TH / 2;
    const h = hgt * u;
    s.poly([[sx - TW / 2, sy + TH / 2 - h], [sx, sy - h], [sx + TW / 2, sy + TH / 2 - h], [sx, sy + TH - h]], top);
    s.poly([[sx - TW / 2, sy + TH / 2 - h], [sx, sy + TH - h], [sx, sy + TH], [sx - TW / 2, sy + TH / 2]], left);
    s.poly([[sx + TW / 2, sy + TH / 2 - h], [sx, sy + TH - h], [sx, sy + TH], [sx + TW / 2, sy + TH / 2]], right);
    if (!lit) return;
    const ww = 4 * u, wh = 5 * u;                        // lit windows on both faces
    for (let r = 0; r < Math.floor(hgt / 16); r++) {
      for (let c = 0; c < 2; c++) {
        const wy = sy + TH / 2 - h + 12 * u + r * 15 * u;
        if (((r * 7 + c * 13 + gx * 5 + gy * 3) % 5) < 3) {
          s.poly([[sx - TW / 2 + (7 + c * 13) * u, wy + (7 + c * 6) * u],
            [sx - TW / 2 + (7 + c * 13) * u + ww, wy + (7 + c * 6) * u + ww / 2],
            [sx - TW / 2 + (7 + c * 13) * u + ww, wy + (7 + c * 6) * u + ww / 2 + wh],
            [sx - TW / 2 + (7 + c * 13) * u, wy + (7 + c * 6) * u + wh]], lit);
        }
        if (((r * 11 + c * 5 + gx * 3 + gy * 7) % 5) < 2) {
          s.poly([[sx + TW / 2 - (7 + c * 13) * u - ww, wy + (7 + c * 6) * u + ww / 2],
            [sx + TW / 2 - (7 + c * 13) * u, wy + (7 + c * 6) * u],
            [sx + TW / 2 - (7 + c * 13) * u, wy + (7 + c * 6) * u + wh],
            [sx + TW / 2 - (7 + c * 13) * u - ww, wy + (7 + c * 6) * u + ww / 2 + wh]], lit);
        }
      }
    }
  }

  const amberT = [240, 178, 88, 1], amberL = [176, 116, 46, 1], amberR = [130, 82, 30, 1];
  const cyanT  = [ 96, 214, 232, 1], cyanL  = [ 44, 140, 162, 1], cyanR  = [ 26,  96, 116, 1];
  const slateT = [104, 126, 168, 1], slateL = [ 56,  72, 108, 1], slateR = [ 38,  50,  80, 1];
  const win    = [255, 236, 176, 0.95];

  // painter's algorithm: farthest (smallest gx+gy) first, or blocks punch
  // through the ones in front of them
  [
    [-1, -1, 30, slateT, slateL, slateR],
    [ 0, -1, 46, cyanT,  cyanL,  cyanR ],
    [-1,  0, 38, cyanT,  cyanL,  cyanR ],
    [ 0,  0, 78, amberT, amberL, amberR],                // the tower, front and centre
    [ 1,  0, 26, slateT, slateL, slateR],
    [ 0,  1, 34, slateT, slateL, slateR]
  ].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]))
    .forEach(b => block(b[0], b[1], b[2], b[3], b[4], b[5], win));

  return s;
}

// --- PNG encoder -----------------------------------------------------------
function crc32 (buf) {
  let c, t = crc32.t;
  if (!t) {
    t = crc32.t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk (type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png (surf) {
  const { w, h, px } = surf;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                            // filter: none
    Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- ICO container ---------------------------------------------------------
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map(n => png(draw(n)));
const head = Buffer.alloc(6 + 16 * SIZES.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
let offset = head.length;
SIZES.forEach((n, i) => {
  const e = 6 + i * 16;
  head[e] = n >= 256 ? 0 : n; head[e + 1] = n >= 256 ? 0 : n;
  head[e + 2] = 0; head[e + 3] = 0;
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, ...images]));
fs.writeFileSync(path.join(OUT, 'icon.png'), images[SIZES.indexOf(256)]);
console.log('wrote build/icon.ico (' + SIZES.join(', ') + ') and build/icon.png');
