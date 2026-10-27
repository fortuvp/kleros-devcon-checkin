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
  // Vertex: position 3, normal 3, uv 2, colour 4 (rgb, a = 1 multiplies by the tint), flags 2 (texture, reeding).
  var STRIDE = 14, WHITE = [1, 1, 1, 1];
  function Geo() { this.v = []; this.i = []; this.n = 0; }
  Geo.prototype.add = function (p, n, u, c, f) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], u[0], u[1], c[0], c[1], c[2], c[3], f[0], f[1]);
    return this.n++;
  };
  Geo.prototype.quad = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };

  // Revolve a [r, h] profile around z (coin faces the camera) or y (plinths stand on the floor).
  // Each profile segment gets its own rings, so creases stay sharp. o: { axis, tex, reed (segment index), col(k), R }.
  function lathe(g, prof, segs, o) {
    var k, j, a, ca, sa, r0, h0, r1, h1, nr, nh, l, base, tex, reed, col, p, n, u, s;
    for (k = 0; k < prof.length - 1; k++) {
      r0 = prof[k][0]; h0 = prof[k][1]; r1 = prof[k + 1][0]; h1 = prof[k + 1][1];
      nr = -(h1 - h0); nh = r1 - r0; l = Math.sqrt(nr * nr + nh * nh) || 1; nr /= l; nh /= l;
      tex = o.tex || 0; reed = o.reed === k ? 1 : 0; col = o.col ? o.col(k) : WHITE;
      base = g.n;
      for (j = 0; j <= segs; j++) {
        a = j / segs * 2 * PI; ca = Math.cos(a); sa = Math.sin(a);
        for (s = 0; s < 2; s++) {
          var r = s ? r1 : r0, h = s ? h1 : h0;
          if (o.axis === 'y') { p = [r * ca, h, -r * sa]; n = [nr * ca, nh, -nr * sa]; }
          else { p = [r * ca, r * sa, h]; n = [nr * ca, nr * sa, nh]; }
          // Faces map the emblem flat (mirrored on the back); other rings carry the angle for the reeding.
          u = tex ? [.5 + (h < 0 ? -.5 : .5) * p[0] / o.R, .5 + .5 * p[1] / o.R] : [j / segs, 0];
          g.add(p, n, u, col, [tex, reed]);
        }
      }
      for (j = 0; j < segs; j++) g.quad(base + j * 2, base + j * 2 + 2, base + j * 2 + 3, base + j * 2 + 1);
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

  // Extrude a CCW outline along z, with a chamfer ring front and back. o: { cap, side, tex, uv(x, y) }.
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
    var tri = earclip(ins), cap = o.cap || WHITE, side = o.side || cap, s, b, t, uv = o.uv;
    for (s = 1; s >= -1; s -= 2) {   // front then back cap
      b = g.n;
      for (i = 0; i < n; i++) {
        var x = ins[i * 2], y = ins[i * 2 + 1], tx = s > 0 && o.tex ? 1 : 0;
        g.add([x, y, z * s], [0, 0, s], uv ? uv(x, y) : [0, 0], cap, [tx, 0]);
      }
      for (t = 0; t < tri.length; t++) g.i.push(b + tri[t]);
    }
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var nx = en[i * 2], ny = en[i * 2 + 1], c7 = .7071, F = [0, 0];
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

  function rrect(w, h, r, seg) {   // CCW rounded rectangle centred on 0
    var p = [], c = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]], i, j, a;
    for (i = 0; i < 4; i++) for (j = 0; j <= seg; j++) {
      a = (c[i][2] + 90 * j / seg) * D2R;
      p.push(c[i][0] + r * Math.cos(a), c[i][1] + r * Math.sin(a));
    }
    return p;
  }
  // Centre a group of Geos on its box and scale the larger of its half-width and half-height to 1, the way
  // the static painter fits its box (a bounding sphere made the landmarks on plinths look small).
  function normalise(geos, pivot) {
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], c = [], R, g, i, k, v;
    for (g = 0; g < geos.length; g++) for (v = geos[g].v, i = 0; i < v.length; i += STRIDE) for (k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]);
    }
    for (k = 0; k < 3; k++) c[k] = (lo[k] + hi[k]) / 2;
    R = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2;
    for (g = 0; g < geos.length; g++) for (v = geos[g].v, i = 0; i < v.length; i += STRIDE) {
      for (k = 0; k < 3; k++) v[i + k] = (v[i + k] - c[k]) / R;
    }
    if (pivot) for (k = 0; k < 3; k++) pivot[k] = (pivot[k] - c[k]) / R;
    return (lo[1] - c[1]) / R;   // floor height, for the shadow
  }

  // Outlines come from objects.js (_shapes: 0..100 box, y down, base at 100), so GL and the static paint match.
  // Converted to y up, centred on x; landmarks stand on y = 0, the shield is centred.
  function outline(name, mid) {
    var S = CO && CO._shapes && CO._shapes[name], p = [], i;
    if (!S || S.length < 6) S = [10, 100, 90, 100, 90, 20, 10, 20];   // plain block if the shape is missing
    for (i = 0; i < S.length; i += 2) p.push((S[i] - 50) / 50, ((mid ? 50 : 100) - S[i + 1]) / 50);
    return p;
  }
  var STEEL = [.78, .8, .88, 0], DARK = [.102, .027, .239, 0], GOLD = [.788, .635, .353, 0];

  // Rotate a Geo’s positions and normals in place (yaw about y, then pitch about x).
  function turn(g, a, b) {
    var m = mul(rotX(b), rotY(a)), v = g.v, i, k, x, y, z;
    for (i = 0; i < v.length; i += STRIDE) for (k = 0; k < 6; k += 3) {
      x = v[i + k]; y = v[i + k + 1]; z = v[i + k + 2];
      v[i + k] = m[0] * x + m[4] * y + m[8] * z; v[i + k + 1] = m[1] * x + m[5] * y + m[9] * z; v[i + k + 2] = m[2] * x + m[6] * y + m[10] * z;
    }
  }
  // Each shape is a list of parts (one draw each: { g, metal, tex, rim, lines, swing }), the pendulum pivot and the floor.
  function build(shape) {
    var parts = [], pivot = null, g, g2, i, p;
    if (shape === 'coin') {
      g = new Geo(); g2 = new Geo();
      var prof = [[0, .06], [.76, .06], [.84, .1], [.96, .1], [1, .07], [1, -.07], [.96, -.1], [.84, -.1], [.76, -.06], [0, -.06]];
      lathe(g, [prof[0], prof[1]], 48, { R: .76, tex: 1 });
      lathe(g, [prof[8], prof[9]], 48, { R: .76, tex: 1 });
      lathe(g2, prof.slice(1, 9), 48, { reed: 3 });
      parts.push({ g: g, metal: .35, tex: 1 }, { g: g2, metal: .9 });
    } else if (shape === 'shield') {
      g = new Geo(); g2 = new Geo();
      extrude(g, outline('shield', 1), .14, .02, { cap: [.55, .55, .6, 1], side: STEEL });
      lathe(g2, [[0, .095], [.5, .095], [.55, .085], [.56, .07]], 48, { R: .5, tex: 1 });
      for (i = 0; i < g2.v.length; i += STRIDE) g2.v[i + 1] += .04;   // the disc sits a little high, like a crest
      parts.push({ g: g, metal: .85 }, { g: g2, metal: .2, tex: 1 });
    } else if (shape === 'tag') {
      var blk = new Geo(), tg = new Geo(), st = new Geo(), F = [0, 0];
      extrude(blk, rrect(.5, .5, .07, 3), .5, .03, { cap: [.24, .16, .5, 0] });
      turn(blk, 35 * D2R, 18 * D2R);   // a three-quarter view, so the block reads as a cube
      for (i = 0; i < blk.v.length; i += STRIDE) blk.v[i + 1] += .62;
      extrude(tg, rrect(1.1, .6, .1, 4), .05, .012, { cap: WHITE, side: [.6, .6, .65, 1], tex: 1,
        uv: function (x, y) { return [x / .54 + .5, y / .54 + .5]; } });
      for (i = 0; i < tg.v.length; i += STRIDE) tg.v[i + 1] -= .24;
      st.add([0, .37, 0], [0, 0, 1], [0, 0], [.85, .8, .95, 0], F); st.add([0, .06, 0], [0, 0, 1], [0, 0], [.85, .8, .95, 0], F);
      pivot = [0, .37, 0];
      parts.push({ g: blk, metal: .35 }, { g: tg, metal: .3, swing: 1, tex: 1 }, { g: st, lines: 1, swing: 1 });
    } else {
      var q = outline(shape);
      for (i = 0; i < q.length; i++) q[i] *= .85;
      g = new Geo(); g2 = new Geo();
      extrude(g, q, .18, .02, { cap: WHITE, side: [.62, .6, .66, 1] });
      for (i = 0; i < g.v.length; i += STRIDE) g.v[i + 1] += .001;
      lathe(g2, [[0, 0], [.95, 0], [1, -.04], [1, -.13], [.94, -.17], [0, -.17]], 48, { axis: 'y',
        col: function (k) { return k > 0 && k < 4 ? GOLD : DARK; } });
      parts.push({ g: g, metal: .25 }, { g: g2, metal: .1, rim: .25 });
    }
    var geos = [];
    for (i = 0; i < parts.length; i++) geos.push(parts[i].g);
    var floor = normalise(geos, pivot);
    return { parts: parts, pivot: pivot, floor: floor };
  }

  // ---- GL setup ----
  var VS = [
    'attribute vec3 aP,aN;attribute vec2 aU,aF;attribute vec4 aC;',
    'uniform mat4 uM,uVP;uniform mat3 uNM;',
    'varying vec3 vW,vN,vO,vT;varying vec2 vU,vF;varying vec4 vC;',
    'void main(){vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=uNM*aN;vT=uNM*vec3(-aP.y,aP.x,0.);vO=aP;vU=aU;vF=aF;vC=aC;',
    'gl_Position=uVP*w;}'
  ].join('\n');
  // Lambert + hemisphere ambient + Blinn + a procedural softbox for metals + a Fresnel rim tinted by the Curate
  // status (iridescent when uRimMix is 0) + dissolve. highp only where the GPU has it: the reeding needs it.
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'uniform vec3 uTint,uRim;uniform float uRimK,uRimMix,uMetal,uTexOn,uDis,uAlpha,uMode,uT;',
    'uniform sampler2D uTex;',
    'varying vec3 vW,vN,vO,vT;varying vec2 vU,vF;varying vec4 vC;',
    'float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}',
    'void main(){',
    ' if(uMode>1.5){gl_FragColor=vec4(vC.rgb*uAlpha,uAlpha);return;}',
    ' if(uMode>.5){float a=(1.-smoothstep(.15,1.,length(vU*2.-1.)))*.45*uAlpha;',
    '  gl_FragColor=vec4(vec3(.027,0.,.102)*a,a);return;}',
    ' float hs=hash(floor(vO*18.));if(hs<uDis)discard;',
    ' vec3 n=normalize(vN),v=normalize(vec3(0.,.35,4.2)-vW),l=normalize(vec3(-.4,.8,.6));',
    ' if(vF.y>.5){n=normalize(n+normalize(vT)*sin(vU.x*753.982)*.15);}',
    ' vec3 base=mix(vC.rgb,vC.rgb*uTint,vC.a);',
    ' vec4 tx=texture2D(uTex,vU);',
    ' float ins=step(length(vU-.5),.5);',
    ' base=mix(base,tx.rgb,tx.a*vF.x*uTexOn*ins);',
    ' float d=max(dot(n,l),0.);',
    ' vec3 amb=mix(vec3(.059,.039,.18),vec3(.227,.165,.478),.5+.5*n.y);',
    ' float sp=pow(max(dot(n,normalize(l+v)),0.),mix(18.,64.,uMetal))*mix(.3,1.,uMetal);',
    ' float box=smoothstep(.85,.98,dot(reflect(-v,n),normalize(vec3(-.4,.7,.6))))*2.*uMetal;',
    ' vec3 c=base*(amb*1.2+d*(1.05-.45*uMetal)+.3*max(dot(n,v),0.))+(sp+box)*mix(vec3(1.),base+.2,uMetal*.6);',
    ' float f=pow(1.-max(dot(n,v),0.),2.5);',
    ' vec3 iri=mix(vec3(.753,.518,1.),vec3(.153,.804,.996),.5+.5*sin(f*6.+uT*.6));',
    ' c+=f*mix(iri,uRim,uRimMix)*1.3*uRimK;',
    ' if(uDis>0.&&hs<uDis+.07)c=mix(vec3(1.,.15,.1),vec3(1.,.7,.25),(hs-uDis)/.07)*1.4;',
    ' c=c/(c+.6)*1.25;',
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
    names = ['uM', 'uVP', 'uNM', 'uTint', 'uRim', 'uRimK', 'uRimMix', 'uMetal', 'uTexOn', 'uDis', 'uAlpha', 'uMode', 'uT', 'uTex'];
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

  // Meshes are built lazily per shape (geometry ignores colour: the tint is a uniform) and kept for the session.
  var meshes = {};
  function meshFor(shape) {
    if (meshes[shape]) return meshes[shape];
    var m = build(shape), i, p;
    for (i = 0; i < m.parts.length; i++) {
      p = m.parts[i];
      p.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p.g.v), gl.STATIC_DRAW);
      if (!p.lines) {
        p.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(p.g.i), gl.STATIC_DRAW);
        p.count = p.g.i.length;
      } else p.count = p.g.n;
      p.g = null;   // free the CPU copy
    }
    return (meshes[shape] = m);
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
  // Emblems come from the shared painter (objects.js _emblem), uploaded once per colour + mark. LRU of 8.
  var texs = {}, texKeys = [];
  function texFor(spec, inUse) {
    if (!spec || !spec.mark || !CO || !CO._emblem) return null;
    var key = (spec.color || '') + '|' + spec.mark, t = texs[key], i;
    if (t) { texKeys.splice(texKeys.indexOf(key), 1); texKeys.push(key); return t; }
    var c = CO._emblem(spec, 256), pot = c && c.width === 256 && c.height === 256;
    if (!c || !c.width) return null;
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas rows run down, uv v runs up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (pot) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, pot ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texs[key] = t; texKeys.push(key);
    for (i = 0; texKeys.length > 8 && i < texKeys.length; i++) {   // evict the oldest that is not on screen
      if (inUse.indexOf(texs[texKeys[i]]) < 0) { gl.deleteTexture(texs[texKeys[i]]); delete texs[texKeys[i]]; texKeys.splice(i--, 1); }
    }
    return t;
  }

  // ---- Hosting ----
  var RIM = { pending: '#6cc5ff', challenge: '#ffc46b', listed: '#65dc7f', leak: '#ff5a78', overruled: '#ff5a78' };
  var host = null, objs = [], VP = null, view = null, cw = 0, ch = 0, unit = .8, raf = 0, last = 0, frameN = 0;
  var paused = false, reduced = RM, swayOn = true, dprCap = 2, ro = null;
  var tgt = { y: 0, p: 0 }, cur = { y: 0, p: 0, v: 0, acc: 0 };
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
      var px = 2 * 4.2 * Math.tan(15 * D2R) / h, hs = Math.min(h * 1.02, w / 2.7), i;
      unit = objs.length > 1 ? .39 * hs * px : .385 * Math.min(w, h) * px;
      for (i = 0; i < objs.length; i++) {
        objs[i].x = objs.length > 1 ? (i - 1) * .86 * hs * px : 0;
        objs[i].k = objs.length > 1 && i !== 1 ? .8 : 1;
      }
    }
    return true;
  }
  function inst(spec, i, n) {
    spec = spec || {};
    var used = [], k;
    for (k = 0; k < objs.length; k++) used.push(objs[k].tex);
    var m = meshFor(spec.shape || 'coin');
    return { mesh: m, tex: texFor(spec, used), tint: rgb(spec.color), x: 0, k: 1, fan: n > 1 ? (i - 1) * 18 * D2R : 0,
      ph: i * 2.1, s: reduced ? 1 : .85, sv: 0, th: reduced || !m.pivot ? 0 : .22, tv: 0 };
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
    tgt.y = cur.y = reduced ? 0 : (+co.ty || 0) * D2R; tgt.p = cur.p = reduced ? 0 : -(+co.tp || 0) * D2R; cur.v = cur.acc = 0;
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
      for (j = 0; j < co.specs.length; j++) if (co.specs[j]) { meshFor(co.specs[j].shape || 'coin'); texFor(co.specs[j], used); }
    }
  }

  // ---- Motion and drawing ----
  var fx = { dis: 0, alpha: 1, shake: 0, pulse: 1 }, ivals = [], lastTs = 0, level = 0;

  // Advance springs and reactions by dt seconds. Returns true while anything still moves.
  function update(dt, t) {
    var e = t - stT, busy = false, k = 1 - Math.exp(-dt / .04), i, o, a;
    var ty = reduced ? 0 : tgt.y, tp = reduced ? 0 : tgt.p + (st === 'leak' ? 20 * D2R : 0);
    var py = cur.y, v;
    cur.y += (ty - cur.y) * k; cur.p += (tp - cur.p) * k;   // drag tilt, smoothed over about 120 ms
    v = (cur.y - py) / dt; cur.acc = clamp((v - cur.v) / dt, -40, 40); cur.v = v;
    if (Math.abs(ty - cur.y) + Math.abs(tp - cur.p) > 1e-3) busy = true;
    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      if (!reduced) {   // drop-in spring from .85
        o.sv += (180 * (1 - o.s) - 14 * o.sv) * dt; o.s += o.sv * dt;
        if (Math.abs(1 - o.s) + Math.abs(o.sv) > 1e-3) busy = true; else { o.s = 1; o.sv = 0; }
      }
      if (o.mesh.pivot && !reduced) {   // pendulum: θ'' = −38θ − 6θ' + drag acceleration
        a = -38 * o.th - 6 * o.tv - cur.acc * .08;
        o.tv += a * dt; o.th = clamp(o.th + o.tv * dt, -.6, .6);
        if (Math.abs(o.th) + Math.abs(o.tv) > 2e-3) busy = true;
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
    var i, j, o, p, M, R, Mp, sc, sw = swayOn && !reduced, w = 2 * PI * t / 6000, yaw, pitch;
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
      gl.uniformMatrix4fv(U.uM, false, mul(trans(o.x, o.mesh.floor * sc - .03, 0), scale(sc * 1.05, 1, sc * .7)));
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
      yaw = o.fan + cur.y + fx.shake + (sw ? 12 * D2R * Math.sin(w + o.ph) : 0);
      pitch = cur.p + (sw ? 5 * D2R * Math.cos(w * .8 + o.ph) : 0);
      R = mul(rotY(yaw), rotX(pitch));
      M = mul(trans(o.x, 0, 0), mul(scale(sc, sc, sc), R));
      gl.uniform3fv(U.uTint, o.tint);
      gl.bindTexture(gl.TEXTURE_2D, o.tex || whiteTex);
      for (j = 0; j < o.mesh.parts.length; j++) {
        p = o.mesh.parts[j];
        if (p.swing) {   // the tag and its string turn about the pivot under the block
          var pv = o.mesh.pivot, Z = mul(trans(pv[0], pv[1], pv[2]), mul(rotZ(o.th), trans(-pv[0], -pv[1], -pv[2])));
          Mp = mul(M, Z); gl.uniformMatrix3fv(U.uNM, false, nm3(mul(R, Z)));
        } else { Mp = M; gl.uniformMatrix3fv(U.uNM, false, nm3(R)); }
        gl.uniformMatrix4fv(U.uM, false, Mp);
        gl.uniform1f(U.uMetal, p.metal || 0);
        gl.uniform1f(U.uRimK, p.rim || 1);
        gl.uniform1f(U.uTexOn, p.tex && o.tex ? 1 : 0);
        gl.uniform1f(U.uMode, p.lines ? 2 : 0);
        bindAttrs(p.vbo);
        if (p.lines) gl.drawArrays(gl.LINES, 0, p.count);
        else { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo); gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_SHORT, 0); }
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
  // Median frame interval over 45 frames: > 22 ms drops to DPR 1 without sway; still > 30 ms gives up on GL.
  function watchdog(ts) {
    var d = lastTs ? ts - lastTs : 0;
    lastTs = ts;
    if (d > 0 && d < 250) ivals.push(d);
    if (ivals.length < 45) return false;
    var m = ivals.slice().sort(function (a, b) { return a - b; })[22];
    ivals = [];
    if (level === 0 && m > 22) { level = 1; dprCap = 1; swayOn = false; cw = 0; }
    else if (level === 1 && m > 30) { fail('slow'); return true; }
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
