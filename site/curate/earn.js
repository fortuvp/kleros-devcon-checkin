// Curate game: the contact step under a locked ticket (badge and none modes; in telegram mode verifying is the
// contact, so no ticket locks). One field, email or @Telegram, plus an optional curator tick. It posts to the
// booth's one sheet script through CurateBadge.post (settings.js server.endpoint, apps-script/staff-desk/), which
// writes the contacts sheet, never the badge list, and never the check-in backend. Nothing is queued or kept on the
// device: a contact that can't be sent is typed again. User text reaches the DOM through textContent only.
(function () {
  'use strict';

  // ---- Setup ----
  var S = window.CURATE_SETTINGS || {}, C = S.contact || {}, CFG = window.KLEROS_BOOTH_CONFIG || {};
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, TG = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;
  var cur = null, sending = false;   // cur: the open step ({ badge, kiosk, onDone, onInput, id })

  function $(id) { return document.getElementById(id); }
  function txt(id, s) { var el = $(id); if (el) el.textContent = s == null ? '' : String(s); return el; }
  // The retired Earn for real queue (v6): its sign-ups went to a sheet script that no longer exists.
  try { localStorage.removeItem('kleros_devcon_curate_earn'); } catch (e) { /* blocked storage: nothing to remove */ }

  function kindOf(v) { return v.length > 120 ? '' : EMAIL.test(v) ? 'email' : TG.test(v) ? 'telegram' : ''; }
  function tidy(v, kind) { return kind === 'telegram' && v.charAt(0) !== '@' ? '@' + v : v; }
  // One id per shown step, reused on retry, so the script writes one contacts row however often it is sent.
  function newId() {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '', u = null, i;
    try { u = new Uint8Array(12); window.crypto.getRandomValues(u); } catch (e) { u = null; }
    for (i = 0; i < 12; i++) s += a.charAt((u ? u[i] : Math.floor(Math.random() * 256)) % a.length);
    return s;
  }
  // The privacy notice (#curate-privacy) is always in the page: say where to ask for deletion (both paragraphs).
  function fillPrivacy() {
    if (C.privacyEmail) ['cp-mail', 'cp-mail-tg'].forEach(function (id) { txt(id, 'ask at the booth or write to ' + C.privacyEmail); });
  }

  // ---- Form ----
  function msg(s, bad) {
    var el = $('contact-msg');
    if (!el) return;
    el.className = bad ? 'earn-msg bad' : 'earn-msg';
    el.textContent = s || '';
  }
  function busy(on) {
    var b = $('contact-go');
    sending = on;
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? 'Unlocking…' : 'Unlock';
  }
  function clear() {
    var input = $('contact-input'), tick = $('contact-curator');
    if (input) input.value = '';
    if (tick) tick.checked = false;
    msg('');
  }
  // opts: { badge: hex64, tier: 1..3, kiosk, onDone(reply), onInput() }.
  function show(opts) {
    var box = $('contact'), form = $('contact-form'), input = $('contact-input'), h = $('contact-title');
    opts = opts || {};
    cur = { badge: opts.badge || '', kiosk: !!opts.kiosk, onDone: opts.onDone, onInput: opts.onInput, id: newId() };
    busy(false);
    clear();
    if (form) form.hidden = false;
    txt('contact-curator-text', 'Also tell me how to earn as a curator: Kleros pays curators ' + (C.monthly || '$5,000+') +
      ' every month.');
    fillPrivacy();
    // A shared booth tablet must not suggest the last visitor's email.
    if (input && cur.kiosk) input.setAttribute('autocomplete', 'off');
    if (!box) return;
    box.hidden = false;
    // The title, not the input: an iPhone keyboard would cover the ticket above.
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browsers: no options */ }
  }
  function hide() {
    var box = $('contact');
    cur = null;
    busy(false);
    clear();
    if (box) box.hidden = true;
  }
  function failed(code) {
    if (code === 'badcontact') return 'Enter an email or a @Telegram handle.';
    if (code === 'notry') return 'Play a round first.';
    return 'Can’t send right now. Check the connection and try again.';
  }
  function submit(ev) {
    var input = $('contact-input'), tick = $('contact-curator'), B = window.CurateBadge, me = cur,
        v = input ? String(input.value || '').trim() : '', kind = kindOf(v);
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!me || sending) return;
    if (!kind) { msg('Enter an email or a @Telegram handle.', true); if (input) input.focus(); return; }
    if (!B || !B.post) { msg(failed(''), true); return; }
    busy(true);
    msg('');
    B.post({ action: 'contact', badge: me.badge, contact: tidy(v, kind), curator: !!(tick && tick.checked), id: me.id,
             event: String(CFG.event || ''), kiosk: me.kiosk }, function (err, j) {
      if (cur !== me) return;   // hidden or shown again meanwhile (a kiosk reset): this reply is stale
      busy(false);
      if (err || !j || !j.ok) { msg(failed(!err && j ? j.error : ''), true); return; }
      var form = $('contact-form'), done = me.onDone;
      if (form) form.hidden = true;
      if (input) input.value = '';
      if (tick) tick.checked = false;
      if (typeof done === 'function') done(j);
    });
  }
  function touched() { if (cur && typeof cur.onInput === 'function') cur.onInput(); }

  // ---- Wiring ----
  function init() {
    var form = $('contact-form');
    fillPrivacy();
    if (!form) return;
    form.addEventListener('submit', submit);
    ['input', 'keydown', 'change'].forEach(function (t) { form.addEventListener(t, touched); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.CurateContact = { show: show, hide: hide };
})();
