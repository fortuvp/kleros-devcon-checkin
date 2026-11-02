// Curate game: the "earn for real" mini form on Results. One field, Telegram or email.
// It posts to the game owner's own sheet script (settings.js sheetApp.endpoint, an Apps Script web app: see
// apps-script/curate-sheet/), never to the check-in backend. While no endpoint is set the form stays hidden,
// so no sign-up is silently lost; ?earnpreview=1 shows it anyway for a look. A sign-up that can't be sent
// waits on the phone (kleros_devcon_curate_earn) and goes out on the next load. User text reaches the DOM
// through textContent only.
(function () {
  'use strict';

  // ---- Setup ----
  var S = window.CURATE_SETTINGS || {}, E = { endpoint: (S.sheetApp || {}).endpoint || '', monthly: (S.earn || {}).monthly }, CFG = window.KLEROS_BOOTH_CONFIG || {};
  var KIOSK = /[?&]kiosk=1\b/.test(location.search), PREVIEW = /[?&]earnpreview=1\b/.test(location.search);
  var KEY = 'kleros_devcon_curate_earn';
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, TG = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;
  var sending = false;

  function $(id) { return document.getElementById(id); }
  function txt(id, s) { var el = $(id); if (el) el.textContent = s; return el; }
  // A booth tablet keeps nothing: each visitor gets a fresh form, and their contact never stays on the device.
  function load() {
    if (KIOSK) return { queue: [], done: false };
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { queue: [], done: false }; } catch (e) { return { queue: [], done: false }; }
  }
  function save() { if (KIOSK) return; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode: memory only */ } }
  var st = load();
  if (!st.queue) st.queue = [];

  function kindOf(v) { return EMAIL.test(v) ? 'email' : TG.test(v) ? 'telegram' : ''; }
  function tidy(v, kind) { return kind === 'telegram' && v.charAt(0) !== '@' ? '@' + v : v; }
  function newId() {
    var s = '', a = 'abcdefghijkmnpqrstuvwxyz23456789', i;
    for (i = 0; i < 12; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  }

  // ---- Sending ----
  // text/plain keeps the request simple (no CORS preflight), as the check-in page does with its backend.
  function send(item) {
    return fetch(E.endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(item) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'not saved'); });
  }
  // One at a time, oldest first. Retries are safe: the sheet script skips an id it already saved.
  function flush() {
    if (sending || !E.endpoint || !st.queue.length || !window.fetch) return;
    sending = true;
    send(st.queue[0]).then(function () {
      sending = false; st.queue.shift(); save(); flush();
    }, function () { sending = false; /* try again on the next load or when back online */ });
  }

  // ---- Form ----
  function msg(s, bad) {
    var el = txt('earn-msg', s);
    if (el) { el.hidden = !s; el.className = bad ? 'earn-msg bad' : 'earn-msg'; }
  }
  // Results (re)shown: the box appears only when sign-ups can reach the sheet, and only until this phone signed up.
  function render() {
    var box = $('earn');
    if (!box) return;
    box.hidden = !(E.endpoint || PREVIEW) || (st.done && !KIOSK);
    if (box.hidden) return;
    txt('earn-line', 'Kleros pays curators ' + (E.monthly || '$5,000+') + ' every month.');
    if (KIOSK || !st.done) { $('earn-form').hidden = false; $('earn-contact').value = ''; msg(''); }
  }
  function submit(ev) {
    var input = $('earn-contact'), v = input.value.trim(), kind = kindOf(v), item;
    ev.preventDefault();
    if (!kind) { msg('Enter an email or a @Telegram handle.', true); input.focus(); return; }
    item = { action: 'earn', id: newId(), contact: tidy(v, kind), kind: kind, source: 'curate', event: CFG.event || '',
      app: (($('rep-kicker') || {}).textContent || '').slice(0, 60),
      score: parseInt((($('rep-score') || {}).textContent || '').replace(/\D/g, ''), 10) || 0, at: new Date().toISOString() };
    if (!E.endpoint) { $('earn-form').hidden = true; msg('Preview only: no sign-up sheet is set yet.'); return; }
    st.queue.push(item);
    st.done = true;
    save();
    input.value = '';
    $('earn-form').hidden = true;
    msg('Thanks! We’ll message you soon.');
    flush();
  }

  // ---- Wiring ----
  function init() {
    var form = $('earn-form'), report = $('report');
    if (!form || !report) return;
    form.addEventListener('submit', submit);
    // Re-render whenever Results come into view (rewards.js toggles the hidden attribute).
    if (window.MutationObserver) {
      new MutationObserver(function () { if (!report.hidden) render(); }).observe(report, { attributes: true, attributeFilter: ['hidden'] });
    }
    render();
    flush();
    window.addEventListener('online', flush);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
