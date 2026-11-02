// Merch desk (staff only): one merch item per player. How players verify comes with every reply (mode, the
// Switches "Verify with" row): telegram (the default) and none: staff scan the QR on the player's game ticket
// (their phone) or type its C- code; badge: staff scan the badge on the visitor's lanyard. The booth sheet script
// (settings.js server.endpoint, apps-script/staff-desk/) says whether that player already got merch and what
// their best game round earned, and staff record what they hand over. Badge reading, hashing, the camera and the
// network live in /curate/badge.js (shared with the game, so both hash a badge alike): only the salted hash
// leaves this phone. Checking saves nothing; only tapping an item adds a row. Advanced, at the bottom of home,
// changes the mode for every phone. Never talks to the check-in backend. User text reaches the DOM through
// textContent only.
// /staff/?test=1 calibrates badges (raw text, normalised id, verdict, pattern) without saving anything: use it
// on real badges to set settings.js badge.pattern (and badge.typed) before opening badge play.
(function () {
  'use strict';

  // ---- Setup ----
  var S = window.CURATE_SETTINGS || {}, CFG = window.KLEROS_BOOTH_CONFIG || {};
  var TEST = /[?&]test=1\b/.test(location.search);
  var KEY = 'kleros_curate_desk';
  var TIER_KEYS = ['teal', 'purple', 'gold'];
  var K_TICKET = /^K-[A-Z0-9]{6}$/;   // a check-in ticket: staff read its colour, any open tier
  var MODES = ['telegram', 'badge', 'none'];
  var MODE_NAME = { telegram: 'Telegram', badge: 'their badge', none: 'no check' };
  var me = load(), scanner = null;
  // gen changes on every new scan and on Next: a reply for an older one is ignored.
  var gen = 0, busy = false, current = null;
  // The Switches tab as the last reply said it (every reply carries open, soldOut and mode).
  var sw = { open: true, soldOut: [], known: false };
  // How players verify: Telegram until the first reply says otherwise; test mode calibrates badges.
  // modeNew: Advanced just changed it (home says "now" until the next home).
  var mode = TEST ? 'badge' : 'telegram', modeNew = false;
  var seen = [];   // test mode: this session's scans { raw, id }, newest last

  // Always reached at call time (never cached at load), like the game does.
  function B() { return window.CurateBadge; }
  function $(id) { return document.getElementById(id); }
  function txt(id, s) { var el = $(id); if (el) el.textContent = s == null ? '' : String(s); return el; }
  function show(id) { ['setup', 'home', 'scan', 'typer', 'adv'].forEach(function (x) { $(x).hidden = x !== id; }); $('result').hidden = true; }
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
      return { key: TIER_KEYS[i], name: t.name || cap(TIER_KEYS[i]), items: items };
    });
  }
  function tierName(i) { var t = tiers()[i - 1]; return t ? t.name : cap(TIER_KEYS[i - 1]); }

  // ---- Switches ----
  // settings.js soldOut stays a static fallback beside the Switches tab, as in the game.
  function soldOut(key) { return sw.soldOut.indexOf(key) > -1 || (S.soldOut || []).indexOf(key) > -1; }
  function switchLine() {
    var el = $('h-switch'), parts = [], gone = [];
    if (!el) return;
    if (!sw.known) { el.textContent = ''; return; }
    if (!sw.open) parts.push('Merch paused: stickers only.');
    tiers().forEach(function (t) { if (soldOut(t.key)) gone.push(t.name); });
    if (gone.length) parts.push('Sold out: ' + gone.join(', ') + '.');
    el.textContent = parts.length ? parts.join(' ') : 'Merch open.';
    el.className = sw.open ? 'muted' : 'warn';
  }

  // ---- Mode ----
  // telegram and none: the player shows a game ticket (its QR, or its C- code); badge: their lanyard badge.
  function tickets() { return mode !== 'badge'; }
  // A scan's player: 'badge' for a lanyard badge, 'player' for a game ticket (whatever the mode).
  function noun(c) { return c && c.kind === 'badge' ? 'badge' : 'player'; }
  function applyMode() {
    var t = tickets(), next = t ? 'Next player' : 'Next badge';
    txt('scan-go', t ? 'Scan ticket' : 'Scan badge');
    txt('type-go', t ? 'Type the ticket code' : 'Type the badge code');
    txt('h-note', 'One item per ' + (t ? 'player' : 'badge') + '. Stickers need no scan.');
    txt('scan-title', t ? 'Scan the QR on their game ticket (their phone)' : 'Point at the badge code');
    txt('type-title', t ? 'Ticket code' : 'Badge code');
    txt('type-label', t ? 'Type the C- code under the QR on their game ticket.' : 'Type it from the badge on their lanyard, not from a phone or paper.');
    $('badge-text').placeholder = t ? 'C-ABC123' : '';
    txt('r-next', next); txt('r-free', 'Not handing anything over? Tap ' + next + ': nothing is saved.');
    modeLine();
  }
  // A reply says the mode changed. Advanced, if open, says the new one too; its selection follows only while it still
  // sits on the old pre-selected mode (the lead may have picked one already).
  function newMode(m) {
    var was = mode;
    mode = m; applyMode();
    if ($('adv').hidden) return;
    txt('adv-now', 'Now: players verify with ' + MODE_NAME[mode] + '.');
    if (picked() === was) pick(mode);
    advReady();
  }
  function modeLine() {
    var el = $('h-mode');
    if (TEST) { el.textContent = ''; return; }
    el.textContent = 'Players ' + (modeNew ? 'now ' : '') + 'verify with ' + MODE_NAME[mode] + '.';
    el.className = mode === 'none' ? 'warn' : 'muted';
  }

  // ---- Network ----
  // done(null, reply) or done('key' | 'net'). busy and server count as unreachable: the same request (same claim
  // id) is simply sent again by Try again.
  function post(body, done) {
    body.key = me.key;
    B().post(body, function (err, j) {
      if (err) { done('net'); return; }
      if (j.error === 'wrongkey') { me.key = ''; me.keyBad = true; save(); done('key'); return; }
      if (typeof j.open === 'boolean') { sw.open = j.open; sw.soldOut = j.soldOut || []; sw.known = true; switchLine(); }
      if (!TEST && MODES.indexOf(j.mode) > -1 && j.mode !== mode) newMode(j.mode);
      if (!j.ok && (j.error === 'busy' || j.error === 'server')) { done('net'); return; }
      done(null, j);
    });
  }

  // ---- Home ----
  function home() {
    var g;
    stopCam();
    gen++; busy = false; current = null; modeNew = false;
    if (!B()) {
      show('setup'); $('setup-form').hidden = true; $('setup-hint').hidden = true;
      txt('setup-title', 'The desk didn’t load');
      txt('setup-msg', 'Reload the page. Don’t hand out merch from it until it loads.');
      return;
    }
    if (!B().endpoint() && !TEST) {
      show('setup'); $('setup-form').hidden = true; $('setup-hint').hidden = true;
      txt('setup-title', 'Not connected yet');
      txt('setup-msg', 'This desk has no badge list yet, so it can’t check anyone. Don’t hand out merch from it. Booth lead: see apps-script/staff-desk/README.md.');
      return;
    }
    if (!me.key && !TEST) {
      show('setup'); $('setup-form').hidden = false; $('setup-hint').hidden = false; txt('setup-title', 'Staff key'); $('k-name').value = me.staff || '';
      txt('setup-msg', me.keyBad ? 'That key isn’t right. Ask the booth lead for the current one.' : '');
      return;
    }
    txt('who', TEST ? 'Test mode · nothing is saved' : (me.staff ? me.staff + ' · staff' : 'Staff'));
    show('home'); applyMode();
    $('adv-go').hidden = TEST;   // test mode saves nothing, so it can't change the mode either
    if (TEST) { txt('h-switch', 'Test mode: scan badges to see what they read as.'); return; }
    switchLine();
    g = gen;
    post({ action: 'stats' }, function (e, j) {
      if (g !== gen) return;
      if (e === 'key') { home(); return; }
      if (e || !j.ok || !j.today) return;
      txt('n-teal', j.today.teal); txt('n-purple', j.today.purple); txt('n-gold', j.today.gold);
    });
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
  // badge.js runs the camera and the reader; a locked screen ('hidden') goes home, any other camera trouble
  // falls back to typing the code (the ticket's C- code, or the lanyard badge's).
  function startCam() {
    if (!B()) return;
    stopCam(); show('scan');
    scanner = B().scan({ video: $('video'), facing: 'environment', onCode: found, onError: function (kind) {
      scanner = null;
      if (kind === 'hidden') home();
      else typeIt(tickets() ? 'Can’t use the camera here. Type the C- code under their ticket QR.' : 'Can’t use the camera here. Type the code from their lanyard badge.');
    } });
  }
  function stopCam() { var s = scanner; scanner = null; if (s) s.stop(); }
  function found(raw) { scanner = null; buzz(30); check(raw, 'scan'); }
  $('scan-go').addEventListener('click', startCam);
  $('scan-cancel').addEventListener('click', home);
  $('scan-type').addEventListener('click', function () { typeIt(''); });

  // ---- Typing ----
  function typeIt(msg) { stopCam(); show('typer'); $('badge-text').value = ''; txt('type-msg', msg); $('badge-text').focus(); }
  $('type-go').addEventListener('click', function () { typeIt(''); });
  $('type-cancel').addEventListener('click', home);
  $('type-form').addEventListener('submit', function (ev) { ev.preventDefault(); check($('badge-text').value, 'typed'); });

  // ---- Result ----
  function result(tone, icon, word, line) {
    var r = $('result');
    r.hidden = false; r.setAttribute('data-tone', tone);
    txt('r-icon', icon); txt('r-word', word); txt('r-line', line); txt('r-msg', '');
    ['r-items', 'r-retry', 'r-free', 'r-game', 'r-recheck', 't-prev', 't-warn'].forEach(function (x) { $(x).hidden = true; });
    r.scrollTop = 0;
  }
  function usedLine(last) { return last ? cap(last.tier) + ' · ' + (last.item || 'merch') + ', ' + (last.day ? last.day + ' ' : '') + last.at + '.' : ''; }

  // ---- Test mode ----
  // Calibration, saves nothing: what a badge reads as, and whether two different badges collapse to one id
  // (then badge play must stay closed). A typed code is compared with the last scanned id (badge.typed).
  function testScan(raw, how) {
    var b = B(), bid = b.id(raw), pat = (S.badge && S.badge.pattern) || '', last = seen[seen.length - 1], clash = false, differ = false, lines;
    raw = String(raw == null ? '' : raw);
    lines = ['Raw: ' + raw.slice(0, 160), 'Id: ' + (bid || '(empty)'), b.ok(bid, raw) ? 'Accepted as a badge.' : 'Refused: not a badge code.',
      'Pattern: ' + (pat || 'none yet (8+ characters with a letter and a digit)')];
    if (how === 'typed') {
      if (last) { differ = last.id !== bid; lines.push('Last scanned id: ' + last.id, differ ? 'Typed and scanned ids differ: set badge.typed to false.' : 'Typed and scanned ids match.'); }
    } else {
      seen.forEach(function (s) { if (s.raw !== raw && s.id === bid) clash = true; });
      seen.push({ raw: raw, id: bid });
      if (seen.length > 50) seen.shift();
    }
    result(clash || differ ? 'warn' : '', 'ℹ', how === 'typed' ? 'Test code' : 'Test scan', lines.join('\n'));
    if (last && how !== 'typed') { txt('t-prev', 'Previous scan: ' + last.raw.slice(0, 80) + '\nId: ' + last.id); $('t-prev').hidden = false; }
    if (clash) { txt('t-warn', 'Two different badges gave the same id. Don’t open badge play: tell the lead.'); $('t-warn').hidden = false; }
  }

  // ---- Check ----
  // current: { kind: 'badge' | 'ticket', badge (the player id; a typed code learns it from the check), sig, code,
  // label, how, checked, claimId, ticket }.
  function check(raw, how) {
    var g, s = String(raw == null ? '' : raw).trim();
    if (busy || !B()) return;
    if (TEST) { testScan(raw, how); return; }
    if (/^KC1\./i.test(s)) { gameTicket(s, how); return; }   // a game ticket's QR, in any mode
    if (tickets()) {
      if (how === 'typed') { typedCode(s); return; }
      buzz([60, 60, 60]);
      result('warn', '!', 'Not a game ticket', 'Scan the QR on their Curate ticket. They get it after a round.');
      return;
    }
    g = ++gen;
    B().read(raw, function (err, r) {
      if (g !== gen) return;
      if (err === 'notbadge') {
        buzz([60, 60, 60]);
        result('warn', '!', 'Not a Devcon badge', 'Use the code on their lanyard badge: not a phone screen, a photo or the back of the badge.');
        return;
      }
      if (err) { result('warn', '!', 'Can’t read badges here', 'This browser can’t check badge codes. Open the desk in Chrome or Safari.'); return; }
      begin({ kind: 'badge', badge: r.hash, label: 'Badge …' + r.tail, how: how });
    });
  }
  function begin(c) {
    current = { kind: c.kind, badge: c.badge || '', sig: c.sig || '', code: c.code || '', label: c.label, how: c.how,
      checked: false, claimId: newId(), ticket: '' };
    checkHash();
  }
  // The QR on a game ticket: 'KC1.' + the player id + '.' + its signature (empty in none mode), in upper case.
  function gameTicket(s, how) {
    var p = s.split('.'), id = String(p[1] || '').toLowerCase(), sig = String(p[2] || '').toLowerCase();
    if (p.length > 3 || !/^[0-9a-f]{64}$/.test(id) || !/^(?:[0-9a-f]{32})?$/.test(sig)) {
      buzz([60, 60, 60]);
      result('warn', '!', 'Not a game ticket', 'This QR doesn’t read as a Curate ticket. Type the C- code under it instead.');
      return;
    }
    gen++;
    begin({ kind: 'ticket', badge: id, sig: sig, label: 'Game ticket', how: how });
  }
  // A typed ticket code: C- and 6 letters or digits, in any case, with or without the dash or spaces.
  function typedCode(s) {
    var c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^K[A-Z0-9]{6}$/.test(c)) { txt('type-msg', 'That’s a check-in ticket. Type the C- code from their game ticket.'); return; }
    if (!/^C[A-Z0-9]{6}$/.test(c)) { txt('type-msg', 'A game ticket code looks like C-ABC123.'); return; }
    gen++;
    begin({ kind: 'ticket', code: 'C-' + c.slice(1), label: 'Ticket C-' + c.slice(1), how: 'typed' });
  }
  // A player is offered merch only after the sheet said they are new (current.checked). The reply names the
  // player id (badge): a typed code learns it here, and the claim goes with it.
  function checkHash() {
    var g = gen, c = current, body = { action: 'check' };
    if (c.badge) { body.badge = c.badge; if (c.sig) body.sig = c.sig; } else body.code = c.code;
    busy = true;
    result('', '…', 'Checking', c.label);
    post(body, function (e, j) {
      if (g !== gen) return;
      busy = false;
      if (e === 'key') { home(); return; }
      if (!e && !j.ok && j.error === 'nocode') {
        buzz([60, 60, 60]); current = null;
        result('warn', '!', 'No ticket with this code', 'Check the C- code under the QR on their phone. They get it after a round.');
        return;
      }
      if (!e && !j.ok && j.error === 'badticket') {
        buzz([60, 60, 60]); current = null;
        result('bad', '✗', 'Ticket not valid', 'This QR wasn’t made by the game. Don’t hand anything over.');
        return;
      }
      if (e || !j.ok) { fail(); return; }
      if (/^[0-9a-f]{64}$/.test(String(j.badge || ''))) c.badge = j.badge;
      if (!c.badge) { fail(); return; }   // an older sheet script: no player id to claim with
      if (j.used) { buzz([60, 60, 60]); current = null; result('bad', '✗', 'Already got merch', usedLine(j.last) + ' No more merch for this ' + noun(c) + '. Stickers are fine.'); return; }
      buzz(30);
      c.checked = true; c.game = j.game || null; c.contact = !!j.contact; c.earned = j.earned || 0;
      fresh();
    });
  }
  function fresh() { result('good', '✓', current.kind === 'badge' ? 'New badge' : 'New player', current.label); $('r-ticket').value = current.ticket || ''; offer(); }

  // What the game says about this player. A game tier counts only once the visitor left a contact (server rule;
  // a Telegram-verified player always has).
  function gameLine() {
    var c = current, gm = c.game, name, s;
    if (!gm) s = 'No game score. Stickers only, unless they show a check-in ticket.';
    else if (gm.tier >= 1) {
      name = tierName(gm.tier);
      s = 'Game: ' + name + ' · ' + gm.score + ' pts' + (c.contact ? '. Give up to ' + name + '.' :
        ', but no email or Telegram yet. ' + (c.kind === 'badge' ? 'Ask them to scan their badge in the game and tap Unlock, then tap Check again.' :
        'Ask them to unlock their ticket in the game, then tap Check again.'));
    } else s = 'Game: ' + gm.score + ' pts, under ' + tierName(1) + '. Stickers only, unless they show a check-in ticket.';
    if (!sw.open) s += ' Merch is paused: stickers only.';
    txt('r-game', s); $('r-game').hidden = false;
    $('r-recheck').hidden = !(gm && gm.tier >= 1 && !c.contact);
  }

  // ---- Items ----
  // One group per tier. A group is open when merch is open, the tier isn't sold out, and the game earned it or
  // a check-in ticket (K-) is typed; otherwise its heading says why.
  function offer() {
    var box = $('r-buttons'), k;
    if (!current) return;
    k = K_TICKET.test($('r-ticket').value.trim().toUpperCase());
    gameLine();
    while (box.firstChild) box.removeChild(box.firstChild);
    tiers().forEach(function (t, i) {
      var why = !sw.open ? 'paused' : soldOut(t.key) ? 'sold out' : (i + 1 > current.earned && !k) ? 'not earned' : '',
        h = document.createElement('h2');
      h.textContent = t.name + (why ? ' · ' + why : '');
      if (why) h.className = 'off';
      box.appendChild(h);
      t.items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 't-' + t.key; b.textContent = item; b.disabled = !!why;
        b.addEventListener('click', function () { give(t, item); });
        box.appendChild(b);
      });
    });
    $('r-items').hidden = false; $('r-free').hidden = false;
  }
  // A typed check-in code opens the tiers at once (staff read its colour).
  $('r-ticket').addEventListener('input', function () {
    if (!current || !current.checked || busy) return;
    current.ticket = $('r-ticket').value.trim().toUpperCase();
    offer();
  });

  // ---- Claim ----
  // The same claim id on every retry, so a claim that saved but lost its reply is recognised, not refused.
  function give(t, item) {
    var ticket = $('r-ticket').value.trim().toUpperCase(), g = gen;
    if (busy || !current || !current.checked) return;
    if (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket)) { txt('r-msg', 'A check-in ticket code looks like K-ABC123 (or leave it empty).'); return; }
    busy = true; current.ticket = ticket;
    Array.prototype.forEach.call($('r-buttons').querySelectorAll('button'), function (b) { b.disabled = true; });
    txt('r-msg', 'Saving…');
    post({ action: 'claim', badge: current.badge, tier: t.key, item: item, ticket: ticket, staff: me.staff || '', id: current.claimId,
      how: current.how === 'typed' ? 'typed' : 'scan' }, function (e, j) {
      if (g !== gen) return;
      busy = false;
      if (e === 'key') { home(); return; }
      if (e) { fail(); return; }
      if (j.ok) {
        // A retry of a claim already saved: what the sheet holds, which may not be the button just tapped.
        if (j.again && j.item) { item = j.item; t = tiers().filter(function (x) { return x.key === j.tier; })[0] || t; }
        buzz(40); result('good', '✓', 'Give: ' + item, t.name + ' · saved. One item per ' + noun(current) + '.'); current = null; return;
      }
      if (j.used) { buzz([60, 60, 60]); result('bad', '✗', 'Already got merch', usedLine(j.last) + ' Another phone just gave it.'); current = null; return; }
      if (j.ticketUsed) { buzz([60, 60, 60]); result('warn', '!', 'Ticket already used', 'This check-in ticket went with another ' + noun(current) + ': ' + usedLine(j.last)); return; }
      buzz([60, 60, 60]);
      if (j.error === 'paused') { sw.open = false; result('warn', '!', 'Merch is paused', 'Stickers only for now.'); }
      else if (j.error === 'soldout') {
        if (!soldOut(t.key)) sw.soldOut = sw.soldOut.concat([t.key]);
        result('warn', '!', t.name + ' is sold out', 'Pick a lower tier or stickers.');
      } else if (j.error === 'notearned') {
        current.earned = j.earned || 0;
        if (typeof j.contact === 'boolean') current.contact = j.contact;
        result('warn', '!', 'Not earned yet', current.contact ? 'Their game score doesn’t reach ' + t.name + '.' : 'No email or Telegram yet. Ask them to unlock the ticket first.');
      } else { fail(); return; }
      offer();   // the groups now say why, the others stay usable
    });
  }
  function fail() {
    busy = false;
    result('warn', '!', 'Can’t reach the list', 'Check the connection, then tap Try again. Don’t hand anything over yet.');
    $('r-retry').hidden = !current;
  }
  // Retry repeats whatever failed: the check, or the save of an already checked player (same claim id).
  $('r-retry').addEventListener('click', function () {
    if (!current || busy) return;
    if (!current.checked) checkHash(); else fresh();
  });
  // Check again: the visitor just unlocked their ticket in the game (contact given).
  $('r-recheck').addEventListener('click', function () {
    if (!current || busy) return;
    current.checked = false; checkHash();
  });
  $('r-next').addEventListener('click', home);

  // ---- Advanced: how players verify ----
  // Writes the Switches "Verify with" row, so every phone (game and desk) follows within a minute. Hidden at the
  // bottom of home behind a typed CHANGE: only the booth lead should use it. Nothing changes until the sheet says ok.
  function picked() { var r = document.querySelector('input[name="adv-mode"]:checked'); return r ? r.value : ''; }
  function pick(m) { Array.prototype.forEach.call(document.querySelectorAll('input[name="adv-mode"]'), function (r) { r.checked = r.value === m; }); }
  function advReady() {
    var m = picked();
    $('adv-apply').disabled = busy || !m || m === mode || $('adv-confirm').value.trim().toUpperCase() !== 'CHANGE';
  }
  $('adv-go').addEventListener('click', function () {
    if (TEST) return;
    show('adv');
    pick(mode);
    $('adv-confirm').value = ''; txt('adv-msg', '');
    txt('adv-now', 'Now: players verify with ' + MODE_NAME[mode] + '.');
    advReady();
    window.scrollTo(0, 0);
  });
  $('adv-modes').addEventListener('change', advReady);
  $('adv-confirm').addEventListener('input', advReady);
  $('adv-cancel').addEventListener('click', home);
  $('adv-apply').addEventListener('click', function () {
    var m = picked(), g = gen;
    advReady();
    if ($('adv-apply').disabled) return;
    busy = true; $('adv-apply').disabled = true; txt('adv-msg', 'Changing…');
    post({ action: 'setmode', mode: m, staff: me.staff || '' }, function (e, j) {
      if (g !== gen) return;
      busy = false;
      if (e === 'key') { home(); return; }
      if (e || !j.ok) {
        txt('adv-msg', e ? 'Can’t reach the list. Check the connection, then try again.' :
          j.error === 'badrequest' ? 'The booth sheet script can’t change this yet. Ask the booth lead to update it.' :
          'That didn’t go through. Try again, or ask the booth lead.');
        advReady(); return;
      }
      if (MODES.indexOf(j.mode) > -1) mode = j.mode; else mode = m;
      home(); modeNew = true; modeLine();
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', home); else home();
})();
