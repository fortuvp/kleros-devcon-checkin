// Curate game rewards: prize strip, counted rounds, the intro's start area, the report and the merch ticket.
// Two modes (settings.js server.endpoint): badge mode, where the sheet script counts each Devcon badge's tries
// and keeps its best score (network through CurateBadge.post only), and v6 mode (no endpoint), where tries and
// the ticket live on this phone. The only reader of kleros_devcon_self (v6 only, never written here) and the only
// writer of kleros_devcon_curate and kleros_devcon_curate_badge. User data reaches the DOM through textContent only.
(function () {
  'use strict';

  // ---- Helpers ----
  var S = window.CURATE_SETTINGS || {};
  var CFG = window.KLEROS_BOOTH_CONFIG || {};
  var KIOSK = /[?&]kiosk=1\b/.test(location.search);
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var KEY = 'kleros_devcon_curate';
  var NAMES = ['free', 'teal', 'purple', 'gold'];
  var UI = { show: function () {}, say: function () {}, reset: function () {} };

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return null; } }
  function abs(src) { return /^(https?:)?\//.test(src) ? src : '/' + String(src).replace(/^\.\//, ''); }
  // Every DOM write is null-safe: the shell may lag behind while packages land in parallel.
  function txt(id, s) { var el = $(id); if (el) el.textContent = s == null ? '' : String(s); return el; }
  function vis(id, on) { var el = $(id); if (el) el.hidden = !on; return el; }
  function fmt(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(at) { var d = new Date(at); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function lowerFirst(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
  function kioskCap() { return S.kioskMaxTier == null ? 1 : S.kioskMaxTier; }
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }   // replies may come from another realm

  // ---- Badge mode: state ----
  // The badge is the player's id; the server's word on it is cached in srv.badge ({ triesUsed, left, best, contact,
  // collected }, any subset: no `left` = status not answered yet). Kiosk keeps all of it in memory, one visitor.
  // Tries are the badge's for the whole event (Code.gs TRIES_PER_BADGE): nothing here resets them at midnight.
  var SV = S.server || {};
  var ONLINE = !!SV.endpoint;
  var BKEY = 'kleros_devcon_curate_badge';
  var MAX_SEND = 6 * 60 * 60 * 1000;   // = Code.gs MAX_SEND_MS: an older finish is refused anyway
  var bd = null;                       // { hash, tail }: never the badge code
  var srv = { open: true, soldOut: [], tiers: null, badge: null, asked: 0 };
  var flow = { busy: 0, offline: false };   // the intro: a request in flight; the last start got no answer
  var tok = null, spare = '', begun = null; // this round's try { token, tryNo }; an unconfirmed start token; begin()'s answer
  var pend = null, bg = [];                 // the finish not saved yet (one, kept on the phone); kiosk ones left behind
  var rs = { sum: null };                   // the round on Results: { sum, g, g0, fun, ci, p, state }
  function Bdg() { return window.CurateBadge || null; }   // looked up at call time: the check script swaps it
  function can(k) { var B = Bdg(); try { return !!(B && B.can && B.can()[k]); } catch (e) { return false; } }
  function paused() { return ONLINE && srv.open === false; }
  function bs() { return srv.badge || {}; }
  function bestTier() { var b = bd && bs().best; return b ? b.tier || 0 : 0; }
  // An unknown id (say a 'travel' run stored before v4) falls back to the first deck in decks.js order.
  function firstDeck() {
    var D = window.CURATE_DECKS || {}, k;
    for (k in D) if (D.hasOwnProperty(k)) return D[k];
    return null;
  }
  function deckOf(id) {
    var D = window.CURATE_DECKS || {};
    return (D.hasOwnProperty(id) && D[id]) || firstDeck() || { id: '', client: 'Kleros Curate', copy: {} };
  }
  function thumbs(box, imgs) {
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    [].concat(imgs || []).slice(0, 3).forEach(function (src) {
      var im = document.createElement('img');
      im.src = abs(src); im.alt = ''; im.width = im.height = 60;
      im.setAttribute('loading', 'lazy'); im.setAttribute('decoding', 'async');
      box.appendChild(im);
    });
  }

  // ---- Merch tiers ----
  // Names, rewards and pictures come from config.js by index, never by name; settings.js decides who gets what.
  var MERCH = CFG.merch && (CFG.merch.tiers || []).length === 3 ? CFG.merch : (S.fallbackMerch || { tiers: [{}, {}, {}] });
  // settings.js owns the thresholds (tuned with curate-check --sim): no copy of them lives here.
  var TIERS = S.tiers || [0];
  var NEED = S.checkinNeededFrom || 3;
  // Counted tries for the whole event: per badge (badge mode) or per phone (v6). Never per day.
  var COUNTED = S.countedTries || 2;
  // v6: the tries copy, said the same way on the title, Results and the ticket.
  function triesLeft(n) { return n + (n === 1 ? ' try' : ' tries') + ' left'; }
  function count(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }   // “1 fake”, “3 fakes”
  function allUsed() { return COUNTED === 1 ? 'Your try is used' : (COUNTED === 2 ? 'Both' : 'All ' + COUNTED) + ' tries used'; }
  // settings.js soldOut is the static fallback; in badge mode the Switches tab adds to it.
  function isSoldOut(i) { return i > 0 && ((S.soldOut || []).indexOf(NAMES[i]) > -1 || (ONLINE && srv.soldOut.indexOf(NAMES[i]) > -1)); }
  function baseTier(i) {
    var t = i === 0 ? (MERCH.free || (S.fallbackMerch || {}).free || {}) : (MERCH.tiers[i - 1] || {});
    var sub = i > 0 && S.substitutes ? S.substitutes[NAMES[i]] : null;
    var reward = (sub && sub.reward) || t.reward || '';
    // Only the free tier’s plain noun is lower-cased: tier rewards carry brand names (Kleros, PoH).
    return { key: NAMES[i], name: i === 0 ? 'Everyone' : (t.name || NAMES[i]), reward: reward,
             short: (sub && (sub.short || sub.reward)) || t.short || (i === 0 ? lowerFirst(reward) : reward),
             img: [].concat((sub && sub.img) || t.img || []).map(abs), min: TIERS[i] || 0 };
  }
  // A sold-out tier keeps its name and threshold but hands out the next open tier’s reward.
  function tierInfo(i) {
    var info = baseTier(i), j = i, low;
    while (j > 0 && isSoldOut(j)) j--;
    if (j < i) {
      low = baseTier(j);
      info.reward = low.reward; info.short = low.short; info.img = low.img;
      info.soldOut = true; info.down = j;
    }
    return info;
  }
  function tierTitle(i) { return i === 0 ? 'Everyone' : baseTier(i).name + ' tier'; }

  // ---- Check-in (read-only) ----
  // Mirrors index.html’s returning-visitor gate and tierOf().
  // merchOf() is never called or copied: it mutates the record.
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function checkin() {
    if (KIOSK || ONLINE) return null;   // badge mode: no check-in gate, and the check-in record is never read
    var me = read('kleros_devcon_self');
    if (!me || !me.ticket) return null;
    var ok = !!(me.confirmed || !me.newsletter || !(CFG.endpoint || '').trim() || !(CFG.blog && CFG.blog.url));
    var m = me.merch || {};
    return { ok: ok, ticket: String(me.ticket), name: String(me.name || ''), claimed: m.claimed || '',
             tier: !ok || m.claimed ? 0 : (m.tg === 'joined' && m.x && m.li ? (m.quiz ? 3 : 2) : 1) };
  }

  // ---- Storage ----
  // One object under one key. Kiosk never touches storage; a blocked browser keeps a memory copy for this visit.
  var st = null, blocked = false;
  function fresh() {
    return { v: 1, deck: (firstDeck() || {}).id || '', relaxed: false, practiced: {}, lastIds: {}, counted: 0,
             best: null, runs: [], collected: null };
  }
  function load() {
    var d = null, f = fresh(), k;
    if (!KIOSK) {
      try { localStorage.getItem(KEY); } catch (e) { blocked = true; }
      d = store(KEY);
    }
    if (!d || typeof d !== 'object' || d.v !== 1) d = f;
    for (k in f) if (f.hasOwnProperty(k) && (d[k] === undefined || d[k] === null && f[k] !== null)) d[k] = f[k];
    if (!(d.runs instanceof Array)) d.runs = [];
    if (window.CURATE_DECKS && !CURATE_DECKS[d.deck]) d.deck = f.deck;   // a deck that no longer exists
    st = d;
  }
  function save() {
    if (KIOSK || !st) return;
    if (store(KEY, st) !== true) blocked = true;
  }
  // Another tab (or a bfcache restore) may have written since: every entry point re-reads and saves in the same
  // task, so a stale copy never overwrites newer shifts or a stamp.
  function sync() {
    if (KIOSK || blocked) { if (!st) load(); return; }   // kiosk and blocked browsers: the memory copy is the truth
    load();
  }
  function code() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = [], s = 'C-', i;
    try { var u = new Uint8Array(6); window.crypto.getRandomValues(u); for (i = 0; i < 6; i++) b.push(u[i]); }
    catch (e) { for (i = 0; i < 6; i++) b.push(Math.floor(Math.random() * 256)); }
    for (i = 0; i < 6; i++) s += A.charAt(b[i] % 32);   // 256 % 32 = 0, so no bias
    return s;
  }

  // ---- Prefs and counted shifts ----
  // v4: one practice card the first time on this phone, whichever app: any practised deck counts for all.
  function practisedAny() { var k; for (k in st.practiced) if (st.practiced.hasOwnProperty(k) && st.practiced[k]) return true; return false; }
  function getPref(k) {
    sync();
    if (k === 'practiced' || k.indexOf('practiced.') === 0) return KIOSK ? false : practisedAny();   // kiosk: practice every time
    return st[k];
  }
  function setPref(k, v) {
    sync();
    if (k.indexOf('practiced.') === 0) st.practiced[k.slice(10)] = !!v;
    else if (k === 'deck' || k === 'relaxed') st[k] = v;
    save();
  }
  function lastIds(deckId) { sync(); return (st.lastIds[deckId] || []).slice(); }
  function saveLastIds(deckId, ids) { sync(); st.lastIds[deckId] = [].concat(ids || []); save(); }
  // A booth tablet counts every visitor’s shift in memory; the reset wipes it for the next one.
  // next: the try number the next counted round gets (game.js builds “Try 1 of 2 · Go!” from it and tries).
  // v6: st.counted is this phone's for the whole event; a new day never resets it.
  function canCount() {
    sync();
    if (KIOSK) return { counted: true, left: 1, reason: 'kiosk', next: 1, tries: 1 };
    if (st.collected) return { counted: false, left: 0, reason: 'collected', next: 0, tries: COUNTED };
    if (st.counted >= COUNTED) return { counted: false, left: 0, reason: 'limit', next: 0, tries: COUNTED };
    return { counted: true, left: COUNTED - st.counted, reason: '', next: st.counted + 1, tries: COUNTED };
  }
  // Called when the clock starts, so quitting does not refund the shift. Badge mode: the server already counted
  // the try at begin(); this only hands back what begin() got.
  function startShift(deckId) {
    var r;
    if (ONLINE) {
      sync(); st.deck = deckId || st.deck; save();
      r = { counted: !!(begun && begun.counted && tok), shiftNo: begun ? begun.shiftNo || 0 : 0,
            code: begun && begun.counted && tok ? 'C-' + tok.token.slice(0, 6).toUpperCase() : null, tries: COUNTED };
      if (tok) tok.used = true;   // this round plays the try: never handed out again by begin()
      return r;
    }
    var c = canCount();
    r = { counted: c.counted, shiftNo: 0, code: null, tries: c.tries };
    if (KIOSK) { st.best = null; st.runs = []; }   // one kiosk shift is one visitor: never show an earlier best
    st.deck = deckId || st.deck;
    if (c.counted) { st.counted++; r.shiftNo = st.counted; r.code = code(); }
    save();
    return r;
  }

  // ---- Title screen: check-in link (footer row), welcome chip, prize strip ----
  function renderHeader() {
    var a = vis('hdr-link', !KIOSK), logo = $('hdr-logo'), me;
    if (logo && KIOSK) logo.removeAttribute('href');   // a booth tablet never opens the check-in page, by key either
    if (!a || KIOSK) return;
    me = ONLINE ? null : read('kleros_devcon_self');
    a.href = '/';
    a.textContent = me && me.ticket ? 'Your check-in ticket →' : 'Booth check-in →';
  }
  // The first matching line wins (§1.3 S1); nothing relevant hides the chip.
  function renderWelcome() {
    var m, ci, best, line = '', go = '', n, b = bs(), g = ONLINE ? modelB().t : 0;   // the ticket's tier: a sold-out one hands down
    if (ONLINE) {   // badge mode: from the remembered badge (a tablet remembers none)
      if (bd && b.collected) line = 'Merch collected. Play for fun.';
      else if (g > 0 && b.contact) { line = 'Your ' + baseTier(g).name + ' ticket is ready ·'; go = 'Show it →'; }
      else if (g > 0) { line = 'Your ' + baseTier(g).name + ' score needs one step ·'; go = 'Unlock →'; }
    } else if (!KIOSK) {
      m = model(); ci = m.ci; best = st.best;
      if (st.collected) line = 'Merch collected. Play for fun.';
      else if (ci && ci.claimed) line = 'You already checked in at the booth. Play for fun.';
      else if (best && m.state === 'live' && m.t > 0) { line = 'Your ' + baseTier(m.t).name + ' ticket is ready ·'; go = 'Show staff →'; }
      else if (best) { line = 'Your best: ' + fmt(best.final) + ' pts ·'; go = 'Show ticket →'; }
      else if (ci && ci.ok && ci.tier > 0 && ci.tier < 3) {
        n = ci.tier + 1;
        line = 'Checked in: ' + baseTier(ci.tier).name + '. Score ' + fmt(TIERS[n]) + ' for ' + baseTier(n).name + '.';
      }
    }
    vis('welcome', !!line);
    txt('welcome-text', line);
    if (vis('welcome-go', !!go)) txt('welcome-go', go);
  }
  // A chip’s short line: points, or what the tier needs on top.
  function ladderHow(i) {
    var info = tierInfo(i);
    if (i > 0 && paused()) return 'Paused';
    if (info.soldOut) return 'Gone today';
    if (i === 0) return 'Finish a round';
    if (ONLINE) return fmt(TIERS[i]) + ' pts';   // badge mode: no check-in, and a tablet has no cap
    if (KIOSK && i > kioskCap()) return fmt(TIERS[i]) + ' pts · own phone';
    return fmt(TIERS[i]) + ' pts' + (i >= NEED ? ' + check-in' : '');
  }
  // The prize strip: 4 chips the shell lays out in a row. Built here, so it needs no template:
  // <li class="chip t-teal [is-locked] [is-sold]"><span class="thumbs"><img alt=""></span>
  //   <span class="chip-txt"><b><em>Teal</em></b><span class="how">{TIERS[1]} pts</span></span><span class="sr">reward</span></li>
  function make(tag, cls, s, slot) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (s != null) e.textContent = s;
    if (slot) e.setAttribute('data-s', slot);
    return e;
  }
  function chip(i) {
    var info = tierInfo(i), li = make('li', 'chip t-' + NAMES[i]), th = make('span', 'thumbs', null, 'thumbs'),
        tx = make('span', 'chip-txt'), b = make('b'), im, capped = KIOSK && !ONLINE && i > kioskCap(),
        sr = info.reward + (i > 0 && paused() ? ': paused right now' : info.soldOut ? ': gone today, scores here get ' + info.short : '') +
          (capped ? ': play on your own phone' : '');
    if (capped) li.className += ' is-locked';   // v6: out of the tablet’s reach
    if (info.soldOut) li.className += ' is-sold';
    li.setAttribute('data-tier', NAMES[i]);
    li.title = sr;
    if (info.img.length) {   // one thumb per chip keeps the strip compact
      im = make('img'); im.src = info.img[0]; im.alt = ''; im.width = im.height = 44;
      im.setAttribute('loading', 'lazy'); im.setAttribute('decoding', 'async');
      th.appendChild(im);
    }
    b.appendChild(make('em', '', info.name, 'name'));
    tx.appendChild(b);
    tx.appendChild(make('span', 'how', ladderHow(i), 'how'));
    li.appendChild(th); li.appendChild(tx);
    li.appendChild(make('span', 'sr', ' · ' + sr, 'reward'));
    return li;
  }
  function renderLadder() {
    var list = $('ladder-list'), i, c = canCount(), ci = checkin(), lead, bb = bs();
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      for (i = 0; i < 4; i++) list.appendChild(chip(i));
    }
    // v6: the tries rule under the strip, then the one-item rule once (the merch note may already say it).
    var once = /one item per person/i.test(MERCH.note || ''),
        rule = (once ? '' : ' One item per person.') + (MERCH.note ? ' ' + MERCH.note + '.' : '');
    // Badge mode: the badge's tries, first match wins (no “scan” here: the title has no scan button).
    if (ONLINE) {
      if (paused()) lead = 'Merch is paused right now. Play for fun.';
      else if (bd && bb.collected) lead = 'Merch collected. Play for fun.';
      else if (bd && bb.left === 0) lead = allUsed() + '. Play for fun.';
      else if (bd && bb.left > 0 && bb.left < COUNTED) lead = bb.left + ' of ' + fmt(COUNTED) + ' tries left.';
      else lead = 'Your Devcon badge gives ' + fmt(COUNTED) + ' tries for merch.';
      txt('ladder-fine', lead + rule);
    }
    // A booth tablet has no tries: every round is the next visitor.
    else if (KIOSK) txt('ladder-fine', 'Booth tablet: one try each, up to ' + baseTier(kioskCap()).name + '.' + rule);
    else {
      // v6: follows this phone's tries, so a fun round never passes for a counted one.
      if (c.reason === 'limit') lead = allUsed() + '. Play for fun.';
      else if (c.counted && c.left < COUNTED && !(ci && ci.claimed)) lead = c.left + ' of ' + fmt(COUNTED) + ' tries left.';   // “1 of 2 tries”: COUNTED ≥ 2 here
      // None used, collected or a duplicate check-in: the welcome chip says the rest.
      else lead = (COUNTED === 1 ? '1 try counts' : fmt(COUNTED) + ' tries count') + ' for merch.';
      txt('ladder-fine', lead + rule);
    }
  }
  function refreshBrief() {
    leaveReport();
    stopTicket();
    clearTimeout(idleTimer);
    if (KIOSK) { st = null; dropVisitor(); }   // a booth tablet: every return to the brief is the next visitor
    sync();
    renderHeader(); renderWelcome(); renderLadder();
    refreshStatus(false);   // badge mode: switches and the badge's tries (throttled)
  }

  // ---- Medal ----
  // objects.js draws the medal (GL or 2D); rewards.js says which tier, once Results show (a hidden box has no size).
  var repTier = 0, medalOn = false;
  function mountMedal() {
    var el = $('rep-medal'), o = window.CurateObjects;
    if (!el) return;
    el.setAttribute('data-tier', NAMES[repTier] || 'free');   // the shell tints the glow behind it
    if (!o || !o.medal) return;
    try { o.medal(el, repTier); medalOn = true; } catch (e) { medalOn = false; }   // a medal failure never blocks Results
  }
  function leaveReport() {
    var o = window.CurateObjects;
    if (!medalOn) return;
    medalOn = false;
    if (o && o.medal) { try { o.medal(null); } catch (e) { /* already gone */ } }
  }
  // The ticket’s small medal: a static 2D coin in the tier colour, drawn here so it never touches the GL one.
  var COIN = ['#cfc4f2', '#7ff0e0', '#b77bff', '#f2c46d'];
  function coin(i, css) {
    var cv = document.createElement('canvas'), x = cv.getContext ? cv.getContext('2d') : null, col = COIN[i] || COIN[0], r, g;
    if (!x) return null;
    cv.width = cv.height = Math.round(css * Math.min(3, window.devicePixelRatio || 1));
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'width:' + css + 'px;height:' + css + 'px;vertical-align:-4px;margin-right:6px;border-radius:50%;' +
      'box-shadow:0 0 8px ' + col;
    r = cv.width / 2;
    // Tier-colour face, a lit highlight and two dark rings (rim and inner edge): enough to read as metal at 18 px.
    g = x.createRadialGradient(r * 0.7, r * 0.6, 0, r, r, r);
    g.addColorStop(0, '#fff'); g.addColorStop(0.45, col); g.addColorStop(1, col);
    x.fillStyle = g; x.beginPath(); x.arc(r, r, r, 0, 7); x.fill();
    x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = Math.max(1, r * 0.1);
    x.beginPath(); x.arc(r, r, r * 0.9, 0, 7); x.stroke();
    x.beginPath(); x.arc(r, r, r * 0.55, 0, 7); x.stroke();
    return cv;
  }
  // #t-tier keeps its text as textContent (the check script reads it); the coin goes in front of it.
  function tierLabel(s, i) {
    var el = txt('t-tier', s), cv;
    if (i == null || !el || !el.insertBefore) return;
    cv = coin(i, 18);
    if (cv) el.insertBefore(cv, el.firstChild);
  }

  // ---- Report ----
  var cuRaf = 0, idleTimer = 0;
  var BEST_KEYS = ['at', 'deck', 'final', 'raw', 'caught', 'fakesSeen', 'listed', 'goodsSeen', 'evidence', 'wrong',
                   'leaks', 'trust', 'reviewed', 'shiftNo', 'code', 'tier'];
  // The tier under the thresholds in force when the shift ended: a mid-day retune never downgrades a ticket.
  function tierOf(b) { return b.tier != null ? b.tier : tierFor(b.final || 0); }
  function finishShift(sum) {
    sync();
    sum = sum || {};
    var run = {}, k, old = st.best, nb, oldT;
    for (k in sum) if (sum.hasOwnProperty(k)) run[k] = sum[k];
    if (ONLINE) { finishOnline(run, sum.misses); return; }
    run.misses = [].concat(sum.misses || []).slice(0, 3);   // keeps the stored object small
    run.day = today();
    run.at = sum.at || Date.now();
    run.tier = tierFor(run.final || 0);
    st.runs.push(run);
    if (st.runs.length > 12) st.runs = st.runs.slice(-12);
    // Only counted runs reach the ticket; a higher tier, then a higher score, wins; ties keep the earlier one.
    oldT = old ? tierOf(old) : -1;
    if (sum.counted && (!old || run.tier > oldT || (run.tier === oldT && (run.final || 0) > (old.final || 0)))) {
      nb = { day: run.day };
      BEST_KEYS.forEach(function (key) { nb[key] = run[key]; });
      if (old && old.shown != null) nb.shown = old.shown;
      st.best = nb;
    }
    save();
    showReport(run, sum.misses);   // the stored run keeps only 3 misses; the report counts them all
  }
  function showReport(run, misses) {
    renderReport(run, misses);
    UI.show('report');
    mountMedal();
    var h = $('rep-title');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    countUp(run.final || 0);
    armIdle();
  }
  // Badge mode: Results at once with the local tier, then the score goes to the server (finish). Nothing of the
  // round is written to kleros_devcon_curate; a counted round stays pending (on the phone) until a reply.
  function finishOnline(run, misses) {
    var counted = !!(run.counted && tok);
    if (run.counted && !tok) run.reason = 'offline';   // no try token: the server never counted this round
    run.counted = counted;
    run.tier = tierFor(run.final || 0);
    if (counted) {
      if (pend && !pend.done) toBackground(pend);   // an older unsaved round keeps retrying from memory
      pend = { hash: bd ? bd.hash : '', token: tok.token, score: Math.max(0, Math.round(run.final || 0)), relaxed: !!run.relaxed,
               endedBy: run.endedBy === 'time' || run.endedBy === 'quit' ? run.endedBy : 'done', t: Date.now(), fails: 0 };
      bSave();
    }
    tok = null; begun = null;
    showReport(run, misses);
    if (counted) sendFinish(pend);   // after the render: a reply may come back at once
  }
  // 900 ms easeOutExpo; set at once under reduced motion.
  function countUp(n) {
    var el = $('rep-score'), t0 = null;
    if (!el) return;
    if (cuRaf && window.cancelAnimationFrame) cancelAnimationFrame(cuRaf);
    if (RM || !window.requestAnimationFrame || n <= 0) { el.textContent = fmt(n); return; }
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / 900);
      el.textContent = fmt(n * (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)));
      cuRaf = p < 1 ? requestAnimationFrame(step) : 0;
    }
    el.textContent = '0';
    cuRaf = requestAnimationFrame(step);
  }
  // The bar on Results runs from 0 to Gold, the maximum: a third each for 0 to Teal, Teal to Purple and Purple to Gold.
  function markerAt(p) {
    var t = [0, tierMin(1), tierMin(2), tierMin(3)], i = 0;
    while (i < 3 && p >= t[i + 1]) i++;
    if (i === 3) return 1;
    return (i + Math.max(0, p - t[i]) / Math.max(1, t[i + 1] - t[i])) / 3;
  }
  function renderMeter(final, g) {
    var meter = $('rep-meter'), labs = $('rep-meter-labels'), mk = $('rep-marker'), segs, t, i;
    if (meter) {
      segs = meter.querySelectorAll('i[data-t]');
      for (i = 0; i < segs.length; i++) {
        t = +segs[i].getAttribute('data-t');
        segs[i].setAttribute('data-tier', t <= g ? NAMES[t] : 'none');   // reached segments take their tier colour
        // v6 only: tiers above a booth tablet's cap are hatched.
        if (KIOSK && !ONLINE && t > kioskCap()) segs[i].setAttribute('data-locked', ''); else segs[i].removeAttribute('data-locked');
      }
    }
    if (mk) mk.style.setProperty('--at', markerAt(final).toFixed(4));
    if (labs) for (i = 0; i < labs.children.length && i < 4; i++) labs.children[i].textContent = fmt(tierMin(i));
  }
  function renderMisses(misses) {
    var n = misses.length, det = vis('rep-missed', n > 0), list = $('rep-misses'), tpl = $('tpl-miss');
    if (!det) return;
    txt('rep-missed-sum', 'What you missed (' + n + ')');
    det.open = false;   // v6: collapsed, so Results stay short
    if (!list || !tpl || !tpl.content) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    misses.slice(0, 3).forEach(function (m) {
      var li = tpl.content.firstElementChild.cloneNode(true), leak = m.kind === 'leak', line = li.querySelector('.m-line');
      function set(s, v) { var el = li.querySelector('[data-s="' + s + '"]'); if (el) el.textContent = v || ''; }
      set('kind', leak ? 'Fake marked correct' : 'Real marked wrong');
      if (leak) { set('lab', m.fieldLabel); set('was', m.shown); set('is', m.fix); } else if (line) line.hidden = true;
      set('name', m.name);
      set('why', m.why);   // a wrong-part catch is a correct call: its lesson stays in the flash
      list.appendChild(li);
    });
  }
  // v6: Results show only what helps: the old quote, payoff, stats grid and fine print stay hidden.
  var REP_GONE = ['rep-quote', 'rep-quote-by'];
  function hideOld() {
    var g = $('rep-caught');
    REP_GONE.forEach(function (id) { vis(id, false); });
    if (g && g.parentNode && g.parentNode.className === 'stats') g.parentNode.hidden = true;
    else ['rep-caught', 'rep-listed', 'rep-evidence', 'rep-wrong'].forEach(function (id) { vis(id, false); });
  }
  // A line the shell may not have yet: its own element, else an old one this file no longer fills.
  function slot(id, old, s) {
    var el = $(id);
    if (el) vis(old, false); else el = $(old);
    if (!el) return;
    el.textContent = s || '';
    el.hidden = !s;
  }
  // The headline follows the trust band (≥90 / 70–89 / <70) from the deck copy; these cover a deck without one.
  var HEADLINES = ['Well done', 'Not bad', 'Too many fakes got in'];   // the brief’s “Great job” trips the job-word check
  function band3(list, fb, band) { var s = list && list[band]; return s ? String(s) : fb[band]; }
  // Ranks by tier when no check-in name; settings.js wins when it has them.
  var RANKS = ['Rookie spotter', 'Sharp eye', 'Eagle eye', 'Master curator'];
  function againText(c) {
    if (KIOSK) return 'Next curator';
    // Badge mode: another counted try is possible unless the known badge has none left.
    if (ONLINE) return !bd || (bs().left !== 0 && !bs().collected && !paused()) ? 'Play again' : 'Play for fun';
    return c && c.counted ? 'Play again' : 'Play for fun';
  }
  function isFun(sum) { return ONLINE ? !sum.counted : !sum.counted && !KIOSK; }
  function v6Tier() { var m = model(); return m.state === 'live' ? m.t : 0; }
  // Why a round was just for fun, and what to do. v6 rounds that carry no reason: collected or out of tries.
  function funWhy(sum) {
    var r = sum.reason || (ONLINE ? '' : st.collected ? 'collected' : 'limit'), bt;
    if (r === 'limit') {
      bt = ONLINE ? bestTier() : v6Tier();
      return allUsed() + '.' + (bt > 0 ? ' Your ' + baseTier(bt).name + ' ticket still counts.' : '');
    }
    if (r === 'collected') return ONLINE ? 'This badge already got its merch.' : 'You already collected merch on this phone.';
    if (r === 'nobadge') return 'No badge scanned. Scan it next round to play for merch.';
    if (r === 'paused') return 'Merch is paused right now. Ask at the booth.';
    if (r === 'offline') return 'We couldn’t reach the merch list, so this round was for fun.';
    if (r === 'nocrypto') return 'This browser can’t read badges, so this round was for fun.';
    return 'You picked Play for fun. Tap Start next time to play for merch.';
  }
  // “Try 1 of 2 · 1 try left”, “Both tries used”, or why this round was just for fun.
  // v6: left comes from storage now, so a try another tab started since is already taken off.
  function triesText(sum, c) {
    var left, bt;
    if (!sum) return '';
    if (isFun(sum)) return funWhy(sum);
    if (ONLINE) {
      left = bs().left != null ? bs().left : Math.max(0, COUNTED - (sum.shiftNo || 1));
      bt = bestTier();
      return 'Try ' + (sum.shiftNo || 1) + ' of ' + COUNTED + ' · ' + (bt > rs.g ? 'Your best, ' + baseTier(bt).name +
        ', still counts.' : left > 0 ? triesLeft(left) : allUsed());
    }
    if (KIOSK) return '';
    if (c.left > 0) return 'Try ' + (sum.shiftNo || 1) + ' of ' + COUNTED + ' · ' + triesLeft(c.left);
    return allUsed();
  }
  var repSum = null;   // the round on Results, for the tries line when another tab changes the count
  function renderReport(sum, misses) {
    var d = deckOf(sum.deck), copy = d.copy || {}, trust = sum.trust == null ? 100 : sum.trust,
        band = trust >= 90 ? 0 : trust >= 70 ? 1 : 2, final = sum.final || 0, ci = checkin(),
        g0 = tierFor(final), g = g0, c = canCount(), pending, fun = isFun(sum), leaks = sum.leaks || 0,
        right = (sum.caught || 0) + (sum.listed || 0), of = sum.entries || S.entries || sum.reviewed || 0,
        // Trust only drops on mistakes, so a round timed out or ended early is capped by the count right too.
        early = sum.endedBy === 'time' || sum.endedBy === 'quit',
        cb = !early ? 0 : right >= of - 1 ? 0 : right >= Math.ceil(of * 0.7) ? 1 : 2;
    if (KIOSK && !ONLINE) g = Math.min(g, kioskCap());   // v6 only: in badge mode the badge is the identity
    // The medal shows the tier this round earns here; a round just for fun gets the free one, so nothing looks won.
    repTier = fun ? 0 : g;
    repSum = sum;
    rs = { sum: sum, g: g, g0: g0, fun: fun, ci: ci, p: ONLINE && !fun ? pend : null, state: ONLINE && !fun ? 'saving' : '' };
    hideOld();
    txt('rep-kicker', d.client);
    // Capped by the count, not by fakes: say why.
    txt('rep-title', cb === 2 && band < 2 ? (sum.endedBy === 'time' ? 'Out of time' : 'Ended early') :
      band3(copy.headlines, HEADLINES, Math.max(band, cb)));
    // A fake marked Wrong is right even with the wrong part picked: the part only changes the points.
    txt('rep-sub', fmt(right) + ' of ' + fmt(of) + ' right');
    // What happened to the app's list, in plain words: how many fakes were marked Correct. A round cut short
    // with few cards seen says nothing about the list, so it gets no line.
    slot('rep-company', 'rep-payoff', cb === 2 && !leaks ? '' : leaks > 0 ?
      count(leaks, 'wrong entry', 'wrong entries') + ' got through.' : 'No wrong entry got through.');
    // v6: the strip shows only when this counted round earned a gated tier that a check-in would unlock.
    pending = !ONLINE && sum.counted && !KIOSK && g >= NEED && !(ci && (ci.ok || ci.claimed)) && !st.collected && !isSoldOut(g) ? g : 0;
    renderGold('rep-gold', 'rep-gold-go', pending, ci);
    renderMeter(final, g0);   // how far the score got, even when the round wins no merch
    renderMisses([].concat(misses || sum.misses || []));
    renderLines();
    txt('again', againText(c));
    txt('rep-switch', 'Try another app');   // game.js wires it back to the title screen
  }
  // The tier and tries lines, and in badge mode the save line and #to-ticket: they follow the finish reply.
  function renderLines() {
    var sum = rs.sum, g = rs.g, ci = rs.ci, info, next = '', line, imgs = [], tries;
    if (!sum) return;
    if (rs.fun || rs.state === 'refused') {
      // Just for fun (or a score the server refused): what the score reached, and that it wins no merch.
      line = g > 0 ? 'Your score reached ' + baseTier(g).name + ', but this round wins no merch.' : 'This round wins no merch.';
      tries = rs.fun ? funWhy(sum) : triesText(sum, canCount());
    } else {
      info = tierInfo(g);
      if (g < 3 && !(KIOSK && !ONLINE && g >= kioskCap())) next = ' · ' + fmt(tierMin(g + 1) - (sum.final || 0)) + ' pts to ' + baseTier(g + 1).name;
      // v6: the score may be past the tablet's cap: say why a kiosk gets the cap’s reward.
      if (KIOSK && !ONLINE && rs.g0 > g) next = ' · Own phone for ' + kioskAbove();
      line = tierTitle(g) + ' · ' + info.reward + next;
      imgs = info.img;
      tries = triesText(sum, canCount());
    }
    // v6: a duplicate check-in already holds this person's one item, so the score names no reward.
    if (ci && ci.claimed) { line = 'Merch goes with your first check-in. Play for fun.'; imgs = []; }
    txt('rep-tier-line', line);
    thumbs($('rep-thumbs'), imgs);
    slot('rep-tries', 'rep-fine', tries);
    if (ONLINE) renderSave(); else txt('to-ticket', 'Show my merch ticket');
  }
  // Badge mode: #rep-save says where the score stands; #to-ticket waits for it.
  function renderSave() {
    var p = rs.p, s = rs.state, b = bs(), bt = bestTier(), line = '', tt = $('to-ticket'), stuck = !!p && p.fails >= 3;
    if (!rs.sum) return;
    if (s === 'saving') line = !p || !p.fails ? 'Saving your score…' : stuck ? 'Can’t reach the merch list. Keep this page open.' :
      'Not saved yet. Trying again…';
    else if (s === 'refused') line = 'This round couldn’t be saved, so it wins no merch.';
    else if (s === 'saved' && paused()) line = 'Merch is paused right now. Your score is saved.';
    txt('rep-save', line);
    vis('rep-save', !!line);
    vis('rep-retry', s === 'saving' && stuck && !p.busy);
    if (!tt) return;
    // A round that wins nothing leads to a ticket only when the badge already has one.
    tt.hidden = (rs.fun || s === 'refused') && !(bt > 0);
    tt.disabled = s === 'saving';
    tt.textContent = s !== 'saving' && bt > 0 && !b.contact && !b.collected ? 'Unlock my merch ticket' : 'Show my merch ticket';
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (!KIOSK) return;
    idleTimer = setTimeout(function () {
      var r = $('report');
      if (!r || r.hidden) return;
      if (rs.p && rs.p.busy) { armIdle(); return; }   // a finish in flight: the next visitor waits for it
      kioskReset();
    }, S.kioskIdleMs || 60000);
  }

  // ---- Ticket model ----
  // §3.4: one item per person, so the ticket shows max(game tier, check-in tier) once the gates are applied.
  // Badge mode: when the server's thresholds differ (an old Code.gs is live), Results and the ticket follow it.
  function tierFor(p) {
    var t = ONLINE && srv.tiers, i;
    if (!t && window.CurateRules && CurateRules.tierFor) return CurateRules.tierFor(p);
    t = t || TIERS;
    for (i = t.length - 1; i > 0; i--) if (p >= t[i]) return i;
    return 0;
  }
  function tierMin(i) { return ((ONLINE && srv.tiers) || TIERS)[i] || 0; }
  function lastCountedRun() {
    for (var i = st.runs.length - 1; i >= 0; i--) if (st.runs[i].counted) return st.runs[i];
    return null;
  }
  function model() {
    if (ONLINE) return modelB();
    sync();
    var ci = checkin(), best = st.best, m = { state: 'live', ci: ci, best: best, t: 0, g: 0, pending: 0,
      source: 'game', soldFrom: -1, code: '' }, g, c, t;
    if (st.collected) { m.state = 'collected'; m.t = st.collected.tier || 0; m.code = st.collected.code || ''; return m; }
    if (ci && ci.claimed) { m.state = 'dup'; return m; }
    // v6: the best counted round of the whole event is the ticket (no daily expiry); none yet: no ticket.
    if (!best) { m.state = 'empty'; m.best = lastCountedRun(); return m; }
    g = tierOf(best);
    m.g = g;
    if (g >= NEED && !(ci && ci.ok)) { m.pending = g; g = NEED - 1; }
    c = ci && ci.ok ? ci.tier : 0;
    t = Math.max(g, c);
    if (c > g) m.source = 'checkin';
    while (t > 0 && isSoldOut(t)) { if (m.soldFrom < 0) m.soldFrom = t; t--; }
    if (KIOSK) t = Math.min(t, kioskCap());
    if (m.pending && isSoldOut(m.pending)) m.pending = 0;   // no point checking in for a tier that is gone today
    if (KIOSK) m.pending = 0;
    m.t = t;
    // The check-in ticket (same K- code) already covers this: one item per person, so no second claimable ticket.
    if (c > 0 && t <= c) { m.state = 'checkin'; return m; }
    m.code = ci && ci.ok ? ci.ticket : best.code;
    return m;
  }
  // Badge mode, from the server's word on the badge: collected, locked (a tier above stickers, no contact yet),
  // or live (the best tier with sold-out tiers handed down; t 0 is the Everyone ticket, no code).
  function modelB() {
    var b = bs(), best = bd ? b.best || null : null, m = { state: 'live', ci: null, best: best, t: 0, g: 0, pending: 0,
      source: 'game', soldFrom: -1, code: '', contact: !!b.contact }, t;
    if (bd && b.collected) { m.state = 'collected'; m.t = m.g = best ? best.tier || 0 : 0; return m; }
    if (!best) return m;
    t = m.g = best.tier || 0;
    while (t > 0 && isSoldOut(t)) { if (m.soldFrom < 0) m.soldFrom = t; t--; }
    m.t = t;
    if (t > 0 && !b.contact) m.state = 'locked';
    else if (t > 0) m.code = best.code || '';
    return m;
  }
  // The Gold strip copy, shared by the report and the ticket. Names come from config, so it follows NEED too.
  function goldCopy(pending, ci) {
    var info = baseTier(pending), head = info.name + ' score. ';
    return ci && !ci.ok ?
      head + 'Confirm your check-in (the link in the Kleros blog email) to claim ' + info.short + '.' :
      head + 'Check in (1 min) on this phone to claim ' + info.short + '.';
  }
  function renderGold(boxId, goId, pending, ci) {
    var on = !!pending && !KIOSK, go;
    if (!vis(boxId, on) || !on) return;
    txt(boxId + '-text', goldCopy(pending, ci));   // #rep-gold-text / #t-gold-text in the shell
    go = $(goId);
    if (go) { go.href = '/'; go.textContent = 'Check in for ' + baseTier(pending).name + ' →'; }
  }

  // ---- Ticket render ----
  var current = null;
  function kioskAbove() {
    var a = [], i;
    for (i = kioskCap() + 1; i < 4; i++) a.push(baseTier(i).name);
    return a.join(' and ');
  }
  function hintFor(m) {
    if (KIOSK) return 'Show this at the booth. Own phone for ' + kioskAbove() + '.';
    return 'Show this at the booth.';
  }
  function soldNote(m) {   // no generated plural: rewards are free text
    var from = baseTier(m.soldFrom);
    return from.reward + ': gone for today. Your ' + from.name + ' score gets ' + tierInfo(m.t).short + '.';
  }
  function noteFor(m) {
    if (blocked) return 'This browser won’t keep your ticket if you close it.';
    if (m.soldFrom > 0) return soldNote(m);
    return m.source === 'checkin' ? 'From your check-in' : 'From your round';
  }
  // Tries last the whole event, so a best round from another day says which day (the front shows today’s date).
  function dayOf(b) {
    if (!b.day || b.day === today()) return '';
    try { return new Date(b.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' · '; }
    catch (e) { return b.day + ' · '; }
  }
  function renderBack(m) {
    var b = m.best, ci = m.ci, live = m.state === 'live', staff = live && !KIOSK && m.t > 0;   // Everyone: nothing to stamp
    txt('tb-shift', !b ? '' : (KIOSK ? '' : 'Try ' + (b.shiftNo || 1) + ' of ' + COUNTED + ' · ') +
        dayOf(b) + hhmm(b.at) + ' · ' + deckOf(b.deck).client);
    txt('tb-stats', !b ? '' : fmt(b.final) + ' pts · ' + fmt(b.caught) + ' of ' + count(b.fakesSeen, 'fake', 'fakes') + ' · ' +
        count(b.evidence, 'part', 'parts') + ' spotted · trust ' + (b.trust == null ? 100 : b.trust) + '%');
    txt('tb-code', !b || !live ? '' : 'Game code ' + (b.code || '') + (ci && ci.ok ? ' · Check-in ' + ci.ticket : ''));
    vis('tb-staff', staff);
    txt('tb-staff', 'Staff: hold the code ' + Math.round((S.staffHoldMs || 2000) / 1000) + ' s, or tap below.');
    if (vis('tb-staff-btn', staff)) txt('tb-staff-btn', 'Mark as collected');
  }
  function renderTicket() {
    if (ONLINE) { renderTicketB(); return; }
    // canCount() first: model() re-reads storage last, so b below is the live best that save() writes.
    var c = canCount(), m = model(), ci = m.ci, b = m.best, live = m.state === 'live', tk = $('ticket'), info = tierInfo(m.t),
        thanks = 'Thanks for playing. Play again for fun.', who, ck;
    current = m;
    if (tk) {
      tk.setAttribute('data-tier', live ? NAMES[m.t] : m.state === 'empty' ? 'empty' : 'claimed');
      if (tk.classList.contains('flipped')) unfocusFace(tk);
      tk.classList.remove('flipped');
      if (!tk.hasAttribute('tabindex')) tk.setAttribute('tabindex', '0');
    }
    txt('t-kicker', 'Kleros booth · Curate game');
    tickClock();
    var lv = vis('t-live', live);
    if (lv) lv.title = 'Live: a screenshot stops ticking';
    vis('t-img', live || m.state === 'collected');
    thumbs($('t-img'), live || m.state === 'collected' ? info.img : []);
    if (live) {
      tierLabel(tierTitle(m.t), m.t); txt('t-reward', info.reward); txt('t-hint', hintFor(m));
      txt('t-note', noteFor(m));
    } else if (m.state === 'collected') {
      txt('t-tier', 'Collected · ' + tierTitle(m.t) + ' · ' + hhmm(st.collected.at));
      txt('t-reward', info.reward);
      // A game handout never shows on the check-in desk, so say it before they check in for another item.
      txt('t-hint', ci && ci.ok ? thanks : 'One item per person, check-in included. Play again for fun.');
      txt('t-note', '');
    } else if (m.state === 'checkin') {
      txt('t-tier', 'Your merch comes with your check-in');
      txt('t-reward', 'Show your check-in ticket at the booth.');
      txt('t-hint', thanks); txt('t-note', '');
    } else if (m.state === 'dup') {
      txt('t-tier', 'Merch goes with your first check-in');
      txt('t-reward', 'You already checked in at the booth. One item per person.');
      txt('t-hint', thanks); txt('t-note', '');
    } else {
      // A try spent on a round that never finished (a reload) leaves no best: say so once the tries are gone.
      txt('t-tier', 'No ticket yet'); txt('t-reward', ''); txt('t-hint', c.counted ? 'Play a round for merch.' : allUsed() + '.');
      txt('t-note', '');
    }
    vis('t-note', !!($('t-note') || {}).textContent);
    // The check-in name only when its gate passes; otherwise a rank earned by the score.
    who = ci && ci.ok && ci.name ? ci.name : (S.ranks || RANKS)[b ? tierOf(b) : 0] || '';
    txt('t-who', who);
    txt('t-org', b ? fmt(b.final) + ' pts · ' + fmt(b.caught) + ' of ' + count(b.fakesSeen, 'fake', 'fakes') + ' caught' : '');
    ck = vis('t-code', live);
    if (ck) { ck.textContent = live ? m.code : ''; ck.classList.remove('holding'); ck.style.setProperty('--hold', '0'); }
    renderBack(m);
    renderGold('t-gold', 't-gold-go', live ? m.pending : 0, ci);
    var back = vis('t-back', !KIOSK);
    if (back && !KIOSK) {
      back.href = '/';
      back.textContent = ci ? 'Back to your check-in ticket →' : 'Check in with Kleros →';
    }
    vis('t-next', KIOSK);
    txt('t-again', againText(c));   // matches #again on the report
    // A tier that went up since this ticket was last shown (say, after checking in) gets the bump.
    if (live && b && b.shown !== m.t) {
      if (tk && b.shown != null && m.t > b.shown) {
        tk.classList.remove('bump'); void tk.offsetWidth; tk.classList.add('bump');
        setTimeout(function () { tk.classList.remove('bump'); }, 900);
      }
      b.shown = m.t;
      save();
    }
  }

  // ---- Ticket render, badge mode ----
  // Locked: the tier with a hidden code and the contact step under it. Live: the game code (C-) staff read
  // with the badge at the desk. Everyone: stickers, no code. Collected: the badge already got its merch.
  var lockTimer = 0;
  function appName(id) { var D = window.CURATE_DECKS || {}; return D.hasOwnProperty(id) && D[id] ? D[id].client : ''; }
  function renderTicketB() {
    var m = model(), b = m.best, tk = $('ticket'), info = tierInfo(m.t), lock = m.state === 'locked',
        coded = m.state === 'live' && m.t > 0, C = window.CurateContact, prev = current, ck, h, tail = bd ? ' · Badge …' + bd.tail : '';
    current = m;
    if (tk) {
      tk.setAttribute('data-tier', m.state === 'collected' ? 'claimed' : NAMES[m.t]);
      if (lock) tk.setAttribute('data-locked', ''); else tk.removeAttribute('data-locked');
      if (tk.classList.contains('flipped')) unfocusFace(tk);
      tk.classList.remove('flipped');
      if (!tk.hasAttribute('tabindex')) tk.setAttribute('tabindex', '0');
    }
    txt('t-kicker', 'Kleros booth · Curate game');
    tickClock();
    vis('t-live', coded);
    vis('t-img', true);
    thumbs($('t-img'), info.img);
    if (m.state === 'collected') {
      txt('t-tier', 'Collected'); txt('t-reward', info.reward); txt('t-hint', 'Thanks for playing. Play again for fun.');
      txt('t-note', '');
    } else {
      tierLabel(tierTitle(m.t), m.t);
      txt('t-reward', info.reward);
      txt('t-hint', lock ? 'Unlock it below.' : coded ? 'Show your badge at the merch desk.' : 'Show this at the booth.');
      txt('t-note', lock ? '' : m.soldFrom > 0 ? soldNote(m) : coded ? (paused() ? 'Merch is paused right now.' : 'From your best round') :
        ((MERCH.free || (S.fallbackMerch || {}).free || {}).how || ''));
    }
    vis('t-note', !!($('t-note') || {}).textContent);
    txt('t-who', (S.ranks || RANKS)[m.g] || '');
    txt('t-org', b ? fmt(b.score) + ' pts' + tail : '');
    ck = vis('t-code', coded || lock);
    if (ck) { ck.textContent = lock ? '······' : coded ? m.code : ''; ck.classList.remove('holding'); ck.style.setProperty('--hold', '0'); }
    // The back: which try, which day and time (tries last the event) and which app; staff use the desk, so no stamp here.
    txt('tb-shift', b ? ['Try ' + (b.tryNo || 1) + ' of ' + COUNTED, b.day || '', b.at || '', appName(b.app)].filter(Boolean).join(' · ') : '');
    txt('tb-stats', b ? fmt(b.score) + ' pts' : '');
    txt('tb-code', coded ? 'Game code ' + m.code + tail : '');
    vis('tb-staff', false); vis('tb-staff-btn', false);
    vis('t-gold', false); vis('t-back', false);
    vis('t-next', KIOSK && !lock);   // the tablet's countdown waits while the contact step is open
    txt('t-again', againText());
    if (!C) return;
    // A redraw of the same locked ticket for the same badge leaves the form alone: the visitor may be typing.
    if (lock && !(prev && prev.state === 'locked' && prev.t === m.t && formFor === bd.hash && !isHidden('contact'))) {
      h = formFor = bd.hash;
      C.show({ badge: h, tier: m.t, kiosk: KIOSK, onDone: function (j) { unlocked(j, h); }, onInput: armLock });
      armLock();
    } else if (!lock) { C.hide(); clearTimeout(lockTimer); }
  }
  var formFor = '';   // the badge hash the contact form was shown for
  function isHidden(id) { var el = $(id); return !el || el.hidden; }
  // The contact went through: the same ticket, unlocked, with the tier-up bump.
  function unlocked(j, hash) {
    var tk = $('ticket'), s;
    absorb(j);
    if (!bd || bd.hash !== hash) return;   // another badge is on screen now: the server holds this one's flag
    s = srv.badge || (srv.badge = {});
    s.contact = true;
    bSave();
    clearTimeout(lockTimer);
    renderTicketB();
    if (tk) {
      tk.classList.remove('bump'); void tk.offsetWidth; tk.classList.add('bump');
      setTimeout(function () { tk.classList.remove('bump'); }, 900);
      try { tk.focus({ preventScroll: true }); } catch (e) { tk.focus(); }
    }
    UI.say('Ticket unlocked');
    nextLeft = Math.round((S.kioskResetMs || 20000) / 1000);   // the tablet's 20 s start only now
    if (KIOSK) txt('t-next', 'Next curator in ' + nextLeft + ' s');
  }
  // Kiosk, locked ticket: only kioskIdleMs with no typing resets the tablet.
  function armLock() {
    clearTimeout(lockTimer);
    if (!KIOSK) return;
    lockTimer = setTimeout(function () {
      var v = $('ticketv');
      if (v && !v.hidden && current && current.state === 'locked') kioskReset();
    }, S.kioskIdleMs || 60000);
  }

  // ---- Ticket mechanics: clock, flip, hold, staff sheet, undo, kiosk ----
  var clockTimer = 0, nextLeft = 0, undoTimer = 0, staffPrev = null, staffFor = null;
  var hold = { on: false, t0: 0, raf: 0 }, suppressFlip = false, holdEndAt = -1e9, myStamp = null;
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  // The clock keeps ticking under reduced motion: it is the live proof against screenshots.
  function tickClock() {
    var d = new Date(), t, day;
    try {
      t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      day = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    } catch (e) { t = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); day = today(d); }
    txt('t-clock', t);
    txt('t-date', day);
  }
  function onTick() {
    var v = $('ticketv');
    if (!v || v.hidden) { stopTicket(); return; }   // left the view: the interval goes with it
    tickClock();
    if (KIOSK) {
      if (current && current.state === 'locked') return;   // badge mode: the contact step holds the tablet (armLock)
      nextLeft--;
      if (nextLeft <= 0) { kioskReset(); return; }
      txt('t-next', 'Next curator in ' + nextLeft + ' s');
    }
  }
  function stopTicket() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = 0;
    cancelHold();
    if (staffFor) closeStaff(false);
  }
  function showTicket() {
    leaveReport();
    sync();
    clearTimeout(idleTimer);
    stopTicket();
    renderTicket();
    UI.show('ticket');
    // The button that led here is gone, so focus never drops to <body>. A locked ticket: the contact step, now that
    // it can take focus and scroll (renderTicket ran while the view was still hidden).
    var tk = $('ticket'), cx = $('contact'), ct = $('contact-title');
    if (current && current.state === 'locked' && cx && !cx.hidden && ct) {
      try { ct.focus({ preventScroll: true }); } catch (e) { ct.focus(); }
      try { cx.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browsers: no options */ }
    } else if (tk) { try { tk.focus({ preventScroll: true }); } catch (e) { tk.focus(); } }
    nextLeft = Math.round((S.kioskResetMs || 20000) / 1000);
    if (KIOSK) txt('t-next', 'Next curator in ' + nextLeft + ' s');
    clockTimer = setInterval(onTick, 1000);
    refreshStatus(false);   // badge mode: a ticket opened from the title catches up with the desk and the switches
  }
  function kioskReset() {
    leaveReport();
    stopTicket();
    clearTimeout(idleTimer);
    clearTimeout(lockTimer);
    st = null;   // the next visitor starts clean
    dropVisitor();
    UI.reset();
  }
  // Badge mode, booth tablet: the next visitor. Forget the badge, the try and the contact form; a finish not saved
  // yet keeps retrying from memory (token and score only, never the badge).
  function dropVisitor() {
    var C = window.CurateContact;
    if (!ONLINE) return;
    if (pend && !pend.done) toBackground(pend);
    pend = null; bd = null; srv.badge = null; tok = null; spare = ''; begun = null;
    flow = { busy: 0, offline: false };
    rs = { sum: null };
    if (C) C.hide();
  }
  // The face turning away is hidden from focus (CSS visibility), so focus inside it moves to the ticket.
  function unfocusFace(tk) { var a = document.activeElement; if (a && a !== tk && tk.contains(a)) tk.focus(); }
  function flip() {
    var tk = $('ticket');
    if (tk) { unfocusFace(tk); tk.classList.toggle('flipped'); }
  }
  // Only the click that follows the hold’s release is swallowed: a long-press with no click (Android) or a
  // click that lands on the staff sheet must not eat the next real tap.
  function onTicketClick(e) {
    var s = suppressFlip;
    suppressFlip = false;
    if (s && now() - holdEndAt < 600) return;
    if (e.target && e.target.closest && e.target.closest('a,button')) return;
    flip();
  }
  function onTicketKey(e) {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    flip();
  }
  // ---- Staff press-and-hold on #t-code ----
  function holdStart(e) {
    var el = $('t-code');
    suppressFlip = false;
    if (!el || KIOSK || ONLINE || !current || current.state !== 'live' || !(current.t > 0) || (e.button && e.button > 0)) return;
    hold.on = true; hold.t0 = now();
    el.classList.add('holding');
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: pointerleave still cancels */ }
    hold.raf = requestAnimationFrame(holdFrame);
  }
  function holdFrame() {
    var el = $('t-code'), p;
    if (!hold.on || !el) return;
    p = Math.min(1, (now() - hold.t0) / (S.staffHoldMs || 2000));
    el.style.setProperty('--hold', p.toFixed(3));
    if (p > 0.12) suppressFlip = true;   // a real hold never turns the ticket over
    if (p >= 1) { cancelHold(); suppressFlip = true; openStaff(); return; }
    hold.raf = requestAnimationFrame(holdFrame);
  }
  function cancelHold() {
    var el = $('t-code');
    hold.on = false;
    if (hold.raf && window.cancelAnimationFrame) cancelAnimationFrame(hold.raf);
    hold.raf = 0;
    if (el) { el.classList.remove('holding'); el.style.setProperty('--hold', '0'); }
  }
  // The finger lifts: the click that follows (if any) must not turn the ticket over.
  function holdEnd() {
    if (suppressFlip) holdEndAt = now();
    cancelHold();
  }
  // ---- Staff sheet and undo ----
  function openStaff() {
    var m = model(), info, p;
    if (KIOSK || ONLINE) return;   // badge mode: staff check the badge at the desk
    if (m.state !== 'live') { renderTicket(); return; }   // another tab stamped it or it changed: show that instead
    if (!(m.t > 0)) return;   // Everyone: stickers are free, and a stamp would stop later shifts from counting
    info = tierInfo(m.t);
    staffFor = { tier: m.t, code: m.code };
    staffPrev = document.activeElement;
    txt('staff-title', 'Mark as collected?');
    txt('staff-body', 'Staff only. Hand over one ' + baseTier(m.t).name + ' item: ' + info.reward +
        '. This greys out the ticket on this phone for the rest of Devcon.');
    // One item per person across both routes. A game handout never reaches the merch desk, so say it here.
    p = m.pending ? baseTier(m.pending) : null;
    vis('staff-desk', true);
    txt('staff-desk', m.ci && m.ci.ok ?
      'First search ' + m.ci.ticket + ' on the merch desk. If Merch given is ticked, or they already got merch ' +
        'with their check-in ticket, no second item (one item per person). Otherwise tick it.' :
      (p ? 'This score reaches ' + p.name + ': ask if they want to check in first for ' + p.short + '. ' : '') +
        'No check-in on this phone, so this is their one item: no second item if they check in later.');
    txt('staff-ok', 'Mark collected'); txt('staff-cancel', 'Cancel');
    vis('staff', true);
    if ($('staff-ok')) $('staff-ok').focus();
  }
  function closeStaff(restore) {
    vis('staff', false);
    staffFor = null;
    suppressFlip = false;
    if (restore !== false && staffPrev && staffPrev.focus) { try { staffPrev.focus(); } catch (e) { /* gone */ } }
    staffPrev = null;
  }
  function confirmStaff() {
    if (!staffFor) return;
    // Re-read first: another tab may have stamped it already, and that stamp must stay as it is.
    if (model().state !== 'live') { closeStaff(false); renderTicket(); return; }
    st.collected = { at: Date.now(), tier: staffFor.tier, code: staffFor.code };
    myStamp = st.collected;
    save();
    closeStaff(false);
    renderTicket();
    txt('undo-text', 'Marked as collected'); txt('undo-btn', 'Undo');
    vis('undo', true);
    UI.say('Marked as collected');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { vis('undo', false); }, S.undoMs || 5000);
    if ($('undo-btn')) $('undo-btn').focus();
  }
  function undoCollect() {
    clearTimeout(undoTimer);
    vis('undo', false);
    sync();
    // Undo only the stamp this page wrote, never one another tab wrote since.
    if (!st.collected || !myStamp || st.collected.at !== myStamp.at || st.collected.code !== myStamp.code) {
      myStamp = null; renderTicket(); return;
    }
    st.collected = null;
    myStamp = null;
    save();
    renderTicket();
    UI.say('Collected mark undone');
    if ($('ticket')) $('ticket').focus();
  }
  // Focus stays inside the sheet; Esc closes it.
  function onDocKey(e) {
    var sheet = $('staff'), f, first, last;
    if (KIOSK) { var r = $('report'); if (r && !r.hidden) armIdle(); }
    if (!staffFor || !sheet || sheet.hidden) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeStaff(); return; }
    if (e.key !== 'Tab') return;
    f = sheet.querySelectorAll('button:not([hidden]),a[href],[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    first = f[0]; last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  // ---- Badge mode: storage ----
  // Own phone only: the badge's hash and last 4 (never the code), its last known state for an offline ticket, and
  // the finish not saved yet. A booth tablet keeps nothing; a blocked browser keeps the memory copy.
  function bLoad() {
    var d = KIOSK || !ONLINE ? null : store(BKEY), p;
    if (!d || typeof d !== 'object' || d.v !== 1) return;
    if (/^[0-9a-f]{64}$/.test(d.hash || '')) {
      bd = { hash: d.hash, tail: String(d.tail || '').slice(-4) };
      srv.badge = { best: d.best || null, contact: !!d.contact, collected: !!d.collected };
    }
    p = d.pending;
    if (p && /^[a-z0-9]{16,24}$/.test(p.token || '') && Date.now() - p.t < MAX_SEND) {
      pend = { hash: d.hash || '', token: p.token, score: p.score | 0, relaxed: !!p.relaxed, endedBy: p.endedBy || 'done', t: p.t, fails: 0 };
    }
  }
  function bSave() {
    var b = bs(), p = pend && !pend.done ? pend : null;
    if (KIOSK || !ONLINE) return;
    if (!bd && !p) { try { localStorage.removeItem(BKEY); } catch (e) { /* blocked: nothing kept */ } return; }
    store(BKEY, { v: 1, hash: bd ? bd.hash : '', tail: bd ? bd.tail : '', best: bd ? b.best || null : null,
      contact: !!(bd && b.contact), collected: !!(bd && b.collected),
      pending: p ? { token: p.token, score: p.score, relaxed: p.relaxed, endedBy: p.endedBy, t: p.t } : null, at: Date.now() });
  }

  // ---- Badge mode: transport ----
  // Every request goes through CurateBadge.post (JSON as text/plain, no preflight). A callback may run at once.
  function post(body, done) {
    var B = Bdg(), called = false;
    function once(err, j) { if (called) return; called = true; done(err, j); }
    body.kiosk = KIOSK;
    if (!B || !B.post) { once('offline'); return; }
    try { B.post(body, once); } catch (e) { if (called) throw e; once('offline'); }
  }
  // No answer, or busy/server: try again later. Any other error code is the server refusing.
  function noAnswer(err, j) { return !!err || !j || (!j.ok && (j.error === 'busy' || j.error === 'server')); }
  // Every reply carries the switches; status also the thresholds in force.
  function absorb(j) {
    if (!j) return;
    if (typeof j.open === 'boolean') srv.open = j.open;
    if (isArr(j.soldOut)) srv.soldOut = j.soldOut.slice();
    if (isArr(j.tiers) && j.tiers.length === TIERS.length) {
      if (j.tiers.join() === TIERS.join()) srv.tiers = null;
      else {
        if (!srv.tiers) console.warn('curate: server tiers differ from settings.js');
        srv.tiers = j.tiers.slice();
      }
    }
  }
  // The badge's own fields from a status, start or finish reply.
  function merge(b) {
    var s = srv.badge || (srv.badge = {});
    if (!b) return;
    ['triesUsed', 'left', 'best', 'contact', 'collected'].forEach(function (k) { if (b[k] !== undefined) s[k] = b[k]; });
    if (b.left != null && b.triesUsed == null) s.triesUsed = Math.max(0, COUNTED - b.left);
  }
  // Whatever is on screen catches up with the server's word.
  function refreshViews() {
    var b = $('brief'), v = $('ticketv'), r = $('report'), m;
    if (b && !b.hidden) { renderWelcome(); renderLadder(); }
    renderIntro();
    if (v && !v.hidden) { m = model(); if (!current || sig(m) !== sig(current)) renderTicket(); }
    if (r && !r.hidden && rs.sum) { renderLines(); txt('again', againText(canCount())); }
  }
  // Leaving the intro mid-start never wastes a try: a counted start whose round never began is played next.
  function held() { return !!(tok && !tok.used && begun && begun.counted && bd && tok.hash === bd.hash); }

  // ---- Badge mode: status ----
  function askStatus(done) {
    var hash = bd ? bd.hash : '', body = { action: 'status' }, f = flow;
    if (hash) body.badge = hash;
    srv.asked = Date.now();
    post(body, function (err, j) {
      if (!noAnswer(err, j) && j.ok) {
        absorb(j);
        f.offline = false;   // the list answers again; an unconfirmed start token is still re-sent first
        if (hash && bd && bd.hash === hash) { if (j.badge) merge(j.badge); bSave(); }
      }
      if (done) done();
      refreshViews();
    });
  }
  // The title, the ticket and Play for fun ask; at most every statusMs unless forced.
  function refreshStatus(force) {
    if (!ONLINE || (!force && Date.now() - srv.asked < (SV.statusMs || 30000))) return;
    askStatus(null);
  }

  // ---- Badge mode: the badge ----
  // A scan or a typed code: read and hash it, then ask its state. Never spends a try (only Start does).
  function setBadge(raw, done) {
    var B = Bdg(), f;
    done = typeof done === 'function' ? done : function () {};
    if (!ONLINE || !B || !can('hash')) { renderIntro(); done({ ok: false, error: 'nocrypto' }); return; }
    B.read(raw, function (err, v) {
      if (err === 'nocrypto') { renderIntro(); done({ ok: false, error: 'nocrypto' }); return; }
      if (err || !v || !/^[0-9a-f]{64}$/.test(v.hash || '')) { done({ ok: false, error: 'notbadge' }); return; }
      if (!bd || bd.hash !== v.hash) { spare = ''; hideContact(); }   // a start token and the contact form belong to one badge
      bd = { hash: v.hash, tail: String(v.tail || '').slice(-4) };
      srv.badge = null;
      f = flow;
      f.offline = false;
      bSave();
      f.busy++;
      renderIntro();
      askStatus(function () {
        f.busy = Math.max(0, f.busy - 1);   // the visitor's own count: a kiosk reset meanwhile made a new one
        renderIntro();   // before done: game.js closes the scanner and focuses the first button shown
        done({ ok: true, tail: bd ? bd.tail : '', state: introState() });
      });
    });
  }
  function forgetBadge() {
    bd = null; srv.badge = null; spare = '';
    flow = { busy: 0, offline: false };   // a late reply for the old badge leaves this one alone
    hideContact();
    bSave();
    renderIntro();
  }
  function hideContact() { var C = window.CurateContact; if (C) C.hide(); clearTimeout(lockTimer); }
  // A try token: 20 characters the server accepts ([a-z0-9]{16,24}), crypto random where available.
  function newToken() {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '', u = null, i;
    try { u = new Uint8Array(20); window.crypto.getRandomValues(u); } catch (e) { u = null; }
    for (i = 0; i < 20; i++) s += a.charAt((u ? u[i] : Math.floor(Math.random() * 256)) % a.length);
    return s;
  }

  // ---- Begin a round ----
  // Decides whether the next round counts. Badge mode, not for fun: POST start (a try counts when it starts;
  // quitting never refunds it). done({ ok, counted, shiftNo, tries, reason }) or done({ ok: false, error }).
  // tries: the counted tries for the whole event (the server's perBadge in badge mode).
  function funReason() {
    var b = bs();
    if (!can('hash')) return 'nocrypto';
    if (paused()) return 'paused';   // first: with merch paused, a badge wouldn't help
    if (!bd) return 'nobadge';
    if (flow.offline) return 'offline';
    if (b.collected) return 'collected';
    if (b.left === 0) return 'limit';
    return 'fun';   // tries left, but the player picked Play for fun
  }
  function begin(deckId, opts, done) {
    var c, token, hash, r, f;
    done = typeof done === 'function' ? done : function () {};
    if (!ONLINE) {   // v6: spends nothing here; startShift spends the try when the clock starts
      c = canCount();
      done({ ok: true, counted: c.counted, shiftNo: c.next, tries: c.tries, reason: c.reason });
      return;
    }
    if (!(opts && opts.fun) && held()) { renderIntro(); done(begun); return; }
    tok = null; begun = null;
    if (opts && opts.fun) {
      r = { ok: true, counted: false, shiftNo: 0, tries: COUNTED, reason: funReason() };
      if (r.reason === 'offline') refreshStatus(true);   // so the intro and Results show the real tries left
      begun = r;
      done(r);
      return;
    }
    if (!can('hash')) { renderIntro(); done({ ok: false, error: 'nocrypto' }); return; }
    if (!bd) { done({ ok: false, error: 'nobadge' }); return; }
    // An unconfirmed token goes first: the server dedupes, so a start that saved but lost its reply isn't spent twice.
    token = spare = spare || newToken();
    hash = bd.hash;
    f = flow;
    f.busy++; f.offline = false;
    renderIntro();
    post({ action: 'start', badge: hash, token: token, app: deckId || '' }, function (err, j) {
      f.busy = Math.max(0, f.busy - 1);
      // The visitor or the badge changed meanwhile (kiosk reset, Not your badge?): this reply is not theirs.
      if (f !== flow || !bd || bd.hash !== hash) { absorb(j); renderIntro(); done({ ok: false, error: 'nobadge' }); return; }
      if (noAnswer(err, j)) { f.offline = true; renderIntro(); done({ ok: false, error: 'offline' }); return; }
      absorb(j);
      spare = '';
      merge(j);
      bSave();
      if (!j.ok || !j.counted) {   // collected, paused or limit (the intro shows it); a refused start spends nothing
        if (!j.ok) f.offline = true;
        renderIntro();
        done({ ok: false, error: j.ok ? j.reason || 'limit' : j.error || 'offline' });
        return;
      }
      tok = { token: token, tryNo: j.tryNo || 1, hash: hash };
      begun = { ok: true, counted: true, shiftNo: tok.tryNo, tries: j.perBadge || COUNTED, reason: '' };
      renderIntro();
      done(begun);
    });
  }

  // ---- Intro: the start area ----
  // First match wins (spec 3.3). 'locked': the badge has a tier above stickers and no contact yet.
  var jsqrAsked = false;
  function introState() {
    var b = bs();
    if (!ONLINE) return 'v6';
    if (!can('hash')) return 'nocrypto';
    if (flow.offline) return 'offline';
    if (bd && modelB().state === 'locked') return 'locked';
    if (bd && b.collected) return 'collected';
    if (paused()) return 'paused';
    if (bd && b.left === 0 && !held()) return 'left0';
    if (bd) return 'ready';
    if (!can('camera') && (S.badge || {}).typed === false) return 'nocamera';
    return 'nobadge';
  }
  function btn(id, label, cls) {
    var el = $(id);
    if (!el) return;
    el.hidden = !label;
    el.disabled = false;
    if (!label) return;
    el.textContent = label;
    el.className = cls || 'ghost';
  }
  function renderIntro() {
    var sec = $('intro'), s = introState(), b = bs(), line = bd ? 'Badge …' + bd.tail : '', note = '', B = Bdg(),
        more = (b.left > 0 || held()) && !paused(), name = baseTier(modelB().t).name, c,   // the ticket's tier (sold out: lower)
        tryN = ' · Try ' + (held() ? tok.tryNo : Math.min(COUNTED, (b.triesUsed || 0) + 1)) + ' of ' + COUNTED;
    if (!sec || sec.hidden) return;
    ['intro-unlock', 'intro-go', 'intro-scan', 'intro-fun', 'intro-change'].forEach(function (id) { btn(id, ''); });
    if (s === 'v6') {
      line = '';
      c = canCount();
      if (c.reason === 'limit') note = allUsed() + '. This round is for fun.';
      btn('intro-go', 'Start', 'primary');
    } else if (s === 'nocrypto') {
      line = ''; note = 'This browser can’t read badges. Play for fun.';
      btn('intro-fun', 'Play for fun', 'primary');
    } else if (s === 'offline') {
      note = 'Can’t reach the merch list. ' + (bd ? 'Try again' : 'Scan your badge again') + ', or play for fun.';
      if (bd) btn('intro-go', 'Try again', 'primary'); else btn('intro-scan', 'Scan your badge', 'primary');   // no badge: nothing to retry
      btn('intro-fun', 'Play for fun');
      if (bd) btn('intro-change', 'Not your badge?');
    } else if (s === 'locked') {
      if (more) line += tryN;
      note = 'Your ' + name + ' score needs one step.';
      btn('intro-unlock', 'Unlock my ' + name + ' ticket', 'primary');
      if (more) btn('intro-go', 'Start', 'second');
      btn('intro-fun', 'Play for fun');
      btn('intro-change', 'Not your badge?');
    } else if (s === 'collected' || s === 'paused' || s === 'left0') {
      note = s === 'collected' ? 'This badge already got its merch.' : s === 'paused' ? 'Merch is paused right now.' : allUsed() + '.';
      btn('intro-fun', 'Play for fun', 'primary');
      if (bd) btn('intro-change', 'Not your badge?');
    } else if (s === 'ready') {
      if (b.left != null || held()) line += tryN;
      btn('intro-go', 'Start', 'primary');
      btn('intro-fun', 'Play for fun');
      btn('intro-change', 'Not your badge?');
    } else if (s === 'nocamera') {
      note = 'No camera here. Play on the booth tablet, or play for fun.';
      btn('intro-fun', 'Play for fun', 'primary');
    } else {
      note = 'Your Devcon badge gives ' + fmt(COUNTED) + ' tries for merch.';
      btn('intro-scan', 'Scan your badge', 'primary');
      btn('intro-fun', 'Play for fun');
      // iPhones have no BarcodeDetector: fetch the reader while the visitor reads the examples.
      if (!jsqrAsked && B && B.loadJsQR && !can('detector')) { jsqrAsked = true; B.loadJsQR(function () {}); }
    }
    if (flow.busy > 0 && s !== 'v6') {
      note = 'Checking your badge…';
      ['intro-unlock', 'intro-go', 'intro-scan', 'intro-fun', 'intro-change'].forEach(function (id) { var el = $(id); if (el) el.disabled = true; });
    }
    // Pick another app waits too: leaving mid-start would spend a try on a round that never plays.
    c = $('intro-back');
    if (c) c.disabled = flow.busy > 0 && s !== 'v6';
    txt('intro-badge', line);
    vis('intro-badge', !!line);
    txt('intro-note', note);
  }

  // ---- Badge mode: saving the score ----
  // Retries after 3, 6, 12, 24, 48 s, then every 60 s while the page is open (kiosk ones left behind: every 30 s).
  var BACKOFF = [3, 6, 12, 24, 48];
  function sendFinish(p) {
    if (!p || p.busy || p.done) return;
    if (Date.now() - p.t > MAX_SEND) { settle(p, null); return; }
    p.busy = true;
    if (rs.p === p) renderSave();
    post({ action: 'finish', token: p.token, score: p.score, relaxed: p.relaxed, endedBy: p.endedBy }, function (err, j) {
      p.busy = false;
      if (noAnswer(err, j)) {
        p.fails++;
        clearTimeout(p.timer);
        p.timer = setTimeout(function () { sendFinish(p); }, (p.bg ? 30 : BACKOFF[p.fails - 1] || 60) * 1000);
        if (rs.p === p) renderSave();
        return;
      }
      settle(p, j);
    });
  }
  // A reply, saved or refused, ends it (so does 6 h without one). Only the round on Results changes what it shows.
  function settle(p, j) {
    p.done = true;
    clearTimeout(p.timer);
    bg = bg.filter(function (x) { return x !== p; });
    absorb(j);
    if (p.bg) return;
    if (pend === p) pend = null;
    if (j && j.ok && bd && bd.hash === p.hash) merge(j);   // only the badge that started this try
    bSave();
    if (rs.p === p) {
      rs.state = j && j.ok ? 'saved' : 'refused';
      if (j && j.ok && typeof j.tier === 'number') rs.g = j.tier;   // the server's tier wins
    }
    // Wherever the player is now (Play again may have reached the intro first): the new best and contact flag.
    refreshViews();
  }
  function toBackground(p) {
    p.bg = true;
    if (bg.indexOf(p) < 0) bg.push(p);
    if (!p.busy) { clearTimeout(p.timer); p.timer = setTimeout(function () { sendFinish(p); }, 30000); }
  }
  // Back online, or a tap on #rep-retry: send what is waiting now.
  function retryAll() {
    [pend].concat(bg).forEach(function (p) { if (p && !p.done && !p.busy) { clearTimeout(p.timer); sendFinish(p); } });
  }

  // ---- Init and API ----
  var wired = false;
  function on(id, type, fn) { var el = $(id); if (el) el.addEventListener(type, fn); }
  function wire() {
    if (wired) return;
    wired = true;
    on('welcome-go', 'click', showTicket);
    on('to-ticket', 'click', showTicket);
    on('ticket', 'click', onTicketClick);
    on('ticket', 'keydown', onTicketKey);
    on('t-code', 'pointerdown', holdStart);
    on('t-code', 'pointerup', holdEnd);
    on('t-code', 'pointercancel', holdEnd);
    on('t-code', 'lostpointercapture', holdEnd);
    on('t-code', 'contextmenu', function (e) { e.preventDefault(); });   // long-press menus would break the hold
    on('tb-staff-btn', 'click', function (e) { e.stopPropagation(); openStaff(); });
    on('staff-ok', 'click', confirmStaff);
    on('staff-cancel', 'click', function () { closeStaff(); });
    on('undo-btn', 'click', undoCollect);
    on('rep-retry', 'click', retryAll);
    window.addEventListener('online', retryAll);
    // Any way out of Results releases the medal: #report getting hidden, or game.js’s two buttons.
    on('again', 'click', leaveReport);
    on('rep-switch', 'click', leaveReport);
    var rep = $('report');
    if (rep && window.MutationObserver) {
      new MutationObserver(function () { if (rep.hidden) leaveReport(); }).observe(rep, { attributes: true, attributeFilter: ['hidden'] });
    }
    document.addEventListener('keydown', onDocKey);
    document.addEventListener('pointerdown', function () {
      var r = $('report');
      if (KIOSK && r && !r.hidden) armIdle();
    });
    // Back from checking in, from another tab or from the bfcache: re-read and upgrade in place.
    document.addEventListener('visibilitychange', redraw);
    window.addEventListener('pageshow', function (e) { if (e.persisted) redraw(); });   // frozen pages miss 'storage'
    window.addEventListener('storage', function (e) {
      if (!KIOSK && (e.key === KEY || e.key === 'kleros_devcon_self' || e.key === null)) redraw();
    });
  }
  // What the ticket shows; an unchanged ticket is left alone, so a flipped ticket or an open sheet stays put.
  function sig(m) {
    return [m.state, m.t, m.code, m.pending, m.soldFrom, m.best && m.best.at, m.best && (m.best.final || m.best.score),
      m.ci && m.ci.name, paused()].join('|');
  }
  function redraw() {
    var v = $('ticketv'), b = $('brief'), r = $('report'), m;
    if (document.hidden) return;   // a hidden tab catches up when shown, so two tabs never write in turn
    if (v && !v.hidden) {
      m = model();   // model(), canCount() and renderWelcome() each re-read storage first
      if (current && sig(m) === sig(current)) return;
      cancelHold();
      if (staffFor) closeStaff(false);
      renderTicket();
    } else if (b && !b.hidden) { renderHeader(); renderWelcome(); renderLadder(); refreshStatus(false); }   // another tab’s try changes the tries line
    else if (r && !r.hidden && ONLINE) { if (rs.sum) renderLines(); }
    else if (r && !r.hidden) { m = canCount(); txt('again', againText(m)); slot('rep-tries', 'rep-fine', triesText(repSum, m)); }
    else { renderIntro(); if ($('intro') && !$('intro').hidden) refreshStatus(false); }   // back later: the badge's tries, as the server has them
  }
  function init(ui) {
    var noop = function () {};
    ui = ui || {};
    UI = { show: ui.show || noop, say: ui.say || noop, reset: ui.reset || noop };
    load();
    bLoad();
    wire();
    refreshBrief();
    if (pend) sendFinish(pend);   // a round saved on an earlier visit but never sent (under 6 h old)
  }

  window.CurateRewards = {
    init: init, kiosk: KIOSK,
    getPref: getPref, setPref: setPref,
    lastIds: lastIds, saveLastIds: saveLastIds,
    tierInfo: tierInfo, canCount: canCount, model: model,   // model: read by scripts/curate-check.js
    startShift: startShift, finishShift: finishShift,
    showTicket: showTicket, refreshBrief: refreshBrief,
    // Badge mode (spec 4.1): online is false in v6 mode, where begin() only reads canCount().
    online: ONLINE, renderIntro: renderIntro, setBadge: setBadge, forgetBadge: forgetBadge, begin: begin,
    refreshStatus: refreshStatus
  };
})();
