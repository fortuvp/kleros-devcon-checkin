// Curate items: each is painted once as a 2.5D object on its own <canvas>, a complete game on its own.
// After first paint gl.js is fetched (unless lite); it registers with _glReady(api) and draws the live object.
// api (all optional): init({ reduced, paused }) -> ok, setReduced(b), live(el, el._co | null), hero(el, specs),
// tilt(el, yaw, pitch), state(el, s), pause(), resume(). el._co = { spec, specs, size, st }. GL puts its canvas
// inside el and fades it in while the el’s .obj-2d fades out. gl.js gives up via _static() or the mode event.
(function () {
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
    CO, api = null, liveEl = null, paused = false, dead = false, asked = false, els = [], ro = null, cache = {}, keys = [];

  // ---- Colour ----
  function rgb(h) {
    var n = parseInt(String(h || '').slice(1), 16);
    if (isNaN(n)) n = 0x9013fe;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  // k < 0 mixes toward black, k > 0 toward white
  function sh(h, k) {
    var c = rgb(h), t = k < 0 ? 0 : 255, i;
    for (i = 0; i < 3; i++) c[i] = Math.round(c[i] + (t - c[i]) * Math.abs(k));
    return 'rgb(' + c + ')';
  }
  function W(a) { return 'rgba(255,255,255,' + a + ')'; }
  function grad(g, st) {
    for (var i = 0; i < st.length; i += 2) g.addColorStop(st[i], st[i + 1]);
    return g;
  }
  function lin(x, x0, y0, x1, y1, st) { return grad(x.createLinearGradient(x0, y0, x1, y1), st); }
  function rad(x, x0, y0, r0, x1, y1, r1, st) { return grad(x.createRadialGradient(x0, y0, r0, x1, y1, r1), st); }

  // ---- Shapes ----
  // Original silhouettes in a 0..100 box, y down, base at 100, no holes (arches are notches from the bottom).
  // HALF rows run from the top centre down the left side to the axis and are mirrored. gl.js extrudes them.
  var HALF = [
    'arch 50 24 38 24 38 16 34 11 30 16 30 30 14 30 14 19 10 14 6 19 6 100 32 100 32 60 38 47 50 42',
    'bridge 50 3 47 8 46 30 14 72 2 72 2 82 10 82 10 100 16 100 16 82 44 82 44 100 50 100',
    'dome 50 3 48 10 42 16 30 28 30 38 34 46 22 46 22 56 10 56 10 100 42 100 42 82 50 74',
    'temple 50 2 48 7 45 9 43 18 39 20 37 32 32 34 30 48 25 50 23 62 12 62 12 100 43 100 43 84 50 78',
    'tower 50 2 46 15 43 15 42 9 40 16 40 34 37 36 37 62 34 64 34 88 28 90 28 100 50 100',
    'minarets 50 42 30 42 30 14 27 9 24 2 21 9 18 14 18 30 15 33 15 100 32 100 32 66 38 56 50 52',
    'station 50 4 47 10 40 18 38 26 34 26 34 40 26 40 26 30 23 24 20 30 20 46 6 46 6 100 40 100 40 82 50 74',
    'palace 50 12 45 18 44 30 38 30 38 24 35 21 32 24 32 40 20 40 20 30 16 25 12 30 12 48 4 48 4 100 50 100',
    'house 50 14 8 42 18 42 18 56 12 56 12 60 18 60 18 100 42 100 42 80 50 74',
    'shield 50 6 38 10 24 11 10 8 9 22 10 38 13 52 18 65 25 76 33 85 41 92 50 98'
  ], FULL = [
    'wave 0 100 0 70 10 60 22 52 36 42 52 30 66 24 80 24 90 30 94 40 88 46 82 40 76 40 72 48 74 58 82 66 92 72 100 76 100 100',
    'park 4 100 4 92 36 92 36 68 20 64 12 52 12 36 20 22 32 14 46 13 58 20 66 32 66 50 58 62 44 68 44 92 ' +
      '78 92 78 74 70 70 66 60 70 48 80 43 90 48 94 60 90 70 82 74 82 92 96 92 96 100',
    'block 6 100 6 50 22 50 22 30 44 30 44 16 38 16 38 10 76 10 76 16 70 16 70 36 84 36 84 56 94 56 94 100'
  ], SHAPES = {};
  (function () {
    var rows = HALF.concat(FULL), r, p, i, a;
    for (r = 0; r < rows.length; r++) {
      p = rows[r].split(' ');
      a = p.shift();
      for (i = 0; i < p.length; i++) p[i] = +p[i];
      if (r < HALF.length) for (i = p.length - 4; i >= 2; i -= 2) p.push(100 - p[i], p[i + 1]);
      SHAPES[a] = p;
      for (a = 0, i = 0; i < p.length; i += 2) a += p[i] * p[(i + 3) % p.length] - p[(i + 2) % p.length] * p[i + 1];
      if (a < 0) for (a = p.slice(), i = 0; i < a.length; i += 2) {
        p[i] = a[a.length - 2 - i]; p[i + 1] = a[a.length - 1 - i];
      }
    }
  })();

  // ---- Paths ----
  // Outline p placed so its box point (bx, by) lands on (ox, oy), scaled by k
  function pth(x, p, ox, oy, k, bx, by) {
    x.beginPath();
    for (var i = 0; i < p.length; i += 2) x[i ? 'lineTo' : 'moveTo'](ox + (p[i] - bx) * k, oy + (p[i + 1] - by) * k);
    x.closePath();
  }
  // Ellipse via a scaled arc: older Safari has no ctx.ellipse
  function ell(x, cx, cy, rx, ry, a0, a1) {
    x.save(); x.translate(cx, cy); x.scale(1, (ry || rx) / rx);
    x.beginPath(); x.arc(0, 0, rx, a0 || 0, a1 || 7);
    x.restore();
  }
  function F(x, f) { x.fillStyle = f; x.fill(); }
  function S(x, w, s) { x.lineWidth = w; x.strokeStyle = s; x.stroke(); }
  function shadow(x, y, r) {
    x.save(); x.translate(0, y); x.scale(1, .16); ell(x, 0, 0, r);
    F(x, rad(x, 0, 0, 0, 0, 0, r, [0, 'rgba(7,0,26,.45)', 1, 'rgba(7,0,26,0)']));
    x.restore();
  }
  // Image im clipped into an ellipse (a circle when ry is omitted)
  function disc(x, im, cx, cy, rx, ry) {
    ry = ry || rx;
    x.save(); ell(x, cx, cy, rx, ry); x.clip();
    x.drawImage(im, cx - rx, cy - ry, rx * 2, ry * 2);
    x.restore();
  }

  // ---- Emblem ----
  // A cached px² canvas shared with gl.js: tint gradient, bevel ring, embossed mark. Never draw on it.
  // #kleros-ico from index.html:461 (rounded); its first subpath doubles as the no-Path2D polygon
  var KP = 'M42.7 1.5 15.7 0.3 0 19.9 11.1 46.2 38.2 47.9 53.6 25.8ZM16 22.8 35.5 14.3 32.7 35.8ZM17.6 3.3 33.2 10 ' +
    '14.4 17.4ZM12.3 26.9 29.3 39 12.7 43.3ZM39.3 14 50.9 25.7 36.3 36.6ZM19 45.4 33.3 41.6 35.8 46.5ZM36.1 40.4 48.6 ' +
    '31.1 38.6 45.3ZM40.3 9.9 42.7 4.9 49.3 19.1ZM23.8 1.8 39.7 2.5 36.9 7.6ZM2.3 18.9 13.4 4.8 9.7 20.5ZM1.8 21.6 9.3 ' +
    '23.2 9.6 40.1Z',
    FONT = 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    kpath = null;
  function sq(x, s) { x.moveTo(0, -s); x.lineTo(s, 0); x.lineTo(0, s); x.lineTo(-s, 0); x.closePath(); }
  function hexa(x, s) {
    for (var i = 0; i < 6; i++) x[i ? 'lineTo' : 'moveTo'](s * Math.cos(i * 1.047 - 1.571), s * Math.sin(i * 1.047 - 1.571));
    x.closePath();
  }
  // The mark centred on (d, d) in the current fillStyle; r = half the canvas
  function mark(x, m, r, d) {
    x.save(); x.translate(d, d); x.scale(r, r); x.beginPath();
    if (m === 'kleros') {
      x.scale(.02, .02); x.translate(-27, -24);
      if (!kpath && window.Path2D) try { kpath = new Path2D(KP); } catch (e) { kpath = 0; }
      if (kpath) x.fill(kpath, 'evenodd'); else { pth(x, KP.split('Z')[0].match(/\d*\.?\d+/g), 0, 0, 1, 0, 0); x.fill(); }
    } else if (m === 'eth') {
      x.rect(-.5, -.5, 1, .17); x.rect(-.34, -.085, .68, .17); x.rect(-.5, .33, 1, .17); x.fill();
    } else if (m === 'tether') {
      x.rect(-.52, -.52, 1.04, .24); x.rect(-.13, -.52, .26, 1.08); x.rect(-.4, -.1, .8, .12); x.fill();
    } else if (m === 'diamond') {
      sq(x, .62); sq(x, .42); x.fill('evenodd'); x.beginPath(); sq(x, .24); x.fill();
    } else if (m === 'hex') {
      hexa(x, .6); hexa(x, .36); x.fill('evenodd');
    } else if (m === 'bang') {
      x.rect(-.11, -.58, .22, .76); x.arc(0, .44, .13, 0, 7); x.fill();
    } else if (m) {
      // Letters, B (btc) and $ come from the system font (150px at 256²); the other marks are paths
      if (m === 'btc') {   // the two strokes above and below the B
        x.rect(-.24, -.62, .09, .3); x.rect(-.02, -.62, .09, .3); x.rect(-.24, .4, .09, .3); x.rect(-.02, .4, .09, .3);
        x.fill();
      }
      x.scale(1 / r, 1 / r);
      x.font = '700 ' + Math.round(r * 1.17) + FONT;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(m === 'btc' ? 'B' : m === 'dollar' ? '$' : String(m).charAt(0), 0, r * .07);
    }
    x.restore();
  }
  function emblem(spec, px) {
    spec = spec || {}; px = px || 256;
    var col = spec.color || '#9013fe', key = col + spec.mark + px, c = cache[key], x, r, i, n;
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = px;
    x = c.getContext('2d'); r = px / 2;
    if (!x) return c;
    x.translate(r, r);
    x.fillStyle = rad(x, -r * .35, -r * .4, r * .05, 0, 0, r * 1.1, [0, sh(col, .4), .55, col, 1, sh(col, -.4)]);
    x.fillRect(-r, -r, px, px);
    // Bevel: a ring lit up-left and shaded down-right, then the reverse just inside it
    for (i = 0; i < 2; i++) {
      ell(x, 0, 0, r * (.84 - i * .03));
      S(x, px * .03, lin(x, -r, -r, r, r, [0, i ? 'rgba(0,0,0,.3)' : W(.6), .5, W(0), 1, i ? W(.35) : 'rgba(0,0,0,.45)']));
    }
    if (spec.mark) {
      i = px * .012; n = rgb(col);
      x.fillStyle = W(.5); mark(x, spec.mark, r, -i);
      x.fillStyle = 'rgba(0,0,0,.42)'; mark(x, spec.mark, r, i);
      x.fillStyle = n[0] * .3 + n[1] * .59 + n[2] * .11 > 168 ? 'rgba(26,7,61,.88)' : W(.94);   // dark mark on light tints
      mark(x, spec.mark, r, 0);
    }
    cache[key] = c; keys.push(key);
    if (keys.length > 12) delete cache[keys.shift()];   // small LRU
    return c;
  }

  // ---- Static painters ----
  // Each draws one object in a -100..100 unit box centred on the origin
  var SILVER = [0, '#f4f1ff', .45, '#a9a3c8', 1, '#4d466e'];
  function coin(x, s) {
    var c = s.color, y = -8, rx = 76, ry = 70, i, g = lin(x, -rx, 0, rx, 0, [0, sh(c, -.6), .35, sh(c, -.1), 1, sh(c, -.65)]);
    shadow(x, 84, 72);
    for (i = 6; i > 0; i--) { ell(x, 0, y + i * 2.4, rx, ry); F(x, g); }   // thickness
    disc(x, emblem(s), 0, y, rx, ry);
    ell(x, 0, y, rx - 3.5, ry - 3.5); S(x, 7, lin(x, -rx, y - ry, rx, y + ry, [0, sh(c, .55), .5, sh(c, .05), 1, sh(c, -.5)]));
    x.lineCap = 'round'; ell(x, 0, y, rx * .9, ry * .9, 3.4, 4.45); S(x, 4, W(.75));   // specular arc
    x.fillStyle = rad(x, -34, y - 34, 0, -34, y - 34, 30, [0, W(.32), 1, W(0)]); x.fillRect(-64, y - 64, 60, 60);
  }
  function shield(x, s) {
    var c = s.color, P = SHAPES.shield, k = 1.55, y = -8;
    shadow(x, 74, 60);
    pth(x, P, 5, y + 5, k, 50, 52); F(x, sh(c, -.6));
    pth(x, P, 0, y, k, 50, 52); F(x, lin(x, 0, -80, 0, 70, [0, sh(c, .3), .5, c, 1, sh(c, -.4)]));
    x.save(); x.clip();   // gloss band
    x.beginPath(); x.moveTo(-80, -40); x.lineTo(-10, -100); x.lineTo(20, -100); x.lineTo(-80, -6); F(x, W(.12));
    x.restore();
    x.lineJoin = 'round'; pth(x, P, 0, y, k, 50, 52); S(x, 5, lin(x, -60, -80, 60, 70, SILVER));
    pth(x, P, 0, y - 3, k * .85, 50, 52); S(x, 2.5, lin(x, 0, -70, 0, 60, [0, W(.4), 1, 'rgba(0,0,0,.35)']));
    disc(x, emblem(s), 0, -16, 36);   // enamel disc
    ell(x, 0, -16, 36); S(x, 4, lin(x, -36, -52, 36, 20, SILVER));
  }
  // A contract block (isometric box with code lines) and the label’s tag on a string
  function tag(x, s) {
    var c = s.color, l = -72, m = -32, r = 8, t = -42, i;
    x.scale(1.15, 1.15); x.translate(-6, -8);   // fill the box like the other items
    shadow(x, 80, 80);
    // Faces: left, right, top; t is the row of the side corners, 22 the iso rise
    pth(x, [l, t, m, t + 22, m, 24, l, 2], 0, 0, 1, 0, 0); F(x, '#2c1d63');
    pth(x, [m, t + 22, r, t, r, 2, m, 24], 0, 0, 1, 0, 0); F(x, '#1d1349');
    pth(x, [m, t - 22, r, t, m, t + 22, l, t], 0, 0, 1, 0, 0); F(x, lin(x, l, 0, r, 0, [0, '#5b4aa8', 1, '#4a3a92']));
    S(x, 1.5, 'rgba(192,132,255,.7)');
    x.save(); x.transform(1, .55, 0, 1, l, t);   // code lines, sheared to the left face
    for (i = 0; i < 4; i++) {
      x.fillStyle = i === 2 ? c : 'rgba(200,180,255,.5)';
      x.fillRect(6 + i % 2 * 6, 9 + i * 8, 22 - i * 3, 3.5);
    }
    x.restore();
    x.beginPath(); x.moveTo(r - 10, t + 9); x.quadraticCurveTo(r + 2, 8, 1, 20); S(x, 1.4, W(.65));   // string
    x.save(); x.translate(36, 38); x.rotate(.48);
    for (i = 0; i < 2; i++) {
      // Darker offset copy, then the face (a rounded rect from l, t)
      l = -50 - i * 4; t = -24 - i * 4; r = l + 104; m = t + 56;
      x.beginPath(); x.moveTo(l + 12, t);
      x.arcTo(r, t, r, m, 12); x.arcTo(r, m, l, m, 12); x.arcTo(l, m, l, t, 12); x.arcTo(l, t, r, t, 12); x.closePath();
      F(x, i ? lin(x, 0, -28, 0, 28, [0, sh(c, .28), 1, sh(c, -.3)]) : sh(c, -.6));
    }
    S(x, 1.5, W(.35));
    ell(x, -39, 0, 8); F(x, '#c9a25a'); ell(x, -39, 0, 4.5); F(x, '#07001a');   // eyelet
    disc(x, emblem(s), 14, 0, 22); ell(x, 14, 0, 22); S(x, 2.5, W(.4));
    x.restore();
  }
  // A landmark miniature: plinth, extruded silhouette, lit face and top edge
  function landmark(x, s) {
    var c = s.color || '#e8c79a', P = SHAPES[s.shape], k = 1.45, b = 62, i;
    shadow(x, 86, 92);
    ell(x, 0, 73, 84, 15); F(x, '#7a5a24');
    ell(x, 0, 69, 84, 15); F(x, lin(x, -84, 0, 84, 0, [0, '#a8823e', .4, '#e3c27a', 1, '#9a7434']));   // gold lip
    ell(x, 0, 64, 82, 14); F(x, rad(x, -10, 60, 4, 0, 64, 84, [0, '#2e1866', 1, '#1a073d']));
    ell(x, 4, 63, 66, 8); F(x, 'rgba(0,0,0,.35)');
    for (i = 5; i > 0; i--) { pth(x, P, i * 1.4, b - i * 1.1, k, 50, 100); F(x, sh(c, -.62 + i * .03)); }   // depth
    pth(x, P, 0, b, k, 50, 100); F(x, lin(x, 0, -80, 0, b, [0, sh(c, .3), .55, c, 1, sh(c, -.3)]));
    // Static-only details that help a small silhouette read: cables, a clock face
    x.beginPath();
    if (s.shape === 'bridge') {
      for (i = 0; i < 8; i++) {
        x.moveTo(i < 4 ? -3 : 3, b + (i % 4 * 7 - 70) * k);
        x.lineTo((i < 4 ? i * 7 - 34 : 34 - i % 4 * 7) * k, b - 26 * k);
      }
    } else if (s.shape === 'tower') { x.arc(0, b - 74 * k, 4.5, 0, 7); F(x, '#fff6df'); }
    S(x, 1.2, sh(c, -.35));
    x.save(); pth(x, P, 0, b, k, 50, 100); x.clip();
    S(x, 5, lin(x, 0, -80, 0, 10, [0, W(.6), 1, W(0)]));   // top-edge highlight
    x.restore();
  }
  var DRAW = { coin: coin, shield: shield, tag: tag };
  function draw(x, spec, cx, cy, size, rot) {
    spec = spec || {};
    x.save(); x.translate(cx, cy); if (rot) x.rotate(rot); x.scale(size / 200, size / 200);
    try { (DRAW[spec.shape] || (SHAPES[spec.shape] ? landmark : coin))(x, spec); } catch (e) { /* never break a card */ }
    x.restore();
  }

  // ---- Paint scheduling ----
  // Paint once the element has a size, again when it changes. offsetWidth ignores drag and stack transforms.
  function paint(el) {
    var o = el._co, w = el.offsetWidth, h = el.offsetHeight, d, x, s;
    if (!o || w < 4 || h < 4 || (w === o.w && h === o.h)) return;
    o.w = w; o.h = h;
    d = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(700000 / (w * h)));
    o.cv.width = Math.round(w * d); o.cv.height = Math.round(h * d);
    x = o.cv.getContext('2d');
    if (!x) return;
    x.setTransform(d, 0, 0, d, 0, 0);
    if (o.size === 'hero') {
      s = Math.min(h * 1.02, w / 2.7);
      draw(x, o.specs[0], w / 2 - s * .86, h / 2 + s * .06, s * .8, -.16);
      draw(x, o.specs[2], w / 2 + s * .86, h / 2 + s * .06, s * .8, .16);
      draw(x, o.specs[1], w / 2, h / 2, s, 0);
    } else draw(x, o.spec, w / 2, h / 2, Math.min(w, h) * .96, 0);
  }
  var pend = false;
  function flush() { pend = false; for (var i = 0; i < els.length; i++) paint(els[i]); }
  function later() {
    if (pend) return;
    pend = true;
    if (window.requestAnimationFrame) requestAnimationFrame(flush); else setTimeout(flush, 16);
  }
  function prune() {
    for (var i = els.length - 1; i >= 0; i--) {
      if (els[i]._co.w && !document.documentElement.contains(els[i])) { if (ro) ro.unobserve(els[i]); els.splice(i, 1); }
    }
  }
  function track(el) {
    prune(); els.push(el);
    if (window.ResizeObserver) {
      if (!ro) ro = new ResizeObserver(function (en) { for (var i = 0; i < en.length; i++) paint(en[i].target); });
      ro.observe(el);
    } else if (!track.on) { track.on = 1; window.addEventListener('resize', later); }
    later();
  }
  function cover(el, gl) {
    if (!el || !el._co) return;
    var st = el._co.cv.style;
    st.transition = gl && !RM ? 'opacity .12s' : '';
    st.opacity = gl ? '0' : '';
    if (gl) st.transform = '';
  }
  function make(size) {
    var el = document.createElement('div'), cv = document.createElement('canvas');
    el.className = 'obj';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
    cv.className = 'obj-2d';
    cv.style.cssText = 'display:block;width:100%;height:100%;transform-origin:50% 50%';
    el.appendChild(cv);
    el._co = { cv: cv, size: size === 'hero' ? 'hero' : 'card', st: 'none', w: 0, h: 0 };
    return el;
  }

  // ---- GL loader and hand-off ----
  var isLite = false;
  function liteFor(o) {
    var n = navigator, c = n.connection;
    return !!(o.lite || (c && c.saveData) || (n.deviceMemory <= 2 && n.hardwareConcurrency <= 4) ||
      /[?&]lite=1\b/.test(location.search) || !window.WebGLRenderingContext);
  }
  function fetchGL() {
    if (asked || dead) return;
    asked = true;
    var sc = document.createElement('script');
    sc.src = '/curate/gl.js'; sc.async = true;
    sc.onload = function () { if (!api && window.CurateGL) CO._glReady(window.CurateGL); };
    (document.head || document.documentElement).appendChild(sc);
  }
  function schedule() {
    function go() {
      if (window.requestIdleCallback) requestIdleCallback(fetchGL, { timeout: 1500 }); else setTimeout(fetchGL, 300);
    }
    if (window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(go, 0); }); else setTimeout(go, 0);
  }
  function setMode(m, quiet) {
    CO.mode = m;
    if (quiet) return;
    try { document.dispatchEvent(new CustomEvent('curate:objects-mode', { detail: { mode: m } })); } catch (e) { /* old browser */ }
  }
  // Any GL failure drops to the static paint for the rest of the session
  function toStatic(quiet) {
    var a = api;
    dead = true; api = null;
    if (!a) return;
    cover(liveEl, false);
    try { if (a.live) a.live(null, null); } catch (e) { /* already broken */ }
    setMode('static', quiet);
  }
  function call(fn, a, b, c) {
    if (!api || !api[fn]) return;
    try { api[fn](a, b, c); } catch (e) { toStatic(); }
  }
  // The hero goes through api.hero when gl.js has one; cards (and a hero otherwise) through api.live
  function handoff(el) {
    if (el._co.size === 'hero' && api.hero) call('hero', el, el._co.specs); else call('live', el, el._co);
    if (!api) return;
    cover(el, true);
    if (el._co.st !== 'none') call('state', el, el._co.st);
  }

  // ---- Public API ----
  function live(el) {
    el = el && el._co ? el : null;
    if (el === liveEl) return;
    var prev = liveEl;
    liveEl = el;
    if (!api) return;
    cover(prev, false);
    if (el) handoff(el); else call('live', null, null);
  }
  CO = window.CurateObjects = {
    mode: 'static',
    init: function (o) {
      if (CO._on) return;
      CO._on = true; o = o || {};
      if ('reduced' in o) RM = !!o.reduced;
      isLite = liteFor(o);
      document.addEventListener('curate:objects-mode', function (e) {
        if (e.detail && e.detail.mode === 'static' && CO.mode === 'gl') toStatic(true);
      });
      if (!isLite) schedule();
    },
    create: function (spec, o) {
      var el = make(o && o.size);
      el._co.spec = spec || {}; el._co.specs = [el._co.spec];
      track(el);
      return el;
    },
    live: live,
    tilt: function (el, yaw, pitch) {
      if (!el || !el._co) return;
      el._co.ty = yaw; el._co.tp = pitch;
      if (RM) return;
      if (api && el === liveEl) return call('tilt', el, yaw, pitch);
      var st = el._co.cv.style;
      st.transition = 'transform .12s cubic-bezier(.3,1.3,.5,1)';   // spring-smoothed over 120 ms
      st.transform = yaw || pitch ? 'perspective(600px) rotateY(' + (+yaw || 0) + 'deg) rotateX(' + (-pitch || 0) + 'deg)' : '';
    },
    state: function (el, s) {
      if (!el || !el._co) return;
      el._co.st = s || 'none';
      if (api && el === liveEl) call('state', el, el._co.st);
    },
    hero: function (slot, specs) {
      if (!slot) return null;
      var el = make('hero'), i;
      specs = specs || [];
      for (el._co.specs = [], i = 0; i < 3; i++) el._co.specs.push(specs[i] || specs[0] || {});
      el._co.spec = el._co.specs[1];
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      if (window.getComputedStyle && getComputedStyle(slot).position === 'static') slot.style.position = 'relative';
      slot.appendChild(el);
      track(el);
      live(el);
      return el;
    },
    pause: function () { paused = true; call('pause'); },
    resume: function () { paused = false; call('resume'); },
    _emblem: emblem,
    _shapes: SHAPES,
    _glReady: function (a) {
      if (api || dead || isLite || !a || !CO._on) return false;
      var ok;
      try { ok = a.init ? a.init({ reduced: RM, paused: paused }) : true; } catch (e) { ok = false; }
      if (!ok) { dead = true; return false; }
      api = a;
      setMode('gl');
      call('setReduced', RM);
      if (paused) call('pause');
      if (liveEl) handoff(liveEl);
      return !!api;
    },
    _static: function () { toStatic(); }
  };
})();
