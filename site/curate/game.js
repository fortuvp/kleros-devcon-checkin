// Curate game engine: the app picker, practice, the round and the hand-off to the report. Internal names still
// say "shift"; only the copy says round. One rAF loop drives the clock and drags. rules.js judges, objects.js
// paints, rewards.js owns storage, report and ticket (never localStorage here). textContent only.
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
  // Calls into objects.js / rewards.js, which may be missing while packages are built apart.
  function ob(fn, a, b, c) { var o = O(); return o && typeof o[fn] === 'function' ? o[fn](a, b, c) : null; }
  function rw(fn, a, b) { var r = Rw(); return r ? r[fn](a, b) : null; }
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
  var mode = 'brief';        // brief | practice | between | banner | shift | ended
  var run = [], idx = 0, cards = [], score = null, info = null, total = 0;
  var clockOn = false, elapsed = 0, lastT = 0, paused = false;
  var lastDecide = -1e9, landT = -1e9;
  var barT = -1e9;           // when the action bar last swapped (Wrong/Correct <-> Cancel) or a flash went
  var said30 = false, said10 = false;
  var raf = 0, drag = null, press = null, flying = null, keyboard = false;
  var picking = null, pickT = -1e9, pickText = '';   // picking: the top card while in pick mode
  var pStep = 0, pT0 = 0, pHinted = false;
  var sayT = 0;
  var announcedTier = 0;     // highest tier shown this shift: re-crossing a threshold stays quiet
  var focusFirst = false;    // focus the next card that lands (after Start), so focus never sits on <body>
  var practiceNext = false;  // Practice again: one practice card before the next app picked

  // ---- Views and announcements ----
  var VIEWS = { brief: 'brief', play: 'play', report: 'report', ticket: 'ticketv' };
  var curView = '';
  function showView(view) {
    var k, b = document.body;
    // Any view change, timer-driven ones included, shuts a How it works sheet left open.
    if (view !== curView) closeHow();
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
  // rewards.js answers any practiced.* key with "practised any app on this phone" (never in kiosk).
  function practised() { return !KIOSK && !!rw('getPref', 'practiced.any'); }
  function renderBrief() {
    var rb = $('relaxed'), secs = String(relaxed ? S.relaxedSeconds : S.seconds), metas, i, d, pa;
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
    show('practice-again', practised());
    pa = $('practice-again');
    if (pa) pa.setAttribute('aria-pressed', practiceNext ? 'true' : 'false');
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
  function pickPic(d) {
    var p = d.pick || {}, el = null, i, c;
    if (p.img) {
      el = document.createElement('img');
      el.src = p.img; el.alt = ''; el.decoding = 'async'; el.draggable = false;
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
      pic = ps ? pickPic(d) : null;
      if (pic) ps.appendChild(pic);
      box.appendChild(el);
      // First visit (and kiosk): the practice photo loads while the title screen is read.
      if (!practised() && d.practice && d.practice[0]) ob('preload', d.practice[0].obj);
    }
  }
  // A tap on an app card picks it and starts (practice first the first time, or when armed).
  function onPick(e) {
    var b = e.target.closest ? e.target.closest('.pick[data-deck]') : null, p;
    if (!b || mode !== 'brief') return;
    keyboard = e.detail === 0;
    setDeck(b.getAttribute('data-deck'));
    rw('setPref', 'deck', deckId);
    p = practiceNext;
    practiceNext = false;
    startFlow(p);
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
    if (mode === 'practice') {
      if (pStep !== 0) return false;
      if (!top._item.bad) { coach(P_REAL); return false; }
    }
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
    if (mode === 'practice') { pT0 = now(); pHinted = false; coach('Now tap the wrong part.'); }
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
      ps[i].classList.remove('hint');
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
    if (mode === 'practice') practiceCard();
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
    if ((mode !== 'shift' && mode !== 'practice') || t - lastDecide < GUARD) return false;
    if (action === 'challenge' ? picking !== top || !picked : !!picking) return false;
    lastDecide = t;
    // The departing card goes inert: focus in it (a tapped part), or on <body> after a pick (Safari never
    // focuses a tapped button), follows the stack.
    held = top.contains(a) || (action === 'challenge' && (!a || a === document.body));
    if (picking) exitPick(false);
    if (held) focusFirst = true;   // topLanded() focuses the next card
    if (mode === 'practice') { f = practiceDecide(top, action, picked); if (f && held) park('play'); return f; }
    item = top._item;
    o = R.judge(item, action, picked);
    res = R.apply(score, item, o);
    f = verdict(o, item, picked);
    // The streak bonus and a new tier ride in the same flash.
    if (res.streakBonus) extra.push(signed(res.streakBonus) + ' streak');
    if (res.tierTo > announcedTier) {
      ti = rw('tierInfo', res.tierTo);
      // A just-for-fun round earns no merch, so it announces no unlock.
      if (ti && info && info.counted && !(KIOSK && res.tierTo > S.kioskMaxTier)) extra.push(ti.name + ' unlocked');
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

  // ---- Practice ----
  // One untimed card that cannot be failed: a wrong move springs it back with a coach line. It is the deck's
  // first practice item, a fake (a good one teaches Correct). pStep is 0 while it is live.
  var P_REAL = 'This one is real. Tap ✓ Correct.';
  // The ✓/✗ glyphs are hidden from screen readers, which read the word after them anyway.
  function coach(s) {
    var el = $('coach'), parts = String(s).split(/([\u2713\u2717])/), i, sp;
    if (!el) return;
    el.textContent = '';
    for (i = 0; i < parts.length; i++) {
      if (i % 2) { sp = document.createElement('span'); sp.setAttribute('aria-hidden', 'true'); sp.textContent = parts[i]; el.appendChild(sp); }
      else if (parts[i]) el.appendChild(document.createTextNode(parts[i]));
    }
  }
  function pItem() { return (deck.practice || [])[0] || {}; }
  // The 4 s idle hint (v6 §6): the list's policy, else the item's own hint, the deck's coach.fact or its why.
  function coachFact() {
    var p = pItem(), l = p.list && deck.lists[p.list];
    return (l && l.policy) || p.hint || (deck.coach || {}).fact || p.why || '';
  }
  function practiceCard() {
    pT0 = now(); pHinted = false;
    coach(pItem().bad ? 'Something here is wrong. Tap ✗ Wrong.' : P_REAL);
  }
  // After 4 s idle in pick mode the wrong part pulses and the coach gives the hint.
  function practiceFrame(t) {
    var top = cards[0], marks, i;
    if (pStep !== 0 || pHinted || !top || picking !== top || !top._item.bad || t - pT0 < 4000) return;
    pHinted = true;
    marks = top.querySelectorAll('[data-f="' + top._item.bad + '"]');
    for (i = 0; i < marks.length; i++) marks[i].classList.add('hint');
    coach(coachFact());
  }
  function practiceDecide(top, action, picked) {
    var item = top._item, o;
    if (pStep !== 0) return false;
    if (item.bad && action !== 'challenge') { coach('Look again. Something here is wrong.'); return false; }
    if (!item.bad && action === 'challenge') { coach(P_REAL); return false; }
    o = R.judge(item, action, picked);
    flash(verdict(o, item, picked));
    if (o.kind === 'catch') buzz(12);
    fly(top, action === 'challenge' ? -1 : 1, o);
    pStep = 1;
    coach(o.evidence === 'wrong' ? 'Almost. That’s how it works.' : 'Nice. That’s how it works.');
    cards.shift(); idx++;   // empty arena until the round
    endPractice(true);
    return true;
  }
  function startPractice() {
    mode = 'practice';
    run = (deck.practice || []).slice(0, 1); idx = 0; pStep = 0; score = null;
    if (!run.length) { beginShift(); return; }
    body('is-practice', true);
    show('practice-bar', true); show('coach', true);
    txt('prog', '');   // practice is not one of the 10
    hudScore(0); hudClock(total * 1000);
    fillStack(); topLanded(); practiceCard();
    startLoop();
  }
  // Practice counts as done once on this phone, for every app; kiosk never stores it. After the flash the
  // coach line stays a moment, then the round starts.
  function endPractice(done) {
    if (!KIOSK) rw('setPref', 'practiced.any', true);
    mode = 'between';
    if (done) afterFlash(function () { later(beginShift, 1200); }); else beginShift();
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
    body('is-paused', false); body('is-practice', false);
    show('paused', false); show('banner', false);
    killFlash();
    if ($('toasts')) $('toasts').textContent = '';
    edges(0, 0);
  }
  // App card → (practice) → round. Practice: first time on this phone, when armed, always in kiosk.
  function startFlow(forcePractice) {
    var k;
    freshPlay();
    total = relaxed ? S.relaxedSeconds : S.seconds;
    hudClock.s = -1;
    txt('client-name', deck.client);
    // The HUD shows this app's list while practice or the banners run, not the last app's.
    for (k in deck.lists) if (deck.lists.hasOwnProperty(k)) { txt('list-name', deck.lists[k].name); txt('policy', deck.lists[k].policy); break; }
    showView('play');
    focusFirst = true;   // Start is gone: the first card that lands takes focus
    if (forcePractice || !practised()) startPractice(); else beginShift();
  }
  function beginShift() {
    freshPlay();
    mode = 'banner';
    // The banner has no control: focus waits on #play, then moves to the first card when it lands.
    park('play'); focusFirst = true;
    show('practice-bar', false); show('coach', false);
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
  // v6 §4: the Go banner says which counted try this is (rewards.js counts; startShift spends it below).
  function goText() {
    var c = rw('canCount'), per = (c && c.perDay) || S.countedPerDay || 2;
    if (!c || c.reason === 'kiosk') return 'Go!';
    if (!c.counted) return 'Just for fun · Go!';
    return 'Try ' + (c.next || per - c.left + 1) + ' of ' + per + ' · Go!';
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
                misses: s.misses, at: Date.now() };
    freshPlay();
    mode = 'ended';
    say('Round over. ' + fmt(s.final) + ' points.');
    if (Rw()) Rw().finishShift(sum); else goBrief(true);
  }
  // Kiosk "next curator", and a clean slate: back to the brief with fresh state.
  function reset() {
    freshPlay();
    mode = 'brief'; score = null; info = null; run = []; idx = 0; practiceNext = false;
    if (KIOSK) { relaxed = false; setDeck(firstDeck()); } else loadPrefs();
    closeHow();
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
    if (paused || document.hidden || !/^(practice|between|banner|shift)$/.test(mode)) return;
    dt = lastT ? Math.min(t - lastT, 1000) : 0;
    lastT = t;
    if (drag && drag.dirty) dragFrame();
    // The clock also stops under the flash (v6 §2: fair play, and the sim's timing stays valid).
    if (mode === 'shift' && clockOn && !flashOn) { elapsed += dt; shiftFrame(); }
    if (mode === 'practice') practiceFrame(t);
    if (!raf && /^(practice|between|banner|shift)$/.test(mode)) raf = requestAnimationFrame(tick);
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
  function canPlay() { return (mode === 'shift' || mode === 'practice') && !paused && !flashOn; }
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
    // Any key skips the flash and does nothing else (Tab still moves focus).
    if (flashOn) { if (k !== 'Tab') { e.preventDefault(); if (!e.repeat) skipFlash(); } return; }
    if (!/^(practice|between|banner|shift)$/.test(mode)) return;
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
    // The v4 shell keeps #start hidden; the app cards start the round.
    on('start', function (e) { keyboard = e.detail === 0; startFlow(false); });
    on('practice-again', function () { practiceNext = !practiceNext; renderBrief(); });
    on('picker', onPick);
    on('relaxed', toggleRelaxed);
    on('skip-practice', function (e) { keyboard = e.detail === 0; if (mode === 'practice' || mode === 'between') endPractice(false); });
    on('b-chal', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; enterPick(); });
    on('b-keep', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; decide('letThrough'); });
    on('b-cancel', function (e) { if (barTap(e)) return; keyboard = e.detail === 0; cancelPick(); });
    on('pause', function (e) { keyboard = e.detail === 0; pause(); });
    on('resume', resume);
    on('end-shift', endFromPause);
    on('flash', skipFlash);
    on('err-reload', function () { location.reload(); });
    on('again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else startFlow(false); });
    on('rep-switch', function () { if (KIOSK) reset(); else goBrief(true); });
    on('t-switch', function () { goBrief(true); });
    on('t-again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else startFlow(false); });
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
  }
  // ---- Pause ----
  // No clock pause in standard play except this overlay: the clock and animations freeze (pick mode stays).
  function pause() {
    var d = drag;
    if (paused || (mode !== 'shift' && mode !== 'practice')) return;
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
  // Ending from the pause overlay still uses a counted shift; during practice it returns to the brief.
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
    if (document.hidden) { if (mode === 'shift' || mode === 'practice') pause(); else stopLoop(); }
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
    window.CurateGame = { show: showView, reset: reset };
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
