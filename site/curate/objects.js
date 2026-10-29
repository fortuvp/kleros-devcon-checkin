// Curate card pictures and the Results medal.
// Cards: a real photo, a flat painted flag or a flat painted logo coin, all plain DOM and 2D canvas, so a card never
// waits on WebGL. Results: a metal medal in the tier colour, painted in 2D at once; gl.js loads in idle time once a
// round starts (never in lite), is set up only when a medal is mounted, then spins it in 3D over the 2D paint.
// gl.js api: init({ reduced }) -> ok, medal(el | null, { color, mark }).
// Any GL failure (_static() or the mode event) goes back to the 2D paint for the rest of the session.
(function () {
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
    CO, api = null, reg = null, liveEl = null, medalEl = null, dead = false, asked = false, isLite = false,
    els = [], ro = null, cache = {}, keys = [], imgs = {}, imgKeys = [], PI = Math.PI;
  // Medal colours by tier: Everyone, Teal, Purple, Gold
  var TIER = ['#cfc4f2', '#7ff0e0', '#b77bff', '#f2c46d'];

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
  function lum(c) { return c[0] * .3 + c[1] * .59 + c[2] * .11; }
  function W(a) { return 'rgba(255,255,255,' + a + ')'; }
  function grad(g, st) {
    for (var i = 0; i < st.length; i += 2) g.addColorStop(st[i], st[i + 1]);
    return g;
  }
  function lin(x, x0, y0, x1, y1, st) { return grad(x.createLinearGradient(x0, y0, x1, y1), st); }
  function rad(x, x0, y0, r0, x1, y1, r1, st) { return grad(x.createRadialGradient(x0, y0, r0, x1, y1, r1), st); }

  // ---- Paths ----
  // Outline p (flat x, y list) placed so its point (bx, by) lands on (ox, oy), scaled by k
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

  // ---- Flags ----
  // A flat flag filling w × h on context x. Kinds: v3, h3 (ratio), h2, nordic (inner), disc (off), cross (Swiss),
  // h3wheel (India). See decks.js.
  function flagAspect(f) { return f && f.kind === 'cross' ? 1 : 1.5; }
  function flagPaint(x, f, w, h) {
    f = f || {};
    var c = f.c || ['#8a83a8', '#d9d4ee', '#8a83a8'], r, i, k, y, t;
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
          x.moveTo(w / 2, h / 2); x.lineTo(w / 2 + r * .9 * Math.cos(i * PI / 12), h / 2 + r * .9 * Math.sin(i * PI / 12));
        }
        x.stroke(); x.beginPath(); x.arc(w / 2, h / 2, r * .18, 0, 7); x.fill();
      }
    }
  }
  // A fresh w × h canvas painted by fn (the title screen’s app cards put it in the DOM, so never shared)
  function fresh(fn, s, w, h) {
    var cv = document.createElement('canvas'), x;
    cv.width = Math.max(1, Math.round(w || 96)); cv.height = Math.max(1, Math.round(h || 64));
    x = cv.getContext('2d');
    if (x) try { fn(x, s || {}, cv.width, cv.height, 1); } catch (e) { /* a blank picture beats a broken card */ }
    return cv;
  }

  // ---- Medal emblem ----
  // A cached px² canvas shared with gl.js (the medal face texture): tint gradient, bevel ring, embossed Kleros
  // mark. Never draw on it. KP is #kleros-ico from site/index.html (rounded); its first subpath doubles as the
  // polygon where Path2D is missing.
  var KP = 'M42.7 1.5 15.7 0.3 0 19.9 11.1 46.2 38.2 47.9 53.6 25.8ZM16 22.8 35.5 14.3 32.7 35.8ZM17.6 3.3 33.2 10 ' +
    '14.4 17.4ZM12.3 26.9 29.3 39 12.7 43.3ZM39.3 14 50.9 25.7 36.3 36.6ZM19 45.4 33.3 41.6 35.8 46.5ZM36.1 40.4 48.6 ' +
    '31.1 38.6 45.3ZM40.3 9.9 42.7 4.9 49.3 19.1ZM23.8 1.8 39.7 2.5 36.9 7.6ZM2.3 18.9 13.4 4.8 9.7 20.5ZM1.8 21.6 9.3 ' +
    '23.2 9.6 40.1Z',
    kpath = null;
  // The mark centred on (d, d) in the current fillStyle; r = half the canvas
  function mark(x, r, d) {
    x.save(); x.translate(d, d); x.scale(r * .02, r * .02); x.translate(-27, -24); x.beginPath();
    if (!kpath && window.Path2D) try { kpath = new Path2D(KP); } catch (e) { kpath = 0; }
    if (kpath) x.fill(kpath, 'evenodd'); else { pth(x, KP.split('Z')[0].match(/\d*\.?\d+/g), 0, 0, 1, 0, 0); x.fill(); }
    x.restore();
  }
  function emblem(spec, px) {
    spec = spec || {}; px = px || 256;
    var col = spec.color || TIER[0], key = 'e' + col + px, c = cache[key], x, r, i, n;
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
    i = px * .012; n = rgb(col);
    x.fillStyle = W(.5); mark(x, r, -i);
    x.fillStyle = 'rgba(0,0,0,.42)'; mark(x, r, i);
    x.fillStyle = lum(n) > 168 ? 'rgba(26,7,61,.88)' : W(.94);   // a dark mark on light tints
    mark(x, r, 0);
    cache[key] = c; keys.push(key);
    if (keys.length > 8) delete cache[keys.shift()];   // small LRU
    return c;
  }

  // ---- Static painters ----
  // The medal in a -100..100 unit box centred on the origin, seen a little from above: thickness, reeding on the
  // edge band, the emblem face, a lit rim and a specular arc.
  function coin(x, s) {
    var c = s.color, y = -8, rx = 76, ry = 70, i, a, g = lin(x, -rx, 0, rx, 0, [0, sh(c, -.6), .35, sh(c, -.1), 1, sh(c, -.65)]);
    shadow(x, 84, 72);
    for (i = 6; i > 0; i--) { ell(x, 0, y + i * 2.4, rx, ry); F(x, g); }   // thickness
    x.beginPath();
    for (i = 1; i < 60; i++) {   // reeding: ticks across the edge band, only where it faces us
      a = i / 60 * PI;
      x.moveTo(rx * Math.cos(a), y + ry * Math.sin(a) + 1); x.lineTo(rx * Math.cos(a), y + ry * Math.sin(a) + 13.4);
    }
    S(x, .9, 'rgba(0,0,0,.28)');
    disc(x, emblem(s), 0, y, rx, ry);
    ell(x, 0, y, rx - 3.5, ry - 3.5); S(x, 7, lin(x, -rx, y - ry, rx, y + ry, [0, sh(c, .55), .5, sh(c, .05), 1, sh(c, -.5)]));
    x.lineCap = 'round'; ell(x, 0, y, rx * .9, ry * .9, 3.4, 4.45); S(x, 4, W(.75));   // specular arc
    x.fillStyle = rad(x, -34, y - 34, 0, -34, y - 34, 30, [0, W(.32), 1, W(0)]); x.fillRect(-64, y - 64, 60, 60);
  }
  // ---- Token logos ----
  // Flat painted logo coins (never downloaded) with a soft shadow like the flags. TOK: mark -> [disc, glyph]
  // colours, which spec.color and color2 override (Solana keeps its purple-to-teal bars).
  var TOK = {
    btc: ['#f7931a'], eth: ['#627eea'], usdt: ['#26a17b'], usdc: ['#2775ca'], doge: ['#c2a633'], sol: ['#0c0a12'],
    ada: ['#0033ad'], link: ['#2a5ada'], uni: ['#ff007a'], pol: ['#8247e5'], avax: ['#e84142'], ton: ['#0098ea'],
    shib: ['#e8490f'], bnb: ['#141519', '#f0b90b'], pnk: ['#9013fe']
  };
  // Subpaths in the glyph’s unit box (the disc has radius 1)
  function pl(x, p) {
    for (var i = 0; i < p.length; i += 2) x[i ? 'lineTo' : 'moveTo'](p[i], p[i + 1]);
    x.closePath();
  }
  function hex(x, cx, cy, r, a) {
    for (var i = 0; i < 6; i++) x[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a + i * PI / 3), cy + r * Math.sin(a + i * PI / 3));
    x.closePath();
  }
  function dot(x, cx, cy, r) { x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, 7); }
  function dia(x, cx, cy, s) { pl(x, [cx, cy - s, cx + s, cy, cx, cy + s, cx - s, cy]); }
  // A bold letter s units tall, set at 100× (canvas text misbehaves at sub-pixel sizes)
  function txt(x, t, s, dy) {
    x.save(); x.scale(.01, .01);
    x.font = '800 ' + Math.round(s * 100) + 'px system-ui, -apple-system, Roboto, Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, 0, dy * 100);
    x.restore();
  }
  // The glyph for mark m in the current fill and stroke; c is the disc colour (for cut-outs)
  function glyph(x, m, c) {
    var i, a, o, g = x.fillStyle;
    x.beginPath(); x.lineCap = 'butt'; x.lineJoin = 'miter';
    if (m === 'btc') {   // the leaning B with two strokes above and below
      x.rotate(.24);
      x.rect(-.2, -.64, .1, .26); x.rect(.02, -.64, .1, .26); x.rect(-.2, .38, .1, .26); x.rect(.02, .38, .1, .26); x.fill();
      txt(x, 'B', 1.12, .05);
    } else if (m === 'eth') {   // two stacked rhombi, the right facets lighter
      pl(x, [0, -.68, 0, .18, -.41, -.05]); pl(x, [0, .28, -.41, .05, 0, .68]); x.fill();
      x.globalAlpha = .62; x.beginPath(); pl(x, [0, -.68, .41, -.05, 0, .18]); pl(x, [0, .28, .41, .05, 0, .68]); x.fill();
    } else if (m === 'usdt') {   // the T with an oval bar across its stem
      x.rect(-.5, -.52, 1, .2); x.rect(-.13, -.52, .26, 1.08); x.fill();
      ell(x, 0, -.1, .52, .15); S(x, .08, g);
    } else if (m === 'usdc') {   // $ in a ring broken at the top and bottom
      x.arc(0, 0, .7, PI * .64, PI * 1.36); x.moveTo(.7 * Math.cos(PI * .36), -.7 * Math.sin(PI * .36));
      x.arc(0, 0, .7, -PI * .36, PI * .36); S(x, .1, g);
      txt(x, '$', 1.02, .04);
    } else if (m === 'doge') {   // the D with a bar through its stem
      x.moveTo(-.28, -.44); x.lineTo(-.06, -.44); x.arc(-.06, 0, .44, -PI / 2, PI / 2); x.lineTo(-.28, .44); x.closePath();
      S(x, .17, g); x.fillRect(-.5, -.07, .42, .14);
    } else if (m === 'sol') {   // three slanted bars
      x.fillStyle = lin(x, -.5, .45, .5, -.45, [0, '#9945ff', 1, '#14f195']);
      pl(x, [-.3, -.44, .52, -.44, .3, -.22, -.52, -.22]); pl(x, [-.52, -.11, .3, -.11, .52, .11, -.3, .11]);
      pl(x, [-.3, .22, .52, .22, .3, .44, -.52, .44]); x.fill();
    } else if (m === 'ada') {   // rings of dots, smaller further out
      for (i = 0; i < 24; i++) {
        a = i * PI / 6; o = [[.43, .064], [.2, .08], [.68, .042], [.45, .06]][i % 2 + (i > 11) * 2];
        dot(x, o[0] * Math.cos(a), o[0] * Math.sin(a), o[1]);
      }
      x.fill();
    } else if (m === 'link') {   // a hexagon outline
      hex(x, 0, 0, .5, -PI / 2); S(x, .15, g);
    } else if (m === 'pol') {   // two linked hexagons
      hex(x, -.18, .1, .3, 0); hex(x, .18, -.1, .3, 0); S(x, .11, g);
    } else if (m === 'avax') {   // a big and a small triangle
      pl(x, [-.18, -.44, .18, .36, -.54, .36]); pl(x, [.4, -.02, .57, .36, .23, .36]); x.fill();
    } else if (m === 'ton') {   // a triangle pointing down, split down the middle
      x.lineJoin = 'round'; pl(x, [-.46, -.36, .46, -.36, 0, .5]); x.moveTo(0, -.36); x.lineTo(0, .5); S(x, .1, g);
    } else if (m === 'shib') {   // a dog’s head; the mirrored ears wind opposite ways, so each part is filled alone
      pl(x, [-.5, -.04, -.42, -.6, -.08, -.32]); x.fill();
      x.beginPath(); pl(x, [.5, -.04, .42, -.6, .08, -.32]); x.fill();
      x.beginPath(); dot(x, 0, .06, .44); x.fill();
      x.fillStyle = c; x.beginPath(); dot(x, -.17, -.02, .065); dot(x, .17, -.02, .065); dot(x, 0, .22, .075); x.fill();
    } else if (m === 'bnb') {   // three diamonds, a chevron above and below
      dia(x, 0, 0, .14); dia(x, -.42, 0, .1); dia(x, .42, 0, .1); x.fill();
      x.beginPath(); x.moveTo(-.31, -.11); x.lineTo(0, -.42); x.lineTo(.31, -.11);
      x.moveTo(-.31, .11); x.lineTo(0, .42); x.lineTo(.31, .11); S(x, .13, g);
    } else if (m === 'pnk') mark(x, 1.04, 0);   // the Kleros mark, as on the medal
    else txt(x, String(m || '?').charAt(0).toUpperCase(), 1.1, .05);
  }
  // One coin of radius R on (cx, cy); d is the canvas scale, as shadows ignore the transform
  function token(x, s, cx, cy, R, d) {
    var t = TOK[s.mark] || [], c = s.color || t[0] || '#9013fe';
    x.save();
    x.shadowColor = 'rgba(7,0,26,.5)'; x.shadowBlur = R * d * .2; x.shadowOffsetY = R * d * .08;
    x.beginPath(); x.arc(cx, cy, R, 0, 7); F(x, c);
    x.restore();
    x.save(); x.translate(cx, cy); x.scale(R, R);
    x.beginPath(); x.arc(0, 0, .975, 0, 7); S(x, .025, W(lum(rgb(c)) < 60 ? .22 : .16));   // a rim for dark discs
    x.fillStyle = x.strokeStyle = s.color2 || t[1] || '#fff';
    glyph(x, s.mark, c);
    x.restore();
  }
  // One coin, centred in w × h
  function tokens(x, s, w, h, d) { token(x, s, w / 2, h * .46, Math.min(w, h) * .4, d); }

  // ---- Elements ----
  // A card picture: .obj fills the card’s slot and centres .obj-2d (el._co.cv), the box that tilts. Photo: a div
  // with the <img>; flag: a canvas exactly the flag’s size; coin: a canvas just round the coin. The medal is a
  // .obj-medal box with its 2D canvas; gl.js adds its own canvas on top.
  var BOX = 'display:block;flex:none;position:relative;width:100%;height:100%;transform-origin:50% 50%';
  // The photo placeholder while it loads or when it fails: a dusk gradient and a small landscape glyph
  var PH = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32">' +
    '<circle cx="34" cy="9" r="4" fill="#fff" fill-opacity=".22"/><path d="M2 30 17 12 27 23 32 18 46 30Z" fill="#fff" ' +
    'fill-opacity=".16"/></svg>') + '") center/56px auto no-repeat,linear-gradient(160deg,#2b1a5e,#140834)';
  function make(kind) {
    var el = document.createElement('div'), v = document.createElement(kind === 'photo' ? 'div' : 'canvas');
    el.className = 'obj obj-' + kind;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = kind === 'medal' ? 'position:relative;width:100%;height:100%;min-height:96px' :
      'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center';
    v.className = 'obj-2d';
    v.style.cssText = kind === 'medal' ? 'position:absolute;left:0;top:0;width:100%;height:100%' : BOX;
    if (kind === 'photo') v.style.cssText += ';overflow:hidden;border-radius:14px;background:' + PH +
      ';box-shadow:0 10px 26px rgba(7,0,26,.5)';
    else if (kind === 'flag') v.style.cssText += ';border-radius:4px;box-shadow:0 8px 22px rgba(7,0,26,.55),0 0 0 1px rgba(255,255,255,.12)';
    el.appendChild(v);
    el._co = { kind: kind, cv: v, w: 0, h: 0 };
    return el;
  }
  // The photo fades in once decoded; on an error the placeholder stays and shows the description
  function photo(el, s) {
    var box = el._co.cv, im = document.createElement('img'), vg = document.createElement('i');
    function shown() { im.style.opacity = '1'; }
    function failed() {
      var cap = document.createElement('span');
      im.style.display = 'none';
      cap.textContent = s.alt || '';
      cap.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;text-align:center;font:600 12px/1.3 Inter,sans-serif;' +
        'color:rgba(255,255,255,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      box.appendChild(cap);
    }
    im.alt = s.alt || '';
    im.decoding = 'async';
    im.draggable = false;   // a native image drag would steal the card swipe
    // s.pos: where a tall photo anchors in the wide box, so the crop keeps a head, the arms or a torch
    im.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;object-position:' +
      (s.pos || '50% 50%') + ';display:block;opacity:0;pointer-events:none;-webkit-user-drag:none;-webkit-user-select:none;' +
      'user-select:none' + (RM ? '' : ';transition:opacity .25s');
    im.onload = shown; im.onerror = failed;
    // A soft vignette and a hairline, so bright skies sit on the dark card
    vg.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;border-radius:inherit;' +
      'background:radial-gradient(ellipse at 50% 42%,rgba(7,0,26,0) 58%,rgba(7,0,26,.38) 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)';
    box.appendChild(im); box.appendChild(vg);
    if (!s.src) return failed();
    im.src = s.src;
    if (im.complete && im.naturalWidth) { im.style.transition = ''; shown(); }   // already decoded: no fade
  }

  // ---- Paint scheduling ----
  // Size (and for canvases, paint) once the element has a size, again when it changes. offsetWidth ignores
  // the drag and stack transforms.
  function paint(el) {
    var o = el._co, w = el.offsetWidth, h = el.offsetHeight, v, bw, bh, a, d, x, k;
    if (!o || w < 4 || h < 4 || (w === o.w && h === o.h)) return;
    o.w = w; o.h = h; v = o.cv;
    if (o.kind === 'photo') {
      // About 16:10, never wider than the slot, and never taller than the 640 px photos fill sharply (the kiosk
      // slot reaches 520 px); .obj centres the box in the slot
      bh = Math.min(h, 360); bw = Math.min(w, Math.round(bh * 1.6));
      v.style.width = bw + 'px'; v.style.height = bh + 'px';
      return;
    }
    bw = w; bh = h;
    if (o.kind === 'flag') {
      a = flagAspect(o.spec.flag); bh = Math.min(h * .8, w * .9 / a); bw = Math.round(bh * a); bh = Math.round(bh);
      v.style.width = bw + 'px'; v.style.height = bh + 'px';
    } else if (o.kind === 'coin') {
      // Just round the coin, so the tilt pivots on it; painted up to 3× as it is small
      bh = Math.round(Math.min(h * .92, 300, w * .96)); bw = bh;
      v.style.width = bw + 'px'; v.style.height = bh + 'px';
    }
    d = Math.min(window.devicePixelRatio || 1, o.kind === 'coin' ? 3 : 2, Math.sqrt(700000 / (bw * bh)));
    v.width = Math.round(bw * d); v.height = Math.round(bh * d);
    x = v.getContext('2d');
    if (!x) return;
    x.setTransform(d, 0, 0, d, 0, 0);
    try {
      if (o.kind === 'flag') flagPaint(x, o.spec.flag, bw, bh);
      else if (o.kind === 'coin') tokens(x, o.spec, bw, bh, d);
      else { k = Math.min(bw, bh) * .96 / 200; x.translate(bw / 2, bh / 2); x.scale(k, k); coin(x, o.spec); }
    } catch (e) { /* never break a card */ }
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
  // The 2D paint hides under GL (and comes back when GL goes)
  function cover(el, gl) {
    if (!el || !el._co) return;
    var st = el._co.cv.style;
    st.transition = gl && !RM ? 'opacity .12s' : '';
    st.opacity = gl ? '0' : '';
  }
  // A medal box in el, replacing any medal already there (other children of el stay)
  function mount(el, tier) {
    var m = make('medal'), c = el.childNodes, i;
    m._co.spec = { color: TIER[Math.max(0, Math.min(3, Math.floor(+tier) || 0))], mark: 'kleros' };
    for (i = c.length - 1; i >= 0; i--) if (c[i].className && /\bobj-medal\b/.test(c[i].className)) el.removeChild(c[i]);
    el.appendChild(m);
    track(m);
    return m;
  }

  // ---- GL loader and hand-off ----
  function liteFor(o) {
    var n = navigator, c = n.connection;
    return !!(o.lite || (c && c.saveData) || (n.deviceMemory <= 2 && n.hardwareConcurrency <= 4) ||
      /[?&]lite=1\b/.test(location.search) || !window.WebGLRenderingContext);
  }
  function fetchGL() {
    if (asked || reg || dead || isLite || !CO._on) return;
    asked = true;
    var sc = document.createElement('script');
    sc.src = '/curate/gl.js'; sc.async = true;
    sc.onload = function () { if (!reg && window.CurateGL) CO._glReady(window.CurateGL); };
    sc.onerror = function () { dead = true; };
    (document.head || document.documentElement).appendChild(sc);
  }
  // In idle time, so the script never competes with a card being dealt
  function fetchSoon() {
    if (asked || reg || dead || isLite) return;
    if (window.requestIdleCallback) requestIdleCallback(fetchGL, { timeout: 4000 }); else setTimeout(fetchGL, 600);
  }
  function setMode(m, quiet) {
    CO.mode = m;
    if (quiet) return;
    try { document.dispatchEvent(new CustomEvent('curate:objects-mode', { detail: { mode: m } })); } catch (e) { /* old browser */ }
  }
  // Any GL failure drops to the 2D paint for the rest of the session
  function toStatic(quiet) {
    var a = api;
    dead = true; api = null;
    if (!a) return;
    cover(medalEl, false);
    try { if (a.medal) a.medal(null); } catch (e) { /* already broken */ }
    setMode('static', quiet);
  }
  function call(fn, a, b) {
    if (!api || !api[fn]) return;
    try { api[fn](a, b); } catch (e) { toStatic(); }
  }
  function handoff() {
    if (!medalEl) return;
    call('medal', medalEl, medalEl._co.spec);
    if (api) cover(medalEl, true);
  }
  // The registered renderer is set up only when a medal needs it: no WebGL context during a round
  function activate() {
    var a = reg, ok;
    if (api || dead || isLite || !a || !CO._on) return;
    try { ok = a.init ? a.init({ reduced: RM }) : true; } catch (e) { ok = false; }
    if (!ok) { dead = true; return; }
    api = a;
    setMode('gl');
    handoff();
  }

  // ---- Public API ----
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
    },
    // spec: { shape: 'photo', src, alt, pos? } | { shape: 'flag', flag } | { shape: 'coin', mark, color?, color2? }
    create: function (spec) {
      spec = spec || {};
      var kind = spec.shape === 'flag' || spec.shape === 'coin' ? spec.shape : 'photo', el = make(kind);
      el._co.spec = spec;
      if (kind === 'photo') photo(el, spec);
      track(el);
      return el;
    },
    // Starts loading a photo (say, the next cards’ photos) so it is decoded by the time its card is dealt
    preload: function (spec) {
      var src = spec && spec.shape === 'photo' && spec.src, im;
      if (!src || imgs[src] || !window.Image) return;
      im = new Image(); im.decoding = 'async'; im.src = src;
      imgs[src] = im; imgKeys.push(src);
      if (imgKeys.length > 24) delete imgs[imgKeys.shift()];
    },
    // The top card. Cards are all 2D now; the first live card means a round is on, so gl.js loads in idle time.
    live: function (el) {
      liveEl = el && el._co ? el : null;
      if (liveEl) fetchSoon();
    },
    tilt: function (el, yaw, pitch) {
      if (!el || !el._co || el._co.kind === 'medal') return;
      if (RM) return;
      var st = el._co.cv.style;
      st.transition = 'transform .12s cubic-bezier(.3,1.3,.5,1)';   // spring-smoothed over 120 ms
      st.transform = yaw || pitch ? 'perspective(600px) rotateY(' + (+yaw || 0) + 'deg) rotateX(' + (-pitch || 0) + 'deg)' : '';
    },
    // Kept for game.js (it reports each card’s Curate status); cards no longer show it
    state: function () {},
    // The Results medal in el (tierIndex 0 Everyone … 3 Gold), replacing the previous one; null releases it.
    medal: function (el, tierIndex) {
      if (medalEl) {
        call('medal', null);
        if (medalEl.parentNode) medalEl.parentNode.removeChild(medalEl);
        medalEl = null;
      }
      if (!el) return null;
      medalEl = mount(el, tierIndex);
      if (api) handoff(); else if (reg) activate(); else fetchGL();
      return medalEl;
    },
    hero: function () { return null; },   // v3’s title hero is gone; kept so an older caller does nothing
    // Kept for game.js: cards do not animate and rewards.js releases the medal when Results hide
    pause: function () {},
    resume: function () {},
    // Shared: the flag painter (a fresh canvas); the medal emblem for gl.js
    _flag: function (f, w, h) { return fresh(flagPaint, f, w, h); },
    _emblem: emblem,
    _glReady: function (a) {
      if (reg || dead || isLite || !a || !CO._on) return false;
      reg = a;
      if (medalEl) activate();
      return true;
    },
    _static: function () { toStatic(); }
  };
})();
