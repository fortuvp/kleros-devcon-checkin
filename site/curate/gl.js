// Curate game WebGL1 renderer for the Results medal. Lazy: objects.js fetches it in idle time once a round is on,
// and sets it up only when a medal is mounted, so the game is complete without it. No library. One context and
// one <canvas>, placed in the medal box over the 2D paint. Any failure falls back to that paint.
(function () {
  var CO = window.CurateObjects || null;
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var PI = Math.PI, D2R = PI / 180;

  // ---- Helpers ----
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgb(hex) {
    var h = String(hex || '#cfc4f2').replace('#', '');
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

  // Revolve an [r, h] profile around z (the medal faces the camera). Each profile segment gets its own rings, so
  // creases stay sharp. o: { tex, reed (segment index), R (the face radius the emblem maps to) }.
  function lathe(g, prof, segs, o) {
    var k, j, s, a, ca, sa, r, h, r0, h0, r1, h1, nr, nh, l, base, tex, reed, p, n, u;
    for (k = 0; k < prof.length - 1; k++) {
      r0 = prof[k][0]; h0 = prof[k][1]; r1 = prof[k + 1][0]; h1 = prof[k + 1][1];
      nr = -(h1 - h0); nh = r1 - r0; l = Math.sqrt(nr * nr + nh * nh) || 1; nr /= l; nh /= l;
      tex = o.tex || 0; reed = o.reed === k ? 1 : 0;
      base = g.n;
      for (j = 0; j <= segs; j++) {
        a = j / segs * 2 * PI; ca = Math.cos(a); sa = Math.sin(a);
        for (s = 0; s < 2; s++) {
          r = s ? r1 : r0; h = s ? h1 : h0;
          p = [r * ca, r * sa, h]; n = [nr * ca, nr * sa, nh];
          // Faces map the emblem flat (mirrored on the back, so it reads right when the back turns to us);
          // other rings carry the angle for the reeding.
          u = tex ? [.5 + (h < 0 ? -.5 : .5) * p[0] / o.R, .5 + .5 * p[1] / o.R] : [j / segs, 0];
          g.add(p, n, u, WHITE, [tex, reed]);
        }
      }
      for (j = 0; j < segs; j++) g.quad(base + j * 2, base + j * 2 + 2, base + j * 2 + 3, base + j * 2 + 1);
    }
  }
  // The medal: two emblem faces and a metal rim with a raised lip, reeded on its outer band. Radius 1.
  function build() {
    var g = new Geo(), g2 = new Geo(),
      prof = [[0, .06], [.76, .06], [.84, .1], [.96, .1], [1, .07], [1, -.07], [.96, -.1], [.84, -.1], [.76, -.06], [0, -.06]];
    lathe(g, [prof[0], prof[1]], 48, { R: .76, tex: 1 });
    lathe(g, [prof[8], prof[9]], 48, { R: .76, tex: 1 });
    lathe(g2, prof.slice(1, 9), 64, { reed: 3 });
    return [{ g: g, metal: .35, tex: 1 }, { g: g2, metal: .9 }];
  }

  // ---- GL setup ----
  var VS = [
    'attribute vec3 aP,aN;attribute vec2 aU,aF;attribute vec4 aC;',
    'uniform mat4 uM,uVP;uniform mat3 uNM;',
    'varying vec3 vW,vN,vT;varying vec2 vU,vF;varying vec4 vC;',
    'void main(){vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=uNM*aN;vT=uNM*vec3(-aP.y,aP.x,0.);vU=aU;vF=aF;vC=aC;',
    'gl_Position=uVP*w;}'
  ].join('\n');
  // Lambert + hemisphere ambient + Blinn + a procedural softbox for the metal + a Fresnel rim in a lighter tier
  // colour. uMode 1 draws the soft floor shadow. highp only where the GPU has it: the reeding needs it.
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'uniform vec3 uTint,uRim;uniform float uMetal,uTexOn,uAlpha,uMode;',
    'uniform sampler2D uTex;',
    'varying vec3 vW,vN,vT;varying vec2 vU,vF;varying vec4 vC;',
    'void main(){',
    ' if(uMode>.5){float a=(1.-smoothstep(.15,1.,length(vU*2.-1.)))*.45*uAlpha;',
    '  gl_FragColor=vec4(vec3(.027,0.,.102)*a,a);return;}',
    ' vec3 n=normalize(vN),v=normalize(vec3(0.,.35,4.2)-vW),l=normalize(vec3(-.4,.8,.6));',
    ' if(vF.y>.5){n=normalize(n+normalize(vT)*sin(vU.x*753.982)*.15);}',
    ' vec3 base=mix(vC.rgb,vC.rgb*uTint,vC.a);',
    ' vec4 tx=texture2D(uTex,vU);',
    ' float ins=step(length(vU-.5),.5);',
    ' base=pow(mix(base,tx.rgb,tx.a*vF.x*uTexOn*ins),vec3(1.4));',   // richer metal: pale tints read as plastic
    ' float d=max(dot(n,l),0.),hy=.5+.5*n.y;',
    ' vec3 amb=mix(vec3(.07,.05,.13),vec3(.28,.24,.4),hy);',   // the stage’s violet, toned down so teal stays teal
    ' float sp=pow(max(dot(n,normalize(l+v)),0.),mix(18.,64.,uMetal))*mix(.3,1.,uMetal);',
    ' float box=smoothstep(.85,.98,dot(reflect(-v,n),normalize(vec3(-.4,.7,.6))))*2.*uMetal;',
    ' vec3 c=base*(amb*1.2+d*(1.05-.45*uMetal)+.3*max(dot(n,v),0.))+(sp+box)*mix(vec3(1.),base+.2,uMetal*.6);',
    ' c+=pow(1.-max(dot(n,v),0.),2.5)*uRim;',
    ' c=min(c*1.25/(dot(c,vec3(.299,.587,.114))+.6),vec3(1.));',   // tone map on luminance, so the hue holds
    ' gl_FragColor=vec4(c*uAlpha,uAlpha);',
    '}'
  ].join('\n');
  var gl = null, canvas = null, prog = null, A = {}, U = {}, quadBuf = null, whiteTex = null, mesh = null, dead = false;

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
    names = ['uM', 'uVP', 'uNM', 'uTint', 'uRim', 'uMetal', 'uTexOn', 'uAlpha', 'uMode', 'uTex'];
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
  // Built once, on the first medal, and kept for the session
  function meshFor() {
    if (mesh) return mesh;
    var parts = build(), i, p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      p.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p.g.v), gl.STATIC_DRAW);
      p.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(p.g.i), gl.STATIC_DRAW);
      p.count = p.g.i.length;
      p.g = null;   // free the CPU copy
    }
    return (mesh = parts);
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
  // The emblem comes from the shared painter (objects.js _emblem), uploaded once per tier colour.
  var texs = {};
  function texFor(spec) {
    if (!spec || !CO || !CO._emblem) return null;
    var key = (spec.color || '') + '|' + (spec.mark || ''), t = texs[key], c;
    if (t) return t;
    c = CO._emblem(spec, 256);
    if (!c || c.width !== 256) return null;
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
    return (texs[key] = t);   // at most four tiers, so no eviction
  }

  // ---- Hosting ----
  var host = null, med = null, VP = null, view = null, cw = 0, ch = 0, unit = .8, raf = 0, last = 0, t0 = 0;
  var paused = false, reduced = RM, swayOn = true, dprCap = 2, ro = null;

  function lookAt() {   // fixed camera: eye (0, .35, 4.2) on the origin
    var e = [0, .35, 4.2], l = Math.sqrt(e[1] * e[1] + e[2] * e[2]), zy = e[1] / l, zz = e[2] / l;
    var m = ident();
    m[5] = zz; m[6] = zy; m[9] = -zy; m[10] = zz;
    m[13] = -(zz * e[1] - zy * e[2]); m[14] = -(zy * e[1] + zz * e[2]);
    return m;
  }
  // Size the backing store to the box: DPR ≤ 2 and ≤ 700k pixels.
  function resize() {
    if (!host) return false;
    var w = host.clientWidth, h = host.clientHeight, d = Math.min(window.devicePixelRatio || 1, dprCap), bw, bh;
    if (!w || !h) return false;
    if (w * h * d * d > 7e5) d = Math.sqrt(7e5 / (w * h));
    bw = Math.round(w * d); bh = Math.round(h * d);
    if (canvas.width !== bw || canvas.height !== bh || cw !== w || ch !== h) {
      canvas.width = bw; canvas.height = bh; cw = w; ch = h;
      VP = mul(persp(30 * D2R, w / h, .1, 20), view);
      // World units per CSS pixel at the medal’s depth; a radius of .36 of the short side matches the 2D paint
      // and leaves room for the bob and the shadow.
      unit = .36 * Math.min(w, h) * 2 * 4.2 * Math.tan(15 * D2R) / h;
    }
    return true;
  }
  function detach() {
    stop();
    if (ro && host) ro.unobserve(host);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    host = null; med = null; cw = ch = 0;
  }
  function attach(el, spec) {
    var tint = rgb(spec.color), cs = canvas.style;
    host = el; t0 = now();
    med = { tex: texFor(spec), tint: tint, s: reduced ? 1 : .85, sv: 0,
      rim: [(tint[0] + .4) * .55, (tint[1] + .4) * .55, (tint[2] + .4) * .55] };   // a lighter tier colour
    meshFor();
    cs.transition = ''; cs.opacity = '0';
    el.appendChild(canvas);
    if (ro) ro.observe(el);
    if (resize()) draw(now());
    void canvas.offsetWidth;   // commit opacity 0 so the 120 ms cross-fade runs
    cs.transition = reduced ? '' : 'opacity .12s';
    cs.opacity = '1';
    kick();
  }

  // ---- Motion and drawing ----
  var ivals = [], lastTs = 0, level = 0;
  function moving() { return swayOn && !reduced; }
  // The drop-in spring from .85. Returns true while it still moves.
  function update(dt) {
    if (reduced) { med.s = 1; return false; }
    med.sv += (180 * (1 - med.s) - 14 * med.sv) * dt; med.s += med.sv * dt;
    if (Math.abs(1 - med.s) + Math.abs(med.sv) > 1e-3) return true;
    med.s = 1; med.sv = 0;
    return false;
  }
  function draw(t) {
    if (!VP || !med) return;
    // A slow turn that lingers on each face (9 s a turn), a small nod and a gentle bob; still: a three-quarter pose
    var mv = moving(), e = t - t0, ph = 2 * PI * e / 9000, sc = unit * med.s, yaw, pitch, bob, R, M, j, p;
    yaw = mv ? ph - .35 * Math.sin(2 * ph) : -24 * D2R;
    pitch = mv ? 5 * D2R * Math.sin(2 * PI * e / 5200) : 0;
    bob = mv ? .05 * Math.sin(2 * PI * e / 2600) : 0;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.uVP, false, VP);
    // The soft floor shadow first, without depth writes: smaller and lighter as the medal rises
    gl.depthMask(false);
    bindAttrs(quadBuf);
    gl.uniform1f(U.uMode, 1);
    gl.uniform1f(U.uAlpha, clamp(.85 - bob * 3, 0, 1));
    gl.uniformMatrix4fv(U.uM, false, mul(trans(0, -1.16 * sc, 0), scale(sc * (.9 - bob), 1, sc * .5)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true);
    gl.uniform1f(U.uMode, 0);
    gl.uniform1f(U.uAlpha, 1);
    gl.uniform3fv(U.uTint, med.tint);
    gl.uniform3fv(U.uRim, med.rim);
    R = mul(rotX(pitch), rotY(yaw));
    M = mul(trans(0, bob * sc, 0), mul(scale(sc, sc, sc), R));
    gl.uniformMatrix4fv(U.uM, false, M);
    gl.uniformMatrix3fv(U.uNM, false, nm3(R));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, med.tex || whiteTex);
    for (j = 0; j < mesh.length; j++) {
      p = mesh[j];
      gl.uniform1f(U.uMetal, p.metal);
      gl.uniform1f(U.uTexOn, p.tex && med.tex ? 1 : 0);
      bindAttrs(p.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  // rAF only while needed: visible page, a mounted medal, something moving.
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
    var t = now(), dt = last ? clamp((t - last) / 1000, .001, .05) : 1 / 60, busy;
    last = t;
    if (watchdog(ts)) return;
    if (!resize()) { last = lastTs = 0; return; }   // hidden box: the ResizeObserver wakes us up
    busy = update(dt);
    draw(t);
    if (busy || moving()) raf = requestAnimationFrame(loop); else last = lastTs = 0;
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
  // Context loss or a slow device: the 2D paint for the rest of the session. objects.js owns the mode switch.
  function fail(why) {
    if (dead) return;
    dead = true;
    detach();
    if (why === 'slow') try { var x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ }
    if (CO && CO._static) CO._static();
    else try { document.dispatchEvent(new CustomEvent('curate:objects-mode', { detail: { mode: 'static' } })); } catch (e) { /* old browser */ }
  }

  // ---- Public API ----
  // The contract objects.js expects (see its header). objects.js wraps every call in try/catch and drops to the
  // 2D paint on a throw.
  var api = {
    mode: 'gl',
    init: function (o) {
      o = o || {};
      if (gl) return !dead;
      if (o.reduced) reduced = true;
      var ok = false;
      try { ok = setupGL(); } catch (e) { ok = false; }
      if (!ok) { dead = true; return false; }
      view = lookAt();
      if (window.ResizeObserver) ro = new ResizeObserver(function () { cw = 0; kick(); });
      window.addEventListener('resize', function () { cw = 0; kick(); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else kick(); });
      return true;
    },
    // el: the .obj-medal box; spec: { color, mark }. null detaches.
    medal: function (el, spec) {
      if (el && el === host) return;
      detach();
      if (dead || !el) return;
      attach(el, spec || {});
    },
    setReduced: function (b) { reduced = !!b; cw = 0; kick(); },
    pause: function () { paused = true; stop(); },
    resume: function () { paused = false; kick(); }
  };

  // ---- Boot ----
  // objects.js registers us from the script’s onload; a direct call covers any other way of loading.
  window.CurateGL = api;
  if (CO && CO._on && CO._glReady) CO._glReady(api);
})();
