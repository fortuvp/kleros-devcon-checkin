// Curate game rules. Pure functions (no DOM, no storage): scripts/curate-check.js runs this code in Node.
(function () {
  var LATE_FROM = 5, MAX_F = 2, MAX_G = 3, TRIES = 200,
    COUNT = { catch: 'caught', listed: 'listed', wrongChallenge: 'wrong', leak: 'leaks' };
  function S() { return window.CURATE_SETTINGS; }

  // ---- Helpers ----
  function shuffle(a, rand) {
    for (var i = a.length - 1, j, t; i > 0; i--) { j = Math.floor(rand() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function copy(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  function listOf(key) {   // list keys are unique across decks
    var D = window.CURATE_DECKS || {}, k;
    for (k in D) if (D[k].lists[key]) return D[k].lists[key];
    return { fields: [] };
  }

  // ---- Dealing a round ----
  // An item's twin keys: null, one string, or a list (a Big Ben photo named Eiffel Tower is both).
  function twins(it) { return !it.twin ? [] : typeof it.twin === 'string' ? [it.twin] : it.twin; }
  // Up to n items passing test: ids not in the last round first, one per twin key.
  function take(pool, n, test, out, seen, last, rand) {
    var c = shuffle(pool.filter(test), rand), i, it, tw;
    c.sort(function (a, b) { return (last.indexOf(a.id) > -1) - (last.indexOf(b.id) > -1); });   // stable
    for (i = 0; i < c.length && n > 0; i++) {
      it = c[i]; tw = twins(it);
      if (seen[it.id] || tw.some(function (k) { return seen['~' + k]; })) continue;
      seen[it.id] = 1;
      tw.forEach(function (k) { seen['~' + k] = 1; });
      out.push(it); n--;
    }
  }
  // Can f fakes and g goods still follow a run of rf fakes or rg goods?
  function fits(f, g, rf, rg) { return g <= MAX_G * (f + 1) - rg && f <= MAX_F * (g + 1) - rf; }
  // One randomised greedy pass; a dead end appends the rest unordered.
  function arrange(open, rest, late, rand) {
    var seq = open.slice(), left = shuffle(rest.slice(), rand), rf = 0, rg = 0, f = 0, c, i, it;
    function step(x) { if (x.bad) { rf++; rg = 0; } else { rg++; rf = 0; } }
    seq.forEach(step);
    left.forEach(function (x) { if (x.bad) f++; });
    while (left.length) {
      c = [];
      for (i = 0; i < left.length; i++) {
        it = left[i];
        if (late && it.list === late && seq.length < LATE_FROM) continue;
        if (it.bad ? rf < MAX_F && fits(f - 1, left.length - f, rf + 1, 0)
          : rg < MAX_G && fits(f, left.length - f - 1, 0, rg + 1)) c.push(i);
      }
      if (!c.length) return { ok: false, items: seq.concat(left) };
      it = left.splice(c[Math.floor(rand() * c.length)], 1)[0];
      seq.push(it); step(it);
      if (it.bad) f--;
    }
    return { ok: true, items: seq };
  }
  // Spec §2.4: easy opening with a card-tell fake at 1 or 2; late list from 5. A deck with no easy
  // card-tell fake opens on any easy fake instead.
  function buildRun(deckId, lastIds, rand) {
    var D = window.CURATE_DECKS, deck = D[deckId], items, split;
    var last = lastIds || [], seen = {}, open = [], rest = [], got = {}, k, r, t;
    if (!deck) for (k in D) { deck = D[k]; break; }   // an unknown id plays the first deck
    items = deck.items; split = deck.split;
    // The intro’s correct example is never dealt: the round would replay an entry the player just saw.
    if (deck.intro) items = items.filter(function (it) { return it.id !== deck.intro.good; });
    rand = rand || Math.random;
    // Never open on the twin of a practice card (e.g. the Eiffel Tower right after practising on it).
    var pt = {};
    (deck.practice || []).forEach(function (p) { twins(p).forEach(function (x) { pt[x] = 1; }); });
    function easy(it) {
      return !twins(it).some(function (x) { return pt[x]; }) && (deck.easy ? it.list === deck.easy : it.lvl === 1);
    }
    take(items, 1, function (it) { return easy(it) && it.bad && it.tell === 'card'; }, open, seen, last, rand);
    if (!open.length) take(items, 1, function (it) { return easy(it) && it.bad; }, open, seen, last, rand);
    take(items, 2, function (it) { return easy(it) && !it.bad; }, open, seen, last, rand);
    open.forEach(function (it) { (got[it.list] || (got[it.list] = [0, 0]))[it.bad ? 1 : 0]++; });
    function pick(bad) {
      for (k in split) {
        t = got[k] || [0, 0];
        take(items, bad ? split[k][1] - t[1] : split[k][0] - split[k][1] - t[0],
      function (it) { return it.list === k && !it.bad === !bad; }, rest, seen, last, rand);
      }
    }
    pick(true); pick(false);
    if (open.length === 3) open = rand() < 0.5 ? [open[1], open[0], open[2]] : [open[1], open[2], open[0]];
    for (t = 0; t < TRIES; t++) { r = arrange(open, rest, deck.late, rand); if (r.ok) break; }
    return { deck: deck.id, items: r.items.map(copy) };
  }

  // ---- Intro ----
  // The intro’s two examples: a correct entry and its twin with one part wrong (practice[0]). Copies, so the
  // caller can’t change the deck. null when the deck has none.
  function intro(deckId) {
    var deck = (window.CURATE_DECKS || {})[deckId], good = null, bad, i;
    if (!deck || !deck.intro || !deck.practice || !deck.practice.length) return null;
    for (i = 0; i < deck.items.length; i++) if (deck.items[i].id === deck.intro.good) good = deck.items[i];
    bad = deck.practice[0];
    return good && !good.bad && bad.bad ? { good: copy(good), bad: copy(bad) } : null;
  }

  // ---- Window ----
  // v5: no per-card window. Kept only so an older caller reads 0 (= no window); new code need not call it.
  function windowFor() { return 0; }

  // ---- Score ----
  function newScore() {
    return { raw: 0, streak: 0, bestStreak: 0, trust: 100, caught: 0, fakesSeen: 0, listed: 0, goodsSeen: 0,
      evidence: 0, wrong: 0, leaks: 0, reviewed: 0, mistakes: 0, misses: [], tier: 0 };
  }
  // action: 'challenge' or anything else (a verify). pickedField: the part picked in pick mode.
  // Jurors rule on the entry, not the reason: a wrong pick still wins the catch ('sharp' = fake spotted).
  function judge(item, action, pickedField) {
    var P = S().points, ev = pickedField || '', bad = item.bad, ch = action === 'challenge',
      k = ch ? (bad ? 'catch' : 'wrongChallenge') : bad ? 'leak' : 'listed',
      ok = !!bad === ch, e = !ev || !ch ? 'none' : bad && (ev === bad || (item.also || []).indexOf(ev) > -1) ? 'sharp' : 'wrong',
      pk = k === 'listed' ? 'letThrough' : k;
    return { kind: k, correct: ok, evidence: e, points: P[pk] + (e === 'sharp' ? P.evidence : 0),
      trust: ok ? 0 : S().trust[pk] };
  }
  // Mutates score; the tier follows raw.
  function apply(score, item, outcome) {
    var P = S().points, k = outcome.kind, bonus = 0, from = score.tier, list, key, lab = '', name = '';
    score.raw += outcome.points;
    score.trust = Math.max(0, Math.min(100, score.trust + outcome.trust));
    score.reviewed++;
    if (item.bad) score.fakesSeen++; else score.goodsSeen++;
    score[COUNT[k]]++;
    if (outcome.evidence === 'sharp') score.evidence++;
    if (outcome.correct) {
      score.streak++;
      if (score.streak > score.bestStreak) score.bestStreak = score.streak;
      if (score.streak % P.streakEvery === 0) { bonus = P.streakBonus; score.raw += bonus; }
    } else {
      score.streak = 0;
      score.mistakes++;
      list = listOf(item.list);
      key = k === 'wrongChallenge' ? '' : item.bad || '';
      // Name: the first field, skipping the picture’s description (Photo, Flag, Logo).
      list.fields.forEach(function (fd) {
        if (!name && fd[0] !== list.objField) name = item.f[fd[0]];
        if (fd[0] === key) lab = fd[1];
      });
      score.misses.push({ id: item.id, kind: key ? 'leak' : k, list: item.list, field: key, fieldLabel: lab,
        shown: key ? item.f[key] : '', fix: key ? item.fix : '', name: name, why: item.why });
    }
    score.tier = tierFor(score.raw);
    return { streakBonus: bonus, tierFrom: from, tierTo: score.tier };
  }
  // 2 Nov: no time bonus, so the score comes from the answers only. The arguments stay for older callers.
  function finish(score) {
    score.timeBonus = 0;
    score.final = Math.max(0, score.raw);
    score.tier = tierFor(score.final);
    return { timeBonus: 0 };
  }
  function tierFor(points) {
    var t = S().tiers, i;
    for (i = t.length - 1; i > 0; i--) if (points >= t[i]) return i;
    return 0;
  }

  window.CurateRules = { buildRun: buildRun, windowFor: windowFor, newScore: newScore, judge: judge, apply: apply,
      finish: finish, tierFor: tierFor, intro: intro };
})();
