// Curate items (waving flags, landmark models, Mumbai sights): each is painted once as a 2.5D object on its own
// <canvas>, a complete game on its own.
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
  function shA(c, k) {
    var t = k < 0 ? 0 : 255, o = [], i;
    for (i = 0; i < 3; i++) o[i] = Math.round(c[i] + (t - c[i]) * Math.abs(k));
    return o;
  }
  function css(c) { return 'rgb(' + c + ')'; }
  function sh(h, k) { return css(shA(rgb(h), k)); }
  // A model part’s colour token: '0' the item’s colour, a number a shade of it, or an absolute #rrggbb
  function tone(c, t) { return t.charAt(0) === '#' ? rgb(t) : shA(c, +t || 0); }
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
    'house 50 14 8 42 18 42 18 56 12 56 12 60 18 60 18 100 42 100 42 80 50 74'
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

  // ---- Landmark models ----
  // Original simplified models, several parts each, in the same 0..100 box (y down, base at 100). Both painters
  // read the parsed parts (_models), so the static paint and GL match. A row is 'type colour numbers':
  //   h d z <half outline>      p d z <outline>          b d z x0 y0 x1 y1 (box)    c d z cx cy rx ry (ellipse)
  //   a d z cx yb w h (pointed arch)   A d z x0 x1 n yb h (row of round arches)
  //   r d z w <polyline> (ribbon)      s d z x0 x1 tx ty yb (shell: base x0..x1, tip tx ty)
  //   S d z w ydeck step <polyline> (hangers from a cable down to a deck)
  //   l n a0 ax z <r y, top down> (lathe about x = ax: n ≤ 8 is faceted, r the apothem; a0 turns it, degrees)
  //   m k (metalness for the rows after, default .1), t deg (lean the rows after about the base centre)
  // d is the depth and z the depth offset, in box units. Colour: '0', a shade such as -.3, or #rrggbb.
  // An empty row repeats the row before it mirrored about x = 50.
  var MIN = '0 14.5 1.1 16 2.7 18.4 2.9 20.4 2.3 21 3.7 21.8 3.7 23 2.6 23.6 2.7 43 3.8 43.8 3.8 45 2.8 45.6 2.9 64 ' +
      '4 64.8 4 66 3 66.6 3.2 88',   // a minaret, top down
    GGM = '26 12.5 30 28 34 40.2 38 49.8 42 56.6 46 60.6 50 62 54 60.6 58 56.6 62 49.8 66 40.2 70 28 74 12.5',   // main span
    MODELS = {
    eiffel: ['m .35',
      'h 0 16 0 50 .5 49.2 .5 49.2 6 47.9 7.2 47.9 10 46.9 11 45.4 24 44.2 36.5 41.6 49 37.8 60.5 33.6 69.5 27 81 ' +
        '19.5 92.5 13 100 24.5 100 28 92.5 32.5 87 38.5 82.6 44.5 80.3 50 79.6',
      'r -.4 17 0 .9 47 12.5 54.4 24', 'r -.4 17 0 .9 53 12.5 45.6 24', 'r -.4 17 0 .9 45.7 25 55.6 35.5',
      'r -.4 17 0 .9 54.3 25 44.4 35.5', 'r -.4 17 0 1 44.6 39 61.2 59.5', 'r -.4 17 0 1 55.4 39 38.8 59.5',
      'r -.4 17 0 1 35.5 65 64.5 75.5', 'r -.4 17 0 1 64.5 65 35.5 75.5',
      'r -.4 17 0 1.2 21 99.5 24.6 91.2 29.6 85 36.6 79.8 43.6 77 50 76.2 56.4 77 63.4 79.8 70.4 85 75.4 91.2 79 99.5',
      'b -.12 30 0 32.5 59.5 67.5 64', 'b -.12 22 0 41.8 35.6 58.2 38.6'],
    pisa: ['t 5.5', 'l -.24 20 0 50 0 0 16 11.6 16 11.6 77',
      'l 0 20 0 50 0 0 5 8 5 9.6 6.4 9.6 7.6 8.6 7.6 8.6 16',
      'l .1 20 0 50 0 11 15 13.3 15 13.3 17.4 11 17.4', 'l .1 20 0 50 0 11 27 13.3 27 13.3 29.4 11 29.4',
      'l .1 20 0 50 0 11 39 13.3 39 13.3 41.4 11 41.4', 'l .1 20 0 50 0 11 51 13.3 51 13.3 53.4 11 53.4',
      'l .1 20 0 50 0 11 63 13.3 63 13.3 65.4 11 65.4', 'l 0 20 0 50 0 11 75 13.3 75 13.3 77.4 12.5 77.4 12.5 100'],
    bigben: ['l #d8b45a 10 0 50 0 0 0 .5 1.5 .5 3.5 .9 4.2', 'l #4f5868 4 45 50 0 0 3.5 1.6 8 4.6 14 8.8 21',
      'l 0 4 45 50 0 0 20.5 9.8 20.5 9.8 22 9 22 9 29.5 11 29.5 11 48 9.2 49.5 9.2 100',
      'p 0 3 8.5 38.6 29.6 39.9 23.5 41.2 29.6', 'p 0 3 8.5 58.8 29.6 60.1 23.5 61.4 29.6',
      'a #3a3040 1 9.2 46.6 28.6 2.8 5.4', 'a #3a3040 1 9.2 53.4 28.6 2.8 5.4',
      'r -.38 1 9.4 1.1 45.6 53 45.6 95', 'r -.38 1 9.4 1.1 50 53 50 95', 'r -.38 1 9.4 1.1 54.4 53 54.4 95',
      'c #c99c40 1.2 11.2 50 39 8.4 8.4', 'c #f4ecd4 1 11.6 50 39 7.4 7.4',
      'r #231d2a .6 12.2 1.1 50 39.5 50 33.6', 'r #231d2a .6 12.2 1 49.6 39 54.4 41'],
    liberty: ['l #cdbb9b 4 45 50 0 0 63.5 12 63.5 12 66 10 66 10 81 14.5 84 14.5 100',
      'p 0 10 0 41.2 64 39.8 57 40.8 46 42.2 33 42.8 25.8 40.4 15.6 40 8.2 38.8 7.6 38.6 5.8 44.2 5.8 44 7.6 42.9 ' +
        '8.2 43.4 14.6 45.2 20.4 46.2 21.6 45.9 18.6 44.7 15.9 46.3 15.6 45.6 12.4 47.6 14.4 48.2 10.4 49.4 13.8 ' +
        '50.6 9.8 51.6 13.8 53.2 10.6 53.6 14.6 55.8 12.8 54.6 16 56.8 16.8 54.3 18.4 53.8 21.6 56.4 23 57.8 26.5 ' +
        '58.6 29.6 60.2 28 62.6 27.6 63 38.4 60.2 39.6 59.6 47 60.4 57 58.8 64',
      'p .12 1 5.3 60.4 28.6 62.2 28.3 62.6 37.9 60.6 38.8',
      'r -.18 1 5.2 .7 46 30 45 62', 'r -.18 1 5.2 .7 52 31 53.5 62',
      'p #ffbe4a 4 0 39.6 5.9 39.9 3.2 41 3.9 41.4 .4 42.6 3.2 43.5 2.5 43.3 5.9'],
    tajmahal: ['l 0 16 0 10 -18 ' + MIN, '', 'b -.05 46 0 3 88 97 100',
      'l 0 16 0 35 4 0 36.5 2.2 37.6 3.8 39.6 4.2 41.6 3.5 43.4 3.5 50', '',
      'l 0 24 0 50 0 0 9.5 3.5 11 7.5 14 11.5 18.5 14.5 24 15.8 30 15.2 35 13 38.8 12.4 39.4 12.4 51',
      'l #d8b25a 12 0 50 0 0 2.5 .7 4 .45 6 1.1 7 .45 8 .8 10',
      'h 0 38 0 50 50 30 50 30 52.5 27 54.5 27 88 50 88', 'b .14 1 19.3 40.5 52 59.5 87.5',
      'a #c4bce0 1 19.8 50 86.5 14 31', 'a #d2cbe9 1 19.4 33.5 69 6.2 13', '', 'a #d2cbe9 1 19.4 33.5 86.5 6.2 13', '',
      'l 0 16 0 10 18 ' + MIN, ''],
    opera: ['b #b98a6c 34 0 5 84 95 100', 's -.1 12 -12 60 84 90 48 84', 's 0 14 -3 34 72 30 16 84',
      's .04 14 6 16 46 12 34 84', 's 0 12 12 58 80 54 46 84', 's .04 10 16 72 92 70 60 84'],
    colosseum: ['p -.3 8 -20 8 40 92 40 92 84 8 84', 'A #6a4630 1 -15.5 56 92 5 57 11',
      'p 0 14 0 4 100 4 30 54 30 58 36 62 36 66 44 72 46 76 52 84 54 88 62 96 64 96 100',
      'A #5a3a26 1 7.4 6 94 8 98.5 14', 'A #5a3a26 1 7.4 6 86 7 79.5 12.5', 'A #5a3a26 1 7.4 6 72 6 61.5 11',
      'A #5a3a26 1 7.4 8 54 6 44 5', 'r .16 15 0 1.2 4 82 96 82', 'r .16 15 0 1.2 4 64 87 64',
      'r .16 15 0 1.2 4 48 71 48', 'r .16 15 0 1 4 31 54 31'],
    burj: ['m .2', 'b -.25 24 0 28 94 72 100', 'm .55', 'l .2 8 0 50 0 0 0 .5 2 1.5 13',
      'l 0 6 90 50 0 0 12.5 2.6 12.5 2.6 24 4 24 4 36 5.6 36 5.6 48 7.2 48 7.2 60 8.8 60 8.8 72 10.6 72 10.6 86 ' +
        '13 86 13 100'],
    goldengate: ['m .3', 'b #9a96a2 18 0 20 86 32 100', '',
      'r .05 1.4 -5 1.3 0 66 9 47 18 29 26 12.5', '', 'r .05 1.4 -5 1.3 ' + GGM,
      'b -.3 16 0 0 74.5 100 77.5', 'b -.12 15 0 0 70 100 74.5',
      'b 0 9 0 22.4 11 25.2 86', '', 'b 0 9 0 26.8 11 29.6 86', '', 'b 0 8 0 25 13 27 16.5', '',
      'b 0 8 0 25 29 27 32', '', 'b 0 8 0 25 45 27 48', '', 'b 0 8 0 25 61 27 64', '',
      'S .05 .8 5 .45 70 4.5 0 66 9 47 18 29 26 12.5', '', 'S .05 .8 5 .45 70 4 ' + GGM,
      'r .05 1.4 5 1.3 0 66 9 47 18 29 26 12.5', '', 'r .05 1.4 5 1.3 ' + GGM],
    christ: ['l #5b7549 7 20 50 0 0 71 9 72 20 77 32 85 44 100', 'l #cbc3b4 4 45 50 0 0 62 5.5 62 5.5 72.5',
      'p 0 9 0 13 31.8 15 30.2 40 29.4 44.5 28 47.2 26.8 52.8 26.8 55.5 28 60 29.4 85 30.2 87 31.8 85 34 60 35 ' +
        '58.6 45 59.6 62 40.4 62 41.4 45 40 35 15 34', 'c 0 9 0 50 22.6 3.4 4.2',
      'r -.14 1 4.8 .7 47.4 36 46.4 61', 'r -.14 1 4.8 .7 52.6 36 53.6 61'],
    pyramid: ['l -.04 4 0 78 -24 0 58 14 100', 'l 0 4 0 44 8 0 22 31 100'],
    sagrada: ['l 0 16 0 50 -12 0 1.5 1.4 3 2.4 9 3.6 20 4.6 32 5.2 46 5.4 62',
      'l #e2b84f 10 0 50 -12 0 -1.5 1.4 -.6 1.8 1 1.2 2.2',
      'l 0 16 0 27 3 .8 22 2 26 3.2 34 4.2 46 4.8 58 5 62', 'l 0 16 0 73 3 .8 22 2 26 3.2 34 4.2 46 4.8 58 5 62',
      'l 0 16 0 39.5 3 .8 15 2 19 3.2 27 4.2 39 4.8 51 5 62', 'l 0 16 0 60.5 3 .8 15 2 19 3.2 27 4.2 39 4.8 51 5 62',
      'l #e0a33c 10 0 27 3 0 18 1.3 19.2 1.5 20.6 1 21.6 .8 22', 'l #e0a33c 10 0 73 3 0 18 1.3 19.2 1.5 20.6 1 21.6 .8 22',
      'l #e0a33c 10 0 39.5 3 0 11 1.3 12.2 1.5 13.6 1 14.6 .8 15', 'l #e0a33c 10 0 60.5 3 0 11 1.3 12.2 1.5 13.6 1 14.6 .8 15',
      'p 0 14 0 16 100 16 66 24 59 32 63 40 54 50 46 60 54 68 63 76 59 84 66 84 100',
      'a #6b5135 1 7.4 50 98.5 12 30', 'a #6b5135 1 7.4 33 98.5 8 22', 'a #6b5135 1 7.4 67 98.5 8 22']
  };

  // Outline generators: numbers in, a list of outlines out
  function arch(cx, yb, w, h, round) {
    var r = w / 2, s = yb - h + (round ? r : w * .75), p = [cx - r, yb, cx - r, s], i, a;
    if (round) for (i = 1; i < 8; i++) { a = i / 8 * Math.PI; p.push(cx - r * Math.cos(a), s - r * Math.sin(a)); }
    else {   // a pointed head: two curves rising steeply from the springing line to the apex
      for (i = 1; i <= 4; i++) { a = i / 4; p.push(cx - r + r * a * a, s + (yb - h - s) * (1.8 * a * (1 - a) + a * a)); }
      for (i = 3; i >= 1; i--) { a = i / 4; p.push(cx + r - r * a * a, s + (yb - h - s) * (1.8 * a * (1 - a) + a * a)); }
    }
    p.push(cx + r, s, cx + r, yb);
    return p;
  }
  // A polyline thickened to width w (mitred joints, so only gentle turns)
  function ribbon(q, w) {
    var L = [], R = [], n = q.length / 2, i, ax, ay, bx, by, l, nx, ny, d;
    function nrm(i) {
      var dx = q[i * 2 + 2] - q[i * 2], dy = q[i * 2 + 3] - q[i * 2 + 1], l = Math.sqrt(dx * dx + dy * dy) || 1;
      return [-dy / l, dx / l];
    }
    for (i = 0; i < n; i++) {
      ax = i ? nrm(i - 1) : nrm(0); bx = i < n - 1 ? nrm(i) : ax;
      nx = ax[0] + bx[0]; ny = ax[1] + bx[1]; l = Math.sqrt(nx * nx + ny * ny) || 1; nx /= l; ny /= l;
      d = w / 2 / Math.max(.5, nx * bx[0] + ny * bx[1]);
      L.push(q[i * 2] + nx * d, q[i * 2 + 1] + ny * d); R.unshift(q[i * 2] - nx * d, q[i * 2 + 1] - ny * d);
    }
    for (i = 0; i < R.length; i += 2) L.push(R[i], R[i + 1]);
    return L;
  }
  // The cable’s height at x, read off its polyline
  function at(q, x) {
    for (var i = 0; i < q.length - 2; i += 2) {
      if ((x - q[i]) * (x - q[i + 2]) <= 0) return q[i + 1] + (q[i + 3] - q[i + 1]) * (x - q[i]) / ((q[i + 2] - q[i]) || 1);
    }
    return q[1];
  }
  var GEN = {
    h: function (q) {
      for (var i = q.length - 4; i >= 2; i -= 2) q.push(100 - q[i], q[i + 1]);
      return [q];
    },
    p: function (q) { return [q]; },
    b: function (q) { return [[q[0], q[1], q[2], q[1], q[2], q[3], q[0], q[3]]]; },
    c: function (q) {
      for (var p = [], i = 0; i < 20; i++) p.push(q[0] + q[2] * Math.cos(i * Math.PI / 10), q[1] + q[3] * Math.sin(i * Math.PI / 10));
      return [p];
    },
    a: function (q) { return [arch(q[0], q[1], q[2], q[3])]; },
    A: function (q) {
      for (var o = [], s = (q[1] - q[0]) / q[2], i = 0; i < q[2]; i++) o.push(arch(q[0] + s * (i + .5), q[3], s * .62, q[4], 1));
      return o;
    },
    r: function (q) { return [ribbon(q.slice(1), q[0])]; },
    s: function (q) {
      // Base x0..x1 at yb; a straight back edge from the nearer end to the tip, a bulging front edge to the other
      var near = Math.abs(q[2] - q[0]) < Math.abs(q[2] - q[1]) ? q[0] : q[1], far = near === q[0] ? q[1] : q[0], p = [near, q[4]], i, a, b;
      for (i = 0; i <= 8; i++) {
        a = i / 8; b = 1 - a;
        p.push(b * b * q[2] + 2 * a * b * (far - (far - near) * .08) + a * a * far, b * b * q[3] + 2 * a * b * q[3] + a * a * q[4]);
      }
      return [p];
    },
    S: function (q) {
      var w = q[0], yd = q[1], st = q[2], c = q.slice(3), o = [], x;
      for (x = c[0] + st; x < c[c.length - 2] - .5; x += st) o.push(ribbon([x, at(c, x), x, yd], w));
      return o;
    }
  };
  var MOD = {};
  // Parsed parts: { t: 'p', c, d, z, p: outline } or { t: 'l', c, n, a0, ax, z, p: [r, y, ...] }, plus m and tilt
  function parse(rows) {
    var out = [], prev = [], m = .1, tilt = 0, r, a, t, c, q, o, i, j, k;
    for (r = 0; r < rows.length; r++) {
      if (!rows[r]) {   // mirror the row before
        for (i = 0, k = prev.length; i < k; i++) {
          o = {}; for (j in prev[i]) o[j] = prev[i][j];
          if (o.t === 'l') o.ax = 100 - o.ax;
          else for (o.p = o.p.slice(), j = 0; j < o.p.length; j += 2) o.p[j] = 100 - o.p[j];
          out.push(o);
        }
        prev = [];
        continue;
      }
      a = rows[r].split(' '); t = a.shift();
      if (t === 'm') { m = +a[0]; continue; }
      if (t === 't') { tilt = +a[0]; continue; }
      c = a.shift();
      for (q = [], i = 0; i < a.length; i++) q.push(+a[i]);
      prev = [];
      if (t === 'l') prev.push({ t: 'l', c: c, n: q[0], a0: q[1], ax: q[2], z: q[3], p: q.slice(4), m: m, tilt: tilt });
      else for (o = GEN[t](q.slice(2)), i = 0; i < o.length; i++) prev.push({ t: 'p', c: c, d: q[0], z: q[1], p: o[i], m: m, tilt: tilt, r: t === 'r' });
      for (i = 0; i < prev.length; i++) out.push(prev[i]);
    }
    return out;
  }
  (function () { for (var k in MODELS) MOD[k] = parse(MODELS[k]); })();

  // ---- Flags ----
  // The flat flag on a w × h canvas, shared with gl.js (its cloth texture). Cached; never draw on it.
  // Kinds: v3, h3 (ratio), h2, nordic (inner), disc (off), cross (Swiss), h3wheel (India). See decks.js.
  function flagAspect(f) { return f && f.kind === 'cross' ? 1 : 1.5; }
  function flag(f, w, h) {
    f = f || {};
    var c = f.c || ['#8a83a8', '#d9d4ee', '#8a83a8'], key = 'f' + JSON.stringify(f) + w + 'x' + h, cv = cache[key], x, r, i, k, y, t;
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    x = cv.getContext('2d');
    if (!x) return cv;
    function band(i, x0, y0, x1, y1) { x.fillStyle = c[i]; x.fillRect(x0, y0, x1 - x0, y1 - y0); }
    if (f.kind === 'v3') for (i = 0; i < 3; i++) band(i, Math.round(w * i / 3), 0, Math.round(w * (i + 1) / 3) + 1, h);
    else if (f.kind === 'h2') { band(0, 0, 0, w, h / 2 + 1); band(1, 0, h / 2, w, h); }
    else if (f.kind === 'nordic' || f.kind === 'cross') {
      band(0, 0, 0, w, h);
      // Nordic: the upright sits at about 37% of the width; Swiss: arms 6/32 wide and 20/32 across, centred
      for (k = 0; k < (f.inner ? 2 : 1); k++) {
        x.fillStyle = k ? f.inner : c[1];
        if (f.kind === 'cross') {
          r = Math.min(w, h); t = r * .1875; y = r * .625;
          x.fillRect(w / 2 - t / 2, h / 2 - y / 2, t, y); x.fillRect(w / 2 - y / 2, h / 2 - t / 2, y, t);
        } else {
          t = h * (f.inner ? (k ? .125 : .25) : .2);
          x.fillRect(w * .37 - t / 2, 0, t, h); x.fillRect(0, h / 2 - t / 2, w, t);
        }
      }
    } else if (f.kind === 'disc') {
      band(0, 0, 0, w, h);
      x.beginPath(); x.arc(w / 2 + (+f.off || 0) * w, h / 2, h * .3, 0, 7); F(x, c[1]);
    } else {   // h3 and h3wheel
      r = f.ratio || [1, 1, 1]; t = r[0] + r[1] + r[2];
      for (y = 0, i = 0; i < 3; i++) { band(i, 0, Math.round(y), w, Math.round(y + h * r[i] / t) + 1); y += h * r[i] / t; }
      if (f.kind === 'h3wheel') {   // the 24-spoke wheel, 3/4 of the white band
        r = h / 8; x.strokeStyle = x.fillStyle = c[3];
        x.lineWidth = r * .13; x.beginPath(); x.arc(w / 2, h / 2, r * .93, 0, 7); x.stroke();
        x.lineWidth = r * .05; x.beginPath();
        for (i = 0; i < 24; i++) {
          x.moveTo(w / 2, h / 2); x.lineTo(w / 2 + r * .9 * Math.cos(i * Math.PI / 12), h / 2 + r * .9 * Math.sin(i * Math.PI / 12));
        }
        x.stroke(); x.beginPath(); x.arc(w / 2, h / 2, r * .18, 0, 7); x.fill();
      }
    }
    cache[key] = cv; keys.push(key);
    if (keys.length > 12) delete cache[keys.shift()];   // small LRU
    return cv;
  }
  // Layout in the painter’s -100..100 box, shared with gl.js (÷ 82, y up) so the cross-fade lines up
  var FLAG = { pole: -56, x0: -54, y0: -77, w: 142, base: 74, top: -86 };
  // The static wave: phase and lift along the cloth (u 0 at the pole); gl.js runs the same wave in depth
  function wave(u) { return 2 * Math.PI * 1.3 * u - 1.2; }
  function lift(u) { return 8 * u * Math.sin(wave(u)) + 4 * u * u; }
  function flag2d(x, s) {
    var f = s.flag || {}, a = flagAspect(f), w = a > 1.2 ? FLAG.w : 104, h = w / a, P = FLAG.pole, N = 48,
      fc = flag(f, 384, Math.round(384 / a)), i, u, ph, dy, sl, g, sx = fc.width / N, dx = w / N;
    x.save(); x.translate(-12, 0); shadow(x, 82, 84); x.restore();
    // A little stand like the landmark plinths, then the brass pole and its finial (a ball and a slanted spike)
    ell(x, P, 79, 25, 6); F(x, '#7a5a24');
    ell(x, P, 76, 25, 6); F(x, lin(x, P - 25, 0, P + 25, 0, [0, '#a8823e', .4, '#e3c27a', 1, '#9a7434']));
    ell(x, P, 73.5, 23, 5); F(x, rad(x, P - 4, 72, 2, P, 73.5, 24, [0, '#2e1866', 1, '#1a073d']));
    x.fillStyle = lin(x, P - 2.6, 0, P + 2.6, 0, [0, '#7d6232', .35, '#f6e4b0', 1, '#5c4520']);
    x.fillRect(P - 2.4, FLAG.top + 3, 4.8, FLAG.base - FLAG.top - 1);
    x.beginPath(); x.moveTo(P - 1.8, FLAG.top - 2.5); x.lineTo(P + 4.4, FLAG.top - 13); x.lineTo(P + 1.9, FLAG.top - 2); F(x, '#d9ae52');   // slanted spike
    ell(x, P, FLAG.top, 4.8); F(x, rad(x, P - 1.6, FLAG.top - 1.8, .5, P, FLAG.top, 5, [0, '#fff3c8', .5, '#e0b85a', 1, '#8a6424']));
    // The cloth in vertical strips, each sheared to follow the wave (no stair-steps on the edges); then one
    // light-and-shade gradient over the waved outline (per-strip shading left seams)
    for (i = 0; i < N; i++) {
      dy = lift(i / N);
      x.save(); x.transform(1, (lift((i + 1) / N) - dy) / dx, 0, 1, FLAG.x0 + i * dx, FLAG.y0 + dy);
      x.drawImage(fc, i * sx, 0, sx, fc.height, 0, 0, dx + .6, h);
      x.restore();
    }
    g = x.createLinearGradient(FLAG.x0, 0, FLAG.x0 + w, 0);
    x.beginPath();
    for (i = 0; i <= N; i++) {
      u = i / N; ph = wave(u); sl = Math.cos(ph) * Math.min(1, u * 4);
      x.lineTo(FLAG.x0 + i * dx, FLAG.y0 + lift(u));
      g.addColorStop(u, sl > 0 ? W(.24 * sl) : 'rgba(12,0,36,' + (-.34 * sl).toFixed(3) + ')');
    }
    for (i = N; i >= 0; i--) x.lineTo(FLAG.x0 + i * dx, FLAG.y0 + h + lift(i / N));
    F(x, g);
    x.fillStyle = 'rgba(12,0,36,.22)'; x.fillRect(FLAG.x0, FLAG.y0, 2.2, h);   // the hem at the pole
  }

  // ---- Static painters ----
  // Each draws one object in a -100..100 unit box centred on the origin. Models sit on a plinth, box scale K,
  // their base line at B.
  var K = 1.45, B = 62, D2R = Math.PI / 180;
  function plinth(x) {
    shadow(x, 86, 92);
    ell(x, 0, 73, 84, 15); F(x, '#7a5a24');
    ell(x, 0, 69, 84, 15); F(x, lin(x, -84, 0, 84, 0, [0, '#a8823e', .4, '#e3c27a', 1, '#9a7434']));   // gold lip
    ell(x, 0, 64, 82, 14); F(x, rad(x, -10, 60, 4, 0, 64, 84, [0, '#2e1866', 1, '#1a073d']));
    ell(x, 4, 63, 66, 8); F(x, 'rgba(0,0,0,.35)');
  }
  function face(x, c) { return lin(x, 0, -80, 0, B, [0, css(shA(c, .26)), .55, css(c), 1, css(shA(c, -.28))]); }
  function hilite(x, w) { x.save(); x.clip(); S(x, w, lin(x, 0, -80, 0, 10, [0, W(.55), 1, W(0)])); x.restore(); }
  // A Mumbai miniature: one extruded silhouette, lit face and top edge
  function landmark(x, s) {
    var c = s.color || '#e8c79a', P = SHAPES[s.shape] || SHAPES.block, i;
    plinth(x);
    for (i = 5; i > 0; i--) { pth(x, P, i * 1.4, B - i * 1.1, K, 50, 100); F(x, sh(c, -.62 + i * .03)); }   // depth
    pth(x, P, 0, B, K, 50, 100); F(x, face(x, rgb(c)));
    // Static-only details that help a small silhouette read: cables, a clock face
    x.beginPath();
    if (s.shape === 'bridge') {
      for (i = 0; i < 8; i++) {
        x.moveTo(i < 4 ? -3 : 3, B + (i % 4 * 7 - 70) * K);
        x.lineTo((i < 4 ? i * 7 - 34 : 34 - i % 4 * 7) * K, B - 26 * K);
      }
    } else if (s.shape === 'tower') { x.arc(0, B - 74 * K, 4.5, 0, 7); F(x, '#fff6df'); }
    S(x, 1.2, sh(c, -.35));
    pth(x, P, 0, B, K, 50, 100); hilite(x, 5);
  }
  function X(v) { return (v - 50) * K; }
  function Y(v) { return B + (v - 100) * K; }
  // A flat part: its side swept as one smooth band per facing (stacked copies stair-stepped on thin spires),
  // steep edges in shade and flat ones lit, then a lit face and a top edge. A ribbon lies on another part’s
  // face, so it gets no side: its side would smear dark copies over that face.
  function poly2d(x, P, c) {
    var n = P.d > 3 && !P.r ? Math.min(5, Math.round(P.d / 3)) : 0, ox = n * 1.3, oy = -n, q = P.p, k, i, j, ax, ay, bx, by, s;
    for (k = 0; n && k < 2; k++) {
      x.beginPath();
      for (i = 0; i < q.length; i += 2) {
        j = (i + 2) % q.length;
        ax = X(q[i]); ay = Y(q[i + 1]); bx = X(q[j]); by = Y(q[j + 1]);
        if ((Math.abs(by - ay) >= Math.abs(bx - ax)) === !!k) continue;   // k 0: steep edges, k 1: flat ones
        s = (bx - ax) * oy - (by - ay) * ox > 0;   // every quad wound the same way, so nonzero fills their union
        x.moveTo(s ? ax : bx, s ? ay : by); x.lineTo(s ? bx : ax, s ? by : ay);
        x.lineTo((s ? bx : ax) + ox, (s ? by : ay) + oy); x.lineTo((s ? ax : bx) + ox, (s ? ay : by) + oy); x.closePath();
      }
      F(x, css(shA(c, k ? -.34 : -.56)));
    }
    pth(x, q, 0, B, K, 50, 100);
    F(x, n ? face(x, c) : css(c));
    if (P.d >= 6 && !P.r) hilite(x, 2.6);
  }
  // A lathe part. Faceted: each face that looks at us, shaded by the light from the upper left.
  // Round: one band per profile segment with a cylinder gradient, over a base fill that hides the seams.
  function lathe2d(x, P, c) {
    var q = P.p, n = P.n, fc = n <= 8, k = fc ? 1 / Math.cos(Math.PI / n) : 1, j, i, a, b, m, nz, dl, sc, r0, r1, rm, g;
    if (fc) for (j = 0; j < n; j++) {
      a = (P.a0 + j * 360 / n) * D2R; b = a + 2 * Math.PI / n; m = (a + b) / 2; nz = -Math.sin(m);
      if (nz < .02) continue;
      dl = (-.4 * Math.cos(m) + .6 * nz) / .721;
      sc = shA(c, -.42 + .62 * Math.max(0, dl));
      x.beginPath();
      for (i = 0; i < q.length; i += 2) x.lineTo(X(P.ax + q[i] * k * Math.cos(a)), Y(q[i + 1]));
      for (i = q.length - 2; i >= 0; i -= 2) x.lineTo(X(P.ax + q[i] * k * Math.cos(b)), Y(q[i + 1]));
      x.closePath();
      F(x, lin(x, 0, Y(q[1]), 0, Y(q[q.length - 1]), [0, css(shA(sc, .12)), 1, css(shA(sc, -.14))]));
    } else {
      x.beginPath();
      for (i = 0; i < q.length; i += 2) x.lineTo(X(P.ax - q[i]), Y(q[i + 1]));
      for (i = q.length - 2; i >= 0; i -= 2) x.lineTo(X(P.ax + q[i]), Y(q[i + 1]));
      F(x, css(shA(c, -.12)));
      for (i = 0; i < q.length - 2; i += 2) {
        r0 = q[i]; r1 = q[i + 2]; rm = Math.max(r0, r1);
        if (rm < .05 || Math.abs(q[i + 3] - q[i + 1]) < .05) continue;
        x.beginPath();
        x.moveTo(X(P.ax - r0), Y(q[i + 1])); x.lineTo(X(P.ax + r0), Y(q[i + 1]));
        x.lineTo(X(P.ax + r1), Y(q[i + 3])); x.lineTo(X(P.ax - r1), Y(q[i + 3])); x.closePath();
        g = [0, css(shA(c, -.25)), .3, css(shA(c, .32)), .66, css(c), 1, css(shA(c, -.5))];
        F(x, lin(x, X(P.ax - rm), 0, X(P.ax + rm), 0, g));
      }
    }
  }
  // Painted-only touches, cheap and small: Pisa’s gallery columns, the pyramid’s courses, the torch’s glow
  function detail2d(x, sh0, c) {
    var i, j, y, v;
    x.beginPath();
    if (sh0 === 'pisa') {
      x.translate(0, B); x.rotate(5.5 * D2R); x.translate(0, -B);
      for (y = 17.4; y < 70; y += 12) for (j = -2; j <= 2; j++) {
        v = 50 + 11.6 * Math.sin(j * 32 * D2R);
        x.moveTo(X(v), Y(y + 1.4)); x.lineTo(X(v), Y(y + 9.2));
      }
      S(x, 1.3, css(shA(c, .2)));
    } else if (sh0 === 'pyramid') {
      for (y = 30; y < 99; y += 6.5) { v = 31 * (y - 22) / 78 * 1.414; x.moveTo(X(44 - v), Y(y)); x.lineTo(X(44 + v), Y(y)); }
      S(x, .8, 'rgba(70,40,10,.2)');
    } else if (sh0 === 'liberty') {
      x.arc(X(41.4), Y(3), 13, 0, 7); F(x, rad(x, X(41.4), Y(3), 0, X(41.4), Y(3), 13, [0, 'rgba(255,200,90,.55)', 1, 'rgba(255,200,90,0)']));
    } else if (sh0 === 'sagrada') {
      for (i = 0; i < 4; i++) for (y = (i % 3 ? 20 : 27); y < 58; y += 5) { x.moveTo(X([27, 39.5, 60.5, 73][i]) + 1.2, Y(y)); x.arc(X([27, 39.5, 60.5, 73][i]), Y(y), 1.2, 0, 7); }
      F(x, 'rgba(60,36,14,.4)');
    }
  }
  function model(x, s) {
    var M = MOD[s.shape], c = rgb(s.color || '#d8c3a0'), i, P;
    plinth(x);
    for (i = 0; i < M.length; i++) {
      P = M[i];
      x.save();
      if (P.tilt) { x.translate(0, B); x.rotate(P.tilt * D2R); x.translate(0, -B); }
      if (P.t === 'l') lathe2d(x, P, tone(c, P.c)); else poly2d(x, P, tone(c, P.c));
      x.restore();
    }
    x.save(); detail2d(x, s.shape, c); x.restore();
  }
  function draw(x, spec, cx, cy, size, rot) {
    spec = spec || {};
    x.save(); x.translate(cx, cy); if (rot) x.rotate(rot); x.scale(size / 200, size / 200);
    try { (spec.shape === 'flag' ? flag2d : MOD[spec.shape] ? model : landmark)(x, spec); } catch (e) { /* never break a card */ }
    x.restore();
  }

  // The brief hero’s fan in CSS px, shared with gl.js so the static paint and GL line up through the cross-fade.
  // s is the centre item’s box; the side items sit dx either side, k times smaller, dy lower and rolled by r.
  // Tight enough that three showcase-sized items (s ≈ 140 px in a 330 px slot) fit without clipping.
  function heroBox(w, h) {
    var s = Math.min(h * .98, w / 2.35);
    return { s: s, dx: .74 * s, dy: .06 * s, k: .82, r: .16 };
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
      s = heroBox(w, h);
      draw(x, o.specs[0], w / 2 - s.dx, h / 2 + s.dy, s.s * s.k, -s.r);
      draw(x, o.specs[2], w / 2 + s.dx, h / 2 + s.dy, s.s * s.k, s.r);
      draw(x, o.specs[1], w / 2, h / 2, s.s, 0);
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
    // Shared with gl.js: the flag painter and its aspect, the outlines, the parsed models and their colours
    _flag: flag,
    _flagAspect: flagAspect,
    _flagLayout: FLAG,
    _shapes: SHAPES,
    _models: MOD,
    _tone: tone,
    _heroBox: heroBox,
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
