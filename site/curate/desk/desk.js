// Merch desk (staff only): one merch item per Devcon badge, whatever email or phone the visitor used.
// Staff scan the badge, the sheet script says whether it already got merch, and staff record what they hand
// over. Only a SHA-256 of the badge code leaves this phone. Talks to settings.js sheetApp.endpoint
// (apps-script/curate-sheet/), never to the check-in backend. User text reaches the DOM through textContent only.
(function () {
  'use strict';

  // ---- Setup ----
  var S = window.CURATE_SETTINGS || {}, CFG = window.KLEROS_BOOTH_CONFIG || {};
  var URL_ = (S.sheetApp || {}).endpoint || '';
  var KEY = 'kleros_curate_desk', SALT = 'kleros-devcon-badge|';
  var TIER_KEYS = ['teal', 'purple', 'gold'];
  var me = load(), stream = null, detector = null, scanning = false, current = null, busy = false;

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

  // The three merch tiers from config.js (the same names staff see on tickets). "X or Y" becomes two buttons.
  function tiers() {
    var m = (CFG.merch && CFG.merch.tiers && CFG.merch.tiers.length === 3) ? CFG.merch : (S.fallbackMerch || { tiers: [] });
    return m.tiers.map(function (t, i) {
      var items = String(t.reward || '').split(/\s+or\s+/i).map(function (s) { s = s.trim(); return s.charAt(0).toUpperCase() + s.slice(1); });
      return { key: TIER_KEYS[i], name: t.name || TIER_KEYS[i], items: items };
    });
  }

  // ---- Network ----
  function post(body) {
    body.key = me.key;
    return fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.error === 'wrong key') { me.key = ''; save(); throw new Error('key'); }
        return j || {};
      });
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
    if (!URL_) { show('setup'); txt('setup-msg', 'The sheet isn’t set up yet: put its URL in settings.js (sheetApp.endpoint).'); return; }
    if (!me.key) { show('setup'); $('k-name').value = me.staff || ''; return; }
    txt('who', me.staff ? me.staff + ' · staff' : 'Staff');
    show('home');
    post({ action: 'stats' }).then(function (j) {
      if (!j.ok || !j.today) return;
      txt('n-teal', j.today.teal); txt('n-purple', j.today.purple); txt('n-gold', j.today.gold);
    }, function (e) { if (e && e.message === 'key') home(); });
  }
  $('setup-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    me.key = $('k-key').value.trim().toUpperCase(); me.staff = $('k-name').value.trim();
    if (!me.key) { txt('setup-msg', 'Enter the key.'); return; }
    save(); $('k-key').value = '';
    home();
  });
  $('rekey').addEventListener('click', function () { me.key = ''; save(); home(); });

  // ---- Camera ----
  // BarcodeDetector where the browser has it (Android Chrome); jsQR on canvas frames elsewhere (iPhone).
  function makeDetector() {
    if (!('BarcodeDetector' in window) || !window.BarcodeDetector.getSupportedFormats) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats().then(function (have) {
      var want = ['qr_code', 'aztec', 'data_matrix', 'pdf417', 'code_128', 'code_39', 'ean_13'].filter(function (f) { return have.indexOf(f) > -1; });
      return want.length ? new window.BarcodeDetector({ formats: want }) : null;
    }, function () { return null; });
  }
  function startCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { typeIt('No camera on this browser: type the code.'); return; }
    show('scan');
    makeDetector().then(function (d) {
      detector = d;
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    }).then(function (s) {
      stream = s; $('video').srcObject = s;
      var p = $('video').play(); if (p && p.catch) p.catch(function () { /* autoplay muted: fine */ });
      scanning = true; tick();
    }, function () { typeIt('The camera is blocked: allow it in the browser, or type the code.'); });
  }
  function stopCam() {
    scanning = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    $('video').srcObject = null;
  }
  function tick() {
    if (!scanning) return;
    var v = $('video');
    if (v.readyState < 2) { setTimeout(tick, 150); return; }
    var next = function () { setTimeout(tick, 150); };
    if (detector) {
      detector.detect(v).then(function (codes) { if (codes && codes[0] && codes[0].rawValue) found(codes[0].rawValue); else next(); }, next);
      return;
    }
    if (!window.jsQR) { next(); return; }
    var c = $('frame'), w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth), x, img, code;
    c.width = w; c.height = h; x = c.getContext('2d'); x.drawImage(v, 0, 0, w, h);
    img = x.getImageData(0, 0, w, h);
    code = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) found(code.data); else next();
  }
  function found(text) {
    if (!scanning) return;
    stopCam(); buzz(30);
    check(String(text).trim());
  }
  $('scan-go').addEventListener('click', startCam);
  $('scan-cancel').addEventListener('click', home);
  $('scan-type').addEventListener('click', function () { stopCam(); typeIt(''); });

  // ---- Typing ----
  function typeIt(msg) { stopCam(); show('typer'); $('badge-text').value = ''; txt('type-msg', msg); $('badge-text').focus(); }
  $('type-go').addEventListener('click', function () { typeIt(''); });
  $('type-cancel').addEventListener('click', home);
  $('type-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var t = $('badge-text').value.trim().toUpperCase().replace(/\s+/g, '');
    if (t.length < 4) { $('badge-text').focus(); return; }
    check(t);
  });

  // ---- Result ----
  function result(tone, icon, word, line) {
    var r = $('result');
    r.hidden = false; r.setAttribute('data-tone', tone);
    txt('r-icon', icon); txt('r-word', word); txt('r-line', line); txt('r-msg', '');
    $('r-items').hidden = true; $('r-retry').hidden = true;
    r.scrollTop = 0;
  }
  function usedLine(last) {
    return last ? cap(last.tier) + ' · ' + (last.item || 'merch') + ' at ' + last.at + '.' : '';
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function check(text) {
    if (busy) return;
    sha256(text).then(function (hash) { current = { badge: hash, checked: false }; checkHash(); }, fail);
  }
  // A badge is offered merch only after the sheet said it is new (current.checked).
  function checkHash() {
    busy = true;
    result('', '…', 'Checking', '');
    post({ action: 'check', badge: current.badge }).then(function (j) {
      busy = false;
      if (!j.ok) throw new Error(j.error || 'check failed');
      if (j.used) { buzz([60, 60, 60]); current = null; result('bad', '✗', 'Already got merch', usedLine(j.last) + ' No more merch for this badge. Stickers are fine.'); return; }
      buzz(30); current.checked = true;
      result('good', '✓', 'New badge', '');
      offer();
    }).catch(fail);
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
    $('r-ticket').value = '';
    $('r-items').hidden = false;
  }
  function give(t, item) {
    var ticket = $('r-ticket').value.trim().toUpperCase();
    if (busy || !current) return;
    if (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket)) { txt('r-msg', 'The ticket code looks like K-ABC123 or C-ABC123 (or leave it empty).'); return; }
    busy = true; txt('r-msg', 'Saving…');
    post({ action: 'claim', badge: current.badge, tier: t.key, item: item, ticket: ticket, staff: me.staff || '', id: newId() }).then(function (j) {
      busy = false;
      if (j.ok) { buzz(40); result('good', '✓', 'Give: ' + item, t.name + ' · saved. One item per badge.'); current = null; return; }
      if (j.used) { buzz([60, 60, 60]); result('bad', '✗', 'Already got merch', usedLine(j.last) + ' Another phone just gave it.'); return; }
      if (j.ticketUsed) { buzz([60, 60, 60]); result('warn', '!', 'Ticket already used', 'This ticket went with another badge: ' + usedLine(j.last)); return; }
      throw new Error(j.error || 'not saved');
    }).catch(fail);
  }
  function fail(e) {
    busy = false;
    if (e && e.message === 'key') { home(); return; }
    result('warn', '!', 'Can’t reach the sheet', 'Check the connection, then try again. Nothing was saved.');
    $('r-retry').hidden = !current;
  }
  // Retry repeats whatever failed: the check, or the save of an already checked badge.
  $('r-retry').addEventListener('click', function () {
    if (!current) return;
    if (!current.checked) { checkHash(); return; }
    result('good', '✓', 'New badge', ''); offer();
  });
  $('r-next').addEventListener('click', function () { current = null; home(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', home); else home();
})();
