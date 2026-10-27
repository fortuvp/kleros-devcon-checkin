// Curate game engine: brief, practice, the 60-second shift and the hand-off to the report.
// One rAF loop drives the clock, the per-entry windows and drag frames. Rules come from rules.js, items are
// painted by objects.js, and rewards.js owns storage, the report and the ticket: this file never touches
// localStorage. User text goes in through textContent only.
(function () {
  var S = window.CURATE_SETTINGS, D = window.CURATE_DECKS, R = window.CurateRules;
  var KIOSK = /[?&]kiosk=1\b/.test(location.search);
  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var LITE = /[?&]lite=1\b/.test(location.search) || !!(navigator.connection && navigator.connection.saveData);
  var MINUS = '−', GUARD = 120;

  // Practice coach facts per client (§1.3 S2); the rest of the coach copy is shared.
  var COACH = {
    wallet: { fact: 'Kleros’ token is PNK.', good: 'devcon.org is Devcon’s site.' },
    mumbai: { fact: 'India Gate is in New Delhi.', good: 'the Gateway of India is in Mumbai.' }
  };

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
  function ob(fn, a, b, c) { var o = O(); return o ? o[fn](a, b, c) : null; }
  function rw(fn, a, b) { var r = Rw(); return r ? r[fn](a, b) : null; }
  // Restarts a one-shot CSS animation class.
  function bump(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function focusEl(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  // Parks focus on a heading or region that is not a control (tabindex -1, no ring), so it never drops to <body>.
  function park(id) {
    var el = $(id);
    if (el && !el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); el.style.outline = 'none'; }
    focusEl(el);
  }
  var timers = [];
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

  // ---- State ----
  var deckId = 'wallet', deck = null, relaxed = false;
  var mode = 'brief';        // brief | practice | between | banner | shift | ended
  var run = [], idx = 0, cards = [], score = null, info = null, total = 0;
  var clockOn = false, elapsed = 0, lastT = 0, paused = false, explainOpen = false;
  var winLen = 0, winStart = 0, graceNext = false, lastDecide = -1e9, landT = -1e9, shownSecs = -1;
  var said30 = false, said10 = false, rushed = false;
  var raf = 0, drag = null, press = null, flying = null, keyboard = false;
  var pStep = 0, pT0 = 0, pHinted = false;
  var heroDeck = '', chalArrow = '', sayT = 0;
  var announcedTier = 0;     // highest tier toasted this shift: re-crossing a threshold stays quiet
  var focusFirst = false;    // focus the next card that lands (after Start), so focus never sits on <body>

  // ---- Views and announcements ----
  var VIEWS = { brief: 'brief', play: 'play', report: 'report', ticket: 'ticketv' };
  function showView(view) {
    var k, b = document.body;
    for (k in VIEWS) show($(VIEWS[k]), k === view);
    // Keep modifier classes, swap the v-* one.
    b.className = (b.className.replace(/(^|\s)v-\S+/g, '') + ' v-' + view).replace(/^\s+/, '');
    if (view !== 'play') { show('paused', false); show('explain', false); body('is-paused', false); }
    ob(view === 'report' || view === 'ticket' ? 'pause' : 'resume');
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
    deckId = D[id] ? id : 'wallet';
    deck = D[deckId];
  }
  function practised() { return !KIOSK && !!rw('getPref', 'practiced.' + deckId); }
  function renderBrief() {
    var c = deck.copy, rb = $('relaxed');
    txt('story-1', c.story1);
    txt('payoff', c.payoff);
    txt('deck-switch', c.switchTo);
    txt('rep-switch', c.repSwitch);
    if (rb) {
      rb.textContent = 'Relaxed timing: ' + (relaxed ? 'On' : 'Off');
      rb.setAttribute('aria-pressed', relaxed ? 'true' : 'false');
    }
    body('is-relaxed', relaxed);
    show('practice-again', practised());
    // The hero keeps its SVG placeholder when objects.js is missing.
    if (O() && heroDeck !== deckId && $('hero-objs')) { O().hero($('hero-objs'), deck.hero); heroDeck = deckId; }
  }
  // focus: when the control that led here is gone (report, pause overlay, kiosk reset).
  function goBrief(focus) {
    mode = 'brief';
    renderBrief();
    rw('refreshBrief');
    showView('brief');
    if (focus) park('brief-title');
  }
  function switchDeck() {
    setDeck(deckId === 'wallet' ? 'mumbai' : 'wallet');
    rw('setPref', 'deck', deckId);
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
  // Long domains keep their end, where lookalikes hide: first 10 + … + last 15.
  function mid(v) { v = String(v); return v.length > 26 ? v.slice(0, 10) + '…' + v.slice(-15) : v; }
  function clone(id) { return $(id).content.firstElementChild.cloneNode(true); }
  function makeCard(item, n, of) {
    var el = clone('tpl-card'), list = listOf(item), rows = slot(el, 'rows'), objSlot = slot(el, 'obj');
    var i, key, li, b, v, obj;
    el._item = item; el._ev = ''; el._n = n; el._of = of;
    slot(el, 'list').textContent = list.name;
    slot(el, 'n').textContent = n + '/' + of;
    slot(el, 'foot').textContent = 'Submitted with a deposit · #' + ('000' + Math.floor(Math.random() * 10000)).slice(-4);
    for (i = 0; i < list.fields.length; i++) {
      key = list.fields[i][0]; v = String(item.f[key]);
      li = clone('tpl-row'); b = li.querySelector('.row');
      b.setAttribute('data-f', key);
      b.setAttribute('aria-label', list.fields[i][1] + ': ' + v);
      slot(li, 'lab').textContent = list.fields[i][1];
      slot(li, 'val').textContent = key === 'site' ? mid(v) : v;
      if (key === 'site') slot(li, 'val').classList.add('mono');
      rows.appendChild(li);
    }
    obj = ob('create', item.obj, { size: 'card' });
    if (!obj) { obj = document.createElement('div'); obj.className = 'obj'; obj.setAttribute('aria-hidden', 'true'); }
    objSlot.appendChild(obj);
    el._obj = obj;
    // The coin is evidence too: tapping it toggles the Coin row.
    if (list.objField) {
      objSlot.setAttribute('data-f', list.objField);
      objSlot.setAttribute('role', 'button');
      objSlot.setAttribute('aria-pressed', 'false');
      objSlot.setAttribute('aria-label', labelOf(item, list.objField) + ': ' + item.f[list.objField]);
    }
    setChip(el, 'st-window', 'Pending', '');
    return el;
  }
  function setChip(el, cls, label, secs) {
    var st = slot(el, 'state');
    st.className = 'state ' + cls;
    slot(el, 'state-label').textContent = label;
    slot(el, 'secs').textContent = secs;
  }
  function secsText(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return ' · 0:' + (s < 10 ? '0' : '') + s; }
  function cardLabel(el, winMs) {
    var item = el._item, f = listOf(item).fields, s = 'Entry ' + el._n + ' of ' + el._of + ', ' + listWord(item) + '. ', i;
    for (i = 0; i < f.length; i++) s += f[i][1] + ': ' + item.f[f[i][0]] + '. ';
    s += winMs ? 'Open to challenge, ' + Math.ceil(winMs / 1000) + ' seconds.' : 'Open to challenge.';
    el.setAttribute('aria-label', s);
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
      else { c.removeAttribute('aria-hidden'); if (!explainOpen) c.removeAttribute('inert'); }
    }
  }
  function fillStack() {
    var stack = $('stack'), el;
    while (cards.length < 3 && idx + cards.length < run.length) {
      el = makeCard(run[idx + cards.length], idx + cards.length + 1, run.length);
      stack.insertBefore(el, stack.firstChild);
      cards.push(el);
    }
    restack();
  }
  function clearStack() {
    finishFly();
    cards = [];
    $('stack').textContent = '';
    ob('live', null);
  }
  // A new top card: its window opens now, and the HUD follows its list.
  function topLanded() {
    var top = cards[0], item;
    if (!top) return;
    item = top._item;
    landT = now();
    txt('list-name', listOf(item).name);
    txt('policy', listOf(item).policy);
    winLen = 0;
    if (mode === 'shift' && !relaxed) {
      winLen = R.windowFor(elapsed / 1000, false) * 1000 + (graceNext ? S.graceMs : 0);
    }
    graceNext = false;
    winStart = elapsed; shownSecs = -1;
    setChip(top, 'st-window', 'Pending', winLen ? secsText(winLen) : ' · open to challenge');
    slot(top, 'rail').style.setProperty('--w', '1');
    cardLabel(top, winLen);
    ob('state', top._obj, 'pending');
    if (!flying) ob('live', top._obj);
    setChalLabel(top);
    if ((keyboard || focusFirst) && !explainOpen) { focusFirst = false; focusEl(top); }
  }

  // ---- Evidence ----
  // Tap-to-toggle only: marking another line moves the mark, and it never commits.
  function toggleEv(card, key) {
    var marks = card.querySelectorAll('[data-f]'), i, on;
    card._ev = card._ev === key ? '' : key;
    for (i = 0; i < marks.length; i++) {
      on = marks[i].getAttribute('data-f') === card._ev;
      marks[i].classList.toggle('is-ev', on);
      marks[i].classList.remove('hint');
      marks[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    card.classList.toggle('has-ev', !!card._ev);
    setChalLabel(card);
    if (mode === 'practice') coachEv(card);
  }
  function setChalLabel(card) {
    var ev = card && card._ev;
    txt('b-chal-label', chalArrow + 'Challenge' + (ev ? ': ' + labelOf(card._item, ev) : ''));
  }
  // ---- HUD ----
  function hudScore(raw, trustDrop) {
    var sv = $('score-v'), pips = document.querySelectorAll('#streak i'), segs = document.querySelectorAll('#meter i');
    var t = S.tiers, on = score ? score.streak % S.points.streakEvery : 0, i, k;
    if (sv && sv.textContent !== (raw < 0 ? MINUS : '') + fmt(raw)) {
      sv.textContent = (raw < 0 ? MINUS : '') + fmt(raw);
      bump(sv, 'bump');
    }
    for (i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < on);
    for (i = 0; i < segs.length; i++) {
      k = +segs[i].getAttribute('data-t') || i + 1;
      segs[i].style.setProperty('--f', String(clamp((raw - t[k - 1]) / (t[k] - t[k - 1]), 0, 1)));
    }
    txt('trust', 'Trust ' + (score ? score.trust : 100) + '%');
    if (trustDrop) bump($('trust'), 'dip');
  }
  function hudClock(leftMs) {
    var secs = Math.max(0, Math.ceil(leftMs / 1000)), arc = $('clock-arc'), ck = $('clock');
    if (arc) arc.style.strokeDashoffset = String(Math.round((1 - clamp(leftMs / (total * 1000), 0, 1)) * 1000) / 10);
    if (secs !== hudClock.s) { hudClock.s = secs; txt('clock-s', String(secs)); }
    if (ck) ck.classList.toggle('low', clockOn && secs <= 10);
  }

  // ---- Toasts ----
  // t = { tone: good|bad|info|tier, title, line, fix: [label, was, is], jurors, thumb, ms, quiet }
  function toast(t) {
    var box = $('toasts'), el, f, j, i, c;
    if (!box) return;
    el = clone('tpl-toast');
    el.setAttribute('data-tone', t.tone || 'info');
    slot(el, 'title').textContent = t.title;
    if (t.line) { slot(el, 'line').textContent = t.line; slot(el, 'line').hidden = false; }
    if (t.fix) {
      f = slot(el, 'fix');
      slot(f, 'fixlab').textContent = t.fix[0];
      slot(f, 'was').textContent = t.fix[1];
      slot(f, 'is').textContent = t.fix[2];
      f.hidden = false;
    }
    if (t.thumb) { slot(el, 'thumb').src = t.thumb; slot(el, 'thumb').hidden = false; }
    if (t.tier) el.style.setProperty('--tc', 'var(--tier-' + t.tier + ')');
    // Rulings are read from #say, so their toast stays quiet to avoid a double read.
    if (t.quiet) el.setAttribute('aria-hidden', 'true');
    box.insertBefore(el, box.firstChild);
    while (box.children.length > 2) box.removeChild(box.lastChild);
    // Two tall toasts can reach the top card's third row on a tall phone: drop the older one. The card's
    // bottom comes from layout (a dragged card is rotated); #toasts is a static child of .dock, so rects.
    c = cards[0];
    c = c ? $('stack').getBoundingClientRect().top + c.offsetTop + c.offsetHeight - 18 : 0;
    while (c && box.children.length > 1 && box.getBoundingClientRect().top < c) box.removeChild(box.lastChild);
    if (t.jurors) {
      j = slot(el, 'jurors'); j.hidden = false;
      for (i = 0; i < 3; i++) (function (dot, d) { setTimeout(function () { dot.classList.add('on'); }, d); })(j.children[i], 60 * (i + 1));
    }
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, t.ms || 1800);
  }
  // Ruling copy per §1.3 S3. Points come from settings so the copy follows any retune.
  function ruling(o, item) {
    var P = S.points, T = S.trust, why = item.why, fix = null, t, lab;
    if (item.bad) fix = [labelOf(item, item.bad), item.f[item.bad], item.fix];
    switch (o.kind) {
      case 'catch':
        t = { tone: 'good', jurors: true, ms: 1300,
              title: 'Rejected · Jurors 3–0 · ' + signed(P.catch) + ' bounty' + (o.evidence === 'sharp' ? ' · ' + signed(P.evidence) + ' sharp evidence' : '') };
        // The label is quoted, so any label reads (‘What it does’ cannot be lower-cased into the sentence).
        if (o.evidence === 'wrong') { lab = labelOf(item, item.bad); t.line = 'The problem was the “' + lab + '” line.'; t.ms = 2600; }
        return t;
      case 'listed': return { tone: 'good', ms: 1300, title: 'Listed · ' + signed(P.letThrough) };
      case 'autoListed': return { tone: 'good', ms: 1300, title: 'No challenge in time · Listed · ' + signed(P.autoListed) };
      case 'wrongChallenge':
        return { tone: 'bad', jurors: true, ms: 2600, line: why,
                 title: 'Jurors 3–0 for the entry · It stays listed · ' + signed(P.wrongChallenge) + ' stake' };
      case 'leak':
        return { tone: 'bad', ms: 2600, line: why, fix: fix, title: 'Fake listed · ' + signed(P.leak) + ' · Trust ' + signed(T.leak) + '%' };
      default:
        return { tone: 'bad', ms: 2600, line: why, fix: fix,
                 title: 'Window closed: the fake got listed · ' + signed(P.leak) + ' · Trust ' + signed(T.leak) + '%' };
    }
  }
  // Chrome logs an intervention error for vibrate() before the first tap (e.g. keyboard-only play).
  function buzz(p) {
    var ua = navigator.userActivation;
    if (RM || !navigator.vibrate || (ua && !ua.hasBeenActive)) return;
    try { navigator.vibrate(p); } catch (e) {}
  }
  // ---- Decisions ----
  var VERDICT = { catch: 'REJECTED', listed: 'LISTED', autoListed: 'LISTED', wrongChallenge: 'STAKE LOST',
                  leak: 'FAKE LISTED', leakTimeout: 'FAKE LISTED' };
  var OBJ_STATE = { catch: 'rejected', listed: 'listed', autoListed: 'listed', wrongChallenge: 'overruled',
                    leak: 'leak', leakTimeout: 'leak' };
  // action: challenge | letThrough | timeout. Returns false when refused (the caller springs the card back).
  function decide(action) {
    var top = cards[0], t = now(), item, o, res, r;
    if (!top || paused || explainOpen) return false;
    if (action === 'timeout') { if (mode !== 'shift') return false; }
    else if ((mode !== 'shift' && mode !== 'practice') || t - lastDecide < GUARD) return false;
    lastDecide = t;
    if (mode === 'practice') return practiceDecide(top, action);
    item = top._item;
    o = R.judge(item, action, top._ev);
    res = R.apply(score, item, o);
    r = ruling(o, item); r.quiet = true;
    toast(r); say(r.title);
    if (res.streakBonus) toast({ tone: 'good', ms: 1300, title: 'Clean streak ×' + score.streak + ' · ' + signed(res.streakBonus) });
    if (res.tierTo > announcedTier) {
      if (!(KIOSK && res.tierTo > S.kioskMaxTier)) tierToast(res.tierTo);
      announcedTier = res.tierTo;
    }
    hudScore(score.raw, o.trust < 0);
    if (!o.correct) { graceNext = true; buzz([20, 40, 20]); } else if (o.kind === 'catch') buzz(12);
    fly(top, action === 'challenge' ? -1 : 1, o, action === 'timeout');
    advance();
    if (!o.correct && relaxed && mode === 'shift' && cards[0]) openExplain(r);
    return true;
  }
  function tierToast(i) {
    var ti = rw('tierInfo', i);
    if (ti) toast({ tone: 'tier', tier: ti.key, ms: 2600, title: ti.name + ' unlocked · ' + ti.reward, thumb: ti.img && ti.img[0] });
  }
  function preloadThumbs() {
    var i, ti;
    for (i = 1; i <= 3; i++) {
      ti = rw('tierInfo', i);
      if (ti && ti.img && ti.img[0]) new Image().src = ti.img[0];
    }
  }
  function advance() {
    cards.shift(); idx++;
    if (mode === 'shift' && idx >= run.length) { endShift('done'); return; }
    fillStack(); topLanded();
  }
  // Fly-out rides the compositor. The next card is already top, so input stays live (buffered).
  function fly(el, dir, o, timedOut) {
    var v = slot(el, 'verdict');
    finishFly();
    if (drag && drag.card === el) drag = null;
    el.classList.remove('dragging', 'spring');
    el.removeAttribute('data-drag');
    el.style.setProperty('--sk', '0'); el.style.setProperty('--sc', '0');
    edges(0, 0);
    if (timedOut) el.classList.add('timeout');
    v.textContent = VERDICT[o.kind];
    v.className = 'verdict ' + (o.correct ? 'v-good' : 'v-bad');
    if (o.kind === 'catch') setChip(el, 'st-off', 'Rejected', '');
    else setChip(el, 'st-listed', 'Listed', '');
    ob('state', el._obj, OBJ_STATE[o.kind]);
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', '');
    // The fly-* classes carry the 240 ms exit (a 24 px fade under reduced motion) from where the drag left it.
    el.classList.add(dir < 0 ? 'fly-left' : 'fly-right');
    flying = { el: el, t: setTimeout(finishFly, RM ? 130 : 250) };
  }
  // Ends (or fast-forwards) a fly-out: the GL object moves to the new top card before the old one goes.
  function finishFly() {
    var f = flying;
    if (!f) return;
    flying = null;
    clearTimeout(f.t);
    ob('live', cards[0] ? cards[0]._obj : null);
    if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
  }

  // ---- Practice ----
  // Two untimed cards that cannot be failed: a wrong move springs the card back with a coach line.
  function coach(s) { txt('coach', s); }
  function coachFacts() { return COACH[deckId] || COACH.wallet; }
  function practiceCard() {
    pT0 = now(); pHinted = false;
    coach(pStep === 0 ? 'Something on this entry breaks the policy. Tap the line that’s wrong.'
                      : 'Every line checks out. Swipe right to let it through.');
  }
  function sharp(item, key) { return key === item.bad || (item.also || []).indexOf(key) > -1; }
  function coachEv(card) {
    if (pStep !== 0) return;
    pT0 = now();
    if (card._ev) coach(sharp(card._item, card._ev) ? 'That’s your evidence. Now swipe left, or press Challenge.'
                                                    : 'Look again: one line doesn’t match.');
  }
  function practiceFrame(t) {
    var top = cards[0], row;
    if (pStep !== 0 || pHinted || !top || top._ev || t - pT0 < 4000) return;
    pHinted = true;
    row = top.querySelector('.row[data-f="' + top._item.bad + '"]');
    if (row) row.classList.add('hint');
    coach('Hint: ' + coachFacts().fact);
  }
  function practiceDecide(top, action) {
    var item = top._item, c = coachFacts(), o, r, step = pStep;
    if (step === 0 && action !== 'challenge') { coach('Careful: that would list a fake. ' + c.fact); return false; }
    if (step === 1 && action === 'challenge') {
      coach('Every line is true: ' + c.good + ' A wrong challenge costs your stake.');
      return false;
    }
    o = R.judge(item, action, top._ev);
    r = ruling(o, item); r.quiet = true;
    toast(r); say(r.title);
    if (o.kind === 'catch') buzz(12);
    fly(top, action === 'challenge' ? -1 : 1, o, false);
    pStep++;
    if (step === 0) {
      coach(o.evidence === 'sharp' ? 'Bounty won. It comes from the faker’s deposit.' : 'Tip: tap the wrong line first for +25.');
      cards.shift(); idx++; fillStack(); topLanded();
      // The second card is live at once; its coach line follows once the first lesson has been read.
      later(function () { if (mode === 'practice' && pStep === 1) practiceCard(); }, 1800);
    } else {
      coach('Nobody challenged it, so it joins the list. That’s how Curate works.');
      cards.shift(); idx++;
      endPractice(true);
    }
    return true;
  }
  function startPractice() {
    mode = 'practice';
    run = deck.practice.slice(); idx = 0; pStep = 0; score = null;
    body('is-practice', true);
    show('practice-bar', true); show('coach', true);
    hudScore(0); hudClock(total * 1000);
    fillStack(); topLanded(); practiceCard();
    startLoop();
  }
  function endPractice(done) {
    if (!KIOSK) rw('setPref', 'practiced.' + deckId, true);
    mode = 'between';
    if (done) later(beginShift, 1800); else beginShift();
  }
  // ---- Shift flow ----
  function banner(text, ms, then) {
    var b = $('banner');
    if (b) { b.textContent = text; b.hidden = false; }
    later(function () { if (b) b.hidden = true; if (then) then(); }, ms);
  }
  function freshPlay() {
    clearTimers(); stopLoop(); clearStack();
    drag = null; paused = false; explainOpen = false; clockOn = false;
    body('is-paused', false); body('is-practice', false);
    show('paused', false); show('explain', false); show('banner', false);
    if ($('toasts')) $('toasts').textContent = '';
    edges(0, 0);
  }
  // Brief → (practice) → shift. Practice runs the first time per client, and every time in kiosk.
  function startFlow(forcePractice) {
    freshPlay();
    total = relaxed ? S.relaxedSeconds : S.seconds;
    heroDeck = '';   // the hero is repainted on the way back, so the GL object returns to it
    hudClock.s = -1;
    txt('client-name', deck.client);
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
    score = R.newScore(); announcedTier = 0; info = null; elapsed = 0; graceNext = false;
    said30 = said10 = rushed = false;
    hudScore(0); hudClock(total * 1000);
    preloadThumbs();
    banner('Shift starts · ' + total + ' s', 600, function () {
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
    var left, fb, d = drag;
    if (mode !== 'shift') return;
    left = Math.max(0, total * 1000 - elapsed);
    // The discarded card drops its drag pose and stamp, so nothing suggests the move counted. Before mode
    // changes, so the chip gets its normal window text back.
    if (d) { drag = null; if (d.on) springBack(d.card); else edges(0, 0); }
    mode = 'ended'; clockOn = false;
    fb = R.finish(score, left / 1000, idx >= run.length, relaxed);
    hudScore(score.raw);
    if (by === 'done') {
      if (relaxed) toast({ tone: 'info', ms: 1300, title: 'Shift done early' });
      else if (score.mistakes <= S.points.bonusMaxMistakes) toast({ tone: 'good', ms: 1300, title: 'Shift done early · ' + signed(fb.timeBonus) + ' time bonus' });
      else toast({ tone: 'info', ms: 2600, title: 'Shift done early', line: 'Time bonus needs ' + S.points.bonusMaxMistakes + ' mistakes or fewer.' });
      later(function () { handOff(by); }, 1300);
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
    say('Shift over. ' + fmt(s.final) + ' points.');
    if (Rw()) Rw().finishShift(sum); else goBrief(true);
  }
  // Kiosk "next curator", and a clean slate for debugging: back to the brief with fresh state.
  function reset() {
    freshPlay();
    mode = 'brief'; score = null; info = null; run = []; idx = 0;
    if (KIOSK) { relaxed = false; setDeck('wallet'); } else loadPrefs();
    heroDeck = '';
    goBrief(true);
  }

  // ---- Loop ----
  // One rAF loop while playing: drag frames, the shift clock, windows and the practice hint.
  // It stops when paused, hidden or off the play view; paused time never reaches elapsed.
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
    if (mode === 'shift' && clockOn && !explainOpen) { elapsed += dt; shiftFrame(); }
    if (mode === 'practice') practiceFrame(t);
    if (!raf && /^(practice|between|banner|shift)$/.test(mode)) raf = requestAnimationFrame(tick);
  }
  function shiftFrame() {
    var left = total * 1000 - elapsed, top = cards[0], w, secs;
    hudClock(left);
    if (!said30 && left <= 30000) { said30 = true; say('30 seconds left'); }
    if (!said10 && left <= 10000) { said10 = true; say('10 seconds left'); }
    if (!relaxed && !rushed && elapsed >= S.rushAt * 1000) {
      rushed = true;
      toast({ tone: 'info', ms: 2200, title: 'Rush hour · ' + (total - S.rushAt) + ' s left · entries close faster' });
    }
    if (left <= 0) { endShift('time'); return; }
    if (!top || !winLen) return;
    w = winLen - (elapsed - winStart);
    slot(top, 'rail').style.setProperty('--w', String(clamp(w / winLen, 0, 1)));
    secs = Math.ceil(w / 1000);
    if (secs !== shownSecs && !(drag && drag.left)) { shownSecs = secs; slot(top, 'secs').textContent = secsText(w); }
    if (w <= 0) decide('timeout');
  }
  // ---- Gestures ----
  // Pointer Events on #stack. Taps are left to the native click (so rows stay real buttons); a drag starts
  // past 8 px of mostly horizontal travel and captures the pointer. Move work is batched into the rAF loop.
  function canPlay() { return (mode === 'shift' || mode === 'practice') && !paused && !explainOpen; }
  function onDown(e) {
    var top = cards[0], t = now();
    keyboard = false;
    if (drag && !drag.on) drag = null;   // a press whose release we never saw (it ended off the stack)
    if (e.button > 0 || drag || !top || !canPlay() || !top.contains(e.target)) return;
    drag = { id: e.pointerId, card: top, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, on: false, left: false,
             dirty: false, buf: [[t, e.clientX]] };
    press = { t0: t, moved: false, dur: 0 };
  }
  function onMove(e) {
    var d = drag, t = now();
    if (!d || e.pointerId !== d.id) return;
    // A mouse/pen press whose release we never saw (it ended off #stack): hover moves must not drag.
    if (e.pointerType !== 'touch' && !e.buttons) { drag = null; if (d.on) springBack(d.card); return; }
    d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
    if (Math.abs(d.dx) > 8 || Math.abs(d.dy) > 8) press.moved = true;
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
    press.dur = t - press.t0;
    if (!d.on) return;   // a tap or a vertical nudge: the click handler decides
    vx = velocity(d.buf, t); ax = Math.abs(d.dx);
    if (d.card === cards[0] && (ax > 0.28 * d.card.offsetWidth || (Math.abs(vx) > 0.55 && ax > 40 && (vx < 0) === (d.dx < 0)))) {
      if (decide(d.dx < 0 ? 'challenge' : 'letThrough')) return;
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
  function onClick(e) {
    var f = e.target.closest ? e.target.closest('[data-f]') : null, top = cards[0];
    if (!f || !top || !top.contains(f) || !canPlay()) return;
    // A pointer click counts as a tap only under 8 px and 350 ms; keyboard clicks (detail 0) always count.
    if (e.detail !== 0 && press && (press.moved || press.dur >= 350)) return;
    if (now() - landT < GUARD) return;
    toggleEv(top, f.getAttribute('data-f'));
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
  // While dragged left the entry reads as being challenged.
  function contest(c, on) {
    if (on) setChip(c, 'st-contested', 'Challenging…', '');
    else {
      setChip(c, 'st-window', 'Pending', winLen && mode === 'shift' ? secsText(winLen - (elapsed - winStart)) : ' · open to challenge');
      shownSecs = -1;
    }
    ob('state', c._obj, on ? 'challenge' : 'pending');
  }
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
  function onKey(e) {
    var k = e.key, top = cards[0], rows;
    if (e.ctrlKey || e.metaKey || e.altKey || !/^(practice|between|banner|shift)$/.test(mode)) return;
    if ($('err') && !$('err').hidden) return;
    // A held key acts once: no decision bursts, no pause/resume flicker, no evidence flicker.
    if (e.repeat && k !== 'Tab') {
      if (/^(ArrowLeft|ArrowRight|Escape|Enter|Spacebar|[ aAdDpP])$/.test(k)) e.preventDefault();
      return;
    }
    // The pause overlay sits above #explain, so it takes the keys first; resume() hands focus back to Got it.
    if (paused) {
      if (k === ' ' || k === 'Spacebar' || k === 'Escape') { e.preventDefault(); resume(); }
      else if (k === 'Tab') trapTab(e, [$('resume'), $('end-shift')]);
      return;
    }
    if (explainOpen) {
      if (k === 'Enter' || k === 'Escape') { e.preventDefault(); closeExplain(); }
      else if (k === 'Tab') { e.preventDefault(); $('explain-ok').focus(); }
      return;
    }
    if (k === 'Escape' || k === 'p' || k === 'P') { e.preventDefault(); keyboard = true; pause(); return; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); keyboard = true; decide('challenge'); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); keyboard = true; decide('letThrough'); }
    else if (k === '1' || k === '2' || k === '3') {
      keyboard = true;
      rows = top ? top.querySelectorAll('.row') : [];
      if (rows[+k - 1] && canPlay() && now() - landT >= GUARD) toggleEv(top, rows[+k - 1].getAttribute('data-f'));
    }
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
    on('start', function (e) { keyboard = e.detail === 0; startFlow(false); });
    on('practice-again', function (e) { keyboard = e.detail === 0; startFlow(true); });
    on('deck-switch', function () { switchDeck(); goBrief(); });
    on('relaxed', toggleRelaxed);
    on('skip-practice', function (e) { keyboard = e.detail === 0; if (mode === 'practice') endPractice(false); });
    on('b-chal', function (e) { keyboard = e.detail === 0; decide('challenge'); });
    on('b-keep', function (e) { keyboard = e.detail === 0; decide('letThrough'); });
    on('pause', function (e) { keyboard = e.detail === 0; pause(); });
    on('resume', resume);
    on('end-shift', endFromPause);
    on('explain-ok', closeExplain);
    on('err-reload', function () { location.reload(); });
    on('again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else startFlow(false); });
    on('rep-switch', function () { switchDeck(); goBrief(true); });
    on('t-again', function (e) { keyboard = e.detail === 0; if (KIOSK) reset(); else startFlow(false); });
    if (st) {
      st.addEventListener('pointerdown', onDown);
      st.addEventListener('pointermove', onMove);
      st.addEventListener('pointerup', onUp);
      st.addEventListener('pointercancel', onCancel);
      // Only #stack's own capture loss counts: a touch's implicit capture on the child is handed over when the
      // drag captures on #stack, and that handoff fires lostpointercapture at the child (it bubbles here).
      st.addEventListener('lostpointercapture', function (e) { if (e.target === st) onCancel(e); });
      st.addEventListener('click', onClick);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
  }
  // ---- Pause and relaxed explanation ----
  // No clock pause in standard play except this overlay: the clock, windows and animations all freeze.
  function pause() {
    var d = drag;
    if (paused || (mode !== 'shift' && mode !== 'practice')) return;
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
    if (explainOpen) $('explain-ok').focus(); else if (cards[0]) cards[0].focus();
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
  // Relaxed mode: after a mistake the next card stays hidden and the clock waits until Got it.
  function openExplain(r) {
    var fx = $('explain-fix'), top = cards[0];
    explainOpen = true;
    txt('explain-title', r.title);
    txt('explain-why', r.line || '');
    if (fx) { fx.textContent = r.fix ? r.fix[0] + ': ' + r.fix[1] + ' → ' + r.fix[2] : ''; fx.hidden = !r.fix; }
    if (top) { top.setAttribute('inert', ''); top.style.visibility = 'hidden'; }
    show('explain', true);
    if ($('explain-ok')) $('explain-ok').focus();
  }
  function closeExplain() {
    var top = cards[0];
    if (!explainOpen) return;
    explainOpen = false;
    show('explain', false);
    if (top) {
      top.removeAttribute('inert'); top.style.visibility = '';
      landT = now();
      top.focus();
    }
  }
  function onVisibility() {
    if (document.hidden) { if (mode === 'shift' || mode === 'practice') pause(); else stopLoop(); }
    else startLoop();
  }

  // ---- Boot ----
  function loadPrefs() {
    setDeck(rw('getPref', 'deck') || 'wallet');
    relaxed = !!rw('getPref', 'relaxed');
  }
  function showErr() {
    var el = $('err');
    if (!el) return;
    el.hidden = false;
    if ($('err-reload')) $('err-reload').focus();
  }
  function boot() {
    var lab = $('b-chal-label');
    body('rm', RM); body('lite', LITE); body('is-kiosk', KIOSK);
    if (!S || !D || !R || !$('tpl-card')) throw new Error('Curate: a module or template is missing');
    // The arrow is part of the label text when the markup puts it there.
    chalArrow = lab && /^\s*←/.test(lab.textContent) ? '← ' : '';
    window.CurateGame = { show: showView, reset: reset };
    rw('init', ui);
    ob('init', { reduced: RM, lite: LITE });
    loadPrefs();
    wire();
    goBrief();
  }
  // Errors during boot (here or in the deferred scripts before DOMContentLoaded) show #err.
  var booting = true;
  window.onerror = function () { if (booting) showErr(); };
  document.addEventListener('DOMContentLoaded', function () { booting = false; });
  try { boot(); } catch (e) { showErr(); if (window.console) console.error(e); }
})();
