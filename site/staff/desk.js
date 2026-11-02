// Merch desk (staff only): one merch item per Devcon badge, whatever email or phone the visitor used.
// Staff scan the badge, the sheet script says whether it already got merch, and staff record what they hand
// over. Only a SHA-256 of the badge's normalised id leaves this phone. Talks to settings.js staffDesk.endpoint
// (apps-script/staff-desk/), never to the check-in backend or the game's sign-up sheet. Staff never open the
// Sheet: checking a badge saves nothing, and only tapping an item adds a row. User text reaches the DOM through textContent only.
// /staff/?test=1 shows what a badge decodes to (raw and normalised) without saving anything: use it once
// on a real badge to set staffDesk.badgePattern before opening.
(function () {
  'use strict';

  // ---- Setup ----
  var S = window.CURATE_SETTINGS || {}, CFG = window.KLEROS_BOOTH_CONFIG || {}, A = S.staffDesk || {};
  var URL_ = A.endpoint || '';
  var PATTERN = null;
  try { PATTERN = A.badgePattern ? new RegExp(A.badgePattern) : null; } catch (e) { PATTERN = null; }
  var TEST = /[?&]test=1\b/.test(location.search);
  var KEY = 'kleros_curate_desk', SALT = 'kleros-devcon-badge|', TIMEOUT_MS = 12000;
  var TIER_KEYS = ['teal', 'purple', 'gold'];
  var me = load(), stream = null, detector = null, scanning = false, camToken = 0, detectFails = 0;
  // gen changes on every new badge and on Next badge: a reply for an older badge is ignored.
  var gen = 0, busy = false, current = null;

  function $(id) { return document.getElementById(id); }
  function txt(id, s) { var el = $(id); if (el) el.textContent = s == null ? '' : String(s); return el; }
  function show(id) { ['setup', 'home', 'scan', 'typer'].forEach(function (x) { $(x).hidden = x !== id; }); $('result').hidden = true; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* private mode: ask again next time */ } }
  function newId() { var s = '', a = 'abcdefghijkmnpqrstuvwxyz23456789', i; for (i = 0; i < 12; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
  // Chrome blocks vibrate (with a console error) until the page has been tapped once.
  function buzz(p) {
    try { if (navigator.vibrate && !(navigator.userActivation && !navigator.userActivation.hasBeenActive)) navigator.vibrate(p); } catch (e) { /* not supported */ }
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  // The three merch tiers from config.js (the same names staff see on tickets). "X or Y" becomes two buttons.
  function tiers() {
    var m = (CFG.merch && CFG.merch.tiers && CFG.merch.tiers.length === 3) ? CFG.merch : (S.fallbackMerch || { tiers: [] });
    return m.tiers.map(function (t, i) {
      var items = String(t.reward || '').split(/\s+or\s+/i).map(function (s) { s = s.trim(); return s.charAt(0).toUpperCase() + s.slice(1); });
      return { key: TIER_KEYS[i], name: t.name || TIER_KEYS[i], items: items };
    });
  }

  // ---- Badge id ----
  // One badge, one id, whether scanned on Android or iPhone or typed: a URL keeps only its id/secret/code/ticket
  // query value or its last path segment, then everything is upper-cased and stripped to letters and digits.
  function badgeId(raw) {
    var s = String(raw == null ? '' : raw).trim(), q, m;
    q = /[?&](?:id|secret|code|ticket|t)=([^&#]+)/i.exec(s);
    m = /^https?:\/\/[^?#]*?([^\/?#]+)\/?(?:[?#].*)?$/i.exec(s);
    if (q) { try { s = decodeURIComponent(q[1]); } catch (e) { s = q[1]; } } else if (m) s = m[1];
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  // A code that isn't a Devcon badge (a phone ticket, the back of the badge, a bottle) is refused, never hashed.
  function badgeOk(id) { return id.length >= 6 && id.length <= 200 && (!PATTERN || PATTERN.test(id)); }

  // ---- Network ----
  function post(body) {
    var ctl = window.AbortController ? new AbortController() : null, timer;
    body.key = me.key;
    timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    return fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (j && j.error === 'wrong key') { me.key = ''; me.keyBad = true; save(); throw new Error('key'); }
        return j || {};
      }, function (e) { clearTimeout(timer); throw e; });
  }
  function sha256(text) {
    var bytes = new TextEncoder().encode(SALT + text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    });
  }

  // ---- Home ----
  function home() {
    stopCam();
    gen++; busy = false; current = null;
    if (!URL_ && !TEST) {
      show('setup'); $('setup-form').hidden = true; $('setup-hint').hidden = true;
      txt('setup-title', 'Not connected yet');
      txt('setup-msg', 'This desk has no badge list yet, so it can’t check anyone. Don’t hand out merch from it. Booth lead: see apps-script/staff-desk/README.md.');
      return;
    }
    if (!me.key && !TEST) {
      show('setup'); $('setup-form').hidden = false; $('setup-hint').hidden = false; txt('setup-title', 'Staff key'); $('k-name').value = me.staff || '';
      txt('setup-msg', me.keyBad ? 'That key didn’t work. Ask the booth lead for the current one.' : '');
      return;
    }
    txt('who', TEST ? 'Test mode · nothing is saved' : (me.staff ? me.staff + ' · staff' : 'Staff'));
    show('home');
    if (TEST) return;
    var g = gen;
    post({ action: 'stats' }).then(function (j) {
      if (g !== gen || !j.ok || !j.today) return;
      txt('n-teal', j.today.teal); txt('n-purple', j.today.purple); txt('n-gold', j.today.gold);
    }, function (e) { if (e && e.message === 'key' && g === gen) home(); });
  }
  $('setup-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    me.key = $('k-key').value.trim().toUpperCase(); me.staff = $('k-name').value.trim(); me.keyBad = false;
    if (!me.key) { txt('setup-msg', 'Enter the key.'); return; }
    save(); $('k-key').value = '';
    home();
  });
  $('rekey').addEventListener('click', function () {
    if (!window.confirm('Sign out of the desk on this phone? You’ll need the key again.')) return;
    me.key = ''; save(); home();
  });

  // ---- Camera ----
  // BarcodeDetector where the browser has it (Android Chrome), limited to 2D badge codes; jsQR on canvas
  // frames elsewhere (iPhone), and also when BarcodeDetector keeps failing.
  function makeDetector() {
    if (!('BarcodeDetector' in window) || !window.BarcodeDetector.getSupportedFormats) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats().then(function (have) {
      var want = (A.badgeFormats || ['qr_code', 'aztec', 'data_matrix', 'pdf417']).filter(function (f) { return have.indexOf(f) > -1; });
      return want.length ? new window.BarcodeDetector({ formats: want }) : null;
    }, function () { return null; });
  }
  function startCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { typeIt('No camera on this browser: type the code.'); return; }
    var token = ++camToken;
    show('scan'); detectFails = 0;
    makeDetector().then(function (d) {
      detector = d;
      return navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
    }).then(function (s) {
      // Left the scan screen while the camera was starting: release it at once.
      if (token !== camToken || $('scan').hidden) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; $('video').srcObject = s;
      try {   // close-up focus where the phone supports it
        var tr = s.getVideoTracks()[0], c = tr && tr.getCapabilities ? tr.getCapabilities() : {};
        if (c.focusMode && c.focusMode.indexOf('continuous') > -1) tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (e) { /* not supported */ }
      var p = $('video').play(); if (p && p.catch) p.catch(function () { /* muted autoplay: fine */ });
      scanning = true; tick();
    }, function () { if (token === camToken) typeIt('The camera is blocked: allow it in the browser settings, or type the code.'); });
  }
  function stopCam() {
    camToken++; scanning = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    $('video').srcObject = null;
  }
  function tick() {
    if (!scanning) return;
    var v = $('video'), next = function () { setTimeout(tick, 150); };
    if (v.readyState < 2 || !v.videoWidth) { next(); return; }
    if (detector && detectFails < 20) {
      detector.detect(v).then(function (codes) { detectFails = 0; if (codes && codes[0] && codes[0].rawValue) found(codes[0].rawValue); else next(); },
        function () { detectFails++; next(); });
      return;
    }
    if (!window.jsQR) { next(); return; }
    var c = $('frame'), w = Math.min(960, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth), x, code;
    c.width = w; c.height = h; x = c.getContext('2d'); x.drawImage(v, 0, 0, w, h);
    code = window.jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) found(code.data); else next();
  }
  function found(raw) {
    if (!scanning) return;
    stopCam(); buzz(30);
    check(raw);
  }
  $('scan-go').addEventListener('click', startCam);
  $('scan-cancel').addEventListener('click', home);
  $('scan-type').addEventListener('click', function () { typeIt(''); });
  // A locked screen or another app freezes the camera: start over from home.
  document.addEventListener('visibilitychange', function () { if (document.hidden && !$('scan').hidden) home(); });

  // ---- Typing ----
  function typeIt(msg) { stopCam(); show('typer'); $('badge-text').value = ''; txt('type-msg', msg); $('badge-text').focus(); }
  $('type-go').addEventListener('click', function () { typeIt(''); });
  $('type-cancel').addEventListener('click', home);
  $('type-form').addEventListener('submit', function (ev) { ev.preventDefault(); check($('badge-text').value); });

  // ---- Result ----
  function result(tone, icon, word, line) {
    var r = $('result');
    r.hidden = false; r.setAttribute('data-tone', tone);
    txt('r-icon', icon); txt('r-word', word); txt('r-line', line); txt('r-msg', '');
    $('r-items').hidden = true; $('r-retry').hidden = true; $('r-free').hidden = true;
    r.scrollTop = 0;
  }
  function usedLine(last) { return last ? cap(last.tier) + ' · ' + (last.item || 'merch') + ', ' + (last.day ? last.day + ' ' : '') + last.at + '.' : ''; }
  function check(raw) {
    var id = badgeId(raw), g;
    if (busy) return;
    if (TEST) {   // calibration: show what this badge reads as, save nothing
      result('', 'ℹ', 'Test scan', 'Raw: ' + String(raw).slice(0, 160) + '\nId: ' + id + (badgeOk(id) ? '\nAccepted.' : '\nRefused by badgePattern or length.'));
      return;
    }
    if (!badgeOk(id)) {
      buzz([60, 60, 60]);
      result('warn', '!', 'Not a Devcon badge', 'Scan the code on their lanyard badge: not a phone screen, a photo or the back of the badge.');
      return;
    }
    g = ++gen;
    sha256(id).then(function (hash) {
      if (g !== gen) return;
      current = { badge: hash, tail: id.slice(-4), checked: false, claimId: newId() };
      checkHash();
    }, fail(g));
  }
  // A badge is offered merch only after the sheet said it is new (current.checked).
  function checkHash() {
    var g = gen;
    busy = true;
    result('', '…', 'Checking', 'Badge …' + current.tail);
    post({ action: 'check', badge: current.badge }).then(function (j) {
      if (g !== gen) return;
      busy = false;
      if (!j.ok) throw new Error(j.error || 'check failed');
      if (j.used) { buzz([60, 60, 60]); current = null; result('bad', '✗', 'Already got merch', usedLine(j.last) + ' No more merch for this badge. Stickers are fine.'); return; }
      buzz(30); current.checked = true;
      result('good', '✓', 'New badge', 'Badge …' + current.tail);
      offer();
    }).catch(fail(g));
  }
  function offer() {
    var box = $('r-buttons');
    while (box.firstChild) box.removeChild(box.firstChild);
    tiers().forEach(function (t) {
      var h = document.createElement('h2'); h.textContent = t.name; box.appendChild(h);
      t.items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 't-' + t.key; b.textContent = item;
        b.addEventListener('click', function () { give(t, item); });
        box.appendChild(b);
      });
    });
    if (current && current.ticket) $('r-ticket').value = current.ticket;
    $('r-items').hidden = false; $('r-free').hidden = false;
  }
  // The same claim id on every retry, so a claim that saved but lost its reply is recognised, not refused.
  function give(t, item) {
    var ticket = $('r-ticket').value.trim().toUpperCase(), g = gen;
    if (busy || !current) return;
    if (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket)) { txt('r-msg', 'The ticket code looks like K-ABC123 or C-ABC123 (or leave it empty).'); return; }
    busy = true; current.ticket = ticket;
    Array.prototype.forEach.call($('r-buttons').querySelectorAll('button'), function (b) { b.disabled = true; });
    txt('r-msg', 'Saving…');
    post({ action: 'claim', badge: current.badge, tier: t.key, item: item, ticket: ticket, staff: me.staff || '', id: current.claimId }).then(function (j) {
      if (g !== gen) return;
      busy = false;
      if (j.ok) { buzz(40); result('good', '✓', 'Give: ' + item, t.name + ' · saved. One item per badge.'); current = null; return; }
      if (j.used) { buzz([60, 60, 60]); result('bad', '✗', 'Already got merch', usedLine(j.last) + ' Another phone just gave it.'); current = null; return; }
      if (j.ticketUsed) { buzz([60, 60, 60]); result('warn', '!', 'Ticket already used', 'This ticket went with another badge: ' + usedLine(j.last)); return; }
      throw new Error(j.error || 'not saved');
    }).catch(fail(g));
  }
  function fail(g) {
    return function (e) {
      if (g !== gen) return;
      busy = false;
      if (e && e.message === 'key') { home(); return; }
      result('warn', '!', 'Can’t reach the sheet', 'Check the connection, then tap Try again. Don’t hand anything over yet.');
      $('r-retry').hidden = !current;
    };
  }
  // Retry repeats whatever failed: the check, or the save of an already checked badge (same claim id).
  $('r-retry').addEventListener('click', function () {
    if (!current || busy) return;
    if (!current.checked) { checkHash(); return; }
    result('good', '✓', 'New badge', 'Badge …' + current.tail); offer();
  });
  $('r-next').addEventListener('click', home);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', home); else home();
})();
