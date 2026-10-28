// Curate game WebGL1 renderer. Lazy: objects.js injects it after first paint and the game is complete without it.
// No library. One context and one <canvas>, moved into the live object’s slot (the top card or the brief hero),
// so it rides the card’s CSS transform during drag and fly-out. Any failure falls back to the static paint.
(function () {
  var CO = window.CurateObjects || null;
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var PI = Math.PI, D2R = PI / 180;

  // ---- Helpers ----
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgb(hex) {
    var h = String(hex || '#9013fe').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  // Column-major 4×4 matrices, as GL expects.
  function mul(a, b) {
    var o = new Float32Array(16), i, j;
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    return o;
  }
  function ident() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function trans(x, y, z) { var m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scale(x, y, z) { var m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function rotY(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function rotX(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function rotZ(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function persp(fovy, asp, n, f) {
    var m = new Float32Array(16), t = 1 / Math.tan(fovy / 2);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
    return m;
  }
  function nm3(m) { return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); }

  // ---- Geometry ----
  // Vertex: position 3, normal 3, uv 2, colour 4 (rgb, a = 1 multiplies by the tint), flags 2 (texture, two-sided).
  var STRIDE = 14, WHITE = [1, 1, 1, 1];
  function Geo() { this.v = []; this.i = []; this.n = 0; }
  Geo.prototype.add = function (p, n, u, c, f) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], u[0], u[1], c[0], c[1], c[2], c[3], f[0], f[1]);
    return this.n++;
  };
  Geo.prototype.quad = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };

  // Revolve a [[r, h], ...] profile about y. Each profile segment gets its own rings, so creases stay sharp;
  // round lathes smooth the normals across gentle turns (domes, minarets). n ≤ 8 is faceted: r is then the
  // apothem and every face is flat (pyramid, Big Ben, Burj). a0 turns it, in degrees. col: [r, g, b, a] or col(k).
  function spin(g, q, n, a0, col) {
    var fc = n <= 8, R = fc ? 1 / Math.cos(PI / n) : 1, sn = [], k, j, s, a, b, m, l, nr, nh, base, c, r, h, e, t;
    for (k = 0; k < q.length - 1; k++) {
      nr = -(q[k + 1][1] - q[k][1]); nh = q[k + 1][0] - q[k][0]; l = Math.sqrt(nr * nr + nh * nh) || 1;
      sn.push([nr / l, nh / l]);
    }
    function nrm(k, s) {   // the normal at one end of segment k, averaged with its neighbour when the turn is gentle
      var o = sn[s ? k + 1 : k - 1];
      if (fc || !o || o[0] * sn[k][0] + o[1] * sn[k][1] < .8) return sn[k];
      var x = o[0] + sn[k][0], y = o[1] + sn[k][1], l = Math.sqrt(x * x + y * y) || 1;
      return [x / l, y / l];
    }
    for (k = 0; k < q.length - 1; k++) {
      c = typeof col === 'function' ? col(k) : col;
      base = g.n;
      for (j = 0; j < n; j++) {
        a = (a0 * D2R) + j * 2 * PI / n; b = a + 2 * PI / n; m = (a + b) / 2;
        for (e = 0; e < 2; e++) {   // the two edges of this face (or column of a round lathe)
          t = e ? b : a;
          for (s = 0; s < 2; s++) {
            r = q[k + s][0] * R; h = q[k + s][1];
            l = nrm(k, s);
            var na = fc ? m : t;
            g.add([r * Math.cos(t), h, -r * Math.sin(t)], [l[0] * Math.cos(na), l[1], -l[0] * Math.sin(na)], [j / n, 0], c, [0, 0]);
          }
        }
        g.quad(base + j * 4, base + j * 4 + 2, base + j * 4 + 3, base + j * 4 + 1);
      }
    }
  }
  // Move the vertices of g from index i0 on, then lean them about z through the base centre
  function place(g, i0, dx, dy, dz, lean) {
    var v = g.v, c = Math.cos(lean || 0), s = Math.sin(lean || 0), i, x, y;
    for (i = i0 * STRIDE; i < v.length; i += STRIDE) {
      v[i] += dx; v[i + 1] += dy; v[i + 2] += dz;
      if (lean) {   // about the base centre, after the move
        x = v[i]; y = v[i + 1]; v[i] = c * x - s * y; v[i + 1] = s * x + c * y;
        x = v[i + 3]; y = v[i + 4]; v[i + 3] = c * x - s * y; v[i + 4] = s * x + c * y;
      }
    }
  }

  function area(pts) {
    var s = 0, i, n = pts.length / 2, j;
    for (i = 0; i < n; i++) { j = (i + 1) % n; s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; }
    return s / 2;
  }
  // Ear clipping for simple polygons without holes (≤ 32 points, so O(n³) is nothing). pts is CCW.
  function earclip(pts) {
    var V = [], out = [], n = pts.length / 2, i, guard = 0;
    for (i = 0; i < n; i++) V.push(i);
    function X(k) { return pts[k * 2]; }
    function Y(k) { return pts[k * 2 + 1]; }
    function cross(a, b, c) { return (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a)); }
    function inside(p, a, b, c) { return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0; }
    while (V.length > 3 && guard++ < 500) {
      var m = V.length, found = false;
      for (i = 0; i < m; i++) {
        var a = V[(i + m - 1) % m], b = V[i], c = V[(i + 1) % m], ok = cross(a, b, c) > 1e-9, q;
        for (q = 0; ok && q < m; q++) {
          var v = V[q];
          if (v !== a && v !== b && v !== c && inside(v, a, b, c)) ok = false;
        }
        if (ok) { out.push(a, b, c); V.splice(i, 1); found = true; break; }
      }
      if (!found) break;   // degenerate input: fan what is left
    }
    for (i = 1; i < V.length - 1; i++) out.push(V[0], V[i], V[i + 1]);
    return out;
  }

  // Extrude a CCW outline along z, with a chamfer ring front and back. o: { cap, side }.
  function extrude(g, pts, depth, ch, o) {
    if (area(pts) < 0) { var r = []; for (var q = pts.length - 2; q >= 0; q -= 2) r.push(pts[q], pts[q + 1]); pts = r; }
    var n = pts.length / 2, z = depth / 2, ins = [], en = [], i, j, k;
    for (i = 0; i < n; i++) {   // outward edge normals
      j = (i + 1) % n;
      var dx = pts[j * 2] - pts[i * 2], dy = pts[j * 2 + 1] - pts[i * 2 + 1], l = Math.sqrt(dx * dx + dy * dy) || 1;
      en.push(dy / l, -dx / l);
    }
    for (i = 0; i < n; i++) {   // inset outline (mitred) for the caps
      k = (i + n - 1) % n;
      var ax = en[k * 2] + en[i * 2], ay = en[k * 2 + 1] + en[i * 2 + 1], d = 1 + en[k * 2] * en[i * 2] + en[k * 2 + 1] * en[i * 2 + 1];
      d = Math.max(d, .5);
      ins.push(pts[i * 2] - ax * ch / d, pts[i * 2 + 1] - ay * ch / d);
    }
    var tri = earclip(ins), cap = o.cap || WHITE, side = o.side || cap, s, b, t, F = [0, 0];
    for (s = 1; s >= -1; s -= 2) {   // front then back cap
      b = g.n;
      for (i = 0; i < n; i++) {
        var x = ins[i * 2], y = ins[i * 2 + 1];
        g.add([x, y, z * s], [0, 0, s], F, cap, F);
      }
      for (t = 0; t < tri.length; t++) g.i.push(b + tri[t]);
    }
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var nx = en[i * 2], ny = en[i * 2 + 1], c7 = .7071;
      var o0 = [pts[i * 2], pts[i * 2 + 1]], o1 = [pts[j * 2], pts[j * 2 + 1]];
      var i0 = [ins[i * 2], ins[i * 2 + 1]], i1 = [ins[j * 2], ins[j * 2 + 1]], zc = z - ch;
      b = g.n;   // wall
      g.add([o0[0], o0[1], zc], [nx, ny, 0], [0, 0], side, F); g.add([o1[0], o1[1], zc], [nx, ny, 0], [0, 0], side, F);
      g.add([o1[0], o1[1], -zc], [nx, ny, 0], [0, 0], side, F); g.add([o0[0], o0[1], -zc], [nx, ny, 0], [0, 0], side, F);
      g.quad(b, b + 1, b + 2, b + 3);
      if (!ch) continue;
      for (s = 1; s >= -1; s -= 2) {   // chamfers
        b = g.n;
        var cn = [nx * c7, ny * c7, s * c7];
        g.add([i0[0], i0[1], z * s], cn, [0, 0], side, F); g.add([i1[0], i1[1], z * s], cn, [0, 0], side, F);
        g.add([o1[0], o1[1], zc * s], cn, [0, 0], side, F); g.add([o0[0], o0[1], zc * s], cn, [0, 0], side, F);
        g.quad(b, b + 1, b + 2, b + 3);
      }
    }
  }

  // Centre a group of Geos on its box and scale the larger of its half-width and half-height to 1, the way
  // the static painter fits its box (a bounding sphere made the landmarks on plinths look small).
  function normalise(geos) {
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], c = [], R, g, i, k, v;
    for (g = 0; g < geos.length; g++) for (v = geos[g].v, i = 0; i < v.length; i += STRIDE) for (k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]);
    }
    for (k = 0; k < 3; k++) c[k] = (lo[k] + hi[k]) / 2;
    R = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2;
    for (g = 0; g < geos.length; g++) for (v = geos[g].v, i = 0; i < v.length; i += STRIDE) {
      for (k = 0; k < 3; k++) v[i + k] = (v[i + k] - c[k]) / R;
    }
    return (lo[1] - c[1]) / R;   // floor height, for the shadow
  }

  // Outlines and models come from objects.js (0..100 box, y down, base at 100), so GL and the static paint match.
  // Box units to GL: centred on x, y up, landmarks standing on y = 0; SC matches the old .85 outline scale.
  var SC = .017;
  function outline(name) {
    var S = CO && CO._shapes && CO._shapes[name], p = [], i;
    if (!S || S.length < 6) S = [10, 100, 90, 100, 90, 20, 10, 20];   // plain block if the shape is missing
    for (i = 0; i < S.length; i += 2) p.push((S[i] - 50) * SC, (100 - S[i + 1]) * SC);
    return p;
  }
  // Plinth colours sit a little under the static ones (top #2e1866 to #1a073d, lip around #a58344): warm light lifts them
  var DARK = [.07, .022, .17, 0], GOLD = [.6, .48, .24, 0];
  function plinth() {
    var g = new Geo();
    spin(g, [[0, 0], [.95, 0], [1, -.04], [1, -.13], [.94, -.17], [0, -.17]], 48, 0,
      function (k) { return k > 0 && k < 4 ? GOLD : DARK; });
    return g;
  }
  // A multi-part landmark: parts of the same metalness share one Geo (one draw), colours baked in
  function model(M, color) {
    var groups = {}, geos = [], parts = [], i, j, P, g, i0, c, q, d, k, main;
    main = (function (h) { var n = parseInt(String(h || '#d8c3a0').slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; })(color);
    for (i = 0; i < M.length; i++) {
      P = M[i];
      g = groups[P.m] || (groups[P.m] = new Geo());
      c = CO._tone(main, P.c);
      c = [c[0] / 255, c[1] / 255, c[2] / 255, 0];
      i0 = g.n;
      if (P.t === 'l') {
        for (q = [], j = 0; j < P.p.length; j += 2) q.push([P.p[j] * SC, (100 - P.p[j + 1]) * SC]);
        spin(g, q, P.n, P.a0, c);
        place(g, i0, (P.ax - 50) * SC, 0, P.z * SC, -P.tilt * D2R);
      } else {
        for (q = [], j = 0; j < P.p.length; j += 2) q.push((P.p[j] - 50) * SC, (100 - P.p[j + 1]) * SC);
        d = P.d * SC;
        // A chamfer only where the part is thick enough for its inset (not on ribbons and hangers)
        k = Math.abs(area(q)) / perim(q);
        extrude(g, q, d, d > .1 && k > .025 ? .012 : 0, { cap: c, side: [c[0] * .72, c[1] * .72, c[2] * .72, 0] });
        for (j = i0 * STRIDE; j < g.v.length; j += STRIDE) {   // lit from the top, like the static face gradient
          k = .84 + .26 * g.v[j + 1] / 1.7;
          g.v[j + 8] *= k; g.v[j + 9] *= k; g.v[j + 10] *= k;
        }
        place(g, i0, 0, 0, P.z * SC, -P.tilt * D2R);
      }
    }
    for (k in groups) { geos.push(groups[k]); parts.push({ g: groups[k], metal: +k, rim: .3, warm: 1 }); }
    g = plinth(); geos.push(g); parts.push({ g: g, metal: .1, rim: .25, warm: 1 });
    return { parts: parts, floor: normalise(geos) };
  }
  function perim(q) {
    for (var s = 0, n = q.length / 2, i = 0, j; i < n; i++) {
      j = (i + 1) % n; s += Math.sqrt(Math.pow(q[j * 2] - q[i * 2], 2) + Math.pow(q[j * 2 + 1] - q[i * 2 + 1], 2));
    }
    return s || 1;
  }

  // ---- Flag ----
  // A brass pole on a little stand and a cloth grid whose vertices the CPU moves each frame (≤ 400 vertices,
  // one dynamic buffer, only while it is the live object). Layout from objects.js (÷ 82, y up) to match the paint.
  var CNX = 24, CNY = 14, FU = 1 / 82, BRASS = [.86, .7, .4, 0];
  function flagMesh(spec) {
    var L = (CO && CO._flagLayout) || { pole: -56, x0: -54, y0: -77, w: 142, base: 74, top: -86 },
      a = CO && CO._flagAspect ? CO._flagAspect(spec.flag) : 1.5, w = (a > 1.2 ? L.w : 104) * FU, px = L.pole * FU,
      g = new Geo(), q = [], i, j, top = -L.top * FU, cl, v, idx = [], k;
    spin(g, [[0, -.896], [.29, -.896], [.305, -.906], [.305, -.955], [.29, -.963], [0, -.963]], 32, 0,
      function (k) { return k > 0 && k < 4 ? GOLD : DARK; });
    spin(g, [[.03, top - .03], [.03, -.896]], 12, 0, BRASS);
    for (i = 0; i <= 6; i++) q.push([.058 * Math.sin(i * PI / 6), top + .058 * Math.cos(i * PI / 6)]);
    spin(g, q, 12, 0, BRASS);
    i = g.n;   // the finial’s spike, leaning towards the fly
    spin(g, [[0, .14], [.024, 0]], 8, 0, BRASS);
    place(g, i, 0, 0, 0, -.42); place(g, i, 0, top + .02, 0);
    place(g, 0, px, 0, 0);
    cl = { x0: L.x0 * FU, y0: -L.y0 * FU, w: w, h: w / a, t: -1, v: new Float32Array((CNX + 1) * (CNY + 1) * STRIDE) };
    for (v = cl.v, j = 0; j <= CNY; j++) for (i = 0; i <= CNX; i++) {
      k = (j * (CNX + 1) + i) * STRIDE;
      v[k + 6] = i / CNX; v[k + 7] = j / CNY;   // uv: hoist on the left, v up (the texture is flipped on upload)
      // Textured, two-sided; the dye (.84) keeps the lit cloth near the painted colours
      v[k + 8] = v[k + 9] = v[k + 10] = .84; v[k + 11] = 0; v[k + 12] = 1; v[k + 13] = 1;
      if (i < CNX && j < CNY) {
        k = j * (CNX + 1) + i;
        idx.push(k, k + 1, k + CNX + 2, k, k + CNX + 2, k + CNX + 1);
      }
    }
    cloth(cl, 0);
    return { parts: [{ g: g, metal: .6, rim: .3, warm: 1 }, { cl: cl, idx: idx, metal: 0, rim: .12, warm: 1, tex: 1 }], floor: -.963 };
  }
  // The travelling wave, in depth, rising away from the pole; normals from its slope. tc in seconds.
  function cloth(cl, tc) {
    var v = cl.v, W = cl.w, H = cl.h, i, j, k, u, s, ph, A, z, zu, zw, nx, ny, nz, l;
    cl.t = tc;
    for (j = 0; j <= CNY; j++) for (i = 0; i <= CNX; i++) {
      u = i / CNX; s = j / CNY; k = (j * (CNX + 1) + i) * STRIDE;
      ph = 2 * PI * (1.3 * u - .75 * tc) - 1.2 + .7 * (1 - s);
      A = .15 * u;
      z = A * Math.sin(ph);
      zu = .15 * Math.sin(ph) + A * Math.cos(ph) * 2 * PI * 1.3;
      zw = -A * Math.cos(ph) * .7;
      // x gathers a little where the cloth swings out; y lifts with the wave as in the painted flag
      v[k] = cl.x0 + u * W - .03 * u * (1 - Math.cos(ph));
      v[k + 1] = cl.y0 - H + s * H - .049 * u * u - .06 * u * Math.sin(ph); v[k + 2] = z;
      nx = -zu * H; ny = -W * zw; nz = W * H; l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      v[k + 3] = nx / l; v[k + 4] = ny / l; v[k + 5] = nz / l;
    }
  }

  // Each shape is a list of parts (one draw each: { g, metal, rim, warm, tex } or a cloth { cl, idx }) and its floor.
  function build(spec) {
    var shape = spec.shape, M = CO && CO._models && CO._models[shape], g, g2, i, q;
    if (shape === 'flag') return flagMesh(spec);
    if (M && CO._tone) return model(M, spec.color);
    q = outline(shape);
    g = new Geo();
    extrude(g, q, .18, .02, { cap: WHITE, side: [.62, .6, .66, 1] });
    for (i = 0; i < g.v.length; i += STRIDE) {   // lit from the top, like the static face gradient (1.12 to .8)
      var vk = .8 + .32 * g.v[i + 1] / 1.7;
      g.v[i + 8] *= vk; g.v[i + 9] *= vk; g.v[i + 10] *= vk;
      g.v[i + 1] += .001;
    }
    g2 = plinth();
    return { parts: [{ g: g, metal: .25, rim: .3, warm: 1 }, { g: g2, metal: .1, rim: .25, warm: 1 }], floor: normalise([g, g2]) };
  }

  // ---- GL setup ----
  var VS = [
    'attribute vec3 aP,aN;attribute vec2 aU,aF;attribute vec4 aC;',
    'uniform mat4 uM,uVP;uniform mat3 uNM;',
    'varying vec3 vW,vN,vO;varying vec2 vU,vF;varying vec4 vC;',
    'void main(){vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=uNM*aN;vO=aP;vU=aU;vF=aF;vC=aC;',
    'gl_Position=uVP*w;}'
  ].join('\n');
  // Lambert + hemisphere ambient + Blinn + a procedural softbox for metals + a Fresnel rim tinted by the Curate
  // status (iridescent when uRimMix is 0) + dissolve. highp only where the GPU has it (the dissolve hash).
  // The cloth is two-sided: its back faces flip their normal.
  // uWarm = 1 for landmarks: neutral ambient, rim scaled by surface lightness and a luminance-only exposure curve,
  // so sandstone stays sandstone (per-channel exposure and violet ambient turned it grey-lavender).
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'uniform vec3 uTint,uRim;uniform float uRimK,uRimMix,uMetal,uTexOn,uDis,uAlpha,uMode,uT,uWarm;',
    'uniform sampler2D uTex;',
    'varying vec3 vW,vN,vO;varying vec2 vU,vF;varying vec4 vC;',
    'float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}',
    'void main(){',
    ' if(uMode>.5){float a=(1.-smoothstep(.15,1.,length(vU*2.-1.)))*.45*uAlpha;',
    '  gl_FragColor=vec4(vec3(.027,0.,.102)*a,a);return;}',
    ' float hs=hash(floor(vO*18.));if(hs<uDis)discard;',
    ' vec3 n=normalize(vN),v=normalize(vec3(0.,.35,4.2)-vW),l=normalize(vec3(-.4,.8,.6));',
    ' if(vF.y>.5&&!gl_FrontFacing)n=-n;',
    ' vec3 base=mix(vC.rgb,vC.rgb*uTint,vC.a);',
    ' vec4 tx=texture2D(uTex,vU);',
    ' base=mix(base,tx.rgb*vC.rgb,tx.a*vF.x*uTexOn);',
    ' float d=max(dot(n,l),0.);',
    ' float hy=.5+.5*n.y;',
    ' vec3 amb=mix(mix(vec3(.059,.039,.18),vec3(.227,.165,.478),hy),mix(vec3(.09,.08,.08),vec3(.30,.28,.26),hy),uWarm);',
    ' float sp=pow(max(dot(n,normalize(l+v)),0.),mix(18.,64.,uMetal))*mix(.3,1.,uMetal);',
    ' float box=smoothstep(.85,.98,dot(reflect(-v,n),normalize(vec3(-.4,.7,.6))))*2.*uMetal;',
    ' vec3 c=base*(amb*1.2+d*(1.05-.45*uMetal)+mix(.3,.22,uWarm)*max(dot(n,v),0.))+(sp+box)*mix(vec3(1.),base+.2,uMetal*.6);',
    ' float f=pow(1.-max(dot(n,v),0.),2.5);',
    ' vec3 iri=mix(vec3(.753,.518,1.),vec3(.153,.804,.996),.5+.5*sin(f*6.+uT*.6));',
    // warm: the idle iridescence stays faint, a status rim comes back to about full strength so it still reads
    ' c+=f*mix(iri,uRim,uRimMix)*1.3*uRimK*mix(1.,(.15+.85*dot(base,vec3(.299,.587,.114)))*(1.+2.*uRimMix),uWarm);',
    ' if(uDis>0.&&hs<uDis+.07)c=mix(vec3(1.,.15,.1),vec3(1.,.7,.25),(hs-uDis)/.07)*1.4;',
    ' float L=dot(c,vec3(.299,.587,.114));',   // warm: near-linear with a soft shoulder, on luminance only
    ' c=mix(c/(c+.6)*1.25,min(c*4./(L+3.),vec3(1.)),uWarm);',
    ' gl_FragColor=vec4(c*uAlpha,uAlpha);',
    '}'
  ].join('\n');
  var gl = null, canvas = null, prog = null, A = {}, U = {}, quadBuf = null, whiteTex = null, dead = false;

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function setupGL() {
    if (/[?&]lite=1\b/.test(location.search) || !window.WebGLRenderingContext) return false;
    canvas = document.createElement('canvas');
    canvas.className = 'obj-gl';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0';
    var opt = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true };
    try { gl = canvas.getContext('webgl', opt) || canvas.getContext('experimental-webgl', opt); } catch (e) { gl = null; }
    if (!gl) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var i, names = ['aP', 'aN', 'aU', 'aC', 'aF'];
    for (i = 0; i < names.length; i++) A[names[i]] = gl.getAttribLocation(prog, names[i]);
    names = ['uM', 'uVP', 'uNM', 'uTint', 'uRim', 'uRimK', 'uRimMix', 'uMetal', 'uTexOn', 'uDis', 'uAlpha', 'uMode', 'uT', 'uTex', 'uWarm'];
    for (i = 0; i < names.length; i++) U[names[i]] = gl.getUniformLocation(prog, names[i]);
    for (i in A) if (A[i] >= 0) gl.enableVertexAttribArray(A[i]);
    // Shadow quad on the floor plane, uv 0..1 for the radial falloff.
    var q = new Geo(), F = [0, 0], N = [0, 1, 0];
    q.add([-1, 0, -1], N, [0, 0], WHITE, F); q.add([1, 0, -1], N, [1, 0], WHITE, F);
    q.add([-1, 0, 1], N, [0, 1], WHITE, F); q.add([1, 0, 1], N, [1, 1], WHITE, F);
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q.v), gl.STATIC_DRAW);
    whiteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 0]));
    gl.uniform1i(U.uTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied output
    gl.clearColor(0, 0, 0, 0);
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); fail('lost'); }, false);
    return true;
  }

  // Meshes are built lazily and kept for the session: per shape for the Mumbai outlines (the tint is a uniform),
  // per shape and colour for the models (colours baked in), per aspect for flags (the texture carries the design).
  // A cloth keeps its CPU vertices and a DYNAMIC buffer; every other part frees its CPU copy.
  var meshes = {};
  function meshKey(spec) {
    var s = spec.shape || 'block';
    if (s === 'flag') return s + (CO && CO._flagAspect ? CO._flagAspect(spec.flag) : 1.5);
    return CO && CO._models && CO._models[s] ? s + spec.color : s;
  }
  function meshFor(spec) {
    var key = meshKey(spec);
    if (meshes[key]) return meshes[key];
    var m = build(spec), i, p, cl;
    for (i = 0; i < m.parts.length; i++) {
      p = m.parts[i]; cl = p.cl;
      p.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, cl ? cl.v : new Float32Array(p.g.v), cl ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      p.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cl ? p.idx : p.g.i), gl.STATIC_DRAW);
      p.count = cl ? p.idx.length : p.g.i.length;
      p.g = p.idx = null;   // free the CPU copy
    }
    return (meshes[key] = m);
  }
  function bindAttrs(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var b = STRIDE * 4;
    gl.vertexAttribPointer(A.aP, 3, gl.FLOAT, false, b, 0);
    gl.vertexAttribPointer(A.aN, 3, gl.FLOAT, false, b, 12);
    gl.vertexAttribPointer(A.aU, 2, gl.FLOAT, false, b, 24);
    gl.vertexAttribPointer(A.aC, 4, gl.FLOAT, false, b, 32);
    gl.vertexAttribPointer(A.aF, 2, gl.FLOAT, false, b, 48);
  }

  // ---- Textures ----
  // Flag cloths take the shared painter’s flag (objects.js _flag), stretched onto a power-of-two canvas so it can
  // be mipmapped (the cloth stretches it back). Uploaded once per design; LRU of 6, never evicting one on screen.
  var texs = {}, texKeys = [];
  function texFor(spec, inUse) {
    if (!spec || spec.shape !== 'flag' || !CO || !CO._flag) return null;
    var f = spec.flag || {}, key = JSON.stringify(f), t = texs[key], i, a, src, c, x;
    if (t) { texKeys.splice(texKeys.indexOf(key), 1); texKeys.push(key); return t; }
    a = CO._flagAspect ? CO._flagAspect(f) : 1.5;
    src = CO._flag(f, 384, Math.round(384 / a));
    c = document.createElement('canvas'); c.width = a > 1.2 ? 512 : 256; c.height = 256;
    x = c.getContext('2d');
    if (!x || !src || !src.width) return null;
    x.drawImage(src, 0, 0, c.width, c.height);
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas rows run down, uv v runs up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texs[key] = t; texKeys.push(key);
    for (i = 0; texKeys.length > 6 && i < texKeys.length; i++) {   // evict the oldest that is not on screen
      if (inUse.indexOf(texs[texKeys[i]]) < 0) { gl.deleteTexture(texs[texKeys[i]]); delete texs[texKeys[i]]; texKeys.splice(i--, 1); }
    }
    return t;
  }

  // ---- Hosting ----
  var RIM = { pending: '#6cc5ff', challenge: '#ffc46b', listed: '#65dc7f', leak: '#ff5a78', overruled: '#ff5a78' };
  var host = null, objs = [], VP = null, view = null, cw = 0, ch = 0, unit = .8, raf = 0, last = 0, frameN = 0;
  var paused = false, reduced = RM, swayOn = true, dprCap = 2, ro = null;
  var tgt = { y: 0, p: 0 }, cur = { y: 0, p: 0 };
  var rim = [0, 0, 0], rimTo = [0, 0, 0], rimMix = 0, rimMixTo = 0, st = 'none', stT = 0;

  function lookAt() {   // fixed camera: eye (0, .35, 4.2) on the origin
    var e = [0, .35, 4.2], l = Math.sqrt(e[1] * e[1] + e[2] * e[2]), zy = e[1] / l, zz = e[2] / l;
    var m = ident();
    m[5] = zz; m[6] = zy; m[9] = -zy; m[10] = zz;
    m[13] = -(zz * e[1] - zy * e[2]); m[14] = -(zy * e[1] + zz * e[2]);
    return m;
  }
  // Size the backing store to the slot: DPR ≤ 2 and ≤ 700k pixels. Layout size, so card transforms do not count.
  function resize() {
    if (!host) return false;
    var w = host.clientWidth, h = host.clientHeight, d = Math.min(window.devicePixelRatio || 1, dprCap), bw, bh;
    if (!w || !h) return false;
    if (w * h * d * d > 7e5) d = Math.sqrt(7e5 / (w * h));
    bw = Math.round(w * d); bh = Math.round(h * d);
    if (canvas.width !== bw || canvas.height !== bh || cw !== w || ch !== h) {
      canvas.width = bw; canvas.height = bh; cw = w; ch = h;
      VP = mul(persp(30 * D2R, w / h, .1, 20), view);
      // World units per CSS pixel at the object’s depth. Sizes match the static paint, so the cross-fade does not jump.
      var px = 2 * 4.2 * Math.tan(15 * D2R) / h, hb = heroBox(w, h), n = objs.length, i, sd;
      unit = n > 1 ? .39 * hb.s * px : .385 * Math.min(w, h) * px;
      for (i = 0; i < n; i++) {
        sd = n > 1 && i !== 1;
        objs[i].x = n > 1 ? (i - 1) * hb.dx * px : 0;
        objs[i].y = sd ? -hb.dy * px : 0;
        objs[i].k = sd ? hb.k : 1;
        objs[i].roll = n > 1 ? (1 - i) * hb.r : 0;   // the static fan leans the side items out
      }
    }
    return true;
  }
  // The hero fan in CSS px from objects.js; the old layout covers a stale cached objects.js without _heroBox.
  function heroBox(w, h) {
    if (CO && CO._heroBox) return CO._heroBox(w, h);
    var s = Math.min(h * 1.02, w / 2.7);
    return { s: s, dx: .86 * s, dy: .06 * s, k: .8, r: .16 };
  }
  function inst(spec, i, n) {
    spec = spec || {};
    var used = [], k;
    for (k = 0; k < objs.length; k++) used.push(objs[k].tex);
    return { mesh: meshFor(spec), tex: texFor(spec, used), tint: rgb(spec.color), x: 0, y: 0, k: 1, roll: 0,
      fan: n > 1 ? (i - 1) * 18 * D2R : 0, ph: i * 2.1, s: reduced ? 1 : .85, sv: 0 };
  }
  function setState(s, instant) {
    st = s || 'none'; stT = now();
    if (st !== 'rejected') {
      rimMixTo = RIM[st] ? 1 : 0;
      if (RIM[st]) rimTo = rgb(RIM[st]);
    }
    if (instant) { rim = rimTo.slice(); rimMix = rimMixTo; }
  }
  function detach() {
    stop();
    if (ro && host) ro.unobserve(host);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    host = null; objs = []; cw = ch = 0;
  }
  function attach(el, co) {
    host = el; objs = [];
    var specs = co.size === 'hero' && co.specs ? co.specs : [co.spec], i;
    for (i = 0; i < specs.length; i++) objs.push(inst(specs[i], i, specs.length));
    tgt.y = cur.y = reduced ? 0 : (+co.ty || 0) * D2R; tgt.p = cur.p = reduced ? 0 : -(+co.tp || 0) * D2R;
    fx = { dis: 0, alpha: 1, shake: 0, pulse: 1 };
    setState(co.st, true);
    var cs = canvas.style;
    cs.transition = ''; cs.opacity = '0';
    el.appendChild(canvas);
    if (ro) ro.observe(el);
    if (resize()) draw(now());
    void canvas.offsetWidth;   // commit opacity 0 so the 120 ms cross-fade runs
    cs.transition = reduced ? '' : 'opacity .12s';
    cs.opacity = '1';
    kick();
    idle(prebuild);
  }
  function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 2000 }); else setTimeout(fn, 200); }
  // Build the shapes of the cards behind the top one in idle time, so the next live() is instant.
  function prebuild() {
    if (dead || !document.querySelectorAll) return;
    var els = document.querySelectorAll('.obj'), i, j, co, used = [];
    for (i = 0; i < objs.length; i++) used.push(objs[i].tex);
    for (i = 0; i < els.length && i < 6; i++) {
      co = els[i]._co;
      if (!co || !co.specs) continue;
      for (j = 0; j < co.specs.length; j++) if (co.specs[j]) { meshFor(co.specs[j]); texFor(co.specs[j], used); }
    }
  }

  // ---- Motion and drawing ----
  var fx = { dis: 0, alpha: 1, shake: 0, pulse: 1 }, ivals = [], lastTs = 0, level = 0;

  // Advance springs and reactions by dt seconds. Returns true while anything still moves.
  function update(dt, t) {
    var e = t - stT, busy = false, k = 1 - Math.exp(-dt / .04), i, o;
    var ty = reduced ? 0 : tgt.y, tp = reduced ? 0 : tgt.p + (st === 'leak' ? 20 * D2R : 0);
    cur.y += (ty - cur.y) * k; cur.p += (tp - cur.p) * k;   // drag tilt, smoothed over about 120 ms
    if (Math.abs(ty - cur.y) + Math.abs(tp - cur.p) > 1e-3) busy = true;
    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      if (!reduced) {   // drop-in spring from .85
        o.sv += (180 * (1 - o.s) - 14 * o.sv) * dt; o.s += o.sv * dt;
        if (Math.abs(1 - o.s) + Math.abs(o.sv) > 1e-3) busy = true; else { o.s = 1; o.sv = 0; }
      }
    }
    k = 1 - Math.exp(-dt / .05);   // rim fades over about 150 ms
    for (i = 0; i < 3; i++) { rim[i] += (rimTo[i] - rim[i]) * k; if (Math.abs(rimTo[i] - rim[i]) > 2e-3) busy = true; }
    rimMix += (rimMixTo - rimMix) * k;
    if (Math.abs(rimMixTo - rimMix) > 2e-3) busy = true;
    fx.dis = 0; fx.alpha = 1; fx.shake = 0; fx.pulse = 1;
    if (st === 'rejected') {
      if (reduced) fx.alpha = clamp(1 - e / 150, 0, 1); else fx.dis = clamp(e / 240, 0, 1);
      if (e < 260) busy = true;
    } else if (st === 'listed' && !reduced && e < 260) {
      fx.pulse = 1 + 1.2 * Math.sin(PI * e / 260); busy = true;
    } else if (st === 'overruled' && !reduced && e < 300) {
      fx.shake = 10 * D2R * Math.sin(e / 300 * 6 * PI) * (1 - e / 300); busy = true;
    }
    if (e < 320) busy = true;
    return busy;
  }

  function draw(t) {
    if (!VP || !objs.length) return;
    // The hero is a showcase: a slower, wider sway than a card (still no full spins)
    var i, j, o, p, M, R, sc, sw = swayOn && !reduced, hero = objs.length > 1, yaw, pitch, cl;
    var w = 2 * PI * t / (hero ? 8000 : 6000), ya = (hero ? 16 : 12) * D2R;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.uVP, false, VP);
    gl.uniform1f(U.uT, t / 1000);
    // Soft radial shadows first, without depth writes
    gl.depthMask(false);
    bindAttrs(quadBuf);
    gl.uniform1f(U.uMode, 1);
    gl.uniform1f(U.uAlpha, fx.alpha * (1 - fx.dis));
    for (i = 0; i < objs.length; i++) {
      o = objs[i]; sc = unit * o.k * o.s;
      gl.uniformMatrix4fv(U.uM, false, mul(trans(o.x, o.y + o.mesh.floor * sc - .03, 0), scale(sc * 1.05, 1, sc * .7)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.depthMask(true);
    gl.uniform3fv(U.uRim, [rim[0] * fx.pulse, rim[1] * fx.pulse, rim[2] * fx.pulse]);
    gl.uniform1f(U.uRimMix, rimMix);
    gl.uniform1f(U.uDis, fx.dis);
    gl.uniform1f(U.uAlpha, fx.alpha);
    gl.activeTexture(gl.TEXTURE0);
    for (i = 0; i < objs.length; i++) {
      o = objs[i]; sc = unit * o.k * o.s;
      yaw = o.fan + cur.y + fx.shake + (sw ? ya * Math.sin(w + o.ph) : 0);
      pitch = cur.p + (sw ? 5 * D2R * Math.cos(w * .8 + o.ph) : 0);
      R = mul(rotY(yaw), rotX(pitch));
      if (o.roll) R = mul(rotZ(o.roll), R);
      M = mul(trans(o.x, o.y, 0), mul(scale(sc, sc, sc), R));
      gl.uniform3fv(U.uTint, o.tint);
      gl.bindTexture(gl.TEXTURE_2D, o.tex || whiteTex);
      for (j = 0; j < o.mesh.parts.length; j++) {
        p = o.mesh.parts[j];
        gl.uniformMatrix3fv(U.uNM, false, nm3(R));
        gl.uniformMatrix4fv(U.uM, false, M);
        gl.uniform1f(U.uMetal, p.metal || 0);
        gl.uniform1f(U.uRimK, p.rim || 1);
        gl.uniform1f(U.uWarm, p.warm || 0);
        gl.uniform1f(U.uTexOn, p.tex && o.tex ? 1 : 0);
        gl.uniform1f(U.uMode, 0);
        cl = p.cl;
        // The cloth waves with the sway clock; reduced motion (or a slow device) keeps its last, gentle pose
        if (cl && sw && cl.t !== t / 1000) {
          cloth(cl, t / 1000);
          gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, cl.v);
        }
        bindAttrs(p.vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo); gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_SHORT, 0);
      }
    }
  }

  // rAF only while needed: visible page, a live object, something moving. Idle sway draws every other frame.
  function kick() {
    if (!raf && !paused && !dead && host && !document.hidden && window.requestAnimationFrame) raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf && window.cancelAnimationFrame) cancelAnimationFrame(raf);
    raf = 0; last = 0; lastTs = 0;
  }
  function loop(ts) {
    raf = 0;
    if (!host || paused || dead || document.hidden) { last = lastTs = 0; return; }
    var t = now(), dt = last ? clamp((t - last) / 1000, .001, .05) : 1 / 60, sw = swayOn && !reduced, busy;
    last = t;
    if (watchdog(ts)) return;
    if (!resize()) { last = lastTs = 0; return; }   // hidden slot: the ResizeObserver wakes us up
    busy = update(dt, t);
    frameN++;
    if (busy || !sw || !(frameN & 1)) draw(t);
    if (busy || sw) raf = requestAnimationFrame(loop); else last = lastTs = 0;
  }
  // Median frame interval over 45 frames: > 22 ms drops to DPR 1 without sway; still > 30 ms gives up on GL,
  // unless the cadence is a steady ~33 ms: that is a browser cap (iOS Low Power Mode, thermal), not a slow GPU.
  function watchdog(ts) {
    var d = lastTs ? ts - lastTs : 0;
    lastTs = ts;
    if (d > 0 && d < 250) ivals.push(d);
    if (ivals.length < 45) return false;
    var s = ivals.slice().sort(function (a, b) { return a - b; }), m = s[22], capped = m < 36 && s[33] - s[11] < 4;
    ivals = [];
    if (level === 0 && m > 22) { level = 1; dprCap = 1; swayOn = false; cw = 0; }
    else if (level === 1 && m > 30 && !capped) { fail('slow'); return true; }
    return false;
  }

  // ---- Failure ----
  // Context loss or a slow device: static paint for the rest of the session. objects.js owns the mode switch.
  function fail(why) {
    if (dead) return;
    dead = true;
    detach();
    if (why === 'slow') try { var x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ }
    if (CO && CO._static) CO._static();
    else try { document.dispatchEvent(new CustomEvent('curate:objects-mode', { detail: { mode: 'static' } })); } catch (e) { /* old browser */ }
  }

  // ---- Public API ----
  // The contract objects.js expects (see its header): init, live, tilt, state, pause, resume.
  // objects.js wraps every call in try/catch and drops to static on a throw.
  var api = {
    mode: 'gl',
    init: function (o) {
      o = o || {};
      if (gl) return !dead;
      if (o.reduced) reduced = true;
      paused = !!o.paused;
      var ok = false;
      try { ok = setupGL(); } catch (e) { ok = false; }
      if (!ok) { dead = true; return false; }
      view = lookAt();
      if (window.ResizeObserver) ro = new ResizeObserver(function () { cw = 0; kick(); });
      window.addEventListener('resize', function () { cw = 0; kick(); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else kick(); });
      return true;
    },
    // el: the .obj element; co: its el._co ({ spec, specs, size, st, ty, tp }). null detaches.
    live: function (el, co) {
      if (el && el === host) return;
      detach();
      if (dead || !el) return;
      attach(el, co || el._co || {});
    },
    tilt: function (el, yaw, pitch) {
      if (el !== host || dead) return;
      tgt.y = (+yaw || 0) * D2R; tgt.p = -(+pitch || 0) * D2R;   // CSS rotateX convention, as in the static tilt
      kick();
    },
    state: function (el, s) {
      if (el !== host || dead || s === st) return;
      setState(s, false);
      kick();
    },
    pause: function () { paused = true; stop(); },
    resume: function () { paused = false; kick(); }
  };

  // ---- Boot ----
  // objects.js registers us from the script’s onload; a direct call covers any other way of loading.
  window.CurateGL = api;
  if (CO && CO._on && CO._glReady) CO._glReady(api);
})();
