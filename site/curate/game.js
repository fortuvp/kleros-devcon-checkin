// Curate game engine: the app picker, the intro (rule, two example entries, the badge scanner sheet), the round
// and the hand-off to the report. Internal names still say "shift"; only the copy says round. One rAF loop
// drives the clock and drags. rules.js judges, objects.js paints, rewards.js owns storage, the server, the
// intro's start area, report and ticket (never localStorage or the network here; CurateBadge only to scan).
// textContent only.
(function () {
  var S = window.CURATE_SETTINGS, D = window.CURATE_DECKS, R = window.CurateRules;
  var KIOSK = /[?&]kiosk=1\b/.test(location.search);
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var LITE = /[?&]lite=1\b/.test(location.search) || !!(navigator.connection && navigator.connection.saveData);
  var MINUS = '−', GUARD = 120;
  // A double tap's second tap lands ~100–300 ms later on whatever button now sits under the finger.
  var BAR_GUARD = 350;


  // ---- Helpers ----
  function $(id) { return document.getElementById(id); }
  function slot(el, name) { return el.querySelector('[data-s="' + name + '"]'); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return performance.now(); }
  function txt(id, s) { var el = $(id); if (el) el.textContent = s; }
  function show(el, on) { if (typeof el === 'string') el = $(el); if (el) el.hidden = !on; }
  function body(cls, on) { document.body.classList.toggle(cls, !!on); }
  function fmt(n) { return String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return (n < 0 ? MINUS : '+') + fmt(n); }
  function Rw() { return window.CurateRewards; }
  function O() { return window.CurateObjects; }
  // objects.js / rewards.js may be missing (or lag a function) while packages are built apart.
  function ob(fn, a, b, c) { var o = O(); return o && typeof o[fn] === 'function' ? o[fn](a, b, c) : null; }
  function rw(fn, a, b, c) { var r = Rw(); return r && typeof r[fn] === 'function' ? r[fn](a, b, c) : null; }
  function has(fn) { var r = Rw(); return !!(r && typeof r[fn] === 'function'); }
  // Badge mode: rewards.js has a server endpoint (settings server.endpoint); else v6, per phone.
  function online() { return !!(Rw() && Rw().online); }
  // Restarts a one-shot CSS animation class (none under reduced motion, so skip the forced reflow).
  function bump(el, cls) { if (!el || RM) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function focusEl(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  // Parks focus on a non-control (tabindex -1, no ring), so it never drops to <body>.
  function park(id) {
    var el = $(id);
    if (el && !el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); el.style.outline = 'none'; }
    focusEl(el);
  }
  var timers = [];
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

  // ---- Decks ----
  // One deck per app, picked on the title screen. An unknown stored id (v3's travel) falls back to the first.
  function deckIds() { var a = [], k; for (k in D) if (D.hasOwnProperty(k)) a.push(k); return a; }
  function firstDeck() { return deckIds()[0] || ''; }
  // Entries per round for a deck: the sum of its split, else the settings default.
  function deckEntries(d) {
    var n = 0, k, sp = d && d.split;
    if (sp) for (k in sp) if (sp.hasOwnProperty(k)) n += sp[k][0];
    return n || S.entries;
  }

  // ---- State ----
  var deckId = '', deck = null, relaxed = false;
  var mode = 'brief';        // brief | intro | banner | shift | ended
  var run = [], idx = 0, cards = [], score = null, info = null, total = 0;
  var clockOn = false, elapsed = 0, lastT = 0, paused = false;
  var lastDecide = -1e9, landT = -1e9;
  var barT = -1e9;           // when the action bar last swapped (Wrong/Correct <-> Cancel) or a flash went
  var said30 = false, said10 = false;
  var raf = 0, drag = null, press = null, flying = null, keyboard = false;
  var picking = null, pickT = -1e9, pickText = '';   // picking: the top card while in pick mode
  var sayT = 0;
  var announcedTier = 0;     // highest tier shown this shift: re-crossing a threshold stays quiet
  var focusFirst = false;    // focus the next card that lands (after Start), so focus never sits on <body>
  // began: begin()'s answer { counted, shiftNo, perDay, reason }; beginning: one in flight.
  var began = null, beginning = false, beginGen = 0;

  // ---- Views and announcements ----
  var VIEWS = { brief: 'brief', intro: 'intro', play: 'play', report: 'report', ticket: 'ticketv' };
  var curView = '';
  function showView(view) {
    var k, b = document.body;
    // Any view change, timer-driven ones too, shuts How it works and the scanner.
    if (view !== curView) { closeHow(); closeScanner(); }
    if (view !== 'intro') idleOff();
    curView = view;
    for (k in VIEWS) show($(VIEWS[k]), k === view);
    // Keep modifier classes, replace the v-* one.
    b.className = (b.className.replace(/(^|\s)v-\S+/g, '') + ' v-' + view).replace(/^\s+/, '');
    if (view !== 'play') { show('paused', false); body('is-paused', false); }
    // On Results #rep-switch goes back to the app cards (set after rewards.js renders).
    show('deck-switch', false);
    if (view === 'report') { txt('rep-switch', 'Try another app'); show('rep-switch', !KIOSK); }   // kiosk: Next curator only
    // objects.js keeps pause/resume as no-ops: the medal comes and goes with Results (rewards.js).
    ob(view === 'ticket' ? 'pause' : 'resume');
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // The live region re-reads identical text only after it was emptied; texts said together are joined.
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    if (sayT) { el._next += ' ' + text; return; }
    el._next = text;
    el.textContent = '';
    sayT = setTimeout(function () { sayT = 0; el.textContent = el._next; }, 60);
  }
  var ui = { show: showView, say: say, reset: reset };

  // ---- Brief ----
  function setDeck(id) {
    deckId = id && D.hasOwnProperty(id) ? id : firstDeck();
    deck = D[deckId];
  }
  function renderBrief() {
    var rb = $('relaxed'), secs = String(relaxed ? S.relaxedSeconds : S.seconds), metas, i, d;
    // The lead promises the round length (longer with More time).
    txt('brief-lead', 'Each entry is right, or has one error. Spot the errors in ' + secs + ' s.');
    if (rb) {
      rb.textContent = 'More time: ' + (relaxed ? 'On' : 'Off');
      rb.setAttribute('aria-pressed', relaxed ? 'true' : 'false');
    }
    // Every app card promises the round length (longer with More time).
    // The More time button's description follows settings (index.html keeps a static copy for no-script).
    txt('relaxed-note', S.relaxedSeconds + ' seconds instead of ' + S.seconds + '.');
    metas = document.querySelectorAll('#picker .pick');
    for (i = 0; i < metas.length; i++) {
      d = D[metas[i].getAttribute('data-deck')];
      if (d && slot(metas[i], 'meta')) slot(metas[i], 'meta').textContent = deckEntries(d) + ' entries · ' + secs + ' s';
    }
  }
  // ---- App picker ----
  // One card per deck, in CURATE_DECKS order, built at boot. The picture is decoration: a photo, a flag, or a
  // painted logo (pick.coin, or pick.coins for a trio in span.coin-trio).
  function logo(c) {
    var o = {}, k;
    for (k in c) if (c.hasOwnProperty(k)) o[k] = c[k];
    o.shape = 'coin';
    return ob('create', o, { size: 'card' });
  }
  // p: an app card's pick or an example's picture: img (+ pos), flag, coins or coin.
  function picOf(p) {
    var el = null, i, c;
    if (p.img) {
      el = document.createElement('img');
      el.src = p.img; el.alt = ''; el.decoding = 'async'; el.draggable = false;
      if (p.pos) el.style.objectPosition = p.pos;
    } else if (p.flag) el = ob('_flag', p.flag, 240, 160);
    else if (p.coins) {
      el = document.createElement('span');
      el.className = 'coin-trio';
      for (i = 0; i < p.coins.length && i < 3; i++) if ((c = logo(p.coins[i]))) el.appendChild(c);
    } else if (p.coin) el = logo(p.coin);
    if (el) el.setAttribute('aria-hidden', 'true');
    return el;
  }
  function renderPicker() {
    var box = $('picker'), tpl = $('tpl-pick'), ids = deckIds(), i, d, el, pic, ps;
    if (!box || !tpl) return;
    box.textContent = '';
    for (i = 0; i < ids.length; i++) {
      d = D[ids[i]];
      el = tpl.content.firstElementChild.cloneNode(true);
      el.setAttribute('data-deck', ids[i]);
      if (slot(el, 'app')) slot(el, 'app').textContent = (d.pick && d.pick.app) || d.client;
      if (slot(el, 'need')) slot(el, 'need').textContent = (d.pick && d.pick.need) || '';
      if (slot(el, 'sub')) slot(el, 'sub').hidden = true;   // v6: name, need and meta only
      ps = slot(el, 'pic');
      pic = ps ? picOf(d.pick || {}) : null;
      if (pic) ps.appendChild(pic);
      box.appendChild(el);
      // The intro's wrong example (practice[0]) loads while the title is read.
      if (d.practice && d.practice[0]) ob('preload', d.practice[0].obj);
    }
  }
  // A tap on an app card picks it and opens its intro (the rule, two examples, Start).
  function onPick(e) {
    var b = e.target.closest ? e.target.closest('.pick[data-deck]') : null;
    if (!b || mode !== 'brief') return;
    keyboard = e.detail === 0;
    setDeck(b.getAttribute('data-deck'));
    rw('setPref', 'deck', deckId);
    showIntro();
  }
  // ---- Photo credits ----
  // How it works credits every photo. https links only; plain text in kiosk (no docs link there).
  function link(label, href) {
    var a;
    if (KIOSK || !/^https:\/\//.test(href || '')) { a = document.createElement('span'); a.textContent = label; return a; }
    a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
    return a;
  }
  function renderCredits() {
    var ul = $('credits-list'), c = window.CURATE_CREDITS || [], i, li;
    if (!ul) return;
    ul.textContent = '';
    for (i = 0; i < c.length; i++) {
      li = document.createElement('li');
      li.appendChild(document.createTextNode(c[i].subject + ': ' + c[i].author + ', '));
      li.appendChild(link(c[i].license, c[i].licenseUrl));
      li.appendChild(document.createTextNode(', via '));
      li.appendChild(link('Wikimedia Commons', c[i].source));
      ul.appendChild(li);
    }
  }
  // focus: when the control that led here is gone (report, pause overlay, kiosk reset).
  function goBrief(focus) {
    mode = 'brief';
    renderBrief();
    rw('refreshBrief');
    showView('brief');
    if (focus) park('brief-title');
  }
  function toggleRelaxed() {
    relaxed = !relaxed;
    rw('setPref', 'relaxed', relaxed);
    renderBrief();
  }
  // Focus the first visible, enabled control of a list.
  function focusOn(ids) {
    var i, el;
    for (i = 0; i < ids.length; i++) { el = $(ids[i]); if (el && !el.hidden && !el.disabled) { focusEl(el); return; } }
  }

  // ---- Intro ----
  // After an app card or Play again: the rule, one correct and one wrong example from that app (wrong part
  // marked, one-line reason), then rewards.js's start area. No practice: pick mode asks for the wrong part.
  // An example's picture, drawn like an app card's (decoration).
  function exPic(o) {
    return o ? picOf(o.shape === 'photo' ? { img: o.src, pos: o.pos } : o.shape === 'flag' ? { flag: o.flag } : { coin: o }) : null;
  }
  // The tag is tied to the swipe and coloured like the title hints.
  function exCard(item, good) {
    var el = clone('tpl-ex'), list = listOf(item), f = list.fields, rows = slot(el, 'rows'), pic = slot(el, 'pic');
    var tag = slot(el, 'tag'), vals = [], i, key, li, p, arrow;
    el.setAttribute('data-ok', good ? 'true' : 'false');
    for (i = 0; i < f.length; i++) {
      key = f[i][0];
      vals.push(String(item.f[key]));
      if (key === list.objField) continue;   // the picture's part has no text row
      li = document.createElement('li');
      li.setAttribute('data-f', key);
      li.appendChild(document.createElement('span')).textContent = String(item.f[key]);   // the mark sits on the span, the · outside it
      if (!good && item.bad === key) li.className = 'is-bad';
      if (rows) rows.appendChild(li);
    }
    if (pic) {
      p = exPic(item.obj);
      if (p) pic.appendChild(p);
      if (!good && item.bad === list.objField) pic.classList.add('is-bad');
    }
    if (tag) {
      arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = good ? '→' : '←';
      tag.className = 'ex-tag ' + (good ? 'g-r' : 'g-l');
      if (good) { tag.appendChild(document.createTextNode('Correct ')); tag.appendChild(arrow); }
      else { tag.appendChild(arrow); tag.appendChild(document.createTextNode(' Wrong')); }
    }
    fill(el, 'why', good ? (f.length === 4 ? 'All four match.' : 'All parts match.') : item.why || '');
    el.setAttribute('aria-label', (good ? 'Correct example: ' : 'Wrong example: ') + vals.join(', ') +
      (good ? '' : '. ' + (item.why || '')));
    return el;
  }
  function renderExamples() {
    var box = $('intro-ex'), ex = R && typeof R.intro === 'function' ? R.intro(deckId) : null;
    if (!box) return;
    box.textContent = '';
    // A help, never a blocker: without examples the rule still shows.
    try {
      if (ex && ex.good && ex.bad && $('tpl-ex')) { box.appendChild(exCard(ex.good, true)); box.appendChild(exCard(ex.bad, false)); }
    } catch (e) { box.textContent = ''; if (window.console) console.error(e); }
    box.hidden = !box.firstChild;
  }
  function showIntro() {
    var k, first = null;
    freshPlay();
    mode = 'intro'; began = null; beginning = false; beginGen++; score = null; info = null;
    for (k in deck.lists) if (deck.lists.hasOwnProperty(k)) { first = deck.lists[k]; break; }
    txt('intro-kicker', deck.client);
    txt('intro-rule', first ? first.policy : '');
    renderExamples();
    showView('intro');
    park('intro-title');
    idleArm();
    rw('renderIntro');
  }

  // ---- Kiosk idle on the intro ----
  // A tablet left on the intro goes back to the title after kioskIdleMs: no visitor inherits a scanned badge.
  var idleT = 0;
  function idleOff() { if (idleT) clearTimeout(idleT); idleT = 0; }
  function idleArm() {
    idleOff();
    if (!KIOSK || curView !== 'intro') return;
    idleT = setTimeout(function () { idleT = 0; if (curView === 'intro') reset(); }, S.kioskIdleMs || 60000);
  }
  function idleNudge() { if (KIOSK && curView === 'intro') idleArm(); }

  // ---- Starting a round ----
  // rewards.js decides if it counts (badge mode: the server spends the try on Start, never on a scan; v6: at the
  // clock start). Not ok: the intro stays, and rewards.js already says why.
  function begin(fun) {
    var gen;
    if (mode !== 'intro' || beginning) return;
    if (!has('begin')) { began = v6Began(); startFlow(); return; }
    beginning = true;   // set first: the answer may come back synchronously
    gen = ++beginGen;
    rw('begin', deckId, { fun: !!fun }, function (r) {
      if (gen !== beginGen) return;   // an intro since left: rewards.js keeps the try for the next Start
      beginning = false;
      if (mode !== 'intro' || curView !== 'intro') return;   // left meanwhile
      if (r && r.ok) { began = r; startFlow(); }
      else focusOn(['intro-unlock', 'intro-go', 'intro-scan', 'intro-fun']);
    });
  }
  // rewards.js without begin(): canCount()'s answer, spending nothing.
  function v6Began() {
    var c = rw('canCount') || {};
    return { ok: true, counted: !!c.counted, shiftNo: c.next || 0, perDay: c.perDay || S.countedPerDay || 2, reason: c.reason || '' };
  }
  // After a failed start #intro-scan reads Try again: it retries the start.
  function onIntroScan(e) {
    keyboard = e.detail === 0;
    if (online() && /again/i.test(($('intro-scan') || {}).textContent || '')) begin(false); else openScanner();
  }

  // ---- Badge scanner sheet ----
  // A code goes to rewards.js setBadge(), which answers after the badge's status, so the intro shows its state
  // when the sheet closes. Never spends a try. CurateBadge is read at call time (the check harness swaps it).
  var scanner = null, scanGen = 0;
  var NOTBADGE = 'That’s not a Devcon badge code. Use the code on your lanyard badge.';
  var CAM = { nocamera: 'No camera here.', blocked: 'Camera blocked.', noreader: 'Can’t load the scanner.' };
  // badge.typed false: the printed code isn't the QR's id, so only scans count.
  function typedOk() { return !(S.badge && S.badge.typed === false); }
  // The camera and its framing hint come and go together.
  function cam(on) { show('badge-cam', on); show('badge-hint', on); }
  function scanOpen() { var b = $('badge'); return !!(b && !b.hidden); }
  function stopScan() {
    var s = scanner;
    scanner = null; scanGen++;   // the old scan's late callbacks are ignored
    if (s && typeof s.stop === 'function') { try { s.stop(); } catch (e) {} }
  }
  function startScan() {
    var B = window.CurateBadge, gen, over = false, s;
    stopScan();
    gen = scanGen;
    cam(true);
    if (!B || typeof B.scan !== 'function') { scanFailed('noreader'); return; }
    s = B.scan({ video: $('badge-video'), facing: KIOSK ? 'user' : 'environment',
      onCode: function (raw) { over = true; if (gen === scanGen) { scanner = null; useCode(raw, false); } },
      onError: function (kind) { over = true; if (gen === scanGen) { scanner = null; scanFailed(kind); } },
      onReady: function () { if (gen === scanGen) idleArm(); },
      // Not a badge (the poster's QR): say so, the camera keeps reading.
      skip: function (raw) { var no = B.ok && !B.ok(B.id(raw), raw); if (no && gen === scanGen) txt('badge-msg', NOTBADGE); return no; } });
    // Callbacks may run before scan() returns.
    if (!over && gen === scanGen) scanner = s;
  }
  function openScanner() {
    if (curView !== 'intro' || scanOpen()) return;
    show('badge', true);
    show('badge-form', false);
    show('badge-type', typedOk());
    show('badge-cancel', true);
    txt('badge-msg', '');
    if ($('badge-code')) $('badge-code').value = '';
    busyScan(false);
    startScan();
    if (scanOpen()) focusEl($('badge-form') && !$('badge-form').hidden ? $('badge-code') : $('badge-cancel'));
  }
  // Any view change closes it too: no camera off screen, no code kept.
  function closeScanner() {
    stopScan();
    show('badge', false);
    if ($('badge-code')) $('badge-code').value = '';
    txt('badge-msg', '');
  }
  function cancelScanner() {
    closeScanner();
    focusOn(['intro-scan', 'intro-go', 'intro-fun']);
  }
  // Typed codes (decision f): a made-up one only buys rounds the desk never pays out.
  function showForm() {
    stopScan();
    cam(false);
    show('badge-type', false);
    show('badge-form', true);
    focusEl($('badge-code'));
  }
  function scanFailed(kind) {
    if (!scanOpen()) return;
    if (kind === 'hidden') { closeScanner(); return; }
    cam(false);
    kind = CAM[kind] ? kind : 'noreader';
    if (typedOk()) { txt('badge-msg', CAM[kind] + ' Type the code on your badge.'); showForm(); return; }
    txt('badge-msg', kind === 'blocked' ? 'Camera blocked. Allow the camera, or play on the booth tablet.' : CAM[kind] + ' Play on the booth tablet.');
    show('badge-form', false); show('badge-type', false);
    focusEl($('badge-cancel'));
  }
  function busyScan(on) { var b = $('badge-use'); if (b) b.disabled = !!on; }
  function useCode(raw, typed) {
    if (!has('setBadge')) { closeScanner(); return; }
    busyScan(true);
    rw('setBadge', raw, function (r) {
      var c = $('badge-code');
      busyScan(false);
      if (!scanOpen()) return;   // cancelled meanwhile
      if (r && r.error === 'notbadge') {
        txt('badge-msg', NOTBADGE);
        if (!typed) startScan();   // scans skip non-badge codes already (skip below), so this never loops
        else if (c) { focusEl(c); if (c.select) c.select(); }
        return;
      }
      closeScanner();   // ok, nocrypto or else: the intro shows the state
      focusOn(['intro-unlock', 'intro-go', 'intro-fun']);
    });
  }
  function onBadgeForm(e) {
    var c = $('badge-code'), b = $('badge-use');
    e.preventDefault();
    if (b && b.disabled) return;
    useCode(c ? c.value : '', true);
  }
  // A modal sheet: Esc cancels, Tab stays on its visible controls.
  function scanKey(e) {
    var f = $('badge-form'), ids = ['badge-type', 'badge-cancel'], list = [], i, el;
    if (e.key === 'Escape') { e.preventDefault(); cancelScanner(); return; }
    if (e.key !== 'Tab') return;
    if (f && !f.hidden) ids = ['badge-code', 'badge-use'].concat(ids);
    for (i = 0; i < ids.length; i++) { el = $(ids[i]); if (el && !el.hidden) list.push(el); }
    if (list.length) trapTab(e, list);
  }

  // ---- Privacy notice ----
  // Links to #curate-privacy open the <details> in place (readable on the booth tablet too).
  function onDocClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#curate-privacy"]') : null, d = $('curate-privacy');
    if (!a || !d) return;
    e.preventDefault();
    d.open = true;
    try { d.scrollIntoView({ block: 'start', behavior: RM ? 'auto' : 'smooth' }); } catch (err) { d.scrollIntoView(); }
    focusEl(d.querySelector('summary'));
  }
  // ---- Cards ----
  function listOf(item) { return deck.lists[item.list]; }
  function labelOf(item, key) {
    var f = listOf(item).fields, i;
    for (i = 0; i < f.length; i++) if (f[i][0] === key) return f[i][1];
    return key;
  }
  function listWord(item) { var n = listOf(item).name; return /list$/i.test(n) ? n : n + ' list'; }
  function clone(id) { return $(id).content.firstElementChild.cloneNode(true); }
  // A template slot the v6 shell may have dropped (or kept hidden): writes to it are harmless.
  function fill(el, name, s) { var x = slot(el, name); if (x) x.textContent = s; }
  function makeCard(item, n, of) {
    var el = clone('tpl-card'), list = listOf(item), rows = slot(el, 'rows'), objSlot = slot(el, 'obj');
    var i, key, li, b, v, obj;
    el._item = item; el._n = n; el._of = of;
    fill(el, 'list', list.name);
    fill(el, 'n', n + '/' + of);
    for (i = 0; i < list.fields.length; i++) {
      key = list.fields[i][0]; v = String(item.f[key]);
      if (key === list.objField) continue;   // the picture is that field: no text row for it
      li = clone('tpl-row'); b = li.querySelector('.row');
      b.setAttribute('data-f', key);
      b.setAttribute('aria-label', list.fields[i][1] + ': ' + v);
      b.setAttribute('tabindex', '-1');          // a part takes focus and taps only in pick mode
      b.setAttribute('aria-disabled', 'true');   // not `disabled`: it can block the pointerdown that starts a swipe
      slot(li, 'lab').textContent = list.fields[i][1];
      slot(li, 'val').textContent = v;
      rows.appendChild(li);
    }
    obj = ob('create', item.obj, { size: 'card' });
    if (!obj) { obj = document.createElement('div'); obj.className = 'obj'; obj.setAttribute('aria-hidden', 'true'); }
    objSlot.appendChild(obj);
    el._obj = obj;
    // The picture is the objField's part; its text is only its accessible name.
    if (list.objField) {
      objSlot.setAttribute('data-f', list.objField);
      objSlot.setAttribute('role', 'img');   // a button only in pick mode; keeps its aria-label readable
      objSlot.setAttribute('aria-label', labelOf(item, list.objField) + ': ' + item.f[list.objField]);
    }
    return el;
  }
  function cardLabel(el) {
    var item = el._item, f = listOf(item).fields, s = 'Entry ' + el._n + ' of ' + el._of + ', ' + listWord(item) + '. ', i;
    for (i = 0; i < f.length; i++) s += f[i][1] + ': ' + item.f[f[i][0]] + '. ';
    el.setAttribute('aria-label', s + 'Correct or wrong?');
  }

  // ---- Stack ----
  // cards[0] is the top card and sits last in the DOM; back cards are inserted behind it.
  function restack() {
    var i, c;
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      c.classList.toggle('is-top', i === 0);
      c.classList.toggle('is-back1', i === 1);
      c.classList.toggle('is-back2', i === 2);
      // Back cards are out of reach for focus, pointers and screen readers.
      if (i > 0) { c.setAttribute('aria-hidden', 'true'); c.setAttribute('inert', ''); }
      else { c.removeAttribute('aria-hidden'); c.removeAttribute('inert'); }
    }
  }
  function fillStack() {
    var stack = $('stack'), el;
    while (cards.length < 3 && idx + cards.length < run.length) {
      el = makeCard(run[idx + cards.length], idx + cards.length + 1, run.length);
      stack.insertBefore(el, stack.firstChild);
      cards.push(el);
    }
    preload(idx + cards.length, 1);
    restack();
  }
  // Loads run[from..from+n-1]'s photos ahead, so no card lands blank.
  function preload(from, n) {
    var i, o;
    for (i = from; i < from + n && i < run.length; i++) {
      o = run[i] && run[i].obj;
      if (o && o.shape === 'photo') ob('preload', o);
    }
  }
  function clearStack() {
    finishFly();
    cards = [];
    $('stack').textContent = '';
    ob('live', null);
  }
  // A new top card: the progress follows it (the hidden v5 list row too, harmlessly).
  function topLanded() {
    var top = cards[0], item;
    if (!top) return;
    item = top._item;
    landT = now();
    txt('list-name', listOf(item).name);
    txt('policy', listOf(item).policy);
    if (mode === 'shift') txt('prog', top._n + '/' + top._of);
    cardLabel(top);
    ob('state', top._obj, 'pending');
    if (!flying) ob('live', top._obj);
    // Focus waits for the flash, so the card's label does not talk over the spoken verdict.
    if (keyboard || focusFirst) {
      focusFirst = false;
      afterFlash(function () { if (cards[0] === top && !paused) focusEl(top); });
    }
  }

  // ---- Pick mode ----
  // Wrong points at the wrong part: the card springs back, its parts (picture, then rows) get badges 1–4,
  // and a tap or key decides. Cancel or Esc leaves. Outside pick mode a tap on a part does nothing.
  function parts(card) {
    var out = [], pic = slot(card, 'obj'), rows = card.querySelectorAll('.row[data-f]'), i;
    if (pic && pic.hasAttribute('data-f')) out.push(pic);
    for (i = 0; i < rows.length; i++) out.push(rows[i]);
    return out;
  }
  // The action bar is one Cancel button while picking. A real swap is stamped so a double tap's
  // second tap cannot hit the button that just appeared under the finger.
  function pickButtons(on) {
    var c = $('b-cancel');
    if (c && c.hidden === on) barT = now();   // only when the bar actually changes (reset paths call this too)
    show('b-cancel', on);
    show('b-chal', !on);
    show('b-keep', !on);
  }
  // Pointer clicks on the action bar wait out a swap; keyboard clicks (detail 0) never wait.
  function barTap(e) { return e.detail !== 0 && now() - barT < BAR_GUARD; }
  function enterPick() {
    var top = cards[0], ps, i, names = [], b, a = document.activeElement;
    if (!top || picking || !canPlay() || now() - lastDecide < GUARD || now() - landT < GUARD) return false;
    ps = parts(top);
    if (!ps.length) return false;
    picking = top; pickT = now();
    for (i = 0; i < ps.length; i++) {
      ps[i].setAttribute('data-n', String(i + 1));
      ps[i].setAttribute('aria-keyshortcuts', String(i + 1));
      ps[i].removeAttribute('aria-disabled');
      if (ps[i].tagName === 'BUTTON') ps[i].removeAttribute('tabindex');   // all four parts join the tab order
      else { ps[i].setAttribute('role', 'button'); ps[i].setAttribute('tabindex', '0'); }   // the picture
      names.push((i + 1) + ' ' + labelOf(top._item, ps[i].getAttribute('data-f')));
    }
    top.classList.add('picking');
    body('is-picking', true);
    b = slot(top, 'pick');
    if (b) {
      if (!pickText) pickText = b.textContent;
      b.textContent = keyboard ? 'What’s wrong? Press 1–' + ps.length + '.' : pickText;
    }
    ob('state', top._obj, 'challenge');
    pickButtons(true);
    say('Pick the wrong part: ' + names.join(', ') + '. Escape cancels.');   // the banner says the question
    // Focus never stays on a hidden button.
    if (keyboard) focusEl(ps[0]);
    else if (a === $('b-chal') || a === $('b-keep')) focusEl(top);
    return true;
  }
  // refocus: a cancel (the card stays), not a decision.
  function exitPick(refocus) {
    var c = picking, a = document.activeElement, ps, i;
    body('is-picking', false);
    pickButtons(false);
    if (!c) return;
    picking = null;
    ps = parts(c);
    for (i = 0; i < ps.length; i++) {
      ps[i].removeAttribute('data-n');
      ps[i].removeAttribute('aria-keyshortcuts');
      if (ps[i].tagName === 'BUTTON') { ps[i].setAttribute('tabindex', '-1'); ps[i].setAttribute('aria-disabled', 'true'); }
      else { ps[i].setAttribute('role', 'img'); ps[i].removeAttribute('tabindex'); }   // inert again
    }
    c.classList.remove('picking');
    if (!refocus) return;
    contest(c, false);
    if (keyboard) focusEl(c);
    else if (a === $('b-cancel') || (a && c.contains(a))) focusEl($('b-chal'));
  }
  function cancelPick() {
    if (!picking) return;
    exitPick(true);
    say('Cancelled.');
  }
  // A tap or key on a part: Wrong, pointing at that part.
  function choosePart(key) {
    if (!picking || picking !== cards[0] || !key || now() - pickT < GUARD) return;
    decide('challenge', key);
  }
  // ---- HUD ----
  // Under the opaque flash a bump is unseen and forces a reflow in the flash's first frame: play it as the flash lifts.
  function bumpScore() { bump($('score-v'), 'bump'); }
  function hudScore(raw) {
    var sv = $('score-v'), pips = document.querySelectorAll('#streak i'), segs = document.querySelectorAll('#meter i');
    var t = S.tiers, on = score ? score.streak % S.points.streakEvery : 0, i, k;
    if (sv && sv.textContent !== (raw < 0 ? MINUS : '') + fmt(raw)) {
      sv.textContent = (raw < 0 ? MINUS : '') + fmt(raw);
      if (!flashOn) bumpScore(); else if (flashQ.indexOf(bumpScore) < 0) flashQ.push(bumpScore);
    }
    for (i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < on);
    for (i = 0; i < segs.length; i++) {
      k = +segs[i].getAttribute('data-t') || i + 1;
      segs[i].style.setProperty('--f', String(clamp((raw - t[k - 1]) / (t[k] - t[k - 1]), 0, 1)));
    }
  }
  function hudClock(leftMs) {
    var secs = Math.max(0, Math.ceil(leftMs / 1000)), arc = $('clock-arc'), ck = $('clock');
    if (arc) arc.style.strokeDashoffset = String(Math.round((1 - clamp(leftMs / (total * 1000), 0, 1)) * 1000) / 10);
    if (secs !== hudClock.s) { hudClock.s = secs; txt('clock-s', String(secs)); }
    if (ck) ck.classList.toggle('low', clockOn && secs <= 10);
  }

  // ---- Toasts ----
  // v6: only the rare end-of-round note. t = { tone: good|info, title, line, ms }
  function toast(t) {
    var box = $('toasts'), el;
    if (!box || !$('tpl-toast')) return;
    el = clone('tpl-toast');
    el.setAttribute('data-tone', t.tone || 'info');
    fill(el, 'title', t.title);
    if (t.line && slot(el, 'line')) { fill(el, 'line', t.line); slot(el, 'line').hidden = false; }
    box.textContent = '';
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, t.ms || 1800);
  }

  // ---- Flash ----
  // v6 §2: after every decision #flash covers the view, green ✓ CORRECT or red ✗ WRONG with the points and one
  // line. The round clock stops while it shows; a tap or any key skips it (not in the first FLASH_MIN ms, so
  // the second tap of a double tap does not swallow the feedback). Calls queued with afterFlash run when it goes.
  var FLASH_MS = { good: 650, soft: 1400, bad: 1400 }, FLASH_MIN = 250;
  var flashOn = false, flashT0 = 0, flashTimer = 0, flashQ = [];
  function flashEl(cls) { var f = $('flash'); return f ? f.querySelector('.' + cls) : null; }
  function flashSet(cls, s) { var x = flashEl(cls); if (x) x.textContent = s; }
  // f = { tone, pts, line, extra }
  function flash(f) {
    var el = $('flash'), ms = FLASH_MS[f.tone] || 650;
    if (!el) return;
    killFlash();
    el.setAttribute('data-tone', f.tone);
    el.hidden = false;   // un-hiding restarts the CSS scale-in, even when two flashes follow each other
    flashSet('fl-icon', f.tone === 'bad' ? '✗' : '✓');
    flashSet('fl-word', f.tone === 'bad' ? 'WRONG' : 'CORRECT');
    flashSet('fl-pts', f.pts);
    flashSet('fl-line', f.line || '');
    flashSet('fl-extra', f.extra || '');
    // #flash is shown and filled in one task, which screen readers rarely announce; #say carries the verdict (word first).
    say((f.tone === 'bad' ? 'Wrong.' : 'Correct.') + ' ' + f.pts + ' points.' + (f.line ? ' ' + f.line.replace(/\.?$/, '.') : '') +
      (f.extra ? ' ' + f.extra.split(' · ').join('. ') + '.' : ''));
    if (f.extra && f.tone === 'good') ms += 350;   // a streak or a tier needs a beat to read
    flashOn = true; flashT0 = now();
    flashTimer = setTimeout(endFlash, ms);
  }
  // Hides the flash and runs what waited for it.
  function endFlash() {
    var q = flashQ, i, c = ['fl-icon', 'fl-word', 'fl-pts', 'fl-line', 'fl-extra'];
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = 0;
    show('flash', false);
    for (i = 0; i < c.length; i++) flashSet(c[i], '');
    if (!flashOn) return;
    flashOn = false; flashQ = [];
    landT = now();   // the card under the flash takes taps only after the guard
    barT = landT;    // a tap meant for the flash (a double tap's second) must not hit Wrong/Correct underneath
    while (q.length) q.shift()();
  }
  // A view change drops the flash and its queue.
  function killFlash() { flashQ = []; flashOn = false; endFlash(); }
  function afterFlash(fn) { if (flashOn) flashQ.push(fn); else fn(); }
  function skipFlash() { if (flashOn && now() - flashT0 >= FLASH_MIN) endFlash(); }
  // A part's label inside a sentence: 'the web domain', 'the photo'.
  function partName(item, key) { return labelOf(item, key).toLowerCase(); }
  // A picture's fix is a description ('White marble dome…'), so mid-sentence it starts lower case; names keep theirs.
  function fixText(item) {
    var x = item.fix;
    return item.bad === listOf(item).objField ? x.charAt(0).toLowerCase() + x.slice(1) : x;
  }
  // The flash for an outcome (rules.js judge). Points come from settings so the copy follows any retune.
  function verdict(o, item, picked) {
    var f = { tone: o.correct ? 'good' : 'bad', pts: signed(o.points), line: '' };
    if (o.kind === 'catch') {
      if (o.evidence === 'sharp') f.line = 'You spotted the ' + partName(item, picked);
      else if (o.evidence === 'wrong') { f.tone = 'soft'; f.line = 'The wrong part was the ' + partName(item, item.bad) + (item.fix ? ': ' + fixText(item) : '') + '.'; }
    } else if (o.kind === 'wrongChallenge') f.line = 'This one was real.';
    else if (o.kind === 'leak') f.line = item.why || '';
    return f;
  }
  // Chrome logs an intervention error for vibrate() before the first tap (e.g. keyboard-only play).
  function buzz(p) {
    var ua = navigator.userActivation;
    if (RM || !navigator.vibrate || (ua && !ua.hasBeenActive)) return;
    try { navigator.vibrate(p); } catch (e) {}
  }
  // ---- Decisions ----
  var OBJ_STATE = { catch: 'rejected', listed: 'listed', wrongChallenge: 'overruled', leak: 'leak' };
  // action: challenge (pick mode, with the part) | letThrough. False when refused (the caller springs back).
  function decide(action, picked) {
    var top = cards[0], t = now(), item, o, res, f, extra = [], ti, a = document.activeElement, held;
    if (!top || paused || flashOn) return false;
    if (mode !== 'shift' || t - lastDecide < GUARD) return false;
    if (action === 'challenge' ? picking !== top || !picked : !!picking) return false;
    lastDecide = t;
    // The departing card goes inert: focus in it (a tapped part), or on <body> after a pick (Safari never
    // focuses a tapped button), follows the stack.
    held = top.contains(a) || (action === 'challenge' && (!a || a === document.body));
    if (picking) exitPick(false);
    if (held) focusFirst = true;   // topLanded() focuses the next card
    item = top._item;
    o = R.judge(item, action, picked);
    res = R.apply(score, item, o);
    f = verdict(o, item, picked);
    // The streak bonus and a new tier ride in the same flash.
    if (res.streakBonus) extra.push(signed(res.streakBonus) + ' streak');
    if (res.tierTo > announcedTier) {
      ti = rw('tierInfo', res.tierTo);
      // A just-for-fun round announces no unlock; only a v6 tablet caps at kioskMaxTier (decision j).
      if (ti && info && info.counted && !(KIOSK && !online() && res.tierTo > S.kioskMaxTier)) extra.push(ti.name + ' unlocked');
      announcedTier = res.tierTo;
    }
    f.extra = extra.join(' · ');
    flash(f);
    hudScore(score.raw);
    if (!o.correct) buzz([20, 40, 20]); else if (o.kind === 'catch') buzz(12);
    fly(top, action === 'challenge' ? -1 : 1, o);
    advance();
    if (held && !cards[0]) park('play');   // last card: nothing lands, so focus waits on #play until Results takes it
    return true;
  }
  function advance() {
    cards.shift(); idx++;
    if (mode === 'shift' && idx >= run.length) { endShift('done'); return; }
    fillStack(); topLanded();
  }
  // Fly-out rides the compositor. The next card is already top, so input stays live (buffered).
  function fly(el, dir, o) {
    finishFly();
    if (drag && drag.card === el) drag = null;
    el.classList.remove('dragging', 'spring');
    el.removeAttribute('data-drag');
    el.style.setProperty('--sk', '0'); el.style.setProperty('--sc', '0');
    edges(0, 0);
    ob('state', el._obj, OBJ_STATE[o.kind]);
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', '');
    // fly-* carries the 240 ms exit (a fade under reduced motion) from where the drag left it.
    el.classList.add(dir < 0 ? 'fly-left' : 'fly-right');
    flying = { el: el, t: setTimeout(finishFly, RM ? 130 : 250) };
  }
  // Ends (or fast-forwards) a fly-out; the new top card's picture goes live.
  function finishFly() {
    var f = flying;
    if (!f) return;
    flying = null;
    clearTimeout(f.t);
    ob('live', cards[0] ? cards[0]._obj : null);
    if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
  }

  // ---- Shift flow ----
  function banner(text, ms, then) {
    var b = $('banner');
    if (b) { b.textContent = text; b.hidden = false; }
    later(function () { if (b) b.hidden = true; if (then) then(); }, ms);
  }
  function freshPlay() {
    clearTimers(); stopLoop();
    exitPick(false);   // a card left in pick mode goes with the stack; the action bar comes back
    clearStack();
    drag = null; paused = false; clockOn = false;
    body('is-paused', false);
    show('paused', false); show('banner', false);
    killFlash();
    if ($('toasts')) $('toasts').textContent = '';
    edges(0, 0);
  }
  // Intro Start (begin() answered) → mission banner → Go → round.
  function startFlow() {
    var k;
    freshPlay();
    total = relaxed ? S.relaxedSeconds : S.seconds;
    hudClock.s = -1;
    txt('client-name', deck.client);
    // The HUD shows this app's list while the banners run, not the last app's.
    for (k in deck.lists) if (deck.lists.hasOwnProperty(k)) { txt('list-name', deck.lists[k].name); txt('policy', deck.lists[k].policy); break; }
    if (!began) began = v6Began();   // a start that skipped the intro (the hidden #start)
    showView('play');
    focusFirst = true;   // the first card that lands takes focus
    beginShift();
  }
  function beginShift() {
    freshPlay();
    mode = 'banner';
    // The banner has no control: focus waits on #play, then moves to the first card when it lands.
    park('play'); focusFirst = true;
    run = R.buildRun(deckId, rw('lastIds', deckId) || []).items; idx = 0;
    rw('saveLastIds', deckId, run.map(function (x) { return x.id; }));
    score = R.newScore(); announcedTier = 0; info = null; elapsed = 0;
    said30 = said10 = false;
    hudScore(0); hudClock(total * 1000);
    txt('prog', '1/' + run.length);
    preload(0, 4);   // the stack's three and the next, while the banners show
    // The app's mission for 900 ms, then Go.
    if (deck.copy && deck.copy.mission) { say(deck.copy.mission); banner(deck.copy.mission, 900, go); } else go();
  }
  // The Go banner names the counted try from begin()'s answer; a v6 booth tablet just says Go.
  function goText() {
    var b = began, per = (b && b.perDay) || S.countedPerDay || 2;
    if (!b || b.reason === 'kiosk') return 'Go!';
    if (!b.counted) return 'Just for fun · Go!';
    return 'Try ' + (b.shiftNo || 1) + ' of ' + per + ' · Go!';
  }
  function go() {
    var g;
    if (mode !== 'banner') return;
    g = goText();
    say(g);
    banner(g, 900, function () {
      // The clock starts when the first real card lands; the shift counts from here.
      mode = 'shift';
      info = rw('startShift', deckId) || { counted: false, shiftNo: 0, code: null };
      clockOn = true;
      fillStack(); topLanded();
      if (document.hidden) pause(); else startLoop();
    });
  }
  // by: time | done | quit. The card on screen at time-out is discarded: not reviewed, not a leak.
  function endShift(by) {
    var left, fb, d = drag, pc = picking;
    if (mode !== 'shift') return;
    left = Math.max(0, total * 1000 - elapsed);
    // The discarded card drops its drag pose and pick mode.
    if (d) { drag = null; if (d.on) springBack(d.card); else edges(0, 0); }
    exitPick(false);
    if (pc) contest(pc, false);
    mode = 'ended'; clockOn = false;
    fb = R.finish(score, left / 1000, idx >= run.length, relaxed);
    hudScore(score.raw);
    if (by === 'done') {
      // After the last card's flash. Same conditions as R.finish(): few mistakes and enough wrong parts spotted.
      afterFlash(function () {
        var tooMany = score.mistakes > S.points.bonusMaxMistakes, noEv = score.evidence < (S.points.bonusMinEvidence || 0);
        if (!tooMany && !noEv) toast({ tone: 'good', ms: 1300, title: 'All done · ' + signed(fb.timeBonus) + ' time bonus' });
        else toast({ tone: 'info', ms: 2200, title: 'All done', line: 'Time bonus needs ' +
          (tooMany ? S.points.bonusMaxMistakes + ' mistakes or fewer.' : 'one wrong part spotted.') });
        later(function () { handOff(by); }, 1300);
      });
    } else if (by === 'time') {
      if (cards[0]) cards[0].setAttribute('inert', '');
      banner('Time’s up', 700, function () { handOff(by); });
    } else handOff(by);
  }
  function handOff(by) {
    var s = score, i = info || {};
    var sum = { deck: deckId, counted: !!i.counted, shiftNo: i.shiftNo || 0, code: i.code || null, relaxed: relaxed,
                endedBy: by, final: s.final, raw: s.raw, timeBonus: s.timeBonus || 0, reviewed: s.reviewed,
                entries: run.length, caught: s.caught, fakesSeen: s.fakesSeen, listed: s.listed, goodsSeen: s.goodsSeen,
                evidence: s.evidence, wrong: s.wrong, leaks: s.leaks, trust: s.trust, bestStreak: s.bestStreak,
                misses: s.misses, at: Date.now(),
                // why a round was just for fun (rewards.js reads it only here)
                reason: i.counted ? '' : (i.reason || (began && began.reason) || '') };
    freshPlay();
    mode = 'ended';
    say('Round over. ' + fmt(s.final) + ' points.');
    if (Rw()) Rw().finishShift(sum); else goBrief(true);
  }
  // Kiosk "next curator", and a clean slate: back to the brief with fresh state.
  function reset() {
    freshPlay();
    mode = 'brief'; score = null; info = null; run = []; idx = 0; began = null; beginning = false; beginGen++;
    if (KIOSK) { relaxed = false; setDeck(firstDeck()); } else loadPrefs();
    closeHow(); closeScanner(); idleOff();
    goBrief(true);
  }
  // A How it works sheet left open must not cover the next title screen.
  function closeHow() {
    var h = $('how');
    if (!h || !h.hasAttribute('open')) return;
    if (h.close) { try { h.close(); } catch (e) { h.removeAttribute('open'); } } else h.removeAttribute('open');
  }

  // ---- Loop ----
  // One rAF loop while playing; it stops when paused, hidden or off play, so paused time never counts.
  function startLoop() {
    if (raf || paused || document.hidden) return;
    lastT = 0;
    raf = requestAnimationFrame(tick);
  }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function tick(t) {
    var dt;
    raf = 0;
    if (paused || document.hidden || !/^(banner|shift)$/.test(mode)) return;
    dt = lastT ? Math.min(t - lastT, 1000) : 0;
    lastT = t;
    if (drag && drag.dirty) dragFrame();
    // The clock also stops under the flash (v6 §2: fair play, and the sim's timing stays valid).
    if (mode === 'shift' && clockOn && !flashOn) { elapsed += dt; shiftFrame(); }
    if (!raf && /^(banner|shift)$/.test(mode)) raf = requestAnimationFrame(tick);
  }
  // Only the round clock runs: no per-card window, no auto-listing, no rush toast.
  function shiftFrame() {
    var left = total * 1000 - elapsed;
    hudClock(left);
    if (!said30 && left <= 30000) { said30 = true; say('30 seconds left'); }
    if (!said10 && left <= 10000) { said10 = true; say('10 seconds left'); }
    if (left <= 0) endShift('time');
  }
  // ---- Gestures ----
  // Pointer Events on #stack. Taps stay native clicks (rows are real buttons); a drag starts past 8 px of
  // mostly horizontal travel and captures the pointer. Moves are batched into the rAF loop. In pick mode a press
  // is only tracked, never dragged.
  function canPlay() { return mode === 'shift' && !paused && !flashOn; }
  function onDown(e) {
    var top = cards[0], t = now();
    keyboard = false;
    if (drag && !drag.on) drag = null;   // a press whose release we never saw (it ended off the stack)
    if (e.button > 0 || drag || !top || !canPlay() || !top.contains(e.target)) return;
    drag = { id: e.pointerId, card: top, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, on: false, left: false,
             dirty: false, buf: [[t, e.clientX]], pick: picking === top };
    press = { moved: false };
  }
  function onMove(e) {
    var d = drag, t = now();
    if (!d || e.pointerId !== d.id) return;
    // A mouse/pen press whose release we never saw (it ended off #stack): hover moves must not drag.
    if (e.pointerType !== 'touch' && !e.buttons) { drag = null; if (d.on) springBack(d.card); return; }
    d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
    if (Math.abs(d.dx) > 8 || Math.abs(d.dy) > 8) press.moved = true;
    if (d.pick) return;   // swipes are off while picking
    d.buf.push([t, e.clientX]);
    while (d.buf.length > 2 && t - d.buf[0][0] > 80) d.buf.shift();
    if (!d.on && Math.abs(d.dx) > 8 && Math.abs(d.dx) > Math.abs(d.dy)) {
      d.on = true;
      d.card.classList.remove('spring');
      d.card.classList.add('dragging');
      try { $('stack').setPointerCapture(d.id); } catch (err) {}
    }
    if (d.on) { d.dirty = true; if (e.cancelable) e.preventDefault(); }
  }
  // Velocity over the last 80 ms only, so a flick that paused before release does not commit.
  function velocity(buf, t) {
    var b = buf.filter(function (p) { return t - p[0] <= 80; }), a, z;
    if (b.length < 2) return 0;
    a = b[0]; z = b[b.length - 1];
    return (z[1] - a[1]) / Math.max(1, z[0] - a[0]);
  }
  function onUp(e) {
    var d = drag, t = now(), vx, ax;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (!d.on) return;   // a tap or a vertical nudge: the click handler decides
    vx = velocity(d.buf, t); ax = Math.abs(d.dx);
    if (d.card === cards[0] && (ax > 0.28 * d.card.offsetWidth || (Math.abs(vx) > 0.55 && ax > 40 && (vx < 0) === (d.dx < 0)))) {
      // Left (Wrong): the card springs back to the centre and asks what's wrong. Right: Correct.
      if (d.dx < 0) { springBack(d.card); enterPick(); return; }
      if (decide('letThrough')) return;
    }
    springBack(d.card);
  }
  // pointercancel (a system gesture) and lost capture spring back, so nothing stays stuck mid-drag.
  function onCancel(e) {
    var d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (press) press.moved = true;
    if (d.on) springBack(d.card);
  }
  // Only in pick mode does a tap on a part do anything: it decides the challenge with that part.
  function onClick(e) {
    var f = e.target.closest ? e.target.closest('[data-f]') : null, top = cards[0];
    if (!picking || picking !== top || !f || !top.contains(f) || !canPlay()) return;
    // A pointer click counts as a tap only under 8 px of travel; keyboard clicks (detail 0) always count.
    if (e.detail !== 0 && press && press.moved) return;
    if (e.detail === 0) keyboard = true;
    choosePart(f.getAttribute('data-f'));
  }
  function dragFrame() {
    var d = drag, c = d.card, dx = d.dx, ax = Math.abs(dx), s = String(clamp((ax - 24) / 66, 0, 1)), g = Math.min(0.55, ax / 220);
    d.dirty = false;
    if (!d.on || c !== cards[0]) return;
    c.style.transform = 'translate3d(' + dx + 'px,' + d.dy * 0.15 + 'px,0)' + (RM ? '' : ' rotate(' + clamp(dx / 22, -16, 16) + 'deg)');
    c.setAttribute('data-drag', dx < 0 ? 'left' : 'right');
    c.style.setProperty('--sk', dx > 0 ? s : '0');
    c.style.setProperty('--sc', dx < 0 ? s : '0');
    edges(dx < 0 ? g : 0, dx > 0 ? g : 0);
    ob('tilt', c._obj, clamp(dx / 4, -35, 35), clamp(d.dy / 10, -15, 15));
    if ((dx < -24) !== d.left) { d.left = dx < -24; contest(c, d.left); }
  }
  // While dragged left the picture reads as being marked wrong.
  function contest(c, on) { ob('state', c._obj, on ? 'challenge' : 'pending'); }
  function edges(l, r) {
    var a = $('edge-l'), b = $('edge-r');
    if (a) a.style.opacity = String(l);
    if (b) b.style.opacity = String(r);
  }
  function springBack(c) {
    if (!c || !c.parentNode) return;
    c.classList.remove('dragging');
    c.removeAttribute('data-drag');
    c.classList.add('spring');
    c.style.transform = '';
    c.style.setProperty('--sk', '0'); c.style.setProperty('--sc', '0');
    edges(0, 0);
    ob('tilt', c._obj, 0, 0);
    contest(c, false);
    setTimeout(function () { c.classList.remove('spring'); }, 320);
  }

  // ---- Keyboard and buttons ----
  // ←/A Wrong, →/D Correct, Esc/P pause. Pick mode: 1–4 or Enter on a part picks it, Esc cancels.
  function onKey(e) {
    var k = e.key, top = cards[0], a = document.activeElement, part;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (scanOpen()) { scanKey(e); return; }   // the badge scanner sheet (intro only) takes the keys first
    // Any key skips the flash and does nothing else (Tab still moves focus).
    if (flashOn) { if (k !== 'Tab') { e.preventDefault(); if (!e.repeat) skipFlash(); } return; }
    if (!/^(banner|shift)$/.test(mode)) return;
    if ($('err') && !$('err').hidden) return;
    // A held key acts once: no decision bursts, no pause/resume flicker, no evidence flicker.
    if (e.repeat && k !== 'Tab') {
      if (/^(ArrowLeft|ArrowRight|Escape|Enter|Spacebar|[ aAdDpP])$/.test(k)) e.preventDefault();
      return;
    }
    // The pause overlay takes the keys first.
    if (paused) {
      if (k === ' ' || k === 'Spacebar' || k === 'Escape') { e.preventDefault(); resume(); }
      else if (k === 'Tab') trapTab(e, [$('resume'), $('end-shift')]);
      return;
    }
    if (picking && picking === top) {
      if (k === 'Escape') { e.preventDefault(); keyboard = true; cancelPick(); return; }
      if (/^[1-9]$/.test(k)) {
        keyboard = true;
        part = top.querySelector('[data-n="' + k + '"]');
        if (part && canPlay()) choosePart(part.getAttribute('data-f'));
        return;
      }
      // The picture is a div, role=button only while picking (the rows are real buttons).
      if ((k === 'Enter' || k === ' ' || k === 'Spacebar') && a && a.tagName !== 'BUTTON' && a.hasAttribute('data-f') && top.contains(a)) {
        e.preventDefault(); keyboard = true; choosePart(a.getAttribute('data-f'));
        return;
      }
      if (/^(ArrowLeft|ArrowRight|[aAdD])$/.test(k)) { e.preventDefault(); return; }
    }
    if (k === 'Escape' || k === 'p' || k === 'P') { e.preventDefault(); keyboard = true; pause(); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); keyboard = true; enterPick(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); keyboard = true; decide('letThrough'); }
  }
  function trapTab(e, list) {
    var i = list.indexOf(document.activeElement);
    e.preventDefault();
    i = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
    if (list[i]) list[i].focus();
  }
  function on(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); }
  function wire() {
    var st = $('stack');
    // The v4 shell keeps #start hidden; the app cards open the intro, whose Start begins the round.
    on('start', function (e) { keyboard = e.detail === 0; if (mode === 'brief') showIntro(); });
    on('picker', onPick);
    on('relaxed', toggleRelaxed);
    // Intro: rewards.js shows, labels and disables these.
    on('intro-go', function (e) { keyboard = e.detail === 0; begin(false); });
    on('intro-fun', function (e) { keyboard = e.detail === 0; begin(true); });
    on('intro-scan', onIntroScan);
    on('intro-change', function () { rw('forgetBadge'); openScanner(); });   // Not your badge?
    on('intro-unlock', function () { rw('showTicket'); });   // the locked ticket, its contact step
    on('intro-back', function () { goBrief(true); });
    on('badge-type', function () { txt('badge-msg', ''); showForm(); });
    on('badge-cancel', cancelScanner);
    if ($('badge-form')) $('badge-form').addEventListener('submit', onBadgeForm);
    on('b-chal', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; enterPick(); });
    on('b-keep', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; decide('letThrough'); });
    on('b-cancel', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; cancelPick(); });
    on('pause', function (e) { keyboard = e.detail === 0; pause(); });
    on('resume', resume);
    on('end-shift', endFromPause);
    on('flash', skipFlash);
    on('err-reload', function () { location.reload(); });
    // Play again: the same app's intro (badge, tries left); kiosk: Next curator.
    on('again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else showIntro(); });
    on('rep-switch', function () { if (KIOSK) reset(); else goBrief(true); });
    on('t-switch', function () { goBrief(true); });
    on('t-again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else showIntro(); });
    if (st) {
      st.addEventListener('pointerdown', onDown);
      st.addEventListener('pointermove', onMove);
      st.addEventListener('pointerup', onUp);
      st.addEventListener('pointercancel', onCancel);
      // Only #stack's own capture loss counts: handing a touch's implicit capture over fires it at the child.
      st.addEventListener('lostpointercapture', function (e) { if (e.target === st) onCancel(e); });
      st.addEventListener('click', onClick);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', onDocClick);
    document.addEventListener('pointerdown', idleNudge);
    document.addEventListener('keydown', idleNudge);
    document.addEventListener('input', idleNudge);
  }
  // ---- Pause ----
  // No clock pause in standard play except this overlay: the clock and animations freeze (pick mode stays).
  function pause() {
    var d = drag;
    if (paused || mode !== 'shift') return;
    endFlash();   // the next card waits under the pause overlay instead
    paused = true;
    stopLoop();
    if (d) { drag = null; if (d.on) springBack(d.card); }
    body('is-paused', true);
    show('paused', true);
    show('paused-note', mode === 'shift' && !!(info && info.counted));
    ob('pause');
    if ($('resume')) $('resume').focus();
  }
  function resume() {
    if (!paused) return;
    paused = false;
    body('is-paused', false);
    show('paused', false);
    ob('resume');
    startLoop();   // resets lastT, so the paused time never counts
    if (cards[0]) cards[0].focus();
  }
  // Ending from the pause overlay still uses a counted shift.
  function endFromPause() {
    if (!paused) return;
    paused = false;
    body('is-paused', false);
    show('paused', false);
    ob('resume');
    if (mode === 'shift') endShift('quit');
    else { freshPlay(); goBrief(true); }
  }
  function onVisibility() {
    if (document.hidden) { if (mode === 'shift') pause(); else stopLoop(); }
    else startLoop();
  }

  // ---- Boot ----
  function loadPrefs() {
    setDeck(rw('getPref', 'deck'));
    relaxed = !!rw('getPref', 'relaxed');
  }
  function showErr() {
    var el = $('err');
    if (!el) return;
    el.hidden = false;
    if ($('err-reload')) $('err-reload').focus();
  }
  // Keyboard help: each control names its key.
  function keyHelp() {
    var k = { 'b-chal': 'ArrowLeft A', 'b-keep': 'ArrowRight D', 'b-cancel': 'Escape', pause: 'P Escape' }, id;
    for (id in k) if (k.hasOwnProperty(id) && $(id)) $(id).setAttribute('aria-keyshortcuts', k[id]);
  }
  function boot() {
    body('rm', RM); body('lite', LITE); body('is-kiosk', KIOSK);
    if (!S || !D || !R || !$('tpl-card')) throw new Error('Curate: a module or template is missing');
    keyHelp();
    window.CurateGame = { show: showView, reset: reset, intro: showIntro };
    rw('init', ui);
    ob('init', { reduced: RM, lite: LITE });
    loadPrefs();
    renderPicker();
    renderCredits();
    wire();
    goBrief();
  }
  // Errors during boot (here or in the deferred scripts before DOMContentLoaded) show #err.
  var booting = true;
  window.onerror = function () { if (booting) showErr(); };
  document.addEventListener('DOMContentLoaded', function () { booting = false; });
  try { boot(); } catch (e) { showErr(); if (window.console) console.error(e); }
})();
