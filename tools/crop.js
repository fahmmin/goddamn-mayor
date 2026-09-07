/* Crop/zoom a PNG for visual inspection, via Electron's nativeImage.
   Run: npx electron tools/crop.js in.png out.png x y w h [scale]        */
const { app, nativeImage } = require('electron');
const path = require('path'), fs = require('fs');
const A = process.argv.slice(2).filter(v => !v.startsWith('--'));
const IN = path.resolve(A[0]), OUT = path.resolve(A[1]);
const X = +A[2] || 0, Y = +A[3] || 0, W = +A[4] || 400, H = +A[5] || 300, S = +A[6] || 2;

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(IN);
  const sz = img.getSize();
  const cut = img.crop({ x: X, y: Y, width: Math.min(W, sz.width - X), height: Math.min(H, sz.height - Y) });
  const big = S === 1 ? cut : cut.resize({ width: Math.round(cut.getSize().width * S), quality: 'good' });
  fs.writeFileSync(OUT, big.toPNG());
  console.log('  source ' + sz.width + 'x' + sz.height + ' -> ' + OUT);
  app.quit();
});
