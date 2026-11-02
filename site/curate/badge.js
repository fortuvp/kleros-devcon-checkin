// Devcon badge module for the game (/curate/) and the staff desk (/staff/): one badge, one id, one hash on any
// phone; only the salted SHA-256 leaves it. Callbacks done(err, value) may run synchronously. QR: BarcodeDetector,
// else jsQR 1.4.0 (Apache-2.0, /curate/vendor/jsQR.js + jsQR-LICENSE.txt), loaded only when a scan needs it.
// QR out (3 Nov): the game ticket's and the booth tablet's Telegram link, drawn with qrcode-generator 1.4.4 (MIT,
// /curate/vendor/qrcode.js + qrcode-LICENSE.txt), loaded only when one shows.
(function () {
  'use strict';

  // ---- Setup ----
  var SALT = 'kleros-devcon-badge|';   // = the v6 desk: old and new pages hash alike
  var FORMATS = ['qr_code', 'aztec', 'data_matrix', 'pdf417'];
  var waits = {};   // callbacks queued on each in-flight vendor load, by its global's name

  // Read at call time: a test harness can swap settings.
  function cfg(k) { return (window.CURATE_SETTINGS || {})[k] || {}; }
  function endpoint() { return cfg('server').endpoint || ''; }
  function can() {
    var md = (window.navigator || {}).mediaDevices;
    return { hash: !!(window.crypto && window.crypto.subtle && window.TextEncoder), camera: !!(md && md.getUserMedia),
      detector: 'BarcodeDetector' in window };
  }

  // ---- Badge id ----
  // 1. a query id/secret/code/ticket/t: its value; 2. other query: last segment + every value; 3. last segment,
  // or every segment when it has no digit; 4. the text. Rules 1, 3 and 4 keep the v6 desk's ids (and hashes).
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function id(raw) {
    var s = String(raw == null ? '' : raw).trim(), q = /[?&](?:id|secret|code|ticket|t)=([^&#]+)/i.exec(s),
      m = /^https?:\/\/[^?#]*?([^\/?#]+)\/?(?:[?#].*)?$/i.exec(s), u, segs;
    if (q) s = dec(q[1]);
    else if (m) {
      u = /^https?:\/\/[^\/?#]*([^?#]*)(?:\?([^#]*))?/i.exec(s);
      segs = u[1].split('/').filter(Boolean);
      if (u[2]) s = m[1] + u[2].split('&').map(function (kv) { return kv.indexOf('=') < 0 ? '' : dec(kv.slice(kv.indexOf('=') + 1)); }).join('');
      else s = /\d/.test(m[1]) || !segs.length ? m[1] : segs.join('');
    }
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  // Refuses Kleros's own links (poster, game), a ticket code without its dash, and, until badge.pattern is
  // calibrated (/staff/?test=1), anything under 8 characters or without a letter and a digit.
  function ok(bid, raw) {
    var host = /^[a-z][\w+.\-]*:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)/i.exec(String(raw == null ? '' : raw).trim()), p = cfg('badge').pattern;
    bid = String(bid || '');
    if (!bid || bid.length > 200 || /^[KC][A-Z0-9]{6}$/.test(bid)) return false;
    if (host && /(^|\.)kleros\.io$/i.test(host[1])) return false;
    try { p = p ? new RegExp(p) : null; } catch (e) { p = null; }   // curate-check makes sure it compiles
    return p ? p.test(bid) : bid.length >= 8 && /\d/.test(bid) && /[A-Z]/.test(bid);
  }
  function tail(bid) { return String(bid || '').slice(-4); }

  // ---- Hash ----
  function hash(bid, done) {
    if (!can().hash) { done('nocrypto'); return; }
    window.crypto.subtle.digest('SHA-256', new window.TextEncoder().encode(SALT + bid)).then(function (buf) {
      done(null, Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''));
    }, function () { done('nocrypto'); });
  }
  function read(raw, done) {
    var bid = id(raw);
    if (!ok(bid, raw)) { done('notbadge', { id: bid }); return; }
    hash(bid, function (err, h) { if (err) done(err); else done(null, { id: bid, tail: tail(bid), hash: h }); });
  }

  // ---- Network ----
  // text/plain: no CORS preflight (Apps Script can't answer one). Any JSON reply goes back as is. opts.keepalive: the
  // request goes on if the page goes away (the Telegram tap's ask).
  function post(body, done, opts) {
    var url = endpoint(), sv = cfg('server'), ctl = window.AbortController ? new window.AbortController() : null, called, timer;
    function fin(err, j) { if (called) return; called = true; clearTimeout(timer); done(err, j); }
    if (!url) { done('noendpoint'); return; }
    if (!window.fetch) { done('offline'); return; }
    timer = setTimeout(function () { if (ctl) ctl.abort(); fin('timeout'); }, (opts && opts.timeoutMs) ||
      (body.action === 'status' ? sv.statusTimeoutMs || 8000 : sv.timeoutMs || 20000));
    window.fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
      credentials: 'omit', keepalive: !!(opts && opts.keepalive), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { /* an HTML error page */ }
        if (j && typeof j === 'object') fin(null, j); else fin('badreply');
      }, function () { fin('offline'); });
  }

  // ---- Vendor scripts (lazy): jsQR, qrcode-generator ----
  // One shared load each; a failed one is retried by the next call. done(good).
  function lazy(name, src, done) {
    var doc = window.document, el;
    done = done || function () {};
    if (window[name]) { done(true); return; }
    if (waits[name]) { waits[name].push(done); return; }
    waits[name] = [done];
    el = doc.createElement('script');
    el.src = src;
    el.onload = el.onerror = function () {
      var list = waits[name], good = !!window[name];
      waits[name] = null;
      if (!good) el.parentNode.removeChild(el);
      list.forEach(function (f) { try { f(good); } catch (e) { /* one caller must not starve the rest */ } });
    };
    doc.head.appendChild(el);
  }
  function loadJsQR(done) { lazy('jsQR', '/curate/vendor/jsQR.js', done); }
  function loadQR(done) { lazy('qrcode', '/curate/vendor/qrcode.js', done); }
  // A QR code as an <svg>: dark modules on white, a 4-module quiet zone, medium error correction. Upper-case text
  // (a ticket) uses the compact alphanumeric mode. null before loadQR() is done, or when the text can't fit.
  function qr(text) {
    var Q = window.qrcode, doc = window.document, NS = 'http://www.w3.org/2000/svg', q, n, d = '', r, c, e, svg, el;
    if (!Q || !doc.createElementNS) return null;
    try {
      q = Q(0, 'M');
      q.addData(String(text), /^[0-9A-Z $%*+\-.\/:]+$/.test(text) ? 'Alphanumeric' : 'Byte');
      q.make();
    } catch (err) { return null; }
    n = q.getModuleCount();
    for (r = 0; r < n; r++) {   // one rectangle per run of dark modules in a row
      for (c = 0; c < n; c = e + 1) {
        e = c;
        while (e < n && q.isDark(r, e)) e++;
        if (e > c) d += 'M' + (c + 4) + ' ' + (r + 4) + 'h' + (e - c) + 'v1h' + (c - e) + 'z';
      }
    }
    svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (n + 8) + ' ' + (n + 8));
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    el = svg.appendChild(doc.createElementNS(NS, 'rect'));
    el.setAttribute('width', '100%'); el.setAttribute('height', '100%'); el.setAttribute('fill', '#fff');
    el = svg.appendChild(doc.createElementNS(NS, 'path'));
    el.setAttribute('d', d); el.setAttribute('fill', '#000');
    return svg;
  }

  // ---- Scanner ----
  // scan({ video, facing, onCode, onError, onReady, skip }) → { stop }. onCode(raw) fires once, camera already off.
  // skip(raw) true: the code is passed over and the camera keeps reading (no restart loop on a poster's QR).
  // onError(kind) ends the scan: nocamera | blocked | noreader | hidden. The reader looks only for the 2D codes
  // of settings badge.formats, so a bottle's barcode never reads.
  function scan(o) {
    var v = o.video, doc = window.document, live = true, stream, timer, det = null, fails = 0, ready, cv, loading;
    function release(s) { s.getTracks().forEach(function (t) { t.stop(); }); }
    function end() {   // safe twice
      live = false; clearTimeout(timer);
      doc.removeEventListener('visibilitychange', onVis);
      if (stream) { release(stream); stream = null; }
      v.srcObject = null;
    }
    function err(kind) { if (live) { end(); if (o.onError) o.onError(kind); } }
    function got(raw) {
      if (!live) return;
      if (o.skip && o.skip(String(raw))) { next(); return; }
      end(); if (o.onCode) o.onCode(String(raw));
    }
    function onVis() { if (doc.hidden) err('hidden'); }   // a locked screen freezes the camera
    function next() { if (live) timer = setTimeout(tick, 150); }
    // jsQR when there is no BarcodeDetector, or after 20 failed detects.
    function needJsQR() {
      if (window.jsQR || loading) return;
      loading = true;
      loadJsQR(function (good) {
        loading = false;
        if (live && !good) { if (det) fails = 0; else err('noreader'); }   // never a camera without a reader
      });
    }
    function tick() {
      var w, h, x, c;
      if (!live) return;
      if (v.readyState < 2 || !v.videoWidth) { next(); return; }
      if (!ready) { ready = true; if (o.onReady) o.onReady(); }
      if (det && fails < 20) {
        det.detect(v).then(function (codes) {
          fails = 0;
          if (codes && codes[0] && codes[0].rawValue) got(codes[0].rawValue); else next();
        }, function () { if (++fails >= 20) needJsQR(); next(); });
        return;
      }
      if (!window.jsQR) { needJsQR(); next(); return; }
      w = Math.min(960, v.videoWidth); h = Math.round(v.videoHeight * w / v.videoWidth);
      cv = cv || doc.createElement('canvas');   // offscreen, never attached
      cv.width = w; cv.height = h;
      x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
      c = window.jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (c && c.data) got(c.data); else next();
    }
    function camera() {
      window.navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: o.facing || 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (s) {
        var tr = s.getVideoTracks()[0], cap, p;
        if (!live) { release(s); return; }   // stopped while the camera was starting
        stream = s; v.srcObject = s;
        try {   // close-up focus where the phone supports it
          cap = tr.getCapabilities ? tr.getCapabilities() : {};
          if (cap.focusMode && cap.focusMode.indexOf('continuous') > -1) tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) { /* not supported */ }
        p = v.play(); if (p && p.catch) p.catch(function () { /* muted autoplay: fine */ });
        tick();
      }, function () { err('blocked'); });
    }

    if (!can().camera) { setTimeout(function () { err('nocamera'); }, 0); return { stop: end }; }   // the caller holds the handle first
    doc.addEventListener('visibilitychange', onVis);
    (function (BD, want) {   // the detector first, then the camera; iPhone fetches jsQR meanwhile
      function go(d) {
        if (!live) return;
        det = d;
        if (!d) needJsQR();
        try { camera(); } catch (e) { err('blocked'); }
      }
      if (!BD || !BD.getSupportedFormats) { go(null); return; }
      BD.getSupportedFormats().then(function (have) {
        var f = want.filter(function (x) { return have.indexOf(x) > -1; });
        try { go(f.length ? new BD({ formats: f }) : null); } catch (e) { go(null); }
      }, function () { go(null); });
    })(window.BarcodeDetector, cfg('badge').formats || FORMATS);
    return { stop: end };
  }

  // ---- Export ----
  window.CurateBadge = { SALT: SALT, endpoint: endpoint, can: can, id: id, ok: ok, tail: tail, hash: hash, read: read,
    post: post, scan: scan, loadJsQR: loadJsQR, loadQR: loadQR, qr: qr };
})();
