/* Surface detail is baked into the existing city cache, never shaded per frame.
   A tiny WebGL material atlas is generated once, copied to Canvas2D, then its
   GPU resources are released. Canvas-only browsers get a deterministic fallback. */
window.MM = window.MM || {};
(function (MM) { 'use strict';
  var G = MM.gfx, SIZE = 128, atlas = null, patterns = new WeakMap();
  var profiles = {
    eco: { dpr: 1, pixels: 6e6, vehicles: 40, people: 35, detail: false },
    balanced: { dpr: 1.5, pixels: 10e6, vehicles: 64, people: 90, detail: true },
    high: { dpr: 2, pixels: 10e6, vehicles: 80, people: 150, detail: true }
  };
  var quality = 'balanced';
  try { var saved = localStorage.getItem('mamdani.graphics.v1'); if (profiles[saved]) quality = saved; } catch (e) {}
  function setQuality (name) {
    if (!profiles[name]) return;
    quality = name;
    try { localStorage.setItem('mamdani.graphics.v1', name); } catch (e) {}
  }
  function canvas (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function makeAtlas () {
    if (atlas) return atlas;
    atlas = [];
    var noise = canvas(64, 64), nc = noise.getContext('2d');
    for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) {
      var v = (G.hash(x, y, 781) * 255) | 0;
      nc.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; nc.fillRect(x, y, 1, 1);
    }
    var gpu = canvas(SIZE * 3, SIZE), gl = null, shaders = [], program, buffer, texture;
    try {
      gl = gpu.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl || !gl.createShader) throw new Error('Canvas fallback');
      function compile (kind, source) {
        var s = gl.createShader(kind); shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Material shader compilation');
        return s;
      }
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, [
        'precision mediump float;',
        'uniform sampler2D grain;',
        'void main(){',
        ' vec2 p=gl_FragCoord.xy; float kind=floor(p.x/128.); p.x=mod(p.x,128.);',
        ' float n=texture2D(grain,mod(p,64.)/64.).r;',
        ' float broad=texture2D(grain,mod(floor(p/8.),64.)/64.).r;',
        ' float a=.025+n*.10; float tone=step(.54,n);',
        ' if(kind<.5){',
        '   float row=floor(p.y/4.); vec2 brick=mod(p+vec2(mod(row,2.)*5.,0.),vec2(10.,4.));',
        '   float mortar=1.-step(.55,min(brick.x,brick.y));',
        '   a+=mortar*.17; tone=mix(tone,.14,mortar);',
        ' } else if(kind>1.5){',
        '   float streak=pow(.5+.5*sin((p.x+p.y*.28)*.095),12.);',
        '   tone=streak; a=.035+streak*.19+broad*.045;',
        ' } else { a+=broad*.025; }',
        ' gl_FragColor=vec4(vec3(tone)*a,a);',
        '}'
      ].join('\n')));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Material shader link');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, noise);
      gl.viewport(0, 0, gpu.width, gpu.height); gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('Material atlas unavailable');
      for (var i = 0; i < 3; i++) {
        var c = canvas(SIZE, SIZE); c.getContext('2d').drawImage(gpu, i * SIZE, 0, SIZE, SIZE, 0, 0, SIZE, SIZE); atlas.push(c);
      }
      MM.materials.backend = 'webgl';
    } catch (e) {
      atlas = [];
      for (var k = 0; k < 3; k++) {
        var tile = canvas(SIZE, SIZE), ctx = tile.getContext('2d');
        for (y = 0; y < SIZE; y += 2) for (x = 0; x < SIZE; x += 2) {
          var h = G.hash(x, y, 781), mortar = k === 0 && (y % 4 === 0 || (x + (y % 8 < 4 ? 0 : 5)) % 10 === 0);
          ctx.fillStyle = h > 0.54 && !mortar ? 'rgba(255,255,255,.08)' : 'rgba(12,22,26,' + (mortar ? '.15)' : '.06)');
          ctx.fillRect(x, y, 2, 2);
        }
        atlas.push(tile);
      }
      MM.materials.backend = 'canvas';
    } finally {
      if (gl && gl.deleteShader) {
        shaders.forEach(function (s) { gl.deleteShader(s); });
        if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer); if (texture) gl.deleteTexture(texture);
        var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
      gpu.width = gpu.height = noise.width = noise.height = 1;
    }
    return atlas;
  }

  // Fill the current path. Texture transforms follow the wall/ground plane;
  // there is no readback, clipping canvas, or screen-sized postprocess pass.
  function surface (ctx, kind, a, b, c, d, x, y) {
    if (!profiles[quality].detail || typeof DOMMatrix === 'undefined') return;
    var list = patterns.get(ctx);
    if (!list) {
      list = makeAtlas().map(function (tile) { return ctx.createPattern(tile, 'repeat'); }); patterns.set(ctx, list);
    }
    var p = list[kind]; if (!p || !p.setTransform) return;
    p.setTransform(new DOMMatrix([a, b, c, d, x, y]));
    ctx.fillStyle = p; ctx.fill();
  }
  function wall (ctx, x0, y0, x1, y1, height, scale, material) {
    if (height < 10 * scale || Math.abs(x1 - x0) < 7 * scale) return;
    var shade = ctx.createLinearGradient(0, Math.min(y0, y1) - height, 0, Math.max(y0, y1));
    shade.addColorStop(0, 'rgba(24,34,37,.15)');
    shade.addColorStop(.10, 'rgba(255,240,211,.06)');
    shade.addColorStop(.65, 'rgba(28,40,44,.05)');
    shade.addColorStop(1, 'rgba(20,29,32,.29)');
    ctx.fillStyle = shade; ctx.fill();
    if (scale >= .65) surface(ctx, material, scale, scale * (y1 - y0) / (x1 - x0), 0, scale, x0, y0);
  }
  MM.materials = { surface: surface, wall: wall, backend: 'uninitialized' };
  MM.visuals = { profiles: profiles, setQuality: setQuality,
    get quality () { return quality; }, get profile () { return profiles[quality]; } };
})(window.MM);
