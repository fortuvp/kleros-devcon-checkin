// Curate game rewards: prize strip, counted rounds, the report and the live merch ticket.
// The only reader of kleros_devcon_self (never written here) and the only writer of kleros_devcon_curate.
// No network calls. User data reaches the DOM through textContent only.
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
  var PER_DAY = S.countedPerDay || 3;
  function isSoldOut(i) { return i > 0 && (S.soldOut || []).indexOf(NAMES[i]) > -1; }
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
  // Mirrors index.html’s returning-visitor gate (:1567-1569) and tierOf() (:1131).
  // merchOf() is never called or copied: it mutates the record.
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function checkin() {
    if (KIOSK) return null;
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
    return { v: 1, deck: (firstDeck() || {}).id || '', relaxed: false, practiced: {}, lastIds: {}, day: today(), counted: 0,
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
    rollDay();
  }
  function save() {
    if (KIOSK || !st) return;
    if (store(KEY, st) !== true) blocked = true;
  }
  // Another tab, or this page back from the bfcache, may have written since this page last read. Every entry
  // point re-reads storage and saves in the same task, so a stale copy never overwrites newer shifts or a stamp.
  function sync() {
    if (KIOSK || blocked) { if (!st) load(); return; }   // kiosk and blocked browsers: the memory copy is the truth
    load();
  }
  // A new local day: counted shifts and today’s best start again; collected, prefs and lastIds stay.
  function rollDay() {
    var t = today();
    if (st.day === t) return false;
    st.day = t; st.counted = 0; st.best = null;
    save();
    return true;
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
  function canCount() {
    sync();
    if (KIOSK) return { counted: true, left: 1, reason: 'kiosk' };
    rollDay();
    if (st.collected) return { counted: false, left: 0, reason: 'collected' };
    if (st.counted >= PER_DAY) return { counted: false, left: 0, reason: 'limit' };
    return { counted: true, left: PER_DAY - st.counted, reason: '' };
  }
  // Called when the clock starts, so quitting does not refund the shift.
  function startShift(deckId) {
    var c = canCount(), r = { counted: c.counted, shiftNo: 0, code: null };
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
    me = read('kleros_devcon_self');
    a.href = '/';
    a.textContent = me && me.ticket ? 'Your check-in ticket →' : 'Booth check-in →';
  }
  // The first matching line wins (§1.3 S1); nothing relevant hides the chip.
  function renderWelcome() {
    var m = model(), ci = m.ci, best = st.best, line = '', go = '', n;
    if (!KIOSK) {
      if (st.collected) line = 'Merch collected. Play for fun.';
      else if (ci && ci.claimed) line = 'You already checked in at the booth, so your merch goes with that check-in. Play for fun.';
      else if (best && m.state === 'live' && m.t > 0) { line = 'Your ' + baseTier(m.t).name + ' ticket is ready ·'; go = 'Show staff →'; }
      else if (best) { line = 'Your best today: ' + fmt(best.final) + ' pts ·'; go = 'Show ticket →'; }
      else if (st.counted >= PER_DAY) line = fmt(PER_DAY) + ' of ' + fmt(PER_DAY) + ' rounds counted today. Play for fun, or come back tomorrow.';
      else if (ci && ci.ok && ci.tier > 0 && ci.tier < 3) {
        n = ci.tier + 1;
        line = 'You’re checked in: ' + baseTier(ci.tier).name + '. Score ' + fmt(TIERS[n]) + ' to move up to ' + baseTier(n).name + '.';
      }
    }
    vis('welcome', !!line);
    txt('welcome-text', line);
    if (vis('welcome-go', !!go)) txt('welcome-go', go);
  }
  // A chip’s short line: points, or what the tier needs on top.
  function ladderHow(i) {
    var info = tierInfo(i);
    if (info.soldOut) return 'Gone today';
    if (i === 0) return 'Finish a round';
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
        tx = make('span', 'chip-txt'), b = make('b'), im,
        sr = info.reward + (info.soldOut ? ': gone today, scores here get ' + info.short : '') +
          (KIOSK && i > kioskCap() ? ': play on your own phone' : '');
    if (KIOSK && i > kioskCap()) li.className += ' is-locked';   // out of the tablet’s reach
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
    var list = $('ladder-list'), i;
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      for (i = 0; i < 4; i++) list.appendChild(chip(i));
    }
    // Brief copy leads with the one-item rule; skip it only when the configured merch note already says it, so it never repeats or disappears.
    var once = /one item per person/i.test(MERCH.note || '');
    // A booth tablet has no "best of 3": every round is the next visitor.
    if (KIOSK) txt('ladder-fine', 'Booth tablet: one round per visitor, up to Teal. Play on your own phone for Purple and Gold.');
    else txt('ladder-fine', (once ? 'From the game or check-in, your' : 'One item per person, from the game or check-in: your') +
        ' best tier counts. Your best of ' + fmt(PER_DAY) + ' rounds today counts.' + (MERCH.note ? ' ' + MERCH.note + '.' : ''));
  }
  function refreshBrief() {
    leaveReport();
    stopTicket();
    clearTimeout(idleTimer);
    if (KIOSK) st = null;   // a booth tablet: every return to the brief is the next visitor
    sync();
    renderHeader(); renderWelcome(); renderLadder();
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
    rollDay();
    sum = sum || {};
    var run = {}, k, old = st.best, nb, oldT;
    for (k in sum) if (sum.hasOwnProperty(k)) run[k] = sum[k];
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
    renderReport(run, sum.misses);   // the stored run keeps only 3 misses; the report counts them all
    UI.show('report');
    mountMedal();
    var h = $('rep-title');
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    countUp(run.final || 0);
    armIdle();
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
  function markerAt(p) {
    var i = tierFor(p);
    if (TIERS.length < 4) return 0;
    if (i >= 3) return Math.min(1, 0.75 + 0.25 * (p - TIERS[3]) / Math.max(1, TIERS[3] - TIERS[2]));
    return (i + (p - TIERS[i]) / Math.max(1, TIERS[i + 1] - TIERS[i])) / 4;
  }
  function renderMeter(final, g) {
    var meter = $('rep-meter'), segs, labs, i, mk = $('rep-marker');
    if (meter) {
      segs = meter.querySelectorAll('i[data-t]');
      for (i = 0; i < segs.length; i++) {
        var t = +segs[i].getAttribute('data-t');
        segs[i].setAttribute('data-tier', t <= g ? NAMES[t] : 'none');   // reached segments take their tier colour
        if (KIOSK && t > kioskCap()) segs[i].setAttribute('data-locked', ''); else segs[i].removeAttribute('data-locked');
      }
    }
    if (mk) mk.style.setProperty('--at', String(Math.max(0, markerAt(final)).toFixed(4)));
    labs = $('rep-meter-labels');
    if (labs) for (i = 0; i < labs.children.length && i < 4; i++) labs.children[i].textContent = fmt(TIERS[i]);
  }
  function renderMisses(misses) {
    var n = misses.length, det = vis('rep-missed', n > 0), list = $('rep-misses'), tpl = $('tpl-miss');
    if (!det) return;
    txt('rep-missed-sum', 'What you missed (' + n + ')');
    det.open = n >= 1 && n <= 3;
    if (!list || !tpl || !tpl.content) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    misses.slice(0, 3).forEach(function (m) {
      var li = tpl.content.firstElementChild.cloneNode(true), leak = m.kind === 'leak', line = li.querySelector('.m-line');
      function set(s, v) { var el = li.querySelector('[data-s="' + s + '"]'); if (el) el.textContent = v || ''; }
      set('kind', leak ? 'Fake listed' : 'Good entry challenged');
      if (leak) { set('lab', m.fieldLabel); set('was', m.shown); set('is', m.fix); } else if (line) line.hidden = true;
      set('name', m.name);
      set('why', m.why);
      list.appendChild(li);
    });
  }
  // A stat tile: the figure goes in its <b> when the shell has one; otherwise no-break spaces keep it whole.
  function stat(id, label, v) {
    var el = $(id), b = el && el.querySelector('b');
    if (b) b.textContent = v; else txt(id, label + ' ' + v.replace(/ /g, '\u00a0'));
  }
  // Headline, quote and payoff follow the trust band (≥90 / 70–89 / <70) and come from the app’s deck copy.
  // App-neutral lines cover a deck that lacks one, so no app shows another app’s story.
  var HEADLINES = ['Clean list. Users are safe.', 'Mostly clean. A few fakes slipped in.', 'Leaky list. Fakes reached users.'];
  var PAYOFFS = ['{client} kept {trust}% of its users’ trust, so they keep using it and it keeps earning.',
    '{client} kept {trust}% of its users’ trust. Each fake that got listed cost it users.',
    '{client} lost users’ trust (down to {trust}%): fakes reached them, and it stops earning until the list is clean.'];
  var QUOTES = ['“Our users only saw real entries today. Come back tomorrow?”',
    '“A few fakes got through. We filed removal requests.”',
    '“Fakes reached our users. We’re pausing the list until it’s clean.”'];
  function band3(list, fb, band) { var s = list && list[band]; return s ? String(s) : fb[band]; }
  function fill(s, d, trust) { return String(s).split('{client}').join(d.client || '').split('{trust}').join(String(trust)); }
  // Ranks by tier when no check-in name; settings.js wins when it has them.
  var RANKS = ['Rookie spotter', 'Sharp eye', 'Eagle eye', 'Master curator'];
  function againText(c) {
    return KIOSK ? 'Next curator' : c.reason === 'collected' || c.left === 0 ? 'Play again for fun' :
      'Play again · ' + c.left + ' of ' + PER_DAY + ' counted rounds left today';
  }
  function renderReport(sum, misses) {
    var d = deckOf(sum.deck), copy = d.copy || {}, trust = sum.trust == null ? 100 : sum.trust,
        band = trust >= 90 ? 0 : trust >= 70 ? 1 : 2, final = sum.final || 0, ci = checkin(),
        g0 = tierFor(final), g = g0, info, next = '', c = canCount(), pending;
    if (KIOSK) g = Math.min(g, kioskCap());
    repTier = g;   // the medal shows the tier this round earns here (capped on a booth tablet)
    txt('rep-kicker', 'Results · ' + d.client + (sum.counted ? '' : ' · Practice round: not counted today'));
    txt('rep-title', band3(copy.headlines, HEADLINES, band));
    txt('rep-sub', fmt(sum.reviewed) + ' of ' + fmt(sum.entries || S.entries || sum.reviewed) + ' entries reviewed');
    stat('rep-caught', 'Fakes caught', fmt(sum.caught) + ' of ' + fmt(sum.fakesSeen));
    stat('rep-listed', 'Good entries listed', fmt(sum.listed) + ' of ' + fmt(sum.goodsSeen));
    stat('rep-evidence', 'Sharp evidence', fmt(sum.evidence));
    stat('rep-wrong', 'Wrong challenges', fmt(sum.wrong));
    txt('rep-quote', fill(band3(copy.quotes, QUOTES, band), d, trust));
    txt('rep-quote-by', copy.quoteBy || (d.client ? d.client + ' (fictional)' : ''));
    txt('rep-payoff', fill(band3(copy.payoffs, PAYOFFS, band), d, trust) +
        (sum.caught > 1 ? ' Your bounties came from the fakers’ deposits.' :
         sum.caught ? ' Your bounty came from the faker’s deposit.' : ' Catch a fake and its deposit becomes your bounty.'));
    renderMeter(final, g);
    info = tierInfo(g);
    if (g < 3 && !(KIOSK && g >= (kioskCap()))) {
      next = ' ' + fmt(TIERS[g + 1] - final) + ' points to ' + baseTier(g + 1).name + '.';
    }
    // The marker stays at the real score, so say why a kiosk score above the cap gets the cap’s reward.
    if (KIOSK && g0 > g) next = ' The booth tablet tops out at ' + baseTier(g).name + '. Play on your own phone for ' + kioskAbove() + '.';
    // A duplicate check-in already holds this person's one item, so the score names no reward.
    txt('rep-tier-line', ci && ci.claimed ? 'Merch goes with your first check-in. Play for fun.' : tierTitle(g) + ' · ' + info.reward + '.' + next);
    thumbs($('rep-thumbs'), ci && ci.claimed ? [] : info.img);
    // The strip shows only when this counted round earned a gated tier that a check-in would unlock.
    pending = sum.counted && !KIOSK && g >= NEED && !(ci && (ci.ok || ci.claimed)) && !st.collected && !isSoldOut(g) ? g : 0;
    renderGold('rep-gold', 'rep-gold-go', pending, ci);
    renderMisses([].concat(misses || sum.misses || []));
    txt('to-ticket', 'Show my merch ticket');
    txt('again', againText(c));
    txt('rep-switch', 'Try another app');   // game.js wires it back to the title screen
    txt('rep-fine', 'Points are for booth merch, not real money. Real challenge windows last days; here you get seconds.' +
        (MERCH.note ? ' ' + MERCH.note + '.' : ''));
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (!KIOSK) return;
    idleTimer = setTimeout(function () { var r = $('report'); if (r && !r.hidden) kioskReset(); }, S.kioskIdleMs || 60000);
  }

  // ---- Ticket model ----
  // §3.4: one item per person, so the ticket shows max(game tier, check-in tier) once the gates are applied.
  function tierFor(p) {
    if (window.CurateRules && CurateRules.tierFor) return CurateRules.tierFor(p);
    for (var i = TIERS.length - 1; i > 0; i--) if (p >= TIERS[i]) return i;
    return 0;
  }
  function lastCountedRun() {
    for (var i = st.runs.length - 1; i >= 0; i--) if (st.runs[i].counted) return st.runs[i];
    return null;
  }
  function model() {
    sync();
    rollDay();
    var ci = checkin(), best = st.best, m = { state: 'live', ci: ci, best: best, t: 0, g: 0, pending: 0,
      source: 'game', soldFrom: -1, code: '' }, g, c, t;
    if (st.collected) { m.state = 'collected'; m.t = st.collected.tier || 0; m.code = st.collected.code || ''; return m; }
    if (ci && ci.claimed) { m.state = 'dup'; return m; }
    if (!best || best.day !== today()) { m.state = 'expired'; m.best = best || lastCountedRun(); return m; }
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
    if (KIOSK) return 'Booth tablet: play on your own phone for ' + kioskAbove() + '.';
    if (m.t === 0) return 'Show this screen at the booth for ' + tierInfo(0).short + '. Score ' +
      fmt(TIERS[1]) + ' for ' + tierInfo(1).short + '.';
    return 'Show this screen at the booth to claim your merch';
  }
  function noteFor(m) {
    var from;
    if (blocked) return 'This browser won’t keep your ticket if you close it.';
    if (m.soldFrom > 0) {   // no generated plural: rewards read 'Copper bottle or gamcha', 'Kleros flip-flops'
      from = baseTier(m.soldFrom);
      return from.reward + ': gone for today. Your ' + from.name + ' score gets ' + tierInfo(m.t).short + '.';
    }
    return m.source === 'checkin' ? 'From your check-in' : 'From your round';
  }
  function renderBack(m) {
    var b = m.best, ci = m.ci, live = m.state === 'live', staff = live && !KIOSK && m.t > 0;   // Everyone: nothing to stamp
    txt('tb-shift', !b ? '' : (KIOSK ? '' : 'Round ' + (b.shiftNo || 1) + ' of ' + PER_DAY + ' today · ') +
        'Played ' + hhmm(b.at) + ' · ' + deckOf(b.deck).client);
    txt('tb-stats', !b ? '' : fmt(b.final) + ' pts · ' + fmt(b.caught) + ' of ' + fmt(b.fakesSeen) + ' fakes · ' +
        fmt(b.evidence) + ' sharp evidence · trust ' + (b.trust == null ? 100 : b.trust) + '%');
    txt('tb-code', !b || !live ? '' : 'Game code ' + (b.code || '') + (ci && ci.ok ? ' · Check-in ' + ci.ticket : ''));
    vis('tb-staff', staff);
    txt('tb-staff', 'Staff: hold the code for ' + Math.round((S.staffHoldMs || 2000) / 1000) +
        ' seconds, or use the button below, to mark as collected.');
    if (vis('tb-staff-btn', staff)) txt('tb-staff-btn', 'Mark as collected');
  }
  function renderTicket() {
    var m = model(), ci = m.ci, b = m.best, live = m.state === 'live', tk = $('ticket'), info = tierInfo(m.t),
        thanks = 'Thanks for curating. Play again for fun.', who, ck;
    current = m;
    if (tk) {
      tk.setAttribute('data-tier', live ? NAMES[m.t] : m.state === 'expired' ? 'expired' : 'claimed');
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
      txt('t-hint', ci && ci.ok ? thanks : 'Thanks for curating. One item per person, check-in included. Play again for fun.');
      txt('t-note', '');
    } else if (m.state === 'checkin') {
      txt('t-tier', 'Your merch comes with your check-in ticket');
      txt('t-reward', 'One item per person: show your check-in ticket at the booth.');
      txt('t-hint', thanks); txt('t-note', '');
    } else if (m.state === 'dup') {
      txt('t-tier', 'Merch goes with your first check-in');
      txt('t-reward', 'This email or Telegram account already checked in at the booth, so its merch belongs to that ' +
          'check-in. One item per person.');
      txt('t-hint', thanks); txt('t-note', '');
    } else {
      txt('t-tier', 'From a previous day'); txt('t-reward', ''); txt('t-hint', 'Play a round for today’s ticket.');
      txt('t-note', '');
    }
    vis('t-note', !!($('t-note') || {}).textContent);
    // The check-in name only when its gate passes; otherwise a rank earned by the score.
    who = ci && ci.ok && ci.name ? ci.name : (S.ranks || RANKS)[b ? tierOf(b) : 0] || '';
    txt('t-who', who);
    txt('t-org', b ? fmt(b.final) + ' pts · ' + fmt(b.caught) + ' of ' + fmt(b.fakesSeen) + ' fakes caught' : '');
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
    txt('t-again', KIOSK ? 'Next curator' : 'Play again');   // matches #again on the report
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

  // ---- Ticket mechanics: clock, flip, hold, staff sheet, undo, kiosk ----
  var clockTimer = 0, renderedDay = '', nextLeft = 0, undoTimer = 0, staffPrev = null, staffFor = null;
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
    if (today() !== renderedDay) { renderedDay = today(); renderTicket(); }   // past midnight: no live ticket
    tickClock();
    if (KIOSK) {
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
    var tk = $('ticket');   // the button that led here is gone, so focus never drops to <body>
    if (tk) { try { tk.focus({ preventScroll: true }); } catch (e) { tk.focus(); } }
    renderedDay = today();
    nextLeft = Math.round((S.kioskResetMs || 20000) / 1000);
    if (KIOSK) txt('t-next', 'Next curator in ' + nextLeft + ' s');
    clockTimer = setInterval(onTick, 1000);
  }
  function kioskReset() {
    leaveReport();
    stopTicket();
    clearTimeout(idleTimer);
    st = null;   // the next visitor starts clean
    UI.reset();
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
    if (!el || KIOSK || !current || current.state !== 'live' || !(current.t > 0) || (e.button && e.button > 0)) return;
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
    if (KIOSK) return;
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
    return [m.state, m.t, m.code, m.pending, m.soldFrom, m.best && m.best.at, m.ci && m.ci.name].join('|');
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
    } else if (b && !b.hidden) { renderHeader(); renderWelcome(); }
    else if (r && !r.hidden) txt('again', againText(canCount()));
  }
  function init(ui) {
    var noop = function () {};
    ui = ui || {};
    UI = { show: ui.show || noop, say: ui.say || noop, reset: ui.reset || noop };
    load();
    wire();
    refreshBrief();
  }

  window.CurateRewards = {
    init: init, kiosk: KIOSK,
    getPref: getPref, setPref: setPref,
    lastIds: lastIds, saveLastIds: saveLastIds,
    tierInfo: tierInfo, canCount: canCount, model: model,   // model: read by scripts/curate-check.js
    startShift: startShift, finishShift: finishShift,
    showTicket: showTicket, refreshBrief: refreshBrief
  };
})();
