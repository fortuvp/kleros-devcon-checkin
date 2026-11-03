#!/usr/bin/env node
// Curate game checks: content schema and facts, round dealing, ES5 lint, user copy (banned words, web3 words
// outside the Crypto exchange app, and Curate’s jargon on the play screen) and file sizes; with --sim, the §2.8
// tier simulation (v5 pick model; 2 Nov: 2 counted tries per badge for the whole event). Badge tries (2 Nov): the booth web app
// (apps-script/staff-desk/Code.gs) runs here against an in-memory Sheets stub, and rewards.js, earn.js and badge.js
// run against it in fake pages. Verify modes (3 Nov): the same in telegram mode (a fake Telegram Bot API) and none mode;
// 3 Nov b: the consent tick, the bot's Back to the game button and the game's landing from it. 3 Nov c: kinder points
// (100 a right answer, 10 a wrong one; Teal at 6 right, Purple at 8, Gold for 10 of 10; 5 fakes a round, so blind
// taps stay under Teal; TARGET moved to match), the title's descender, Telegram usernames in the contacts sheet and
// the desk's Reset a player.
// Node 22, no dependencies. It runs the very settings.js, decks.js and rules.js the phones load.
//   node scripts/curate-check.js          checks only
//   node scripts/curate-check.js --sim    checks, then 20,000 simulated players per profile
//   node scripts/curate-check.js --fit    the same simulation, plus the tier thresholds that would hit TARGET
// Exits non-zero on any failure. Run it after every change to settings.js, decks.js or rules.js.
// v5: the tiers were refitted with --fit for 60 s rounds and pick mode; v6: refitted again for 2 counted tries. A deliberate retune (README stock
// runbook) moves the tier mix away from §2.8 on purpose: the --sim table then shows the new shares; update
// TARGET below once the team agrees on them.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), crypto = require('crypto');

var ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'site', 'curate');
var STAFF = path.join(ROOT, 'site', 'staff'), GS = path.join(ROOT, 'apps-script', 'staff-desk', 'Code.gs');
var FIT = process.argv.indexOf('--fit') > -1, SIM = FIT || process.argv.indexOf('--sim') > -1;
var errors = [], warnings = [];
function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function pct(n, d) { return d ? Math.round(1000 * n / d) / 10 : 0; }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

// ---- Load ----
// A fake `window` that is also the global, so `window.X = …` and bare globals both work, as in a browser.
function load(files) {
  var ctx = { console: console };
  ctx.window = ctx;
  vm.createContext(ctx);
  files.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}
var W = load(['site/curate/settings.js', 'site/curate/decks.js', 'site/curate/rules.js']);
var S = W.CURATE_SETTINGS, D = W.CURATE_DECKS, R = W.CurateRules;

// ---- Settings ----
function checkSettings() {
  var keys = ['v', 'seconds', 'entries', 'fakes', 'points', 'trust',
    'tiers', 'checkinNeededFrom', 'countedTries', 'kioskMaxTier', 'kioskResetMs', 'kioskIdleMs', 'staffHoldMs',
    'undoMs', 'soldOut', 'substitutes', 'ranks', 'fallbackMerch', 'server', 'verify', 'telegram', 'badge', 'contact'], i, cfg, fm,
    tk = ['teal', 'purple', 'gold'];
  if (!S) return fail('settings.js: window.CURATE_SETTINGS is missing');
  keys.forEach(function (k) { if (S[k] === undefined) fail('settings.js: missing ' + k); });
  // Badge tries (2 Nov): one server block replaces the desk and sign-up blocks.
  ['staffDesk', 'earn'].forEach(function (k) { if (S[k] !== undefined) fail('settings.js: ' + k + ' is gone (server holds the one endpoint)'); });
  (function (sv, bg, ct) {
    if (typeof sv.endpoint !== 'string' || (sv.endpoint &&
      !/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(sv.endpoint))) {
      fail('settings.js: server.endpoint must be empty or an Apps Script /exec URL');
    }
    if (!(sv.timeoutMs >= 15000)) fail('settings.js: server.timeoutMs must be ≥ 15000 (above the script’s 6 s lock wait)');
    try { new RegExp(bg.pattern || ''); } catch (e) { fail('settings.js: badge.pattern does not compile: ' + e.message); }
    if (typeof bg.typed !== 'boolean') fail('settings.js: badge.typed must be true or false');
    // 3 Nov (owner): players never type a badge code; badge mode is scan only.
    if (bg.typed !== false) fail('settings.js: badge.typed must be false (badge mode is scan only)');
    if (typeof ct.monthly !== 'string' || !ct.monthly) fail('settings.js: contact.monthly is empty');
  })(S.server || {}, S.badge || {}, S.contact || {});
  // 3 Nov: how players verify until the server answers (its Switches tab wins), and the Telegram bot's link and timing.
  (function (tg) {
    if (['telegram', 'badge', 'none'].indexOf(S.verify) < 0) fail('settings.js: verify must be telegram, badge or none');
    if (S.verify !== 'telegram') warn('settings.js: verify is ' + S.verify + '; the owner chose telegram as the default');
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(tg.bot || '')) fail('settings.js: telegram.bot must be a bot username, without the @');
    if (!(tg.pollMs >= 1000) || !(tg.waitMs >= 60000) || tg.waitMs <= tg.pollMs) fail('settings.js: telegram.pollMs ≥ 1000 and waitMs ≥ 60000');
  })(S.telegram || {});
  // 2 Nov (user): 2 tries per ticket, the Devcon badge, for the whole event. Nothing counts tries per day any more.
  ['countedPerDay', 'lastDay'].forEach(function (k) {
    if (S[k] !== undefined) fail('settings.js: ' + k + ' is gone (countedTries is per badge or phone for the whole event, never per day)');
  });
  ['catch', 'evidence', 'letThrough', 'wrongChallenge', 'leak', 'streakEvery', 'streakBonus', 'effort'].forEach(function (k) {
    if (typeof S.points[k] !== 'number') fail('settings.js: points.' + k + ' is not a number');
  });
  // 2 Nov: no time bonus (the score is the answers) and one 90 s round for everyone (no More time).
  ['perSecondLeft', 'bonusMaxMistakes', 'bonusMinEvidence', 'relaxedBonus'].forEach(function (k) {
    if (S.points[k] !== undefined) fail('settings.js: points.' + k + ' is gone (no time bonus)');
  });
  if (S.relaxedSeconds !== undefined) fail('settings.js: relaxedSeconds is gone (one round length for everyone)');
  // Effort points (2 Nov): a played round never scores 0, but effort alone never reaches Teal.
  if (!(S.points.effort > 0)) fail('settings.js: points.effort must be above 0 (a played round never scores 0)');
  if (S.points.effort * S.entries >= S.tiers[1]) fail('settings.js: effort points alone (' + S.points.effort * S.entries + ') reach Teal (' + S.tiers[1] + ')');
  (function () {   // every entry wrong: the score is the effort floor, never 0; the floor never lifts a better score
    var sc = R.newScore(), it = { id: 'x', list: '', bad: 'name', f: {} }, i;
    for (i = 0; i < S.entries; i++) R.apply(sc, it, R.judge(it, 'letThrough', ''));
    R.finish(sc);
    if (sc.final !== S.points.effort * S.entries) fail('rules.js: a round of ' + S.entries + ' mistakes scores ' + sc.final + ', not the effort floor ' + S.points.effort * S.entries);
    sc = R.newScore(); it = { id: 'y', list: '', bad: '', f: {} };
    for (i = 0; i < S.entries; i++) R.apply(sc, it, R.judge(it, 'letThrough', ''));
    R.finish(sc);
    if (sc.final !== sc.raw || sc.final <= S.points.effort * S.entries) fail('rules.js: the effort floor changed a better score (' + sc.raw + ' → ' + sc.final + ')');
  })();
  ['leak', 'wrongChallenge'].forEach(function (k) {
    if (typeof S.trust[k] !== 'number') fail('settings.js: trust.' + k + ' is not a number');
  });
  if (S.tiers.length !== 4 || S.tiers[0] !== 0) fail('settings.js: tiers must be [0, teal, purple, gold]');
  for (i = 1; i < S.tiers.length; i++) if (S.tiers[i] <= S.tiers[i - 1]) fail('settings.js: tiers must rise');
  // v5 brief §1: one calm round, no per-card window, no auto-listing, no rush toast.
  if (S.windows != null && !(Array.isArray(S.windows) && !S.windows.length)) fail('settings.js: windows must be [] or null (v5: no per-card countdown)');
  if (S.rushAt != null) fail('settings.js: rushAt is gone in v5 (no rush toast)');
  if (S.points.autoListed !== undefined) fail('settings.js: points.autoListed is gone in v5 (no auto-listing)');
  // Gold stays reachable: a flawless round (every call and every wrong part right) must score Gold, however slow.
  (function (P) {
    var flawless = S.fakes * (P.catch + P.evidence) + (S.entries - S.fakes) * P.letThrough +
      Math.floor(S.entries / P.streakEvery) * P.streakBonus;
    if (flawless < S.tiers[3]) fail('settings.js: a flawless round scores ' + flawless + ', below Gold (' + S.tiers[3] + ')');
  })(S.points);
  if (S.ranks.length !== 4) fail('settings.js: ranks needs 4 names');
  // 2 tries count for merch (whole event), said on the title, the intro, the Go banner, Results and the ticket.
  if (S.countedTries !== 2) warn('settings.js: countedTries is ' + S.countedTries + '; the copy and the sim assume 2 tries');
  if (S.checkinNeededFrom < 1 || S.checkinNeededFrom > 4) fail('settings.js: checkinNeededFrom must be 1..4');
  S.soldOut.forEach(function (k) { if (tk.indexOf(k) < 0) fail('settings.js: soldOut has unknown tier ' + k); });
  tk.forEach(function (k) {
    var sub = S.substitutes[k];
    if (sub && (typeof sub.reward !== 'string' || !sub.img || !sub.img.length)) fail('settings.js: substitutes.' + k + ' needs reward and img');
  });
  fm = S.fallbackMerch;
  if (!fm || !fm.free || !fm.tiers || fm.tiers.length !== 3) fail('settings.js: fallbackMerch needs free and 3 tiers');
  // fallbackMerch is an exact copy of config.js merch (read here, never written).
  try {
    cfg = load(['site/config.js']).KLEROS_BOOTH_CONFIG;
    if (JSON.stringify(cfg.merch) !== JSON.stringify(fm)) warn('settings.js: fallbackMerch differs from config.js merch');
  } catch (e) { warn('config.js could not be read: ' + e.message); }
}

// ---- Scoring (3 Nov c) ----
// The owner (3 Nov): 8 of 10 right still won only a sticker; 6 of 10 should reach the next tier. So 100 points a right
// answer, 10 a wrong one, 0 an entry still undecided at time-out, no evidence or streak bonus, and the tiers follow the
// right answers: Teal at 6 right, Purple at 8, Gold for 10 out of 10. Played here with the real rules on dealt rounds of
// every deck, whatever the mix of mistakes and the parts picked; then the game's own flash (verdict(), run from
// game.js), Results (rewards.js in a fake page), How it works and the title's gradient text.
var RIGHT_FOR = [0, 6, 8, 10];   // right answers of 10 for Everyone, Teal, Purple, Gold
// Correct on everything: the real entries right, the fakes wrong.
function allCorrect() { return (S.entries - S.fakes) * S.points.letThrough + S.fakes * S.points.leak; }
function checkScoring() {
  var n = 0, P = S.points, rand = mulberry32(303), GAME = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8'),
    HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), bad = {}, bonus = 0, m, f, verdict, how, css, fake, good, x;
  function ok(cond, msg) { n++; if (!cond) fail('scoring: ' + msg); }
  function want(right) { for (var t = 3; t > 0; t--) if (right >= RIGHT_FOR[t]) return t; return 0; }
  function pts(right, wrong) { return right * P.catch + wrong * P.leak; }
  // A dealt round of deck with `right` of its entries right (picked at random), the first `decided` decided; each right
  // Wrong taps the wrong part or another one by a coin flip, each mistake is whichever the entry allows.
  function round(deck, right, decided) {
    var items = R.buildRun(deck, [], rand).items, sc = R.newScore(), at = items.map(function (y, i) { return i; }), yes = {}, i, it, r, act, pk, sw;
    for (i = at.length - 1; i > 0; i--) { r = Math.floor(rand() * (i + 1)); sw = at[i]; at[i] = at[r]; at[r] = sw; }
    at.slice(0, right).forEach(function (j) { yes[j] = 1; });
    for (i = 0; i < Math.min(decided, items.length); i++) {
      it = items[i];
      act = !!it.bad === !!yes[i] ? 'challenge' : 'letThrough';
      pk = act !== 'challenge' ? '' : !it.bad ? anyPart(it, rand) : rand() < 0.5 ? it.bad : wrongPart(it, rand);
      if (R.apply(sc, it, R.judge(it, act, pk)).streakBonus) bonus++;
    }
    R.finish(sc);
    return sc;
  }
  ok(S.entries === RIGHT_FOR[3] && P.catch === P.letThrough && P.wrongChallenge === P.leak && P.leak >= 0 && P.evidence === 0 &&
    P.streakBonus === 0 && P.streakEvery > 0, 'points must be one value a right answer, one a wrong one (never below 0), no evidence or streak bonus: ' + JSON.stringify(P));
  // Every count of right answers, decided in full: the score is the answers, and the tier follows the right ones.
  DECK_IDS.forEach(function (deck) {
    var right, k, sc;
    for (right = 0; right <= S.entries; right++) {
      for (k = 0; k < 20; k++) {
        sc = round(deck, right, S.entries);
        if (sc.final !== pts(right, S.entries - right) || R.tierFor(sc.final) !== want(right)) bad[deck + ' ' + right] = sc.final + ' (tier ' + R.tierFor(sc.final) + ')';
      }
    }
    // Time ran out: undecided entries score nothing, and the tier still follows the right answers.
    for (right = 0; right <= S.entries; right++) {
      sc = round(deck, S.entries, right);
      if (sc.final !== pts(right, 0) || R.tierFor(sc.final) !== want(right)) bad[deck + ' ' + right + ' of ' + right + ' decided'] = sc.final;
    }
  });
  ok(!Object.keys(bad).length, 'rounds whose score or tier does not follow the right answers (' + RIGHT_FOR.slice(1).join(' / ') + ' right for Teal / Purple / Gold): ' + JSON.stringify(bad));
  ok(bonus === 0, bonus + ' streak bonuses in the dealt rounds');
  // The flash, from game.js itself: a right answer shows its points, a mistake none (its 10 are no reward), and a fake
  // marked Wrong scores the same with the wrong part or another one (the soft flash only teaches).
  m = ['fmt', 'signed'].map(function (k) { return (new RegExp('\\n  function ' + k + '\\(n\\) \\{[^\\n]*\\}\\n').exec(GAME) || [''])[0]; });
  f = /\n  function verdict\(o, item, picked\) \{[\s\S]*?\n  \}\n/.exec(GAME);
  if (!f || !m[0] || !m[1]) return fail('game.js: verdict(), fmt() or signed() is missing, so the flash checks did not run');
  verdict = new Function('MINUS', 'partName', 'fixText', m.join('') + f[0] + '\nreturn verdict;')('−',
    function (it, k) { return String(k); }, function (it) { return it.fix; });
  D.sights.items.forEach(function (it) { if (it.bad && !fake) fake = it; if (!it.bad && !good) good = it; });
  [['a fake marked Wrong, its wrong part', fake, 'challenge', fake.bad, 'good', '+' + P.catch],
    ['a fake marked Wrong, another part', fake, 'challenge', wrongPart(fake, rand), 'soft', '+' + P.catch],
    ['a real entry marked Correct', good, 'letThrough', '', 'good', '+' + P.letThrough],
    ['a real entry marked Wrong', good, 'challenge', anyPart(good, rand), 'bad', ''],
    ['a fake marked Correct', fake, 'letThrough', '', 'bad', '']].forEach(function (c) {
    var o = R.judge(c[1], c[2], c[3]), v = verdict(o, c[1], c[3]);
    ok(v.tone === c[4] && v.pts === c[5], 'the flash for ' + c[0] + ': ' + JSON.stringify(v) + ', want tone ' + c[4] + ' and points “' + c[5] + '”');
  });
  ok(/\n    if \(res\.streakBonus\) extra\.push\(/.test(GAME), 'game.js: the streak line no longer waits for a streak bonus (with none, it must not show)');
  ok(/hudScore\(R\.shown\(score\), !o\.correct\)/.test(GAME), 'game.js: a mistake’s 10 points bump the score like a reward');
  // Results: “N of 10 right”, the tier by right answers and the points to the next one (rewards.js, a v6 page).
  [5, 6, 7, 8, 9].forEach(function (right) {
    var pg = page(new Store()), sc = round('sights', right, S.entries), i = pg.CurateRewards.startShift('sights'), g = want(right),
      line, names = ['Everyone', 'Teal', 'Purple', 'Gold'];
    pg.CurateRewards.finishShift({ deck: 'sights', counted: i.counted, shiftNo: i.shiftNo, code: i.code, relaxed: false, endedBy: 'done',
      final: sc.final, raw: sc.raw, timeBonus: 0, reviewed: sc.reviewed, entries: S.entries, caught: sc.caught, fakesSeen: sc.fakesSeen,
      listed: sc.listed, goodsSeen: sc.goodsSeen, evidence: sc.evidence, wrong: sc.wrong, leaks: sc.leaks, trust: sc.trust,
      bestStreak: sc.bestStreak, misses: sc.misses, at: 0, reason: '' });
    line = pg.text('rep-tier-line');
    ok(pg.text('rep-sub') === right + ' of ' + S.entries + ' right' && line.indexOf(g ? names[g] + ' tier · ' : 'Everyone · ') === 0 &&
      line.slice(-(' · ' + (S.tiers[g + 1] - sc.final) + ' pts to ' + names[g + 1]).length) === ' · ' + (S.tiers[g + 1] - sc.final) + ' pts to ' + names[g + 1],
      'Results for ' + right + ' right (' + sc.final + ' pts): ' + pg.text('rep-sub') + ' / ' + line);
  });
  // How it works says the rule in one line, from settings.js (a retune must update it), and names no bonus.
  how = 'Here: Wrong is a challenge. ' + P.catch + ' points for each right answer, ' + P.leak + ' for trying. Teal at ' + RIGHT_FOR[1] +
    ' right, Purple at ' + RIGHT_FOR[2] + ', Gold for ' + RIGHT_FOR[3] + ' out of ' + S.entries + '.';
  x = (/<dialog\b[^>]*\bid="how"[\s\S]*?<\/dialog>/.exec(HTML) || [''])[0];
  ok(x.indexOf('<p>' + how + '</p>') > -1, 'How it works must say: ' + how);
  ok(!/extra points|bonus|streak/i.test(x.replace(/<!--[\s\S]*?-->|<[^>]*>/g, ' ')), 'How it works names a bonus there is none of');
  // The title's descender (3 Nov c, the g of “get”): a gradient clipped to the text paints inside the box only, so each
  // such rule pads its bottom and takes the padding back with a negative margin, so nothing below it moves.
  css = ((HTML.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*background-clip:\s*text[^{}]*\}/g) || []);
  ok(css.some(function (r) { return /^\s*#brief h1\s*\{/.test(r); }), 'index.html: #brief h1 is no longer gradient text (update this check)');
  css.forEach(function (r) {
    var pb = /padding-bottom:\s*(\d*\.?\d+)em/.exec(r), mb = /margin-bottom:\s*-(\d*\.?\d+)em/.exec(r);
    ok(pb && mb && Number(pb[1]) >= 0.1 && pb[1] === mb[1], 'index.html: ' + r.split('{')[0].trim() + ' clips a gradient to its text without padding-bottom ≥ .1em and the same negative margin-bottom (its descenders are cut)');
  });
  // Blind play (3 Nov c). Wrong on everything is the fakes right, Correct on everything the real entries right: with 4
  // fakes in 10 that was 6 right, Teal by the owner's rule for 10 taps without reading, so a round deals 5 fakes and
  // either is 5 right, under Teal.
  x = S.fakes * P.catch + (S.entries - S.fakes) * P.wrongChallenge;
  ok(R.tierFor(x) === 0, 'Wrong on everything, without reading, scores ' + x + ': Teal or above');
  x = allCorrect();
  ok(R.tierFor(x) === 0, 'Correct on everything, without reading, scores ' + x + ' (' + (S.entries - S.fakes) + ' real entries of ' + S.entries +
    ' right): Teal or above for 10 taps (deal more fakes, or raise Teal)');
  // The project README's tier table (outside the game: a warning only).
  x = fs.existsSync(path.join(ROOT, 'README.md')) ? fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8') : '';
  (x.match(/`tiers\[[123]\]` points \(\d[\d,]*/g) || []).forEach(function (s) {
    var k = +/\[(\d)\]/.exec(s)[1], v = Number(/\((\d[\d,]*)/.exec(s)[1].replace(/,/g, ''));
    if (v !== S.tiers[k]) warn('README.md: the tier table says tiers[' + k + '] is ' + v + '; settings.js says ' + S.tiers[k]);
  });
  console.log('Scoring\n  ' + n + ' cases (' + P.catch + ' a right answer, ' + P.leak + ' a wrong one; Teal / Purple / Gold at ' + RIGHT_FOR.slice(1).join(' / ') +
    ' right, in dealt rounds of every deck; the flash, Results, How it works, the title’s descender)');
}

// ---- Schema ----
// v5 (brief §3): sights show a photo, countries a flat flag, tokens a flat painted logo coin. No sleeve.
var SHAPES = ['photo', 'flag', 'coin'];
// The logo marks the coin painter draws (brief §3).
var MARKS = ['btc', 'eth', 'usdt', 'usdc', 'doge', 'sol', 'ada', 'link', 'uni', 'pol', 'avax', 'ton', 'shib', 'bnb', 'pnk',
  'xrp', 'ltc', 'xlm', 'dot', 'xmr', 'aave', 'arb', 'op', 'gno', 'near'];   // v6 brief §5: ten more marks
var IMG = path.join(DIR, 'img'), IMG_URL = '/curate/img/';
// Flag kinds: the number of colours, then the optional keys each kind takes (brief §3). v6 §5 adds only h4
// (four equal stripes, Mauritius) and h5 (five stripes, the middle one twice as tall: Thailand; a ratio for the
// thin white bands of Botswana).
var FLAG_KINDS = { v3: [3], h3: [3, 'ratio'], h2: [2], nordic: [2, 'inner'], disc: [2, 'off'], cross: [2],
  h3wheel: [4], h4: [4], h5: [5, 'ratio'] };
function hex(c) { return /^#[0-9a-f]{6}$/i.test(c || ''); }
// Photo credits (P0): every file in site/curate/img has exactly one entry, and only credited files are used.
var CREDITS = (function () {
  var c;
  try { c = load(['site/curate/credits.js']).CURATE_CREDITS; } catch (e) { fail('credits.js could not be read: ' + e.message); }
  return Array.isArray(c) ? c : [];
})();
var CREDITED = {}, USED = {};
function okFlag(fl, where) {
  var k = fl && FLAG_KINDS[fl.kind], key;
  if (!k) return fail(where + ': flag kind ' + (fl && fl.kind) + ' not allowed');
  if (!Array.isArray(fl.c) || fl.c.length !== k[0] || !fl.c.every(hex)) fail(where + ': a ' + fl.kind + ' flag needs ' + k[0] + ' #rrggbb colours');
  for (key in fl) if (key !== 'kind' && key !== 'c' && k.indexOf(key) < 1) fail(where + ': flag key ' + key + ' not allowed on ' + fl.kind);
  if (fl.ratio !== undefined && (!Array.isArray(fl.ratio) || fl.ratio.length !== k[0] ||
    !fl.ratio.every(function (x) { return typeof x === 'number' && x > 0; }))) fail(where + ': ratio needs ' + k[0] + ' positive numbers');
  if (fl.inner !== undefined && !hex(fl.inner)) fail(where + ': inner is not #rrggbb');
  if (fl.off !== undefined && (typeof fl.off !== 'number' || Math.abs(fl.off) > 0.25)) fail(where + ': off must be a number in ±0.25');
}
// A photo path is /curate/img/<file>.jpg, on disk and in credits.js. Returns the key (file name without .jpg).
function okImg(src, where) {
  var m = /^\/curate\/img\/([a-z0-9-]+)\.jpg$/.exec(src || '');
  if (!m) return fail(where + ': photo src ' + src + ' is not ' + IMG_URL + '<name>.jpg'), null;
  if (!fs.existsSync(path.join(IMG, m[1] + '.jpg'))) fail(where + ': ' + src + ' is not in site/curate/img');
  if (!CREDITED[m[1] + '.jpg']) fail(where + ': ' + src + ' has no entry in credits.js');
  USED[m[1] + '.jpg'] = 1;
  return m[1];
}
// A logo coin: { color, color2?, mark }, with or without shape (pick.coin leaves it out).
function okCoin(o, where) {
  var k;
  if (!o || typeof o !== 'object') return fail(where + ': a coin spec is missing');
  for (k in o) if (['shape', 'color', 'color2', 'mark'].indexOf(k) < 0) fail(where + ': coin key ' + k + ' not allowed');
  if (o.shape !== undefined && o.shape !== 'coin') fail(where + ': a coin spec has shape ' + o.shape);
  if (!hex(o.color)) fail(where + ': a coin needs color as #rrggbb');
  if (o.color2 !== undefined && !hex(o.color2)) fail(where + ': coin color2 is not #rrggbb');
  if (MARKS.indexOf(o.mark) < 0) fail(where + ': coin mark ' + o.mark + ' is not one of ' + MARKS.join(', '));
}
function okObj(o, where) {
  var allowed = { photo: ['src', 'alt', 'pos'], flag: ['flag'], coin: ['color', 'color2', 'mark'] }, k;
  if (!o || SHAPES.indexOf(o.shape) < 0) return fail(where + ': obj.shape ' + (o && o.shape) + ' not allowed');
  for (k in o) if (k !== 'shape' && allowed[o.shape].indexOf(k) < 0) fail(where + ': obj.' + k + ' not allowed on a ' + o.shape);
  if (o.shape === 'photo') {
    okImg(o.src, where);
    if (typeof o.alt !== 'string' || !o.alt) fail(where + ': a photo needs alt text');
    if (o.pos !== undefined && !/^\d{1,3}% \d{1,3}%$/.test(o.pos)) fail(where + ': photo pos ' + o.pos + ' is not "x% y%"');
  } else if (o.shape === 'flag') okFlag(o.flag, where);
  else okCoin(o, where);
}
function checkCredits() {
  var files = fs.existsSync(IMG) ? fs.readdirSync(IMG).filter(function (f) { return !/^\./.test(f); }) : [];
  CREDITS.forEach(function (c, i) {
    var at = 'credits.js[' + i + ']';
    ['file', 'subject', 'author', 'license', 'licenseUrl', 'source'].forEach(function (k) {
      if (typeof c[k] !== 'string' || !c[k].trim()) fail(at + ': ' + k + ' is missing');
    });
    if (CREDITED[c.file]) fail(at + ': ' + c.file + ' is credited twice');
    CREDITED[c.file] = 1;
    if (files.indexOf(c.file) < 0) fail(at + ': ' + c.file + ' is not in site/curate/img');
    if (!/^https:\/\//.test(c.licenseUrl || '') || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(c.source || '')) {
      fail(at + ': licenseUrl must be https and source a Commons file page');
    }
    if (!/^(CC0|Public domain|CC BY(-SA)? [0-9.]+)$/.test(c.license || '')) fail(at + ': licence ' + c.license + ' is not CC0, PD, CC BY or CC BY-SA');
  });
  files.forEach(function (f) {
    if (!/\.jpg$/.test(f)) fail('site/curate/img/' + f + ': only .jpg photos belong here');
    if (!CREDITED[f]) fail('site/curate/img/' + f + ': no entry in credits.js');
  });
}

// ---- Facts ----
// Typed here a second time, apart from decks.js, so a slip in either shows up. Checked by hand against each
// country’s flag specification, capital and country-code top-level domain (IANA root zone).
// Country: [capital, flag spec, words for the flag, web domain].
var COUNTRY = {
  Italy: ['Rome', { kind: 'v3', c: ['#009246', '#ffffff', '#ce2b37'] }, 'Green, white, red', '.it'],
  France: ['Paris', { kind: 'v3', c: ['#0055a4', '#ffffff', '#ef4135'] }, 'Blue, white, red', '.fr'],
  Ireland: ['Dublin', { kind: 'v3', c: ['#169b62', '#ffffff', '#ff883e'] }, 'Green, white, orange', '.ie'],
  Belgium: ['Brussels', { kind: 'v3', c: ['#1a1a1a', '#fdda24', '#ef3340'] }, 'Black, yellow, red', '.be'],
  Nigeria: ['Abuja', { kind: 'v3', c: ['#008751', '#ffffff', '#008751'] }, 'Green, white, green', '.ng'],
  Romania: ['Bucharest', { kind: 'v3', c: ['#002b7f', '#fcd116', '#ce1126'] }, 'Blue, yellow, red', '.ro'],
  Chad: ['N’Djamena', { kind: 'v3', c: ['#002664', '#fecb00', '#c60c30'] }, 'Dark blue, yellow, red', '.td'],
  Mali: ['Bamako', { kind: 'v3', c: ['#14b53a', '#fcd116', '#ce1126'] }, 'Green, yellow, red', '.ml'],
  Guinea: ['Conakry', { kind: 'v3', c: ['#ce1126', '#fcd116', '#009460'] }, 'Red, yellow, green', '.gn'],
  Peru: ['Lima', { kind: 'v3', c: ['#d91023', '#ffffff', '#d91023'] }, 'Upright red, white, red', '.pe'],   // the civil flag, no arms
  'Côte d’Ivoire': ['Yamoussoukro', { kind: 'v3', c: ['#f77f00', '#ffffff', '#009e60'] }, 'Orange, white, green', '.ci'],   // capital since 1983; Abidjan is the biggest city
  Germany: ['Berlin', { kind: 'h3', c: ['#1a1a1a', '#dd0000', '#ffce00'] }, 'Black, red, gold', '.de'],
  Austria: ['Vienna', { kind: 'h3', c: ['#c8102e', '#ffffff', '#c8102e'] }, 'Red, white, red', '.at'],
  Hungary: ['Budapest', { kind: 'h3', c: ['#ce2939', '#ffffff', '#477050'] }, 'Red, white, green', '.hu'],
  Estonia: ['Tallinn', { kind: 'h3', c: ['#0072ce', '#1a1a1a', '#ffffff'] }, 'Blue, black, white', '.ee'],
  Colombia: ['Bogotá', { kind: 'h3', c: ['#fcd116', '#003893', '#ce1126'], ratio: [2, 1, 1] }, 'Yellow, blue, red', '.co'],
  Netherlands: ['Amsterdam', { kind: 'h3', c: ['#ae1c28', '#ffffff', '#21468b'] }, 'Red, white, blue', '.nl'],   // the constitution’s capital; The Hague is the seat of government
  Luxembourg: ['Luxembourg', { kind: 'h3', c: ['#ed2939', '#ffffff', '#00a1de'] }, 'Red, white, light blue', '.lu'],
  Bulgaria: ['Sofia', { kind: 'h3', c: ['#ffffff', '#00966e', '#d62612'] }, 'White, green, red', '.bg'],
  Lithuania: ['Vilnius', { kind: 'h3', c: ['#fdb913', '#006a44', '#c1272d'] }, 'Yellow, green, red', '.lt'],
  Latvia: ['Riga', { kind: 'h3', c: ['#9e3039', '#ffffff', '#9e3039'], ratio: [2, 1, 2] }, 'Dark red, thin white band', '.lv'],
  Gabon: ['Libreville', { kind: 'h3', c: ['#009e60', '#fcd116', '#3a75c4'] }, 'Green, yellow, blue', '.ga'],
  'Sierra Leone': ['Freetown', { kind: 'h3', c: ['#1eb53a', '#ffffff', '#0072c6'] }, 'Green, white, blue', '.sl'],
  Armenia: ['Yerevan', { kind: 'h3', c: ['#d90012', '#0033a0', '#f2a800'] }, 'Red, blue, orange', '.am'],
  Poland: ['Warsaw', { kind: 'h2', c: ['#ffffff', '#dc143c'] }, 'White over red', '.pl'],
  Monaco: ['Monaco', { kind: 'h2', c: ['#ce1126', '#ffffff'] }, 'Red over white', '.mc'],
  Ukraine: ['Kyiv', { kind: 'h2', c: ['#0057b7', '#ffd700'] }, 'Blue over yellow', '.ua'],   // DSTU 4512:2006 colours
  Sweden: ['Stockholm', { kind: 'nordic', c: ['#006aa7', '#fecc02'] }, 'Blue, yellow cross', '.se'],
  Finland: ['Helsinki', { kind: 'nordic', c: ['#ffffff', '#002f6c'] }, 'White, blue cross', '.fi'],
  Denmark: ['Copenhagen', { kind: 'nordic', c: ['#c8102e', '#ffffff'] }, 'Red, white cross', '.dk'],
  Norway: ['Oslo', { kind: 'nordic', c: ['#ba0c2f', '#ffffff'], inner: '#00205b' }, 'Red, blue cross edged white', '.no'],
  Iceland: ['Reykjavík', { kind: 'nordic', c: ['#02529c', '#ffffff'], inner: '#dc1e35' }, 'Blue, red cross edged white', '.is'],
  Japan: ['Tokyo', { kind: 'disc', c: ['#ffffff', '#bc002d'] }, 'White, red disc', '.jp'],
  Bangladesh: ['Dhaka', { kind: 'disc', c: ['#006a4e', '#f42a41'], off: -0.05 }, 'Green, red disc', '.bd'],   // disc at 45% of the length
  // Palau (5:8): the disc centre is 7/10 of the height from the hoist, 7/16 of the length, so about -0.06 as for
  // Bangladesh. Capital Ngerulmud (Melekeok state) since 2006; Koror is the biggest town.
  Palau: ['Ngerulmud', { kind: 'disc', c: ['#4aadd6', '#ffde00'], off: -0.06 }, 'Light blue, yellow disc', '.pw'],
  Switzerland: ['Bern', { kind: 'cross', c: ['#da291c', '#ffffff'] }, 'Red, white cross', '.ch'],
  India: ['New Delhi', { kind: 'h3wheel', c: ['#ff9933', '#ffffff', '#138808', '#000080'] }, 'Saffron, white, green, navy wheel', '.in'],
  Mauritius: ['Port Louis', { kind: 'h4', c: ['#ea2839', '#1a206d', '#ffd500', '#00a551'] }, 'Red, blue, yellow, green', '.mu'],
  Thailand: ['Bangkok', { kind: 'h5', c: ['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'] }, 'Red, white, wide blue, white, red', '.th'],
  'Costa Rica': ['San José', { kind: 'h5', c: ['#002b7f', '#ffffff', '#ce1126', '#ffffff', '#002b7f'] }, 'Blue, white, wide red, white, blue', '.cr'],   // the civil flag, no arms
  // Botswana (9:1:4:1:9), a 2:3 flag whose white bands are thin fimbriations.
  Botswana: ['Gaborone', { kind: 'h5', c: ['#75aadb', '#ffffff', '#1a1a1a', '#ffffff', '#75aadb'], ratio: [9, 1, 4, 1, 9] }, 'Light blue, black band edged white', '.bw']
};
// Photo file: [name, city, country, words for the photo]. Each checked against the photo itself and its
// Commons page. City is the city, or “Near …” outside one: Jinshanling lies in Hebei, north-east of Beijing;
// Machu Picchu above Aguas Calientes, reached from Cusco; Elephanta Island in Mumbai Harbour, Raigad district.
// v6: Petra beside the town of Wadi Musa; Angkor Wat about 6 km north of Siem Reap; Stonehenge about 13 km north
// of Salisbury; Mount Fuji about 100 km south-west of Tokyo (as the Great Wall’s Jinshanling is from Beijing);
// Neuschwanstein in Schwangau, by Füssen; Chichén Itzá about 40 km west of Valladolid, Yucatán; Ahu Tongariki
// on Easter Island (Rapa Nui, Chile), whose one town is Hanga Roa. Qutub Minar (Mehrauli) and the Lotus Temple
// (Kalkaji) are in Delhi outside New Delhi; India Gate is in New Delhi. Mysore keeps its English name (officially
// Mysuru) so it reads like Mysore Palace. CSMT is Chhatrapati Shivaji Maharaj Terminus (renamed in 2017), shortened
// on the card because the full name overflows the 281 px value row at 375 px; its why line names it in full.
var SIGHT = {
  'eiffel': ['Eiffel Tower', 'Paris', 'France', 'Iron lattice tower'],
  'colosseum': ['Colosseum', 'Rome', 'Italy', 'Oval arena of stone arches'],
  'taj-mahal': ['Taj Mahal', 'Agra', 'India', 'White marble dome, four minarets'],
  'opera-house': ['Sydney Opera House', 'Sydney', 'Australia', 'White shell-shaped roofs'],
  'great-wall': ['Great Wall of China', 'Near Beijing', 'China', 'Stone wall winding over hills'],
  'golden-gate': ['Golden Gate Bridge', 'San Francisco', 'USA', 'Red suspension bridge'],
  'machu-picchu': ['Machu Picchu', 'Near Cusco', 'Peru', 'Stone ruins on a mountain ridge'],
  'big-ben': ['Big Ben', 'London', 'UK', 'Gothic clock tower'],
  'burj-khalifa': ['Burj Khalifa', 'Dubai', 'UAE', 'Very tall glass skyscraper'],
  'sagrada-familia': ['Sagrada Família', 'Barcelona', 'Spain', 'Basilica with tall spires'],
  'statue-liberty': ['Statue of Liberty', 'New York', 'USA', 'Green statue with a torch'],
  'christ-redeemer': ['Christ the Redeemer', 'Rio de Janeiro', 'Brazil', 'Statue, arms spread wide'],
  'gateway-of-india': ['Gateway of India', 'Mumbai', 'India', 'Stone arch lit at dusk'],
  'cst-mumbai': ['CSMT', 'Mumbai', 'India', 'Gothic station with domes'],
  'sea-link': ['Bandra–Worli Sea Link', 'Mumbai', 'India', 'Cable-stayed bridge over the sea'],
  'haji-ali': ['Haji Ali Dargah', 'Mumbai', 'India', 'White shrine with a dome'],
  'marine-drive': ['Marine Drive', 'Mumbai', 'India', 'Curving seafront at night'],
  'elephanta': ['Elephanta Caves', 'Near Mumbai', 'India', 'Three-faced stone carving'],
  'petra': ['Petra', 'Near Wadi Musa', 'Jordan', 'Temple carved in pink rock'],
  'angkor-wat': ['Angkor Wat', 'Near Siem Reap', 'Cambodia', 'Temple towers mirrored in a pond'],
  'stonehenge': ['Stonehenge', 'Near Salisbury', 'UK', 'Ring of standing stones'],
  'parthenon': ['Parthenon', 'Athens', 'Greece', 'Columned temple on a rocky hill'],
  'pyramids-giza': ['Pyramids of Giza', 'Giza', 'Egypt', 'Three pyramids in the desert'],
  'leaning-tower-pisa': ['Leaning Tower of Pisa', 'Pisa', 'Italy', 'White tower that leans'],
  'mount-fuji': ['Mount Fuji', 'Near Tokyo', 'Japan', 'Snow-capped volcano'],
  'neuschwanstein': ['Neuschwanstein Castle', 'Near Füssen', 'Germany', 'White castle above a forest'],
  'tower-bridge': ['Tower Bridge', 'London', 'UK', 'Bridge with two stone towers'],
  'brandenburg-gate': ['Brandenburg Gate', 'Berlin', 'Germany', 'Columned gate, chariot on top'],
  'chichen-itza': ['Chichén Itzá', 'Near Valladolid', 'Mexico', 'Stepped stone pyramid'],
  'moai': ['Moai', 'Near Hanga Roa', 'Chile', 'Row of giant stone heads'],
  'golden-temple': ['Golden Temple', 'Amritsar', 'India', 'Gold temple on a pool'],
  'hawa-mahal': ['Hawa Mahal', 'Jaipur', 'India', 'Pink palace, many small windows'],
  'qutub-minar': ['Qutub Minar', 'Delhi', 'India', 'Tall fluted red stone tower'],
  'mysore-palace': ['Mysore Palace', 'Mysore', 'India', 'Palace with red-capped domes'],
  'victoria-memorial': ['Victoria Memorial', 'Kolkata', 'India', 'White marble hall, big dome'],
  'charminar': ['Charminar', 'Hyderabad', 'India', 'Four arches, four minarets'],
  'lotus-temple': ['Lotus Temple', 'Delhi', 'India', 'White petal-shaped temple'],
  'meenakshi-temple': ['Meenakshi Temple', 'Madurai', 'India', 'Tower covered in carved figures'],
  'india-gate': ['India Gate', 'New Delhi', 'India', 'Sandstone war memorial arch']
};
// Token: [name, ticker, official website, coin spec, words for the logo]. Each website opened and checked on
// 29 Oct 2026 and again on 30 Oct 2026 (curl, and against its CoinGecko listing). XRP uses xrpl.org, the XRP
// Ledger’s own site (CoinGecko lists ripple.com, the company); NEAR is NEAR Protocol, as CoinGecko names it. Shiba Inu uses shib.io (shibatoken.com is a legacy redirect
// that showed a takedown notice in 2026); avax.network forwards to avalanche.com but is still Avalanche’s
// CoinGecko listing. Toncoin is left out (renamed Gram in 2026).
var TOKEN = {
  btc: ['Bitcoin', 'BTC', 'bitcoin.org', { color: '#f7931a', mark: 'btc' }, 'Orange coin, white B'],
  eth: ['Ethereum', 'ETH', 'ethereum.org', { color: '#627eea', mark: 'eth' }, 'Blue coin, white diamond'],
  usdt: ['Tether', 'USDT', 'tether.to', { color: '#26a17b', mark: 'usdt' }, 'Green coin, white T'],
  usdc: ['USD Coin', 'USDC', 'circle.com', { color: '#2775ca', mark: 'usdc' }, 'Blue coin, $ in a ring'],
  doge: ['Dogecoin', 'DOGE', 'dogecoin.com', { color: '#c2a633', mark: 'doge' }, 'Gold coin, white D'],
  sol: ['Solana', 'SOL', 'solana.com', { color: '#1a1a1a', mark: 'sol' }, 'Black coin, three slanted bars'],
  ada: ['Cardano', 'ADA', 'cardano.org', { color: '#0033ad', mark: 'ada' }, 'Navy coin, rings of white dots'],
  link: ['Chainlink', 'LINK', 'chain.link', { color: '#2a5ada', mark: 'link' }, 'Blue coin, white hexagon'],
  uni: ['Uniswap', 'UNI', 'uniswap.org', { color: '#ff007a', mark: 'uni' }, 'Pink coin, white U'],
  pol: ['Polygon', 'POL', 'polygon.technology', { color: '#8247e5', mark: 'pol' }, 'Purple coin, two linked hexagons'],
  avax: ['Avalanche', 'AVAX', 'avax.network', { color: '#e84142', mark: 'avax' }, 'Red coin, white triangle'],
  shib: ['Shiba Inu', 'SHIB', 'shib.io', { color: '#ffa409', mark: 'shib' }, 'Amber coin, white dog face'],
  bnb: ['BNB', 'BNB', 'bnbchain.org', { color: '#1a1a1a', color2: '#f0b90b', mark: 'bnb' }, 'Black coin, gold squares'],
  pnk: ['Kleros', 'PNK', 'kleros.io', { color: '#9013fe', mark: 'pnk' }, 'Violet coin, Kleros mark'],
  xrp: ['XRP', 'XRP', 'xrpl.org', { color: '#23292f', mark: 'xrp' }, 'Charcoal coin, white X'],
  ltc: ['Litecoin', 'LTC', 'litecoin.org', { color: '#345d9d', mark: 'ltc' }, 'Blue coin, white L with a bar'],
  xlm: ['Stellar', 'XLM', 'stellar.org', { color: '#1a1a1a', mark: 'xlm' }, 'Black coin, ring with two lines'],
  dot: ['Polkadot', 'DOT', 'polkadot.com', { color: '#e6007a', mark: 'dot' }, 'Pink coin, ring of white dots'],
  xmr: ['Monero', 'XMR', 'getmonero.org', { color: '#ff6600', mark: 'xmr' }, 'Orange coin, white M'],
  aave: ['Aave', 'AAVE', 'aave.com', { color: '#b6509e', mark: 'aave' }, 'Purple-teal coin, white A'],
  arb: ['Arbitrum', 'ARB', 'arbitrum.io', { color: '#213147', mark: 'arb' }, 'Navy coin, A in a hexagon'],
  op: ['Optimism', 'OP', 'optimism.io', { color: '#ff0420', mark: 'op' }, 'Red coin, white OP'],
  gno: ['Gnosis', 'GNO', 'gnosis.io', { color: '#133629', color2: '#f0ebde', mark: 'gno' }, 'Dark green coin, cream G'],
  near: ['NEAR Protocol', 'NEAR', 'near.org', { color: '#1a1a1a', mark: 'near' }, 'Black coin, white N']
};
// Real tickers that may appear only as the wrong ticker on a fake, with what they really are (named in why).
var OTHER_TICKERS = { ETC: 'Ethereum Classic' };

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// Every key of table whose column col equals v (a location such as Mumbai, India fits several sights).
function keysWhere(table, col, v) { return Object.keys(table).filter(function (k) { return same(table[k][col], v); }); }
// For each field, the keys it points at; then exactly the `bad` field may disagree with the other three.
// `drawn` is the key of the drawn picture (photo, flag or logo), and `desc` the words that describe it.
function specOf(o) { var r = {}, k; for (k in o) if (k !== 'shape') r[k] = o[k]; return r; }
var VOTES = {
  sights: function (it) {
    var m = /\/([a-z0-9-]+)\.jpg$/.exec(it.obj.src || ''), drawn = m && SIGHT[m[1]] ? m[1] : null;
    return { photo: drawn ? [drawn] : [], name: keysWhere(SIGHT, 0, it.f.name), city: keysWhere(SIGHT, 1, it.f.city),
      country: keysWhere(SIGHT, 2, it.f.country), drawn: drawn, desc: drawn && SIGHT[drawn][3],
      truth: function (x, k) { return SIGHT[x][{ photo: 3, name: 0, city: 1, country: 2 }[k]]; } };
  },
  countries: function (it) {
    var drawn = keysWhere(COUNTRY, 1, it.obj.flag)[0] || null;
    return { flag: drawn ? [drawn] : [], country: COUNTRY[it.f.country] ? [it.f.country] : [],
      capital: keysWhere(COUNTRY, 0, it.f.capital), domain: keysWhere(COUNTRY, 3, it.f.domain), drawn: drawn,
      desc: drawn && COUNTRY[drawn][2],
      truth: function (x, k) { return k === 'country' ? x : COUNTRY[x][{ flag: 2, capital: 0, domain: 3 }[k]]; } };
  },
  tokens: function (it) {
    var drawn = keysWhere(TOKEN, 3, specOf(it.obj))[0] || null;
    return { logo: drawn ? [drawn] : [], name: keysWhere(TOKEN, 0, it.f.name), ticker: keysWhere(TOKEN, 1, it.f.ticker),
      site: keysWhere(TOKEN, 2, it.f.site), drawn: drawn, desc: drawn && TOKEN[drawn][4],
      truth: function (x, k) { return TOKEN[x][{ logo: 4, name: 0, ticker: 1, site: 2 }[k]]; } };
  }
};
// No prices and no investment talk on the Crypto exchange app (brief §3).
var MONEY = /\b(?:prices?|invest\w*|profits?|gains?|moon|pump\w*|returns?|yield|apy|trading|buy now|cheap|worth)\b|[€£₹]|\$\d/i;
function checkFacts(it, list, where) {
  var keys = list.fields.map(function (f) { return f[0]; }), v, others, x, y, k;
  if (!VOTES[it.list]) return fail(where + ': no fact table for list ' + it.list);
  v = VOTES[it.list](it);
  if (!v.drawn) return fail(where + ': the drawn ' + it.obj.shape + ' matches no known ' + list.objField);
  // The picture’s words always describe what is drawn: a wrong picture shows on the card.
  if (it.f[list.objField] !== v.desc) fail(where + ': ' + list.objField + ' words ' + it.f[list.objField] + ' do not describe the drawn picture (' + v.desc + ')');
  if (it.obj.shape === 'photo' && it.obj.alt !== v.desc) fail(where + ': photo alt ' + it.obj.alt + ' should be ' + v.desc);
  if (it.list === 'countries' && !/^\.[a-z]{2}$/.test(it.f.domain)) fail(where + ': domain ' + it.f.domain + ' is not a country-code domain like .it');
  if (it.list === 'tokens') {
    // Websites are bare domains (plain text, never links); tickers are capitals.
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(it.f.site)) fail(where + ': website ' + it.f.site + ' is not a bare domain');
    if (!/^[A-Z]{2,5}$/.test(it.f.ticker)) fail(where + ': ticker ' + it.f.ticker + ' is not 2 to 5 capitals');
    if (it.bad === 'ticker' && OTHER_TICKERS[it.f.ticker] && it.why.indexOf(OTHER_TICKERS[it.f.ticker]) < 0) {
      fail(where + ': ' + it.f.ticker + ' is a real ticker, so why must say it is ' + OTHER_TICKERS[it.f.ticker]);
    }
    for (k in it.f) if (MONEY.test(it.f[k])) fail(where + ': ' + k + ' talks money: ' + it.f[k]);
    if (MONEY.test(it.why)) fail(where + ': why talks money: ' + it.why);
  }
  others = keys.filter(function (k) { return k !== it.bad; });
  // The entries the other three parts agree on.
  x = v[others[0]].filter(function (p) { return others.every(function (k) { return v[k].indexOf(p) > -1; }); });
  if (!x.length) return fail(where + ': ' + others.join(', ') + ' do not all point at one entry');
  if (!it.bad) return;
  if (v[it.bad].some(function (p) { return x.indexOf(p) > -1; })) fail(where + ': the odd part ' + it.bad + ' agrees with the others');
  y = v.truth(x[0], it.bad);
  if (x.some(function (p) { return v.truth(p, it.bad) !== y; })) fail(where + ': ' + others.join(', ') + ' leave the fix ambiguous');
  if (it.fix !== y) fail(where + ': fix ' + it.fix + ' should be ' + y);
  if (it.bad === list.objField && it.tell !== 'card') fail(where + ': a wrong ' + it.bad + ' shows on the card, so its tell is card');
}
// Walks every string in a value and calls fn(string, path).
function strings(v, at, fn) {
  var k;
  if (typeof v === 'string') return fn(v, at);
  if (v && typeof v === 'object') for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) strings(v[k], at + '.' + k, fn);
}
var COUNTS = [];   // per list: [deck, list, good, fake, card tells], printed in the summary
// v5 brief §3: three apps in title-screen order, each with one list of 4 parts, its picture first.
// [list, objField, pick picture key, shape of every card’s picture]
var DECKS = { sights: ['sights', 'photo', 'img', 'photo'], countries: ['countries', 'flag', 'flag', 'flag'],
  tokens: ['tokens', 'logo', 'coin', 'coin'] };
var PARTS = 4;
// [good, fake] in the pool (v6 brief §5). Countries stop at 42 good: with the flag kinds allowed (h4 and h5
// added, nothing else) the plain flags of uncontroversial countries with settled capitals run out there (no
// emblems, stars or crests; Bolivia and Indonesia left out for their capitals, Russia and Yemen too); 41 since
// 2 Nov, when The Gambia left (players read its “The” as the error). POOL_MIN is
// the hard floor, the count delivered; POOL_BRIEF is what the brief asks, printed (not failed) while a list is
// below it, so the gap shows on every run instead of hiding behind “All checks passed”.
var POOL_MIN = { sights: [30, 15], countries: [41, 20], tokens: [20, 12] };   // 2 Nov: The Gambia left (its “The” read as an error)
var POOL_BRIEF = { sights: [30, 15], countries: [45, 20], tokens: [20, 12] };
// The policy is the practice coach’s idle hint (v6 §6): one short line.
var POLICY_MAX = 52;
// Short copy (v6 §6: one short line per idea, ≤ 8 words where possible): [path in the deck, max characters,
// max words]. The title card shows the app and one need line; the mission shows for a moment before Go.
var COPY_MAX = [['pick.app', 24, 5], ['pick.need', 36, 8], ['copy.mission', 28, 6]];
// The red flash says why in one line (v6 §2): every why fits 48 characters.
var WHY_MAX = 48;
// Results (v6 §6): a headline per trust band (≥ 90, 70–89, < 70), short; the v5 quote, payoffs and sub line are
// gone. Badge tries (2 Nov): the company line is plain words from rewards.js (“No wrong entry got through.”), so
// copy.company is gone too.
var HEAD_MAX = 24, GONE = ['pick.sub', 'copy.quotes', 'copy.quoteBy', 'copy.payoffs', 'copy.company'];
// The soft flash line (v6 §2: a fake marked Wrong, the wrong part picked): game.js verdict() builds it from the
// field label, lower-cased, and the fix, e.g. 'The wrong part was the city: Agra.'
var EV_LINE = 'The wrong part was the ', EV_MAX = 64;
function evLine(lab, fix) { return EV_LINE + lab.toLowerCase() + (fix ? ': ' + fix : '') + '.'; }
var EV_LINES = [], EV_LONG = '';
// Every field label must read inside that sentence: no quotes or end punctuation.
function checkLabel(where, lab) {
  var line = evLine(lab);
  if (/[“”"‘’'.,:;!?]$|[“”"]/.test(lab)) fail(where + ': label ' + lab + ' breaks ' + line);
  if (EV_LINES.indexOf(line) < 0) EV_LINES.push(line);
}
// Each fake’s own line must fit the flash.
function checkEvLine(where, lab, fix) {
  var line = evLine(lab, fix);
  if (line.length > EV_MAX) fail(where + ': ' + line + ' is ' + line.length + ' characters (max ' + EV_MAX + ')');
  if (line.length > EV_LONG.length) EV_LONG = line;
}
function words(x) { return String(x).split(/\s+/).filter(Boolean).length; }
function twinsOf(it) { return !it.twin ? [] : typeof it.twin === 'string' ? [it.twin] : it.twin; }
function checkItem(deck, it, ids, practice) {
  var where = deck.id + (practice ? '.practice ' : ' ') + (it && it.id), list, keys, k;
  if (!it || typeof it.id !== 'string' || !it.id) return fail(deck.id + ': an item has no id');
  if (ids[it.id]) fail(where + ': duplicate id');
  ids[it.id] = 1;
  list = deck.lists[it.list];
  if (!list) return fail(where + ': unknown list ' + it.list);
  keys = list.fields.map(function (f) { return f[0]; });
  for (k in it.f) if (keys.indexOf(k) < 0) fail(where + ': field ' + k + ' is not in list ' + it.list);
  keys.forEach(function (k) {
    if (typeof it.f[k] !== 'string' || !it.f[k].trim()) fail(where + ': field ' + k + ' is missing or empty');
  });
  if (it.twin !== null && typeof it.twin !== 'string' && !(Array.isArray(it.twin) && it.twin.length &&
    it.twin.every(function (t) { return typeof t === 'string' && t; }))) fail(where + ': twin must be null, a string or a list of strings');
  if ([1, 2, 3].indexOf(it.lvl) < 0) fail(where + ': lvl must be 1, 2 or 3');
  okObj(it.obj, where);
  if (it.obj && DECKS[deck.id] && it.obj.shape !== DECKS[deck.id][3]) fail(where + ': a ' + deck.id + ' entry cannot show a ' + it.obj.shape);
  if (it.bad !== null && keys.indexOf(it.bad) < 0) fail(where + ': bad ' + it.bad + ' is not a field of ' + it.list);
  if (!Array.isArray(it.also)) fail(where + ': also must be an array');
  else it.also.forEach(function (k) { if (keys.indexOf(k) < 0) fail(where + ': also has unknown field ' + k); });
  if (typeof it.why !== 'string' || !it.why) fail(where + ': why is missing');
  else if (it.why.length > WHY_MAX) fail(where + ': why is ' + it.why.length + ' characters (max ' + WHY_MAX + ')');
  if (it.bad) {
    if (it.tell !== 'card' && it.tell !== 'know') fail(where + ': a fake needs tell card or know');
    if (typeof it.fix !== 'string' || !it.fix) fail(where + ': a fake needs a fix');
    if (it.f[it.bad] === it.fix) fail(where + ': fix equals the shown value');
    list.fields.forEach(function (fd) { if (fd[0] === it.bad) checkEvLine(where, fd[1], it.fix); });
  } else if (it.tell || it.fix) fail(where + ': a good entry has a tell or fix');
  if (!it.obj || SHAPES.indexOf(it.obj.shape) < 0) return;
  checkFacts(it, list, where);
}
function get(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
function checkSchema() {
  var ids = {}, dk;
  if (!D) return fail('decks.js: window.CURATE_DECKS is missing');
  // v5 brief §3: three apps, in title-screen order.
  if (Object.keys(D).join() !== Object.keys(DECKS).join()) fail('decks.js: decks must be ' + Object.keys(DECKS).join(', ') + ' (found ' + Object.keys(D).join(', ') + ')');
  strings(D, 'CURATE_DECKS', function (s, at) {
    if (/http|[<>]/i.test(s)) fail('decks.js ' + at + ': contains http, < or >');
  });
  for (dk in D) {
    (function (deck) {
      var c = deck.copy || {}, pk = deck.pick || {}, want = DECKS[dk] || [], entries = 0, fakes = 0, lk, li, per = {},
        cardEasy = 0, easyFakes = 0, pt = {};
      if (deck.id !== dk) fail(dk + ': id must equal its key');
      if (typeof deck.client !== 'string' || !deck.client) fail(dk + ': client is missing');
      // The title-screen card: app, one need line, and the deck’s own kind of picture.
      ['app', 'need'].forEach(function (k) { if (typeof pk[k] !== 'string' || !pk[k]) fail(dk + ': pick.' + k + ' is missing'); });
      // Tokens: pick.coin (one logo) plus an optional pick.coins trio; the shell picks which to show.
      ['img', 'flag', 'coin', 'sleeve'].forEach(function (k) {
        if ((pk[k] !== undefined) !== (k === want[2])) fail(dk + ': the pick picture must be pick.' + want[2] + ' only');
      });
      if (pk.coins !== undefined && (want[2] !== 'coin' || !Array.isArray(pk.coins) || pk.coins.length !== 3)) fail(dk + ': pick.coins must be a trio on the tokens card only');
      if (pk.img !== undefined) okImg(pk.img, dk + '.pick');
      if (pk.flag !== undefined) okFlag(pk.flag, dk + '.pick');
      if (pk.coin !== undefined) okCoin(pk.coin, dk + '.pick.coin');
      (Array.isArray(pk.coins) ? pk.coins : []).forEach(function (o, i) { okCoin(o, dk + '.pick.coins[' + i + ']'); });
      if (dk === 'tokens') strings({ pick: pk, copy: c, coach: deck.coach }, dk, function (x, at) {
        if (MONEY.test(x)) fail(at + ': the Crypto exchange app talks money: ' + x);
      });
      if (typeof c.mission !== 'string' || !c.mission) fail(dk + ': copy.mission is missing');
      [['headlines', 3, HEAD_MAX]].forEach(function (k) {
        var a = c[k[0]];
        if (!Array.isArray(a) || a.length !== k[1] || !a.every(function (x) { return typeof x === 'string' && x; })) {
          return fail(dk + ': copy.' + k[0] + ' needs ' + k[1] + ' lines');
        }
        a.forEach(function (x, i) { if (x.length > k[2]) fail(dk + ': copy.' + k[0] + '[' + i + '] is ' + x.length + ' characters (max ' + k[2] + ')'); });
      });
      GONE.forEach(function (k) { if (get(deck, k) !== undefined) fail(dk + ': ' + k + ' is gone in v6 (fewer words)'); });
      COPY_MAX.forEach(function (m) {
        var s = get(deck, m[0]);
        if (typeof s === 'string' && s.length > m[1]) fail(dk + ': ' + m[0] + ' is ' + s.length + ' characters (max ' + m[1] + ')');
        if (typeof s === 'string' && words(s) > m[2]) fail(dk + ': ' + m[0] + ' is ' + words(s) + ' words (max ' + m[2] + ')');
      });
      if (deck.coach !== undefined && (!deck.coach || typeof deck.coach.fact !== 'string' || !deck.coach.fact)) fail(dk + ': coach.fact is missing');
      if (deck.hero !== undefined) fail(dk + ': hero is gone in v4 (pictures live on the title cards)');
      if (/music|song|sleeve/i.test(JSON.stringify(deck))) fail(dk + ': music is gone in v5');
      for (lk in deck.lists) {
        li = deck.lists[lk];
        if (!li.name || !li.policy || !li.fields || li.fields.length !== PARTS) fail(dk + '.' + lk + ': name, policy and ' + PARTS + ' fields needed');
        // Pick mode numbers the parts 1–4 in field order, the picture first.
        if (!li.fields || !li.fields[0] || li.fields[0][0] !== li.objField) fail(dk + '.' + lk + ': objField must be the first field');
        if (li.policy && li.policy.length > POLICY_MAX) fail(dk + '.' + lk + ': policy is ' + li.policy.length + ' characters (max ' + POLICY_MAX + ')');
        (li.fields || []).forEach(function (f) { checkLabel(dk + '.' + lk, f[1]); });
        per[lk] = [0, 0, 0];
      }
      // One list per app, with the drawn object (if any) as its first field.
      if (Object.keys(deck.lists || {}).join() !== want[0]) fail(dk + ': lists must be ' + want[0]);
      if (deck.lists[want[0]] && (deck.lists[want[0]].objField || null) !== want[1]) fail(dk + '.' + want[0] + ': objField must be ' + want[1]);
      if (deck.easy && !deck.lists[deck.easy]) fail(dk + ': easy list ' + deck.easy + ' does not exist');
      if (deck.late && !deck.lists[deck.late]) fail(dk + ': late list ' + deck.late + ' does not exist');
      for (lk in deck.split) {
        if (!deck.lists[lk]) fail(dk + ': split names unknown list ' + lk);
        entries += deck.split[lk][0]; fakes += deck.split[lk][1];
      }
      if (entries !== S.entries || fakes !== S.fakes) fail(dk + ': split adds up to ' + entries + '/' + fakes + ', settings say ' + S.entries + '/' + S.fakes);
      // Practice (brief §C): at least one card; the first is a fake the coach can explain.
      if (!Array.isArray(deck.practice) || !deck.practice.length || !deck.practice[0].bad) fail(dk + ': practice needs at least 1 item, a fake first');
      (deck.practice || []).forEach(function (it) {
        checkItem(deck, it, ids, true);
        twinsOf(it).forEach(function (t) { pt[t] = 1; });
      });
      (deck.items || []).forEach(function (it) {
        checkItem(deck, it, ids, false);
        if (per[it.list]) { per[it.list][it.bad ? 1 : 0]++; if (it.bad && it.tell === 'card') per[it.list][2]++; }
        if (it.bad && it.lvl === 1 && !twinsOf(it).some(function (t) { return pt[t]; })) { easyFakes++; if (it.tell === 'card') cardEasy++; }
      });
      // The intro (2 Nov): intro.good is a correct entry of this deck; practice[0] is the wrong example.
      if (!deck.intro || !(deck.items || []).some(function (it) { return it.id === deck.intro.good && !it.bad; })) {
        fail(dk + ': intro.good must name a correct entry of this deck');
      }
      if (easyFakes < 3) fail(dk + ': only ' + easyFakes + ' easy fakes can open a round (need ≥ 3)');
      if (cardEasy < 3) fail(dk + ': only ' + cardEasy + ' easy card-tell fakes can open a round (need ≥ 3)');
      for (lk in per) {
        COUNTS.push([dk, lk, per[lk][0], per[lk][1], per[lk][2]]);
        // At least half the fakes can be caught from the card plus the policy.
        if (per[lk][1] && per[lk][2] * 2 < per[lk][1]) fail(dk + '.' + lk + ': only ' + per[lk][2] + ' of ' + per[lk][1] + ' fakes are card tells (need ≥ 50%)');
        if (POOL_MIN[lk] && (per[lk][0] < POOL_MIN[lk][0] || per[lk][1] < POOL_MIN[lk][1])) {
          fail(dk + '.' + lk + ': pool is ' + per[lk][0] + ' good / ' + per[lk][1] + ' fake, brief §3 wants ≥ ' + POOL_MIN[lk].join(' / '));
        }
      }
      // Every photo is dealt as a good entry somewhere, so none is shown only on fakes.
      if (dk === 'sights') {
        Object.keys(SIGHT).forEach(function (k) {
          if (!(deck.items || []).some(function (it) { return !it.bad && it.obj && it.obj.src === IMG_URL + k + '.jpg'; })) fail(dk + ': no good entry shows ' + k + '.jpg');
        });
      }
    })(D[dk]);
  }
  CREDITS.forEach(function (c) { if (!USED[c.file]) warn('credits.js: ' + c.file + ' is credited but no deck shows it'); });
  console.log('Content');
  COUNTS.forEach(function (c) {
    console.log('  ' + pad(c[0] + '.' + c[1], 21) + lpad(c[2], 3) + ' good ' + lpad(c[3], 3) + ' fake  (' + c[4] + ' card tells)');
    var b = POOL_BRIEF[c[1]];
    if (b && (c[2] < b[0] || c[3] < b[1])) {
      console.log('    ' + c[1] + ': ' + c[2] + ' good, below the brief’s ' + b[0] + ' (accepted departure, see PR)');
    }
  });
  console.log('  ' + CREDITS.length + ' credited photos, ' + Object.keys(USED).length + ' used');
  // The sentence lives in game.js: make sure it is still the one rendered here.
  try {
    if (fs.readFileSync(path.join(DIR, 'game.js'), 'utf8').indexOf('\'' + EV_LINE + '\'') < 0) warn('game.js: the wrong-part line does not start \'' + EV_LINE + '\'; update evLine() here');
  } catch (e) { warn('game.js could not be read: ' + e.message); }
  console.log('Wrong-part lines (soft flash)\n  ' + EV_LINES.map(function (l) { return l.replace(/\.$/, ': …'); }).join('\n  ') +
    '\n  longest: ' + EV_LONG + ' (' + EV_LONG.length + ' of ' + EV_MAX + ')');
}

// ---- Dealing ----
// Deterministic generator, so every run of this script prints the same numbers.
function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var BUILDS = 2000;
// Returns the problems with one dealt round (empty when it follows §2.4).
function runProblems(deck, run, practiceIds) {
  var p = [], items = run.items, ids = {}, twins = {}, per = {}, fakes = 0, rf = 0, rg = 0, i, it, k, open;
  function easy(x) { return deck.easy ? x.list === deck.easy : x.lvl === 1; }
  if (run.deck !== deck.id) p.push('deck is ' + run.deck);
  if (items.length !== S.entries) p.push(items.length + ' entries');
  for (i = 0; i < items.length; i++) {
    it = items[i];
    if (ids[it.id]) p.push('duplicate ' + it.id);
    ids[it.id] = 1;
    twinsOf(it).forEach(function (t) { if (twins[t]) p.push('two of twin ' + t); twins[t] = 1; });
    if (practiceIds[it.id]) p.push('practice item ' + it.id);
    if (deck.intro && it.id === deck.intro.good) p.push('the intro’s correct example ' + it.id);
    per[it.list] = per[it.list] || [0, 0];
    per[it.list][0]++;
    if (it.bad) { fakes++; per[it.list][1]++; rf++; rg = 0; } else { rg++; rf = 0; }
    if (rf > 2) p.push('3 fakes in a row at ' + i);
    if (rg > 3) p.push('4 good entries in a row at ' + i);
    if (deck.late && it.list === deck.late && i < 5) p.push(deck.late + ' at index ' + i);
  }
  if (fakes !== S.fakes) p.push(fakes + ' fakes');
  for (k in deck.split) {
    if (!per[k] || per[k][0] !== deck.split[k][0] || per[k][1] !== deck.split[k][1]) {
      p.push(k + ' has ' + (per[k] || [0, 0]).join('/') + ', split says ' + deck.split[k].join('/'));
    }
  }
  open = items.slice(0, 3);
  if (!open.every(easy)) p.push('an opening entry is not from the easy pool');
  if (open.filter(function (x) { return x.bad; }).length !== 1 || open[0].bad) p.push('the opening needs one fake, at 1 or 2');
  // Every deck has a picture, so every round opens on a card tell.
  open.forEach(function (x) { if (x.bad && x.tell !== 'card') p.push('the opening fake is not a card tell'); });
  // Never open on the twin of a practice card.
  (deck.practice || []).forEach(function (pr) {
    twinsOf(pr).forEach(function (t) { if (open.some(function (x) { return twinsOf(x).indexOf(t) > -1; })) p.push('the opening repeats practice twin ' + t); });
  });
  return p;
}
function checkDealing() {
  var dk, out = [];
  for (dk in D) {
    (function (deck) {
      var rand = mulberry32(7), practiceIds = {}, last = [], bad = 0, first = '', repeats = 0, i, run, p;
      (deck.practice || []).forEach(function (it) { practiceIds[it.id] = 1; });
      for (i = 0; i < BUILDS; i++) {
        run = R.buildRun(deck.id, last, rand);
        p = runProblems(deck, run, practiceIds);
        if (p.length) { bad++; if (!first) first = p.join('; '); }
        // Like a phone: the previous round’s ids are passed in, so the next round avoids them where it can.
        repeats += run.items.filter(function (x) { return last.indexOf(x.id) > -1; }).length;
        last = run.items.map(function (x) { return x.id; });
      }
      if (bad) fail(deck.id + ': ' + bad + ' of ' + BUILDS + ' dealt rounds break §2.4, first: ' + first);
      // buildRun must not touch the deck: items are copies.
      run.items[0].why = 'changed';
      if (deck.items.some(function (x) { return x.why === 'changed'; })) fail(deck.id + ': buildRun returns the deck’s own objects');
      out.push('  ' + pad(deck.id, 11) + BUILDS + ' rounds, ' + bad + ' broken, ' +
        (Math.round(100 * repeats / (BUILDS - 1)) / 100) + ' entries repeated from the previous round on average');
    })(D[dk]);
  }
  // The intro’s two examples (2 Nov): copies of intro.good and practice[0], twins of each other.
  for (dk in D) {
    (function (ex) {
      if (!ex || !ex.good || ex.good.bad || !ex.bad || !ex.bad.bad) return fail(dk + ': CurateRules.intro gives no correct and wrong example');
      if (!twinsOf(ex.good).some(function (t) { return twinsOf(ex.bad).indexOf(t) > -1; })) fail(dk + ': the intro examples share no twin');
      ex.good.why = 'changed';
      if (D[dk].items.some(function (x) { return x.why === 'changed'; })) fail(dk + ': CurateRules.intro returns the deck’s own objects');
    })(R.intro ? R.intro(dk) : null);
  }
  // A missing rand falls back to Math.random.
  if (R.buildRun('sights', []).items.length !== S.entries) fail('buildRun without rand failed');
  // An unknown id (a stored v3 'travel' run) plays the first deck.
  if (R.buildRun('travel', [], mulberry32(3)).deck !== Object.keys(D)[0]) fail('buildRun with an unknown deck does not fall back to the first deck');
  console.log('Dealing');
  out.forEach(function (l) { console.log(l); });
}

// ---- ES5 lint ----
// Blanks comments, strings and regex literals (keeping newlines), so words in copy such as "let it through"
// are not mistaken for code. Backticks are kept so a template literal is still caught. onStr(text, line), when
// given, receives every quoted string literal: the copy check reads user copy through it.
function codeOnly(src, onStr) {
  var out = '', i = 0, n = src.length, c, q, prev = '', j, word, line = 1, at = 0;
  function blank(s) { return s.replace(/[^\n]/g, ' '); }
  while (i < n) {
    c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      j = src.indexOf('\n', i); if (j < 0) j = n;
      out += blank(src.slice(i, j)); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      out += blank(src.slice(i, j)); i = j; continue;
    }
    if (c === '\'' || c === '"') {
      q = c; j = i + 1;
      while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (onStr) { line += src.slice(at, i).split('\n').length - 1; at = i; onStr(src.slice(i + 1, j), line); }
      out += q + blank(src.slice(i + 1, j)) + q; i = j + 1; prev = 'x'; continue;
    }
    if (c === '/') {
      // A regex can only start where an operand is expected.
      word = /(?:return|typeof|case|in|of|void|delete|throw|new)$/.test(out.replace(/\s+$/, ''));
      if (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || word) {
        j = i + 1;
        var cls = false;
        while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          j++;
        }
        out += '/' + blank(src.slice(i + 1, j)) + '/'; i = j + 1; prev = 'x'; continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}
var LINT = [
  [/=>/, 'arrow function'], [/\blet\b/, 'let'], [/\bconst\b/, 'const'], [/`/, 'backtick'],
  [/\bclass\s+\w/, 'class'], [/\.\.\./, 'spread or rest'], [/\bfor\s*\([^)]*\bof\b/, 'for…of'],
  [/\bArray\.from\b/, 'Array.from'], [/\bObject\.assign\b/, 'Object.assign']
];
function checkLint() {
  // The game's own files, plus the staff desk and the booth web app (same house style, 2 Nov).
  var files = fs.readdirSync(DIR).filter(function (f) { return /\.js$/.test(f); }).sort()
    .map(function (f) { return 'site/curate/' + f; }).concat(['site/staff/desk.js', 'apps-script/staff-desk/Code.gs']), hits = 0;
  files.forEach(function (f) {
    var lines;
    try { lines = codeOnly(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n'); } catch (e) { return fail(f + ' could not be read'); }
    lines.forEach(function (line, i) {
      LINT.forEach(function (rule) {
        if (rule[0].test(line)) { hits++; fail(f + ':' + (i + 1) + ': ES5 only, found ' + rule[1]); }
      });
    });
  });
  console.log('ES5 lint\n  ' + files.length + ' file(s): ' + files.map(function (f) { return path.basename(f); }).join(', ') + (hits ? '' : ', clean'));
}

// ---- User copy ----
// Brief §2 and §3: no job words in anything a player can read (v6 §6 asks for the Results headline “Great job”,
// an idiom, so that one phrase passes), and nothing web3 except in the Crypto exchange
// app (v5 brief §5): its deck data and its title card copy, which all live in CURATE_DECKS.tokens. Only user
// copy is read:
// quoted string literals in site/curate/*.js (and inline scripts), plus index.html text and the readable
// attributes. Identifier-like strings ('shift', 'end-shift', 'startShift') are internal and stay; a word joined
// to another by a letter, digit, _ or - is part of an identifier, so it never counts either.
function word(w, flags) { return new RegExp('(?<![\\w-])(?:' + w + ')(?![\\w-])', flags === undefined ? 'i' : flags); }
var BANNED = [
  [word('shifts?'), 'shift'], [word('clients?'), 'client'], [word('hired'), 'hired'], [word('(?<!great )jobs?'), 'job'],
  [word('employees?'), 'employee'], [/staff of the company/i, 'staff of the company'], [word('work(?:ers?)?'), 'work'],
  [word('boss(?:es)?'), 'boss'], [/let (?:it |them |everything )?through/i, 'let it through'],
  [word('trainees?'), 'Trainee'], [word('senior'), 'Senior'], [/head curator/i, 'Head curator']
];
var WEB3 = [
  [word('tokens?'), 'token'], [word('wallets?'), 'wallet'], [word('crypto\\w*'), 'crypto'], [word('swap\\w*'), 'swap'],
  [word('ENS', ''), 'ENS'], [word('etherscan'), 'Etherscan'], [word('metamask'), 'MetaMask'], [word('uniswap'), 'Uniswap'],
  [word('tickers?'), 'ticker'], [word('contracts?'), 'contract'], [word('blockchains?'), 'blockchain'],
  [word('on-?chain'), 'on-chain'], [word('nfts?'), 'NFT'], [word('defi'), 'DeFi'], [word('web3'), 'web3'],
  [word('ether'), 'Ether'], [word('ETH', ''), 'ETH'], [word('bitcoin'), 'Bitcoin'], [word('coins?'), 'coin'],
  [word('PNK', ''), 'PNK'], [/seed phrase/i, 'seed phrase'], [word('dapps?'), 'dapp'], [word('airdrops?'), 'airdrop']
];
// v6 §1: Curate’s vocabulary stays in How it works (and at most one Results line about deposits). The play
// screen says Wrong and Correct: these words fail in game.js (cards, banners, coach, flash, toasts) and in the
// deck data, and only warn in the shell’s markup outside the How it works sheet.
var JARGON = [[word('challeng\\w*'), 'challenge'], [word('verif\\w*'), 'verify'], [word('listed'), 'listed'],
  [word('rejected'), 'rejected'], [word('jurors?'), 'jurors'], [word('bount(?:y|ies)'), 'bounty'],
  [word('deposits?'), 'deposit'], [word('stak(?:e|es|ed)'), 'stake'], [word('pending'), 'pending'],
  [word('submitted'), 'submitted']];
// 2 Nov (user): “2 tries per ticket”: a badge (or, without the sheet script, a phone) has 2 counted tries for the
// whole event. No copy may limit or renew tries by the day; the stock lines (“Gone today”) are about stock, not tries.
var DAILY = [[/\btr(?:y|ies)\b[^.]*\b(?:a|per|each|every) day\b/i, 'tries a day'],
  [/\b(?:a|per|each|every) day\b[^.]*\btr(?:y|ies)\b/i, 'a day … tries'], [/\btr(?:y|ies)\b[^.]*\btoday\b/i, 'tries … today'],
  [/\btoday(?:[’']s)? tr(?:y|ies)\b/i, 'today’s tries'], [/\btomorrow\b/i, 'tomorrow'], [/\bnew tries\b/i, 'new tries'],
  [/\bdaily tr(?:y|ies)\b/i, 'daily tries']];
function daily(t) { for (var i = 0; i < DAILY.length; i++) if (DAILY[i][0].test(t)) return DAILY[i][1]; return ''; }
// 3 Nov c (spec 3): the desk's Reset a player confirm says the player “can play 2 new tries” once staff delete their
// record: tries a reset gives back, not a day. Only that sentence, and only in the staff desk, passes.
function dailyAt(t, where) {
  var d = daily(t);
  return d === 'new tries' && /^site\/staff\//.test(where) && /\bdeleted: they can play \d+ new tries\b/.test(t) ? '' : d;
}
// The tries lines are built from fragments (' left', ' · Go!'), so a fragment saying “today” or “a day” fails on
// its own in the game’s code and markup, wherever the “try” is. The deck data is exempt (“a day trip”, “Today
// it’s Tokyo”), and so is stock (“Gone today”, “gone for today”): staff restock by the day.
function dayWord(t) {
  t = t.replace(/\bgone (?:for )?today\b/gi, ' ');
  return /\btoday\b/i.test(t) ? 'today' : /\b(?:a|per|each|every) day\b/i.test(t) ? 'a day' : /\bdaily\b/i.test(t) ? 'daily' : '';
}
var IDENT = /^[a-z_$][\w$.\-\/:]*$/;   // ids, keys, classes, paths, mode names
// Web3 words allowed in decks.js: every string the tokens deck holds (its entries, list, pick card and copy).
// The same words anywhere else (another deck, game.js, rewards.js, index.html) still fail.
var WEB3_OK = {};
if (D && D.tokens) strings(D.tokens, 'tokens', function (x) { WEB3_OK[x] = 1; });
// Identifiers that name the tokens deck or its parts on purpose (deck id, field keys, coin shape and marks).
var WEB3_IDS = ['tokens', 'coin', 'coins', 'ticker'].concat(MARKS);
var SHADER = /\b(?:gl_\w+|uniform|varying|attribute|precision)\b/;
function checkCopy() {
  var files = fs.readdirSync(DIR).filter(function (f) { return /\.js$/.test(f); }).sort(), n = 0, hits = 0, allowed = 0,
    play = 0;
  // play: 1 = play-screen copy (jargon fails), 2 = shell markup outside How it works (jargon warns).
  function test(text, where, isIdent, web3ok, onPlay) {
    var t = text.replace(/<[^>]*>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/\{\w+\}/g, ' ');
    if (!t.trim()) return;
    n++;
    if (isIdent) {
      if (web3ok || WEB3_IDS.indexOf(text) > -1) return;   // e.g. a token’s website, bitcoin.org
      WEB3.forEach(function (r) { if (r[0].test(t)) warn(where + ': identifier ' + text + ' still names ' + r[1]); });
      return;
    }
    BANNED.forEach(function (r) { if (r[0].test(t)) { hits++; fail(where + ': user copy says ' + r[1] + ': ' + t.trim().slice(0, 70)); } });
    if (dailyAt(t, where)) { hits++; fail(where + ': user copy counts tries by the day (' + daily(t) + '): ' + t.trim().slice(0, 70)); }
    else if (/^site\/curate\/(?!decks\.js)/.test(where) && dayWord(t)) {
      hits++; fail(where + ': game copy says ' + dayWord(t) + ' (tries are for the whole event; only stock is per day): ' + t.trim().slice(0, 70));
    }
    // v4 (user feedback): the title shows what an app needs, so the v3 line is retired everywhere.
    if (/spot the fakes/i.test(t)) warn(where + ': the retired v3 line “Spot the fakes” is still in user copy');
    if (onPlay) {
      play++;
      JARGON.forEach(function (r) {
        if (!r[0].test(t)) return;
        if (onPlay === 1) { hits++; fail(where + ': play-screen copy says ' + r[1] + ': ' + t.trim().slice(0, 70)); }
        else warn(where + ': markup outside How it works says ' + r[1] + ': ' + t.trim().slice(0, 70));
      });
    }
    if (web3ok) { allowed++; return; }
    WEB3.forEach(function (r) { if (r[0].test(t)) { hits++; fail(where + ': user copy is web3 (' + r[1] + '): ' + t.trim().slice(0, 70)); } });
  }
  function js(src, name, from) {
    var decks = name === 'site/curate/decks.js', onPlay = decks || name === 'site/curate/game.js' ? 1 : 0;
    codeOnly(src, function (str, line) {
      // A literal reads as the runtime string once its escapes are undone (decks.js has none today).
      if (!SHADER.test(str)) test(str, name + ':' + (from + line - 1), IDENT.test(str), decks && WEB3_OK[str] === 1, onPlay);
    });
  }
  files.forEach(function (f) { js(fs.readFileSync(path.join(DIR, f), 'utf8'), 'site/curate/' + f, 1); });
  // The staff desk (2 Nov): staff read it, so job and web3 words count; Curate’s jargon does not apply there.
  js(fs.readFileSync(path.join(STAFF, 'desk.js'), 'utf8'), 'site/staff/desk.js', 1);
  markup('site/curate/index.html', true);
  markup('site/staff/index.html', false);
  function markup(name, game) {
    var src = fs.readFileSync(path.join(ROOT, name), 'utf8'), m, re, html, how;
    function lineAt(i) { return src.slice(0, i).split('\n').length; }
    // The How it works sheet may name Curate’s words; the rest of the markup should not.
    how = /<dialog\b[^>]*\bid="how"[\s\S]*?<\/dialog>/i.exec(src) || { index: -1, 0: '' };
    function where(i) { return !game || (i >= how.index && i < how.index + how[0].length) ? 0 : 2; }
    function blank(x) { return x.replace(/[^\n]/g, ' '); }
    // Inline scripts are read as JS; comments, styles and scripts are then blanked so only markup is left.
    re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = re.exec(src))) if (m[1].trim()) js(m[1], name, lineAt(m.index + m[0].indexOf(m[1])));
    html = src.replace(/<!--[\s\S]*?-->|<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>/gi, blank);
    re = /\s(?:aria-label|aria-description|title|alt|placeholder|content|value|data-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    while ((m = re.exec(html))) test(m[1] !== undefined ? m[1] : m[2], name + ':' + lineAt(m.index), false, false, where(m.index));
    re = />([^<]+)</g;
    while ((m = re.exec(html))) if (m[1].trim()) test(m[1], name + ':' + lineAt(m.index), false, false, where(m.index));
  }
  // The user’s words for the title (2 Nov), the privacy notice the contact step links to, and no retired line.
  (function (src) {
    var h1 = /<h1\b[^>]*\bid="brief-title"[^>]*>([\s\S]*?)<\/h1>/.exec(src), lead = /\bid="brief-lead"[^>]*>([\s\S]*?)</.exec(src);
    if (!h1 || h1[1].trim() !== 'Help an app, get rewarded.') fail('index.html: the title h1 must read Help an app, get rewarded.');
    if (!lead || lead[1].trim() !== 'Each entry is right, or has one error. Spot the errors in ' + S.seconds + ' s.') {
      fail('index.html: the title lead must read Each entry is right, or has one error. Spot the errors in ' + S.seconds + ' s.');
    }
    if (!/\bid="curate-privacy"/.test(src)) fail('index.html: #curate-privacy (the privacy notice) is missing');
  })(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'));
  fs.readdirSync(DIR).filter(function (f) { return /\.(js|html)$/.test(f); }).forEach(function (f) {
    if (/clean list/i.test(fs.readFileSync(path.join(DIR, f), 'utf8'))) fail('site/curate/' + f + ': the retired line “Clean list” is still there');
  });
  // The docs and the server say the same (2 Nov): no retired per-day wording about tries ("not 2 a day" is fine).
  ['README.md', 'docs/DEPLOY.md', 'apps-script/staff-desk/README.md', 'apps-script/staff-desk/Code.gs'].forEach(function (f) {
    var src = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '', m,
      re = /(?:\d|two|counted) tries (?:a|each|every|per) day|tries (?:per|each|every) day|tries daily|per (?:badge|phone) per day|daily tries|new tries tomorrow|tr(?:y|ies) left today|tries used today|countedPerDay|PER_DAY|perDay|lastDay/ig;
    while ((m = re.exec(src))) fail(f + ':' + src.slice(0, m.index).split('\n').length + ': says tries are per day (' + m[0] + '); they are per badge for the whole event');
  });
  console.log('User copy\n  ' + n + ' strings and text runs in ' + (files.length + 3) + ' files' +
    (hits ? ': ' + hits + ' banned, web3 or jargon word(s)' : ': no job words, nothing web3') + ' (' + allowed +
    ' tokens-deck strings may name tokens; ' + play + ' play-screen strings free of Curate jargon)');
}

// ---- Sizes ----
// Budgets in bytes: [raw, gzip] (0 = no limit). The data files (settings, decks, rules, credits) fail when over;
// the rest only warn. Each budget is the measured size plus about 10%: set after the first review round, set
// again for v3 (28 Oct), and for v4 the data files (three decks, one list each, photo credits) plus objects.js
// and gl.js (landmarks, cloth and hero gone, medal back), and game.js +1.5 KB (picker, practice toggle, relaxed
// finish-bonus toasts) after its comments were trimmed. v5: decks.js holds 4 parts per entry and a third,
// larger pool (tokens with painted logos) in place of music; game.js +2 KB and index.html +3.5 KB for pick mode
// (enter, cancel, 1–4 keys, focus; banner, badges, outlines, dimming, Cancel bar) and the coin title card.
// Then game.js +2 KB more after review (parts out of the tab order outside pick mode, focus after a pick,
// the double-tap guard on the swapping action bar, the longer practice hold), and the total with it.
// v6 (a larger database, brief §5): decks.js about doubles its pools (72 sights, 68 countries, 43 tokens) and
// credits.js holds 39 photo credits instead of 18; objects.js gains ten painted logo marks and the h4 and h5
// flags; the eager total follows.
// Unminified on purpose: no build step, and the source stays readable. Raise a budget only with a reason.
// Photos in site/curate/img are reported apart, each within 60 KiB, and stay out of the eager total (v4 brief):
// a card loads its photo when dealt; only the Sightseeing pick card shows one (taj-mahal.jpg) on the title screen.
var KB = 1024, IMG_MAX = 60 * KB;
// objects.js paint() caps the photo box at 360 px tall, so a shorter photo is upscaled even at 1× and looks soft.
// Warn under 350 px: opera-house.jpg (v4, 354 px) is within 2% and stays.
var IMG_MIN_H = 350;
// Height of a JPEG from its first SOF0/SOF1/SOF2 marker, or 0 when none is found.
function jpegHeight(buf) {
  var i = 2, m, len;
  while (i + 9 < buf.length && buf[i] === 0xff) {
    m = buf[i + 1]; len = buf.readUInt16BE(i + 2);
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return buf.readUInt16BE(i + 5);
    i += 2 + len;
  }
  return 0;
}
// Badge tries (2 Nov): settings.js 4.8 KB (the server, badge and contact keys; lastDay went with daily tries); rules.js 9.2 KB (intro());
// earn.js is now the contact step (6 KB / 2.5 KB gz); game.js 58 KB / 18.5 KB gz (intro, scanner sheet);
// index.html 77 KB / 22 KB gz (intro, scanner, contact, privacy notice); badge.js is new (10 KB / 4 KB gz).
// rewards.js 78 KB / 25 KB gz, above the spec’s 56 / 18.5: it holds both modes (v6 per phone and badge mode: tries,
// saving with retries, switches, the locked ticket), measured 74.2 / 23.6. The total follows (eager files).
// Verify modes (3 Nov, growth accepted for the ship-day build; the owner may still ask for a lazy Telegram file):
// rewards.js 92 KB / 29.25 KB gz holds the Telegram verify flow, its tgcheck polling, the kiosk QR, mode-aware copy,
// the ticket QR text and the QR retry, measured 91.4 / 29.1; badge.js 11.5 KB / 4.75 KB gz adds loadQR and qr() (the
// SVG drawing; the generator itself is lazy), measured 11.4 / 4.7. The total follows: 338 KB / 108.5 KB gz.
// 3 Nov b (spec 2): rewards.js 97 KB / 31 KB gz holds the consent tick (its key, the dimmed link, Tick the box first),
// back and app on every tgcheck and the way back from the bot's Back to the game button (tgLand, landed), measured
// 96.0 / 30.6. The total follows: 344 KB / 110.25 KB gz.
// 3 Nov c (review): badge.js 11.75 KB / 4.875 KB gz, as post() passes keepalive (the Telegram tap's ask outlives the
// page), measured 11.55 / 4.79. rewards.js (the watch, agree, the tablet's focus) and the total stay within theirs.
var BUDGETS = {
  // settings.js +0.5 KB and earn.js: the Earn for real sign-up (30 Oct); +0.25 KB: separate desk and sign-up sheets (2 Nov).
  'settings.js': [4.8 * KB, 0, true], 'earn.js': [6 * KB, 2.5 * KB], 'decks.js': [47.5 * KB, 13.75 * KB, true], 'rules.js': [9.2 * KB, 0, true],
  'credits.js': [12 * KB, 2.75 * KB, true],
  // game.js +0.25 KB gz: a stale start reply is ignored and the scanner skips non-badge codes (2 Nov review).
  'objects.js': [33.5 * KB, 12.5 * KB], 'gl.js': [21 * KB, 8.25 * KB], 'game.js': [58 * KB, 18.75 * KB],
  // rewards.js +0.5 KB gz in v6: the tries line, the early-end headline and the just-for-fun tier line.
  'rewards.js': [97 * KB, 31 * KB], 'index.html': [77 * KB, 22 * KB], 'badge.js': [11.75 * KB, 4.875 * KB]
};
var TOTAL = [344 * KB, 110.25 * KB];   // eager files only: gl.js loads later, and only where WebGL runs; jsQR only to scan
function checkSizes() {
  var total = 0, totalGz = 0, imgs = [], imgTotal = 0, big = 0;
  console.log('Sizes (raw / gzip, budget)');
  Object.keys(BUDGETS).forEach(function (f) {
    var b = BUDGETS[f], p = path.join(DIR, f), buf, raw, gz, over;
    if (!fs.existsSync(p)) return console.log('  ' + pad(f, 12) + 'not written yet');
    buf = fs.readFileSync(p);
    raw = buf.length; gz = zlib.gzipSync(buf, { level: 9 }).length;
    if (f !== 'gl.js') { total += raw; totalGz += gz; }
    over = (b[0] && raw > b[0]) || (b[1] && gz > b[1]);
    console.log('  ' + pad(f, 12) + lpad(raw, 6) + ' / ' + lpad(gz, 5) + '   ≤ ' + (b[0] / KB) + ' KB' +
      (b[1] ? ' / ' + (b[1] / KB) + ' KB gz' : '') + (over ? '   OVER' : ''));
    if (over) (b[2] ? fail : warn)('site/curate/' + f + ' is over its budget');
  });
  console.log('  ' + pad('total', 12) + lpad(total, 6) + ' / ' + lpad(totalGz, 5) + '   ≤ ' + (TOTAL[0] / KB) + ' KB / ' +
    (TOTAL[1] / KB) + ' KB gz, before gl.js and photos');
  if (total > TOTAL[0] || totalGz > TOTAL[1]) warn('site/curate is over the total budget (eager files)');
  // jsQR loads only when a phone without a built-in QR reader scans a badge, and qrcode-generator (3 Nov) only when a
  // ticket QR or the tablet's Telegram QR shows: both reported apart, out of the total, each with its licence.
  [['jsQR', 'only when a scan needs it', 'the iPhone badge reader'], ['qrcode', 'only when a QR shows', 'the ticket QR maker']].forEach(function (v) {
    var p = path.join(DIR, 'vendor', v[0] + '.js'), buf = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (!buf) return fail('site/curate/vendor/' + v[0] + '.js is missing (' + v[2] + ')');
    console.log('  ' + pad('vendor/' + v[0], 12) + lpad(buf.length, 6) + ' / ' + lpad(zlib.gzipSync(buf, { level: 9 }).length, 5) + '   lazy: ' + v[1]);
    if (!fs.existsSync(path.join(DIR, 'vendor', v[0] + '-LICENSE.txt'))) fail('site/curate/vendor/' + v[0] + '-LICENSE.txt is missing');
  });
  if (fs.existsSync(IMG)) imgs = fs.readdirSync(IMG).filter(function (f) { return /\.jpg$/.test(f); });
  imgs.forEach(function (f) {
    var buf = fs.readFileSync(path.join(IMG, f)), n = buf.length, h = jpegHeight(buf);
    imgTotal += n;
    if (n > IMG_MAX) { big++; fail('site/curate/img/' + f + ' is ' + n + ' bytes (max ' + IMG_MAX + ')'); }
    if (h < IMG_MIN_H) warn('site/curate/img/' + f + ' is ' + (h || '?') + ' px tall, under ' + IMG_MIN_H + ': it upscales in the card');
  });
  console.log('  ' + pad('img/*.jpg', 12) + lpad(imgTotal, 7) + '  in ' + imgs.length + ' photos, not eager, each ≤ 60 KB' + (big ? '   OVER' : ''));
}

// ---- Booth web app (Code.gs) ----
// apps-script/staff-desk/Code.gs in a vm against stubs of exactly the Sheets API subset it may use (spec 1.3): an
// in-memory bound sheet (the badge list) plus the contacts sheet by CONTACTS_SHEET_ID, CacheService with TTLs on
// a fake clock, LockService, PropertiesService, Utilities.formatDate (Intl, booth time zone), ContentService and
// Logger. Written values are coerced the way Sheets does: a bare yyyy-MM-dd becomes a Date (midnight IST), a numeric
// string a number, and a leading ' is dropped (the rest stays text). H.writes keeps every value as sent.
// 3 Nov (verify modes): the Verify with dropdown (data validation builder), Sheet.deleteRow, the document and user
// locks (H.docBusy; opts.nodoclock: getDocumentLock() answers null, as Apps Script documents for a web app),
// Utilities.computeHmacSha256Signature (signed bytes, as Apps Script returns them) and getUuid, and UrlFetchApp
// against a fake Bot API (H.tg): getUpdates serves H.tg.updates from the offset sent, sendMessage (fetchAll) lands in
// H.tg.sent ({ chat, text, preview, markup }: markup is reply_markup, 3 Nov b), H.tg.down makes every fetch throw with
// the URL (and so the token) in its message, as Apps Script does.
// ScriptApp (3 Nov review): the project's triggers in H.triggers ({ fn, minutes }), so staffSetup's tgTick shows.
// 3 Nov c (review): a long poll (getUpdates timeout up to 25 s, each in H.tg.waits) with nothing to read waits: the
// clock moves on by the timeout, or H.tg.wait(seconds) runs instead (it may queue a message and move the clock
// itself); H.tg.instant answers at once without moving it. Each sent message keeps the clock (at). deleteTrigger.
// opts.mode: Verify with set to that mode (writeMode_) before any case; opts.token: TG_TOKEN set.
var GS_SRC = fs.existsSync(GS) ? fs.readFileSync(GS, 'utf8') : '';
var GS_T0 = Date.parse('2026-11-03T05:00:00Z');   // 10:30 IST on the first booth day
var TG_TOKEN = '7712345678:AAF-check-script-fake-token_x9';   // never a real token: the fake Bot API below answers it
// The Telegram username the fake Bot API gives a sender unless a case says otherwise (3 Nov c): one per account.
function tgUser(id) { return 'user' + id; }
function gsHarness(opts) {
  opts = opts || {};
  var H = { clock: GS_T0, lockBusy: false, docBusy: false, offline: false, logs: [], toasts: [], alerts: [], writes: [], menu: [],
    locks: [], triggers: [] }, cache = {}, props = {};
  H.tg = { updates: [], sent: [], calls: [], gets: 0, offsets: [], waits: [], down: false, instant: false, wait: null, seq: 500000, username: 'KlerosBoothBot' };
  function coerce(v) {
    H.writes.push(v);
    if (typeof v !== 'string') return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00+05:30');
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v.charAt(0) === '\'') return v.slice(1);
    return v;
  }
  function Sheet(name) { this.name = name; this.rows = []; this.prot = []; this.frozen = 0; this.boxes = {}; this.rules = {}; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(function (c) { return c !== '' && c !== undefined; })) return i;
    return 0;
  };
  Sheet.prototype.appendRow = function (a) {
    var i, at = this.getLastRow();
    this.rows[at] = a.map(coerce);
    for (i = 0; i < this.rows.length; i++) if (!this.rows[i]) this.rows[i] = [];
  };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  Sheet.prototype.deleteRow = function (r) {
    if (typeof r !== 'number' || r < 1 || r > this.getLastRow()) throw new Error('deleteRow ' + r + ' is outside the sheet');
    this.rows.splice(r - 1, 1);
  };
  Sheet.prototype.protect = function () {
    var p = { calls: [], setDescription: function () { p.calls.push('desc'); }, getEditors: function () { return ['owner']; },
      removeEditors: function () { p.calls.push('remove'); }, setWarningOnly: function () { p.calls.push('warn'); } };
    this.prot.push(p);
    return p;
  };
  Sheet.prototype.getRange = function (r, c, n, m) {
    var sh = this;
    if (typeof r !== 'number') throw new Error('getRange takes numbers only (spec 1.3)');
    n = n || 1; m = m || 1;
    function cell(i, j) { var row = sh.rows[r - 1 + i] || [], v = row[c - 1 + j]; return v === undefined ? '' : v; }
    function put(i, j, v) { while (sh.rows.length < r + i) sh.rows.push([]); sh.rows[r - 1 + i][c - 1 + j] = coerce(v); }
    return {
      getSheet: function () { return sh; },
      getValues: function () { var out = [], i, j; for (i = 0; i < n; i++) { out.push([]); for (j = 0; j < m; j++) out[i].push(cell(i, j)); } return out; },
      setValues: function (a) { for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) put(i, j, a[i][j]); },
      setValue: function (v) { put(0, 0, v); },
      insertCheckboxes: function () {
        for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) { sh.boxes[(r + i) + ':' + (c + j)] = true; if (cell(i, j) === '') put(i, j, false); }
      },
      setDataValidation: function (rule) {
        if (!rule || !rule.built) throw new Error('setDataValidation takes a built rule');
        for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) sh.rules[(r + i) + ':' + (c + j)] = rule;
      }
    };
  };
  function Book() { this.sheets = {}; }
  Book.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
  Book.prototype.insertSheet = function (n) { return (this.sheets[n] = new Sheet(n)); };
  Book.prototype.getEditors = function () { return opts.editors || ['owner']; };
  Book.prototype.toast = function (m) { H.toasts.push(m); };
  H.bound = new Book(); H.contacts = new Book();
  H.contacts.insertSheet('Contacts');   // the real contacts sheet: one empty tab, no headers yet
  function fmt(d, tz, f) {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    if (f === 'yyyy-MM-dd') return p.year + '-' + p.month + '-' + p.day;
    if (f === 'HH:mm') return p.hour + ':' + p.minute;
    if (f === 'EEE d MMM') return p.weekday + ' ' + Number(p.day) + ' ' + new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(d);
    if (f === 'yyyyMMddHHmm') return p.year + p.month + p.day + p.hour + p.minute;
    throw new Error('formatDate ' + f + ' is outside spec 1.3');
  }
  var ui = { createMenu: function () { return ui; }, addItem: function (label, fn) { H.menu.push([label, fn]); return ui; },
    addSeparator: function () { return ui; }, addToUi: function () {}, alert: function (s) { H.alerts.push(String(s)); } };
  function lock(kind, busy) {
    return { tryLock: function () { H.locks.push(kind); return !busy(); }, releaseLock: function () {} };
  }
  // The fake Bot API: one reply object per request, like UrlFetchApp's HTTPResponse.
  function reply(code, o) { return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(o); } }; }
  function botApi(url, o) {
    var m = /^https:\/\/api\.telegram\.org\/bot([^\/?]+)\/(\w+)(?:\?(.*))?$/.exec(String(url)), q = {}, off, body;
    if (!m) throw new Error('UrlFetchApp is only for the Telegram Bot API, not ' + String(url).slice(0, 40));
    if (H.tg.down) throw new Error('Exception: Address unavailable: ' + url);
    (m[3] || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    H.tg.calls.push(m[2]);
    if (m[1] !== TG_TOKEN) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (m[2] === 'getMe') return reply(200, { ok: true, result: { id: 7712345678, is_bot: true, username: H.tg.username } });
    if (m[2] === 'deleteWebhook') return reply(200, { ok: true, result: true });
    if (m[2] === 'getUpdates') {
      H.tg.gets++;
      if (q.allowed_updates !== '["message"]' || !/^(0|[1-9]\d?)$/.test(q.timeout || '') || Number(q.timeout) > 25 || !(Number(q.limit) >= 1)) {
        throw new Error('getUpdates query ' + m[3]);
      }
      off = Number(q.offset) || 0;
      H.tg.offsets.push(off); H.tg.waits.push(Number(q.timeout));
      // Telegram forgets every update below the offset it is sent (they count as read).
      H.tg.updates = H.tg.updates.filter(function (u) { return u.update_id >= off; });
      // A long poll with nothing to read waits for a message or the timeout.
      if (!H.tg.updates.length && Number(q.timeout) > 0 && !H.tg.instant) {
        if (H.tg.wait) H.tg.wait(Number(q.timeout)); else H.clock += Number(q.timeout) * 1000;
      }
      return reply(200, { ok: true, result: H.tg.updates.slice(0, Number(q.limit)) });
    }
    if (m[2] === 'sendMessage') {
      if (!o || String(o.method).toLowerCase() !== 'post' || o.contentType !== 'application/json') throw new Error('sendMessage is a JSON POST');
      body = JSON.parse(o.payload);
      H.tg.sent.push({ chat: body.chat_id, text: body.text, preview: body.disable_web_page_preview, markup: body.reply_markup, at: H.clock });
      return reply(200, { ok: true, result: { message_id: H.tg.sent.length } });
    }
    return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
  }
  // A private message to the bot (fromId's own chat) queued for the next getUpdates; more: { chat, isBot, noFrom,
  // username }. 3 Nov c: each sender has its own username (tgUser), or more.username: a string, or null for none.
  H.tg.say = function (fromId, text, more) {
    var x = more || {}, u = { update_id: ++H.tg.seq, message: { message_id: H.tg.seq, date: Math.floor(H.clock / 1000), text: text,
      chat: { id: x.chat ? -100123 : fromId, type: x.chat || 'private' } } };
    if (!x.noFrom) u.message.from = { id: fromId, is_bot: !!x.isBot, first_name: 'Ana' };
    if (!x.noFrom && x.username !== null) u.message.from.username = x.username === undefined ? tgUser(fromId) : x.username;
    H.tg.updates.push(u);
    return u.update_id;
  };
  function bytes(v) { return typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(function (b) { return (b + 256) % 256; })); }
  var ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return H.bound; },
      openById: function (id) { if (id === ctx.CONTACTS_SHEET_ID && id) return H.contacts; throw new Error('no sheet ' + id); },
      flush: function () {}, getUi: function () { return ui; },
      newDataValidation: function () {
        var b = { list: null, dropdown: null,
          requireValueInList: function (list, dropdown) { b.list = list.slice(); b.dropdown = dropdown; return b; },
          build: function () { if (!b.list) throw new Error('a rule without a criterion'); return { built: true, list: b.list, dropdown: b.dropdown }; } };
        return b;
      }
    },
    LockService: {
      getScriptLock: function () { return lock('script', function () { return H.lockBusy; }); },
      getDocumentLock: function () { return opts.nodoclock ? null : lock('document', function () { return H.docBusy; }); },
      getUserLock: function () { return lock('user', function () { return H.docBusy; }); }
    },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { var e = cache[k]; return e && e.t > H.clock ? e.v : null; },
      put: function (k, v, s) { cache[k] = { v: String(v), t: H.clock + (s || 600) * 1000 }; },
      remove: function (k) { delete cache[k]; } }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = String(v); } }; } },
    Utilities: { formatDate: fmt, getUuid: function () { return crypto.randomUUID(); },
      // Apps Script's Byte[]: signed, -128..127.
      computeHmacSha256Signature: function (value, key) {
        return Array.prototype.map.call(crypto.createHmac('sha256', bytes(key)).update(bytes(value)).digest(), function (b) { return b > 127 ? b - 256 : b; });
      } },
    UrlFetchApp: { fetch: botApi, fetchAll: function (reqs) { return reqs.map(function (r) { return botApi(r.url, r); }); } },
    // Time-driven triggers only, at the intervals Apps Script allows.
    ScriptApp: {
      getProjectTriggers: function () { return H.triggers.map(function (t) { return { t: t, getHandlerFunction: function () { return t.fn; } }; }); },
      deleteTrigger: function (x) {
        var i = x ? H.triggers.indexOf(x.t) : -1;
        if (i < 0) throw new Error('deleteTrigger takes one of getProjectTriggers()');
        H.triggers.splice(i, 1);
      },
      newTrigger: function (fn) {
        return { timeBased: function () { return { everyMinutes: function (n) {
          if ([1, 5, 10, 15, 30].indexOf(n) < 0) throw new Error('everyMinutes ' + n + ' is not an Apps Script interval');
          return { create: function () { H.triggers.push({ fn: fn, minutes: n }); return {}; } };
        } }; } };
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { s: s, setMimeType: function () { return this; } }; } },
    Logger: { log: function (s) { H.logs.push(String(s)); } }
  };
  vm.createContext(ctx);
  vm.runInContext(GS_SRC, ctx, { filename: 'Code.gs' });
  ctx.now_ = function () { return new Date(H.clock); };
  H.ctx = ctx; H.props = props; H.cache = cache;
  if (opts.token) props.TG_TOKEN = TG_TOKEN;
  if (opts.mode) ctx.writeMode_(opts.mode);
  // The Telegram player id and signature, computed here apart from Code.gs (HMAC-SHA256 under TG_SECRET).
  H.tgId = function (n) { return crypto.createHmac('sha256', props.TG_SECRET).update('tg|' + n).digest('hex'); };
  H.sig = function (id) { return crypto.createHmac('sha256', props.TG_SECRET).update('sig|' + id).digest('hex').slice(0, 32); };
  // The Verify with cell, by label, as Sheets holds it.
  H.verifyCell = function () {
    var rows = (H.tab('Switches') || { rows: [] }).rows, i;
    for (i = 1; i < rows.length; i++) if (rows[i] && rows[i][0] === 'Verify with') return { row: i + 1, value: rows[i][1] };
    return null;
  };
  H.call = function (b) { return JSON.parse(ctx.doPost({ postData: { contents: typeof b === 'string' ? b : JSON.stringify(b) } }).s); };
  H.tab = function (n) { return H.bound.sheets[n]; };
  H.rows = function (n) { var t = H.tab(n); return t ? t.getLastRow() : 0; };
  H.snap = function () { return JSON.stringify([H.bound.sheets, H.contacts.sheets]); };
  return H;
}
// The best possible round under settings.js, over every deck (spec 1.6): Code.gs MAX_SCORE must equal it.
function maxScore() {
  var P = S.points, best = 0;
  Object.keys(D).forEach(function (dk) {
    var e = 0, f = 0, k, sp = D[dk].split;
    for (k in sp) { e += sp[k][0]; f += sp[k][1]; }
    best = Math.max(best, f * (P.catch + P.evidence) + (e - f) * P.letThrough + Math.floor(e / P.streakEvery) * P.streakBonus);
  });
  return best;
}
function checkServer() {
  var n = 0, H, r, key, i, t1, t2, t3, t4, last, before, crow, sw, tmp, A = 'a'.repeat(64), B = 'b'.repeat(64),
    C = 'c'.repeat(64), E = 'e'.repeat(64), F = 'f'.repeat(64), seq = 0, HOUR = 3600 * 1000;
  // A Purple round (3 Nov c: 8 right and 2 wrong is 820), read from settings.js so a retune keeps these cases Purple.
  var P2 = S.tiers[2] + 20;
  function ok(cond, msg) { n++; if (!cond) fail('Code.gs: ' + msg); }
  function tok() { seq++; return ('tok' + seq + 'qwertyuiopasdfghjk').slice(0, 20); }
  function start(h, badge, t, more) {
    var b = { action: 'start', badge: badge, token: t || tok(), app: 'sights' }, k;
    for (k in more || {}) b[k] = more[k];
    return h.call(b);
  }
  function claim(h, badge, tier, id, more) {
    var b = { action: 'claim', key: h.props.STAFF_KEY, badge: badge, tier: tier, item: 'x', staff: 'Ana', id: id }, k;
    for (k in more || {}) b[k] = more[k];
    return h.call(b);
  }
  if (!GS_SRC) return fail('apps-script/staff-desk/Code.gs is missing');
  // These cases date from badge mode (2 Nov): their starts carry no sig, so each harness that starts a try has
  // Verify with set to Badge. Telegram (the default) and none mode have their own cases (checkVerify).
  // 2. In sync with settings.js and decks.js: the server derives the tier itself, from the same thresholds.
  H = gsHarness({ mode: 'badge' });
  ok(JSON.stringify(H.ctx.TIERS) === JSON.stringify(S.tiers), 'TIERS ' + JSON.stringify(H.ctx.TIERS) + ' differ from settings.js tiers ' + JSON.stringify(S.tiers));
  ok(H.ctx.TRIES_PER_BADGE === S.countedTries, 'TRIES_PER_BADGE differs from settings.js countedTries');
  ok(H.ctx.PER_DAY === undefined && typeof H.ctx.today_ !== 'function', 'PER_DAY or today_ is back: tries are per badge for the whole event');
  ok(H.ctx.MAX_SCORE === maxScore() && H.ctx.MAX_SCORE >= S.tiers[3], 'MAX_SCORE ' + H.ctx.MAX_SCORE + ', the best round under settings.js is ' + maxScore());
  ok(JSON.stringify(H.ctx.APPS) === JSON.stringify(Object.keys(D)), 'APPS differ from the deck ids');
  ok(H.ctx.CONTACTS_SHEET_ID === '1LzRQ9IizuRMrqWAclFuY2v0bONkgxb2ezvXPbVsBtIc' && H.ctx.SHEET_ID === '', 'sheet ids');
  // 1. Setup: every tab with its headers, protected, one staff key that a second run keeps.
  H.ctx.staffSetup();
  ok(H.tab('Badge claims') && H.tab('Badge claims').rows[0].join() === 'Time,Badge (hashed),Tier,Item,Ticket,Staff,Id,How', 'Badge claims headers');
  ok(H.tab('Tries') && H.tab('Tries').rows[0].join() === H.ctx.TRY_HEAD.join() && H.ctx.TRY_HEAD.length === 11, 'Tries headers');
  sw = H.tab('Switches') ? H.tab('Switches').rows : [];
  ok(sw[1] && sw[1][0] === 'Merch open' && sw[1][1] === true && [2, 3, 4].every(function (k) { return sw[k] && sw[k][1] === false; }),
    'Switches: Merch open ticked, the three sold-out boxes not ' + JSON.stringify(sw));
  ok(H.contacts.sheets.Contacts.rows[0].join() === 'Day,Contact,Kind,Curator info,Event,Source,Id,Username' && !H.bound.sheets.Contacts, 'Contacts headers, in the contacts sheet only');
  ['Badge claims', 'Tries', 'Switches'].forEach(function (t) { ok(H.tab(t).prot.some(function (p) { return p.calls.indexOf('remove') > -1; }), t + ' is not protected'); });
  ok(H.contacts.sheets.Contacts.prot.some(function (p) { return p.calls.indexOf('remove') > -1; }), 'Contacts is not protected');
  key = H.props.STAFF_KEY;
  ok(/^[A-Z2-9]{16}$/.test(key || '') && H.logs.some(function (l) { return l.indexOf(key) > -1; }), 'staffSetup logs a 16-character key');
  H.ctx.staffSetup();
  ok(H.props.STAFF_KEY === key && H.tab('Switches').getLastRow() <= 7, 'a second staffSetup changed the key or added switch rows');
  H.ctx.newStaffKey();
  ok(H.props.STAFF_KEY !== key, 'newStaffKey kept the old key');
  r = gsHarness({ editors: ['owner', 'x'] }); r.ctx.staffSetup();
  ok(r.logs.some(function (l) { return /^Warning: other people can edit/.test(l); }), 'no Warning line when others can edit');
  r = gsHarness(); r.bound.insertSheet('Badge claims').appendRow(['Time', 'Badge (hashed)', 'Tier', 'Item', 'Ticket', 'Staff', 'Id']);
  r.ctx.staffSetup();
  ok(r.tab('Badge claims').rows[0][7] === 'How', 'an old 7-column Badge claims header did not get How');
  // 10. Transport and keys.
  ok(JSON.parse(H.ctx.doGet().s).service === 'kleros booth', 'doGet');
  ok(H.call('not json').error === 'badrequest' && H.call({ action: 'nope' }).error === 'badrequest', 'badrequest');
  ok(H.call({ action: 'check', badge: A }).error === 'wrongkey' && H.call({ action: 'stats', key: 'WRONG' }).error === 'wrongkey' &&
    H.call({ action: 'claim', badge: A, tier: 'teal' }).error === 'wrongkey', 'staff actions without the key');
  ok(H.call({ action: 'status' }).ok === true, 'status needs no key');
  // 3. Two counted tries per badge for the whole event, a third refused; a retried token is the same try; a token
  // is one badge's.
  t1 = tok(); t2 = tok();
  r = start(H, A, t1);
  ok(r.ok && r.counted && r.tryNo === 1 && r.left === 1 && r.perBadge === 2 && r.perDay === undefined && r.open === true &&
    Array.isArray(r.soldOut), 'first start ' + JSON.stringify(r));
  r = start(H, A, t2, { app: 'evil' });
  ok(r.counted && r.tryNo === 2 && r.left === 0, 'second start ' + JSON.stringify(r));
  ok(H.tab('Tries').rows[2][8] === '' && !(H.tab('Tries').rows[1][1] instanceof Date), 'an unknown app is stored, or Day is not text');
  r = start(H, A);
  ok(r.ok && r.counted === false && r.reason === 'limit' && r.left === 0 && H.rows('Tries') === 3, 'a third start ' + JSON.stringify(r));
  r = start(H, A, t1);
  ok(r.counted && r.tryNo === 1 && H.rows('Tries') === 3, 'a retried token spent a try ' + JSON.stringify(r));
  ok(start(H, B, t1).error === 'badtoken', 'a token reused with another badge');
  ok(start(H, 'nothex').error === 'badbadge' && start(H, A, 'BAD').error === 'badtoken', 'bad badge or token');
  // 4. A new day gives no new tries (2 Nov, user: 2 tries per ticket): not at 00:01 IST, not on the last booth day.
  // A badge with one try on day 1 gets try 2 on day 2, then none. Day is still written, as a record.
  r = gsHarness({ mode: 'badge' }); r.clock = Date.parse('2026-11-03T18:29:00Z');
  start(r, A); start(r, A);
  ok(start(r, A).reason === 'limit', 'the limit at 23:59 IST on day 1');
  r.clock = Date.parse('2026-11-03T18:31:00Z');
  tmp = start(r, A);
  ok(tmp.ok && tmp.counted === false && tmp.reason === 'limit' && tmp.left === 0, 'a new day (00:01 IST) gave new tries ' + JSON.stringify(tmp));
  r.clock = Date.parse('2026-11-06T06:00:00Z');
  tmp = r.call({ action: 'status', badge: A });
  ok(start(r, A).reason === 'limit' && tmp.badge && tmp.badge.left === 0 && tmp.badge.triesUsed === 2 && tmp.perBadge === 2 &&
    r.rows('Tries') === 3, 'the last booth day gave new tries ' + JSON.stringify(tmp));
  r.clock = Date.parse('2026-11-03T06:00:00Z'); start(r, B);
  r.clock = Date.parse('2026-11-04T06:00:00Z'); tmp = start(r, B);
  ok(tmp.counted && tmp.tryNo === 2 && tmp.left === 0 && start(r, B).reason === 'limit', 'one try on day 1, then day 2 ' + JSON.stringify(tmp));
  // The Day record is the IST day: a fresh badge's try at 00:01 IST (18:31Z) is dated the next day.
  r.clock = Date.parse('2026-11-03T18:31:00Z'); start(r, 'd'.repeat(64));
  tmp = r.tab('Tries').rows.slice(1).map(function (x) { return x[1]; });
  ok(tmp.join() === '2026-11-03,2026-11-03,2026-11-03,2026-11-04,2026-11-04', 'the Day column is not the IST day, kept as a record ' + JSON.stringify(tmp));
  // Stats' handouts today (stock pacing) roll over at 00:01 IST too: a claim at 23:59 IST is yesterday's.
  r = gsHarness(); r.ctx.staffSetup(); r.clock = Date.parse('2026-11-03T18:29:00Z');
  claim(r, E, 'teal', 'claimide0001', { ticket: 'K-DAY001' });
  r.clock = Date.parse('2026-11-03T18:31:00Z');
  claim(r, F, 'teal', 'claimidf0001', { ticket: 'K-DAY002' });
  tmp = r.call({ action: 'stats', key: r.props.STAFF_KEY });
  ok(r.rows('Badge claims') === 3 && tmp.ok && tmp.today && tmp.today.teal === 1, 'stats today is not the IST day ' + JSON.stringify(tmp));
  // 5. finish: one score per token, inside the time window, never above the best possible round.
  H.clock += 5000;
  ok(H.call({ action: 'finish', token: t1, score: 500 }).error === 'early', 'a finish 5 s after its start');
  H.clock += 3 * HOUR;
  r = H.call({ action: 'finish', token: t1, score: P2, tier: 3, relaxed: false, endedBy: 'done' });
  ok(r.ok && r.score === P2 && r.tier === 2 && r.best && r.best.score === P2 && r.perBadge === 2 && r.left === 0,
    'the tier comes from the score, not the body ' + JSON.stringify(r));
  ok(r.best && /^C-[A-Z0-9]{6}$/.test(r.best.code) && r.best.code === 'C-' + t1.slice(0, 6).toUpperCase(), 'best.code ' + (r.best || {}).code);
  H.clock += 7 * HOUR;
  ok(H.call({ action: 'finish', token: t1, score: P2 }).ok === true, 'the same finish again (7 h later) is not ok');
  ok(H.call({ action: 'finish', token: t1, score: P2 + 1 }).error === 'used', 'a second score for one token');
  ok(H.call({ action: 'finish', token: t2, score: 400 }).error === 'late', 'a finish 10 h after its start');
  ok(H.call({ action: 'finish', token: 'unknowntoken12345', score: 1 }).error === 'badtoken', 'an unknown token');
  t3 = tok(); start(H, C, t3); H.clock += 60000;
  ok(H.call({ action: 'finish', token: t3, score: maxScore() + 1 }).error === 'toohigh', 'a score above the best possible round');
  ok(H.call({ action: 'finish', token: t3, score: -1 }).error === 'badscore' && H.call({ action: 'finish', token: t3, score: 3.5 }).error === 'badscore', 'badscore');
  // 6. status: the best across days, with its game code and time.
  r = H.call({ action: 'status', badge: A });
  ok(r.ok && r.v && r.tiers.join() === S.tiers.join() && r.maxScore === maxScore() && r.badge && r.badge.best && r.badge.best.score === P2 &&
    r.badge.best.at === '13:30' && r.badge.left === 0 && r.badge.triesUsed === 2 && r.badge.today === undefined && r.perBadge === 2 &&
    r.badge.contact === false && r.badge.collected === false, 'status ' + JSON.stringify(r));
  ok(H.call({ action: 'status' }).badge === null, 'status without a badge');
  // 7. contact: only for a badge with an earned round, one contacts row per badge, nothing of it in the badge sheet.
  ok(H.call({ action: 'contact', badge: C, contact: 'ana@example.org', id: 'abcdefabcdef' }).error === 'notry', 'a contact for a badge with no earned round');
  ok(H.call({ action: 'contact', badge: A, contact: 'bob', id: 'abcdefabcdef' }).error === 'badcontact', 'bob is not a contact');
  t4 = tok(); start(H, B, t4); H.clock += 60000;
  ok(H.call({ action: 'finish', token: t4, score: S.tiers[1] + 10 }).tier === 1, 'a Teal finish');
  r = claim(H, B, 'teal', 'claimidb0001');
  ok(r.error === 'notearned' && r.contact === false, 'a claim before the contact ' + JSON.stringify(r));
  r = H.call({ action: 'contact', badge: A, contact: 'ana@example.org', id: 'abcdefabcdef', curator: true, event: '\t=1', kiosk: true });
  ok(r.ok && r.contact === true && typeof r.open === 'boolean', 'contact ' + JSON.stringify(r));
  H.call({ action: 'contact', badge: A, contact: 'ana@example.org', id: 'abcdefabcdef' });
  H.call({ action: 'contact', badge: A, contact: 'ana@example.org', id: 'zzzzzzzzzzzz' });
  ok(H.contacts.sheets.Contacts.getLastRow() === 2, 'a retried or second contact for one badge added a row');
  ok(H.call({ action: 'contact', badge: B, contact: '@ana_k', id: 'qqqqqqqqqqqq' }).ok, 'a @Telegram contact on a second earned badge');
  ok(H.contacts.sheets.Contacts.getLastRow() === 3, 'two badges, two contacts rows');
  crow = H.contacts.sheets.Contacts.rows.slice(1, 3);
  ok(crow.every(function (row) { return typeof row[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && row[5] === 'curate'; }) &&
    crow[0][1] === 'ana@example.org' && crow[0][2] === 'email' && crow[0][3] === 'yes' && crow[1][2] === 'telegram',
    'contacts rows: Day is a date only, Source curate, kind and curator tick ' + JSON.stringify(crow));
  tmp = JSON.stringify(H.contacts.sheets);
  ok(!/[0-9a-f]{64}/.test(tmp) && [t1, t2, t4].every(function (t) { return tmp.indexOf(t) < 0; }) && tmp.indexOf(String(P2)) < 0, 'the contacts sheet holds a badge, token or score');
  tmp = JSON.stringify(H.bound.sheets);
  ok(tmp.indexOf('@') < 0 && tmp.indexOf('ana@example.org') < 0 && tmp.indexOf('ana_k') < 0, 'the badge sheet holds a contact');
  ok(H.writes.indexOf('\'\t=1') > -1, 'the event \\t=1 is not written as \'\\t=1');
  r = H.call({ action: 'check', key: H.props.STAFF_KEY, badge: A });
  ok(r.ok && r.contact === true && r.earned === 2 && r.used === false && r.game && r.game.score === P2 && r.triesUsed === 2 &&
    r.today === undefined, 'check after the contact ' + JSON.stringify(r));
  // 9. claim: one item per badge, up to the earned tier; a check-in ticket (K-) allows any open tier, once.
  ok(claim(H, A, 'gold', 'claimida0001').error === 'notearned', 'Gold claimed on a Purple badge');
  r = claim(H, A, 'purple', 'claimida0002', { staff: '=1+1', how: 'typed' });
  ok(r.ok, 'a Purple claim ' + JSON.stringify(r));
  ok(claim(H, A, 'purple', 'claimida0002').ok && H.rows('Badge claims') === 2, 'the same claim id again is not green, or added a row');
  ok(claim(H, A, 'teal', 'claimida0003').used === true, 'a second item for one badge');
  ok(H.tab('Badge claims').rows[1][7] === 'typed' && H.writes.indexOf('\'=1+1') > -1, 'How typed in column 8, staff =1+1 written as \'=1+1');
  r = claim(H, 'd'.repeat(64), 'gold', 'claimidd0001', { ticket: 'K-ABC123' });
  ok(r.ok, 'a K- ticket on a badge with no game ' + JSON.stringify(r));
  ok(claim(H, C, 'teal', 'claimidc0001', { ticket: 'K-ABC123' }).ticketUsed === true, 'a K- ticket used twice');
  ok(start(H, A).reason === 'collected', 'a claimed badge can still start a counted try');
  r = H.call({ action: 'stats', key: H.props.STAFF_KEY });
  ok(r.ok && r.today && r.today.purple === 1 && r.today.gold === 1 && r.v === H.ctx.SCRIPT_V, 'stats ' + JSON.stringify(r));
  // 8. Switches, read by label: pause, sold out, the menu and a hand edit.
  H.tab('Switches').rows[1][1] = false; delete H.cache.switches;
  i = H.rows('Tries');
  r = start(H, E);
  ok(r.ok && r.counted === false && r.reason === 'paused' && r.open === false && H.rows('Tries') === i, 'a start while paused ' + JSON.stringify(r));
  ok(claim(H, A, 'teal', 'claimida0009').used === true, 'a collected badge while paused is not red');
  ok(claim(H, F, 'teal', 'claimidf0009', { ticket: 'K-ZZZ999' }).error === 'paused', 'a claim while paused');
  H.ctx.openMerch(); H.ctx.toggleGold();
  ok(H.toasts.indexOf('Merch open.') > -1 && H.toasts.indexOf('Gold sold out. Stays on until you untick it.') > -1, 'menu toasts ' + JSON.stringify(H.toasts));
  sw = H.tab('Switches').rows; tmp = sw[1]; sw[1] = sw[4]; sw[4] = tmp; delete H.cache.switches;
  r = H.call({ action: 'status' });
  ok(r.open === true && r.soldOut.join() === 'gold', 'switches moved rows are read by label ' + JSON.stringify(r));
  ok(claim(H, F, 'gold', 'claimidf0010', { ticket: 'K-ZZZ999' }).error === 'soldout', 'a sold-out tier claimed');
  H.cache.switches = { v: 'x', t: H.clock + 99999 };
  H.ctx.onEdit({ range: H.tab('Switches').getRange(2, 2, 1, 1) });
  ok(!H.cache.switches, 'a hand edit of Switches keeps the cached switches');
  H.ctx.showStaffKey();
  ok(H.alerts.some(function (a) { return a.indexOf(H.props.STAFF_KEY) > -1; }), 'showStaffKey');
  // Rows of earlier days count, whatever their Day cell holds (text, or a Date Sheets made of it).
  r = gsHarness({ mode: 'badge' }); r.ctx.staffSetup();
  start(r, A); start(r, A);
  r.tab('Tries').rows[1][1] = new Date('2026-11-01T00:00:00+05:30'); r.tab('Tries').rows[2][1] = '2026-11-02';
  ok(start(r, A).reason === 'limit', 'tries with an earlier Day (a Date, or text) gave new tries');
  // A retune never downgrades a tier already earned: a round stored under 2026-11-03b (the 750 scale: 450 was Teal)
  // stays the best over a later 550 (Everyone now) in finish, check and claim; an old 560 Purple over a new 640 Teal.
  r = gsHarness({ mode: 'badge' }); r.ctx.staffSetup();
  t1 = tok(); start(r, A, t1); r.clock += 60000; r.call({ action: 'finish', token: t1, score: 450 }); r.tab('Tries').rows[1][7] = 1;
  t2 = tok(); start(r, A, t2); r.clock += 60000;
  tmp = r.call({ action: 'finish', token: t2, score: 550 });
  ok(tmp.ok && tmp.tier === 0 && tmp.best && tmp.best.tier === 1 && tmp.best.score === 450, 'a later round under the new scale downgraded a tier ' + JSON.stringify(tmp));
  r.call({ action: 'contact', badge: A, contact: 'ana@example.org', id: 'abcdefabcdef' });
  tmp = r.call({ action: 'check', key: r.props.STAFF_KEY, badge: A });
  ok(tmp.ok && tmp.earned === 1 && tmp.game && tmp.game.score === 450 && claim(r, A, 'teal', 'claimidr0001').ok, 'check and claim after a retune ' + JSON.stringify(tmp));
  t1 = tok(); start(r, B, t1); r.clock += 60000; r.call({ action: 'finish', token: t1, score: 560 }); r.tab('Tries').rows[3][7] = 2;
  t2 = tok(); start(r, B, t2); r.clock += 60000; r.call({ action: 'finish', token: t2, score: 640 });
  tmp = r.call({ action: 'status', badge: B });
  ok(tmp.badge && tmp.badge.best && tmp.badge.best.tier === 2 && tmp.badge.best.score === 560, 'an old Purple lost to a new Teal ' + JSON.stringify(tmp.badge));
  // 11. Caps and the lock: busy, and nothing written.
  r = gsHarness({ mode: 'badge' }); r.ctx.staffSetup();
  for (i = 0; i < 61; i++) last = start(r, (i % 10 + '').repeat(64));
  ok(last.error === 'busy', 'the 61st start in a minute ' + JSON.stringify(last));
  r.clock += 60000;
  ok(start(r, A).ok === true, 'the next minute still busy');
  t1 = tok(); start(r, B, t1); r.clock += 60000; r.call({ action: 'finish', token: t1, score: S.tiers[1] });
  r.lockBusy = true; before = r.snap();
  ok(start(r, C).error === 'busy' && r.call({ action: 'finish', token: tok(), score: 1 }).error === 'busy' &&
    r.call({ action: 'contact', badge: B, contact: '@ana_k', id: 'abcdefabcdef' }).error === 'busy' &&
    claim(r, B, 'teal', 'claimid00001', { ticket: 'K-QQQ111' }).error === 'busy', 'busy under a held lock');
  ok(r.snap() === before, 'a busy reply wrote to a sheet');
  // 10. An internal throw answers server, never its message.
  r.lockBusy = false;
  r.ctx.SpreadsheetApp.getActiveSpreadsheet = function () { throw new Error('secret boom'); };
  Object.keys(r.cache).forEach(function (k) { delete r.cache[k]; });
  tmp = r.call({ action: 'status', badge: A });
  ok(tmp.ok === false && tmp.error === 'server' && JSON.stringify(tmp).indexOf('boom') < 0, 'an internal throw ' + JSON.stringify(tmp));
  // 12. Error codes are identifiers (lowercase letters only), so the clients and the copy lint can tell them apart.
  (GS_SRC.match(/\berror: '[^']*'|\bfail_\('[^']*'\)/g) || []).forEach(function (m) { ok(/'[a-z]+'/.test(m), 'error code ' + m); });
  console.log('Booth web app (Code.gs)\n  ' + n + ' cases (setup, sync with settings.js, 2 tries per badge, no new tries on a new day, finish, status, contacts sheet, claims, a retune never downgrades a tier, switches, caps, lock)');
}

// ---- Booth web app: how players verify (3 Nov) ----
// The Switches "Verify with" row (Telegram by default), setmode, start's signature check, tgcheck against the fake
// Bot API (gsHarness), the bot's answers and its contacts rows, and the desk's check by ticket QR or typed C- code.
// 3 Nov b (spec 2): a short verified answer with one Back to the game button (the page and app the phone sent with
// tgcheck, else the live game), and Curator info yes on the bot's contacts rows (the game's consent tick).
var TG_SAY = {   // the spec's bot copy, word for word
  verified: '✅ You’re verified. Tap below to go back to the game.',
  back: '▶️ Back to the game',   // the verified answer's one button
  help: 'This bot verifies players for the Kleros Curate game at the Kleros booth. Open devcon.kleros.io/curate and tap Verify with Telegram.',
  stopped: 'Done: you’re off Kleros news and your Telegram ID is deleted. Your game tries still count.',
  stopRetry: 'Sorry, that didn’t go through. Please send /stop again in a minute.'   // 3 Nov review: a /stop whose delete failed
};
function checkVerify() {
  var n = 0, H, r, q, i, t, tmp, cell, sw, before, gets, nc = [], id1, id2, sig1, code, row, A = 'a'.repeat(64), seq = 0,
    TG1 = 5550001234, TG2 = 5550009876, TG3 = 5550005555, NOTE = 'Telegram: add TG_TOKEN in Project Settings › Script properties, then run telegramTest',
    GAME = 'https://devcon.kleros.io/curate/', NETLIFY = 'https://kleros-devcon.netlify.app/curate/',
    PREVIEW = 'https://deploy-preview-12--kleros-devcon.netlify.app/curate/', u, t0, t1, t2, wa, wb, k;
  function ok(cond, msg) { n++; if (!cond) fail('Code.gs verify: ' + msg); }
  function tok(p) { seq++; return ((p || 'vt') + seq + 'qwertyuiopasdfghjkzx').slice(0, 20); }
  // A nonce as the phone makes it: 24 letters and digits.
  function nonce() { var s = ('Nn' + (nc.length + 1) + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ').slice(0, 24); nc.push(s); return s; }
  function start(h, badge, more) {
    var b = { action: 'start', badge: badge, token: tok(), app: 'sights' }, k;
    for (k in more || {}) b[k] = more[k];
    return h.call(b);
  }
  function staff(h, b) { b.key = h.props.STAFF_KEY; return h.call(b); }
  // A phone's tgcheck, past the 2 s poll throttle (the phone asks every 2.5 s).
  // more: back and app, as the phone sends them (3 Nov b).
  function tgcheck(h, nn, more) {
    var b = { action: 'tgcheck', nonce: nn }, k;
    for (k in more || {}) b[k] = more[k];
    h.clock += 2100; return h.call(b);
  }
  // The verified answer's keyboard: one Back to the game button to url (3 Nov b).
  function backKb(url) { return JSON.stringify({ inline_keyboard: [[{ text: TG_SAY.back, url: url }]] }); }
  function contactRows(h) { return h.contacts.sheets.Contacts.rows.slice(1).filter(function (x) { return x && x.length; }); }
  function tgRows(h, id) { return contactRows(h).filter(function (x) { return String(x[1]) === String(id) && x[2] === 'telegram id'; }); }
  // The cache's waiting adds ('tgq') as Code.gs keeps them (3 Nov c): [Telegram ID, ticked, username], no tick unless
  // said; the username is the sender's (tgUser, from the fake Bot API).
  function waiting(ids, ticked) { return JSON.stringify(ids.map(function (x) { return [String(x), (ticked || []).indexOf(x) > -1, tgUser(x)]; })); }
  if (!GS_SRC) return;
  // Version, the default mode and the Verify with row: a text cell with its dropdown, never a checkbox.
  H = gsHarness();
  ok(H.ctx.SCRIPT_V === '2026-11-03c', 'SCRIPT_V is ' + H.ctx.SCRIPT_V);
  r = H.call({ action: 'status' });
  ok(r.ok && r.mode === 'telegram' && r.tg === false, 'a sheet with no Switches tab: mode ' + r.mode + ', tg ' + r.tg);
  H.ctx.staffSetup();
  cell = H.verifyCell(); sw = H.tab('Switches');
  ok(cell && cell.row === 6 && cell.value === 'Telegram', 'Verify with row ' + JSON.stringify(cell));
  ok(!sw.boxes['6:2'] && sw.rules['6:2'] && sw.rules['6:2'].list.join() === 'Telegram,Badge,None' && sw.rules['6:2'].dropdown === true &&
    [2, 3, 4, 5].every(function (k) { return sw.boxes[k + ':2'] && !sw.rules[k + ':2']; }), 'Verify with is a dropdown, the others checkboxes');
  ok(/^Tick or untick/.test(String((sw.rows[6] || [])[0])) && H.tab('Switches').getLastRow() === 7, 'the note left row 7');
  t = H.props.TG_SECRET;
  ok(/^[A-Za-z0-9]{32}$/.test(t || '') && H.logs.every(function (l) { return l.indexOf(t) < 0; }), 'staffSetup makes a 32-character TG_SECRET, never logged');
  ok(H.logs.indexOf(NOTE) > -1 && H.logs.indexOf('Telegram: ready') < 0, 'staffSetup without TG_TOKEN: ' + H.logs.slice(-1));
  H.props.TG_TOKEN = '  ' + TG_TOKEN + '\n'; H.ctx.staffSetup();
  ok(H.props.TG_SECRET === t && H.verifyCell().row === 6 && H.tab('Switches').getLastRow() === 7 && H.logs.indexOf('Telegram: ready') > -1,
    'a second staffSetup changed TG_SECRET, added a row or did not say ready');
  // staffSetup installs the tgTick trigger once, so /stop is read (and a slow Start answered) with no phone verifying:
  // every minute since 3 Nov c (review). It replaces the 5-minute one an earlier copy installed, and only that one.
  ok(JSON.stringify(H.triggers) === '[{"fn":"tgTick","minutes":1}]' && typeof H.ctx.tgTick === 'function', 'the tgTick trigger ' + JSON.stringify(H.triggers));
  ok(H.logs.indexOf('Telegram: the bot is read every minute (trigger tgTick), so /stop works without a verifying phone.') > -1, 'staffSetup on tgTick: ' + H.logs.slice(-1));
  q = gsHarness(); q.triggers.push({ fn: 'other', minutes: 10 }, { fn: 'tgTick', minutes: 5 });
  q.ctx.staffSetup();
  ok(JSON.stringify(q.triggers) === '[{"fn":"other","minutes":10},{"fn":"tgTick","minutes":1}]', 'staffSetup over a 5-minute tgTick ' + JSON.stringify(q.triggers));
  ok(H.call({ action: 'status' }).tg === true, 'status tg with a token pasted with spaces');
  // The live sheet (2 Nov): four switch rows and the note in row 7; Verify with goes into row 6, the rest stays.
  q = gsHarness(); tmp = q.bound.insertSheet('Switches');
  tmp.rows = [['Switch', 'On'], ['Merch open', false], ['Teal sold out', true], ['Purple sold out', false], ['Gold sold out', false], [],
    ['Tick or untick: …']];
  q.ctx.staffSetup();
  r = q.call({ action: 'status' });
  ok(q.verifyCell() && q.verifyCell().row === 6 && q.verifyCell().value === 'Telegram' && r.mode === 'telegram' && r.open === false &&
    r.soldOut.join() === 'teal' && tmp.rows[6][0] === 'Tick or untick: …', 'the live Switches tab ' + JSON.stringify(tmp.rows));
  // The cell, read by label: any case and spaces; anything else (a typo, blank, a stray tick) reads as Telegram.
  [['Badge', 'badge'], [' none ', 'none'], ['BADGE', 'badge'], ['Telegram', 'telegram'], ['Telegarm', 'telegram'], ['', 'telegram'],
    [true, 'telegram']].forEach(function (c) {
    H.tab('Switches').rows[5][1] = c[0]; delete H.cache.switches;
    tmp = H.call({ action: 'status' });
    ok(tmp.mode === c[1], 'Verify with ' + JSON.stringify(c[0]) + ' reads as ' + tmp.mode);
  });
  // Cached 20 s; a hand edit clears it; a copy cached by the previous script (no mode) is read again.
  H.tab('Switches').rows[5][1] = 'Badge';
  ok(H.call({ action: 'status' }).mode === 'telegram', 'the switches cache did not hold');
  H.clock += 21000;
  ok(H.call({ action: 'status' }).mode === 'badge', 'the switches cache outlived 20 s');
  H.tab('Switches').rows[5][1] = 'None'; H.ctx.onEdit({ range: H.tab('Switches').getRange(6, 2, 1, 1) });
  ok(H.call({ action: 'status' }).mode === 'none', 'a hand edit of Verify with kept the cache');
  H.cache.switches = { v: JSON.stringify({ open: true, soldOut: [] }), t: H.clock + 99999 };
  ok(H.call({ action: 'status' }).mode === 'none', 'a cached copy without mode was used');
  // Every reply carries the mode, like open and soldOut; a thrown error answers its code only.
  ok(staff(H, { action: 'stats' }).mode === 'none' && staff(H, { action: 'check', badge: A }).mode === 'none' &&
    H.call({ action: 'nope' }).mode === undefined, 'mode in the replies');
  // setmode: staff key, the three values only, the cell, the cache, the log (staff name as plain text).
  ok(H.call({ action: 'setmode', mode: 'badge' }).error === 'wrongkey' && H.call({ action: 'setmode', key: 'WRONG', mode: 'badge' }).error === 'wrongkey',
    'setmode without the key');
  ['', 'Badge', 'evil', null, 'telegram '].forEach(function (m) {
    ok(staff(H, { action: 'setmode', mode: m, staff: 'Ana' }).error === 'badrequest' && H.verifyCell().value === 'None', 'setmode ' + JSON.stringify(m));
  });
  H.call({ action: 'status' });   // cached as none
  r = staff(H, { action: 'setmode', mode: 'badge', staff: '=Ana' });
  ok(r.ok && r.mode === 'badge' && H.verifyCell().value === 'Badge' && H.call({ action: 'status' }).mode === 'badge', 'setmode badge ' + JSON.stringify(r));
  ok(H.logs.indexOf('mode badge by \'=Ana') > -1 && H.logs.every(function (l) { return l.indexOf(H.props.STAFF_KEY) < 0 || /^Staff key/.test(l); }),
    'setmode log ' + H.logs.slice(-2));
  r = staff(H, { action: 'setmode', mode: 'none', staff: 'Ana' });
  ok(r.mode === 'none' && H.verifyCell().value === 'None' && staff(H, { action: 'setmode', mode: 'telegram', staff: 'Ana' }).mode === 'telegram' &&
    H.verifyCell().value === 'Telegram' && H.call({ action: 'status' }).mode === 'telegram', 'setmode none, then telegram');
  // The owner's menu: three Verify with items, each writing the cell at once.
  H.ctx.onOpen();
  ok(['verifyTelegram', 'verifyBadge', 'verifyNone'].every(function (f) { return H.menu.some(function (m) { return m[1] === f; }) && typeof H.ctx[f] === 'function'; }) &&
    H.menu.some(function (m) { return m[0] === 'Players verify with Telegram'; }), 'menu ' + JSON.stringify(H.menu));
  H.ctx.verifyBadge();
  ok(H.call({ action: 'status' }).mode === 'badge' && H.toasts.indexOf('Players now verify with their badge. Every phone follows within a minute.') > -1,
    'the menu item did not switch to badge ' + JSON.stringify(H.toasts.slice(-1)));
  H.ctx.verifyTelegram();
  ok(H.call({ action: 'status' }).mode === 'telegram', 'the menu item did not switch back to Telegram');

  // tgcheck: the nonce's format, no bot token, then the bot's updates.
  q = gsHarness(); q.ctx.staffSetup();
  ['short', 'x'.repeat(41), 'abc-def_ghi.jklmnopqrs', '', 'aaaaaaaaaaaaaaaa\n'].forEach(function (x) {
    ok(q.call({ action: 'tgcheck', nonce: x }).error === 'badrequest', 'nonce ' + JSON.stringify(x) + ' is not badrequest');
  });
  ok(q.call({ action: 'tgcheck' }).error === 'badrequest' && q.call({ action: 'tgcheck', nonce: nonce() }).error === 'notelegram' && q.tg.calls.length === 0,
    'tgcheck with no TG_TOKEN');
  H.props.TG_TOKEN = TG_TOKEN;
  t = nonce(); gets = H.tg.gets;
  r = tgcheck(H, t);
  ok(r.ok && r.verified === false && r.badge === undefined && r.mode === 'telegram' && H.tg.gets === gets + 1, 'tgcheck before the bot saw it ' + JSON.stringify(r));
  i = H.tg.say(TG1, '/start ' + t);
  r = tgcheck(H, t);
  id1 = H.tgId(TG1); sig1 = H.sig(id1);
  ok(r.ok && r.verified === true && r.badge === id1 && r.sig === sig1 && /^[0-9a-f]{64}$/.test(r.badge) && /^[0-9a-f]{32}$/.test(r.sig),
    'tgcheck after /start: ' + JSON.stringify(r) + ' want ' + id1 + ' / ' + sig1);
  // Its one button: the live game with the nonce (this phone sent no back), so that page verifies at once.
  ok(H.tg.sent.length === 1 && H.tg.sent[0].chat === TG1 && H.tg.sent[0].text === TG_SAY.verified && H.tg.sent[0].preview === true &&
    JSON.stringify(H.tg.sent[0].markup) === backKb(GAME + '?tg=' + t), 'the verified answer ' + JSON.stringify(H.tg.sent));
  // Curator info: empty here, since no tgcheck said the box was ticked (agree; its own cases below, 3 Nov c). Username:
  // the sender's, as text (3 Nov c; its own cases in checkReset).
  row = tgRows(H, TG1);
  ok(row.length === 1 && row[0][0] === dayOf(H) && row[0][3] === '' && row[0][4] === 'Devcon VIII Mumbai' && row[0][5] === 'curate bot' &&
    row[0][6] === '' && row[0][7] === tgUser(TG1) && row[0].length === 8 && typeof row[0][1] === 'string' && H.writes.indexOf('\'' + TG1) > -1 &&
    H.writes.indexOf('\'' + tgUser(TG1)) > -1, 'the contacts row ' + JSON.stringify(row));
  ok(H.props.TG_OFFSET === String(i + 1), 'TG_OFFSET ' + H.props.TG_OFFSET + ' after update ' + i);
  // The same nonce again: still verified, from the cache, no poll; for 6 h only.
  gets = H.tg.gets;
  r = tgcheck(H, t);
  ok(r.verified && r.badge === id1 && H.tg.gets === gets, 'a verified nonce asked again ' + JSON.stringify(r));
  // The same Telegram account with a new link: the same id, one contacts row (cache, then the sheet itself).
  t = nonce(); H.tg.say(TG1, '/start ' + t);
  r = tgcheck(H, t);
  delete H.cache['tgc:' + TG1];
  tmp = nonce(); H.tg.say(TG1, '/start@KlerosBoothBot ' + tmp);
  q = tgcheck(H, tmp);
  ok(r.badge === id1 && q.verified && q.badge === id1 && tgRows(H, TG1).length === 1, 'the same account verified twice: ' +
    JSON.stringify([r.badge, q.badge]) + ', rows ' + tgRows(H, TG1).length);
  // Another account: another id. The offset moves on: no update is read twice.
  t = nonce(); i = H.tg.say(TG2, ' /start   ' + t + ' ');
  r = tgcheck(H, t);
  id2 = H.tgId(TG2);
  ok(r.verified && r.badge === id2 && id2 !== id1 && r.sig === H.sig(id2) && tgRows(H, TG2).length === 1, 'a second account ' + JSON.stringify(r));
  before = H.tg.sent.length;
  tgcheck(H, nonce());
  ok(H.props.TG_OFFSET === String(i + 1) && H.tg.offsets[H.tg.offsets.length - 1] === i + 1 && H.tg.sent.length === before,
    'an update read twice, or the offset ' + H.props.TG_OFFSET + ' did not move');
  // /start with no (or a bad) nonce, anything else: help, no contact. Groups, bots, a message without a sender: ignored.
  before = contactRows(H).length; i = H.tg.sent.length;
  H.tg.say(TG3, '/start'); H.tg.say(TG3, '/start short'); H.tg.say(TG3, 'hello'); H.tg.say(TG3, '/start ' + nonce() + ' more');
  t = nonce();
  H.tg.say(TG3, '/start ' + t, { chat: 'group' }); H.tg.say(TG3, '/start ' + t, { isBot: true }); H.tg.say(TG3, '/start ' + t, { noFrom: true });
  r = tgcheck(H, t);
  tmp = H.tg.sent.slice(i);
  ok(!r.verified && contactRows(H).length === before && tmp.length === 4 && tmp.every(function (x) { return x.text === TG_SAY.help && x.chat === TG3 && !x.markup; }),
    'help answers ' + JSON.stringify(tmp) + ' ' + JSON.stringify(r));
  // /stop deletes every row of that account (a hand-made duplicate too), answers stopped, and keeps the other's.
  H.contacts.sheets.Contacts.appendRow(['\'2026-11-03', '\'' + TG1, 'telegram id', '', 'Devcon VIII Mumbai', 'curate bot', '']);
  H.contacts.sheets.Contacts.appendRow(['\'2026-11-03', 'ana@example.org', 'email', '', '', 'curate', '\'abcdefabcdef']);
  i = H.tg.sent.length;
  H.tg.say(TG1, '/stop');
  tgcheck(H, nonce());
  ok(tgRows(H, TG1).length === 0 && tgRows(H, TG2).length === 1 && contactRows(H).some(function (x) { return x[1] === 'ana@example.org'; }) &&
    H.tg.sent.length === i + 1 && H.tg.sent[i].text === TG_SAY.stopped && !H.tg.sent[i].markup && !H.cache['tgc:' + TG1], '/stop ' + JSON.stringify(contactRows(H)));
  // After /stop the id still plays (tries count), and verifying again adds the row back.
  t = nonce(); H.tg.say(TG1, '/start ' + t);
  ok(tgcheck(H, t).badge === id1 && tgRows(H, TG1).length === 1, 'verifying again after /stop');
  // Back to the game (3 Nov b): the phone names its page (back) and app with every tgcheck while it waits; the bot's
  // verified answer opens that page with ?tg=NONCE&app=APP, else the live game with ?tg=NONCE. Kept per nonce
  // ('tgb:', 6 h) until it is verified, and stored before the poll the same call runs. Anything else: ignored, no error.
  q = gsHarness({ token: true }); q.ctx.staffSetup();
  t = nonce(); q.tg.say(TG1, '/start ' + t);
  r = tgcheck(q, t, { back: PREVIEW, app: 'tokens' });
  u = q.tg.sent[q.tg.sent.length - 1];
  ok(r.ok && r.verified && r.badge === q.tgId(TG1) && u && u.text === TG_SAY.verified && JSON.stringify(u.markup) === backKb(PREVIEW + '?tg=' + t + '&app=tokens'),
    'Back to the game, from the tgcheck whose poll verified it ' + JSON.stringify([r, u]));
  // Sent earlier, then again with another page and app (the later wins); a tgcheck without back keeps it; the poll
  // another phone's tgcheck runs uses it.
  t = nonce();
  r = tgcheck(q, t, { back: GAME, app: 'sights' });
  ok(r.ok && r.verified === false && r.error === undefined && q.cache['tgb:' + t] && q.cache['tgb:' + t].v === JSON.stringify({ back: GAME, app: 'sights' }) &&
    q.cache['tgb:' + t].t === q.clock + q.ctx.TG_NONCE_S * 1000, 'tgcheck with back and app ' + JSON.stringify([r, q.cache['tgb:' + t]]));
  tgcheck(q, t, { back: NETLIFY, app: 'countries' }); tgcheck(q, t); tgcheck(q, t, { app: 'tokens' });
  q.tg.say(TG2, '/start ' + t);
  tgcheck(q, nonce());
  u = q.tg.sent[q.tg.sent.length - 1];
  ok(u.chat === TG2 && JSON.stringify(u.markup) === backKb(NETLIFY + '?tg=' + t + '&app=countries') && tgcheck(q, t).badge === q.tgId(TG2),
    'a later back and app, used by a poll another phone ran ' + JSON.stringify(u));
  // No app, or an empty one: the page alone.
  [{ back: NETLIFY }, { back: NETLIFY, app: '' }, { back: NETLIFY, app: null }].forEach(function (x) {
    var nn = nonce(), y;
    tgcheck(q, nn, x); q.tg.say(TG1, '/start ' + nn); tgcheck(q, nn);
    y = q.tg.sent[q.tg.sent.length - 1];
    ok(JSON.stringify(y.markup) === backKb(NETLIFY + '?tg=' + nn), 'Back to the game with ' + JSON.stringify(x) + ': ' + JSON.stringify(y.markup));
  });
  // Ignored, never an error: not https, localhost, another host or a look-alike, another path, a query or hash, a
  // trailing newline, a preview number too long, upper case, not a string; or a good back with an app that isn't one.
  tmp = [];
  ['http://devcon.kleros.io/curate/', 'https://localhost:8080/curate/', 'http://localhost:8080/curate/', 'https://127.0.0.1/curate/',
    'https://evil.example/curate/', 'https://devcon.kleros.io.evil.example/curate/', 'https://evildevcon.kleros.io/curate/',
    'https://devcon.kleros.io/curate', 'https://devcon.kleros.io/', 'https://devcon.kleros.io/curate/x', 'https://devcon.kleros.io/curate/index.html',
    'https://devcon.kleros.io/curate/?lite=0', 'https://devcon.kleros.io/curate/#x', 'https://devcon.kleros.io/curate/\n', ' https://devcon.kleros.io/curate/',
    'https://DEVCON.KLEROS.IO/curate/', 'https://user@devcon.kleros.io/curate/', 'https://devcon.kleros.io:444/curate/',
    'https://deploy-preview-123456--kleros-devcon.netlify.app/curate/', 'https://deploy-preview---kleros-devcon.netlify.app/curate/',
    'https://deploy-preview-12--kleros-devcon.netlify.app.evil.example/curate/', 'javascript:alert(1)//https://devcon.kleros.io/curate/', '',
    [GAME], { back: GAME }, 5, true].forEach(function (b) { tmp.push([b, 'sights']); });
  ['evil', 'Sights', 'sights ', 5, 0, true, false, ['sights'], { app: 'sights' }, 'constructor', '__proto__'].forEach(function (a) { tmp.push([NETLIFY, a]); });
  i = q.tg.sent.length;
  tmp.forEach(function (x) {
    x.n = nonce(); x.r = tgcheck(q, x.n, { back: x[0], app: x[1] }); x.kept = q.cache['tgb:' + x.n];
    q.tg.say(TG3, '/start ' + x.n);
  });
  tgcheck(q, nonce());
  u = q.tg.sent.slice(i);
  tmp.forEach(function (x, j) {
    var url = u[j] && u[j].markup ? u[j].markup.inline_keyboard[0][0].url : '';
    ok(x.r.ok === true && x.r.verified === false && x.r.error === undefined && !x.kept && url === GAME + '?tg=' + x.n,
      'back ' + JSON.stringify(x[0]) + ' with app ' + JSON.stringify(x[1]) + ' was not ignored: ' + JSON.stringify([x.r, x.kept, url]));
  });
  ok(u.length === tmp.length, 'answers to the ignored backs: ' + u.length + ' of ' + tmp.length);
  // A verified nonce keeps no back; a failed cache write is not an error (the button opens the live game); the
  // tgTick trigger's poll uses the stored page too.
  t = nonce(); q.tg.say(TG1, '/start ' + t); tgcheck(q, t);
  r = tgcheck(q, t, { back: NETLIFY, app: 'tokens' });
  ok(r.verified && !q.cache['tgb:' + t], 'a back kept for a verified nonce ' + JSON.stringify(q.cache['tgb:' + t]));
  tmp = q.ctx.CacheService.getScriptCache; t = nonce();
  q.ctx.CacheService.getScriptCache = function () {
    var c = tmp(), put = c.put;
    c.put = function (k, v, s) { if (/^tgb:/.test(k)) throw new Error('Exception: quota'); return put(k, v, s); };
    return c;
  };
  r = tgcheck(q, t, { back: NETLIFY, app: 'tokens' });
  q.ctx.CacheService.getScriptCache = tmp;
  q.tg.say(TG1, '/start ' + t); tgcheck(q, t);
  ok(r.ok && r.verified === false && JSON.stringify(q.tg.sent[q.tg.sent.length - 1].markup) === backKb(GAME + '?tg=' + t), 'a failed cache write ' + JSON.stringify(r));
  t = nonce(); tgcheck(q, t, { back: PREVIEW, app: 'countries' }); q.tg.say(TG2, '/start ' + t);
  q.clock += 2100; q.ctx.tgTick();
  u = q.tg.sent[q.tg.sent.length - 1];
  ok(u.text === TG_SAY.verified && JSON.stringify(u.markup) === backKb(PREVIEW + '?tg=' + t + '&app=countries'), 'tgTick: Back to the game ' + JSON.stringify(u.markup));
  tmp = q.logs.join('\n');
  ok(nc.every(function (x) { return tmp.indexOf(x) < 0; }) && tmp.indexOf('curate/') < 0, 'a log line holds a nonce or a back:\n' + tmp);
  // The poll runs at most every 2 s for all phones; a nonce lasts 6 h.
  gets = H.tg.gets;
  H.clock += 2100; H.call({ action: 'tgcheck', nonce: nonce() }); H.call({ action: 'tgcheck', nonce: nonce() }); H.clock += 1500;
  H.call({ action: 'tgcheck', nonce: nonce() });
  ok(H.tg.gets === gets + 1, 'three tgchecks within 2 s polled ' + (H.tg.gets - gets) + ' times');
  H.clock += 600; H.call({ action: 'tgcheck', nonce: nonce() });
  ok(H.tg.gets === gets + 2, 'a tgcheck 2.1 s after a poll did not poll');
  H.clock += 6 * 3600 * 1000;
  ok(tgcheck(H, nc[1]).verified === false, 'a nonce verified 6 h ago still answers');
  // The poll takes the document lock, never the script lock: a held write lock doesn't stop it; a held poll lock
  // answers "not yet" without asking Telegram; a web app with no document lock uses the user lock.
  t = nonce(); H.tg.say(TG2, '/start ' + t);
  H.lockBusy = true; H.locks = [];
  r = tgcheck(H, t);
  H.lockBusy = false;
  ok(r.verified && r.badge === id2 && H.locks.indexOf('script') < 0 && H.locks.indexOf('document') > -1, 'tgcheck under a held script lock ' + JSON.stringify([r, H.locks]));
  t = nonce(); H.tg.say(TG2, '/start ' + t); gets = H.tg.gets;
  H.docBusy = true; r = tgcheck(H, t); H.docBusy = false;
  ok(r.ok && r.verified === false && H.tg.gets === gets && tgcheck(H, t).verified === true, 'tgcheck under a held poll lock ' + JSON.stringify(r));
  q = gsHarness({ nodoclock: true, token: true }); q.ctx.staffSetup();
  t = nonce(); q.tg.say(TG1, '/start ' + t);
  r = tgcheck(q, t);
  ok(r.verified && q.locks.indexOf('user') > -1, 'no document lock: ' + JSON.stringify(r));
  // Telegram down, or refusing the token: "not yet", nothing read, nothing logged (a fetch error carries the URL).
  t = nonce(); i = H.tg.say(TG3, '/start ' + t); before = H.props.TG_OFFSET;
  H.tg.down = true; r = tgcheck(H, t); H.tg.down = false;
  ok(r.ok && r.verified === false && H.props.TG_OFFSET === before, 'Telegram down ' + JSON.stringify(r));
  H.props.TG_TOKEN = 'bad' + TG_TOKEN; r = tgcheck(H, t); H.props.TG_TOKEN = TG_TOKEN;
  ok(r.ok && r.verified === false && H.props.TG_OFFSET === before, 'a refused token ' + JSON.stringify(r));
  ok(tgcheck(H, t).verified === true && H.props.TG_OFFSET === String(i + 1), 'Telegram back: the waiting /start was not read');
  // The contacts sheet broken (moved, trashed, access lost; 3 Nov review): verifying goes on. A /stop first in the
  // batch doesn't block it: every nonce verifies, the offset moves on, the sheet is opened once per poll, the failed
  // adds wait for the next poll and the /stop asks to be sent again (never "deleted"). Nothing of it is logged.
  tmp = H.ctx.SpreadsheetApp.openById; q = 0;
  H.ctx.SpreadsheetApp.openById = function () { q++; throw new Error('boom ' + TG_TOKEN + ' ' + (TG3 + 1)); };
  i = H.tg.sent.length; t = nonce(); code = nonce();
  H.tg.say(TG3 + 2, '/stop'); H.tg.say(TG3 + 1, '/start ' + t); H.tg.say(TG3 + 3, '/start ' + code); before = H.tg.say(TG3 + 4, '/start ' + nonce());
  r = tgcheck(H, t); row = tgcheck(H, code);
  ok(r.ok && r.verified && r.badge === H.tgId(TG3 + 1) && row.verified && row.badge === H.tgId(TG3 + 3) && H.props.TG_OFFSET === String(before + 1) && q === 1,
    'a broken contacts sheet stopped verifying ' + JSON.stringify([r, row, H.props.TG_OFFSET, before, q]));
  ok(H.tg.sent.slice(i).map(function (x) { return x.text === TG_SAY.stopRetry && !x.markup ? 'retry' : x.text === TG_SAY.verified && x.markup ? 'ok' : x.text; }).join() === 'retry,ok,ok,ok' &&
    tgRows(H, TG3 + 1).length === 0 && H.cache.tgq.v === waiting([TG3 + 1, TG3 + 3, TG3 + 4]), 'the answers or the waiting adds ' +
    JSON.stringify([H.tg.sent.slice(i), H.cache.tgq]));
  // A /stop while its add still waits drops it, so the ID never comes back; the sheet back, the rest are added.
  i = H.tg.sent.length; H.tg.say(TG3 + 4, '/stop');
  tgcheck(H, nonce());
  ok(H.tg.sent.length === i + 1 && H.tg.sent[i].text === TG_SAY.stopRetry && q === 2 && H.cache.tgq.v === waiting([TG3 + 1, TG3 + 3]),
    'a /stop with its add waiting ' + JSON.stringify([H.tg.sent.slice(i), H.cache.tgq, q]));
  H.ctx.SpreadsheetApp.openById = tmp;
  tgcheck(H, nonce());
  ok(tgRows(H, TG3 + 1).length === 1 && tgRows(H, TG3 + 3).length === 1 && tgRows(H, TG3 + 4).length === 0 && !H.cache.tgq,
    'the waiting adds after the sheet came back ' + JSON.stringify([contactRows(H).length, H.cache.tgq]));
  i = H.tg.sent.length; H.tg.say(TG3 + 1, '/stop'); tgcheck(H, nonce());
  ok(tgRows(H, TG3 + 1).length === 0 && H.tg.sent[i].text === TG_SAY.stopped, '/stop once the sheet is back');
  // Any other throw in the poll: "not yet" (phones keep asking, no 'server'), one plain log line.
  tmp = H.ctx.tgPoll_;
  H.ctx.tgPoll_ = function () { throw new Error('boom ' + TG_TOKEN + ' ' + TG3); };
  r = tgcheck(H, nonce());
  H.ctx.tgPoll_ = tmp;
  ok(r.ok === true && r.verified === false && H.logs[H.logs.length - 1] === 'tgcheck: the poll failed', 'a throw in the poll ' + JSON.stringify(r) + ' ' + H.logs.slice(-1));
  // tgTick (the trigger): reads the bot with no phone polling, as in badge mode, so /stop deletes the row; the same
  // lock and 2 s throttle as tgcheck; without a token it does nothing; a throw is one plain log line.
  q = gsHarness({ token: true, mode: 'badge' }); q.ctx.staffSetup(); q.ctx.staffSetup();
  ok(q.triggers.length === 1 && q.triggers[0].fn === 'tgTick', 'staffSetup twice: triggers ' + JSON.stringify(q.triggers));
  t = nonce(); q.tg.say(TG1, '/start ' + t); q.clock += 2100; q.ctx.tgTick();
  ok(tgRows(q, TG1).length === 1 && q.call({ action: 'tgcheck', nonce: t }).badge === q.tgId(TG1), 'tgTick: a /start');
  q.tg.say(TG1, '/stop'); q.clock += 5 * 60000; q.locks = []; gets = q.tg.gets;
  q.ctx.tgTick();
  ok(tgRows(q, TG1).length === 0 && q.tg.sent[q.tg.sent.length - 1].text === TG_SAY.stopped && q.tg.gets === gets + 1 && q.locks.join() === 'document',
    'tgTick: a /stop in badge mode ' + JSON.stringify([q.tg.sent.slice(-1), q.locks]));
  q.ctx.tgTick();
  ok(q.tg.gets === gets + 1, 'tgTick within 2 s of a poll polled again');
  q.props.TG_TOKEN = ''; q.clock += 5 * 60000; q.ctx.tgTick();
  ok(q.tg.gets === gets + 1, 'tgTick without TG_TOKEN asked Telegram');
  q.props.TG_TOKEN = TG_TOKEN; tmp = q.ctx.tgPoll_; q.ctx.tgPoll_ = function () { throw new Error('boom ' + TG1); };
  q.ctx.tgTick(); q.ctx.tgPoll_ = tmp;
  ok(q.logs[q.logs.length - 1] === 'tgTick: the poll failed' && q.logs.join('\n').indexOf(String(TG1)) < 0, 'tgTick after a throw ' + q.logs.slice(-1));
  // Curator info yes only with the tick (3 Nov c, review): the game sends agree: 1 with every tgcheck once the box is
  // ticked, kept per nonce ('tga:', 6 h) while it waits; a page from before the tick sends none, so its row stays
  // empty. A later ticked verify sets yes on the row already there; an unticked one never clears it, and writes nothing
  // once the cache knows. A waiting add keeps its tick (an old bare-ID one has none).
  q = gsHarness({ token: true }); q.ctx.staffSetup();
  t = nonce(); r = tgcheck(q, t, { agree: 1 });
  ok(r.ok && r.verified === false && q.cache['tga:' + t] && q.cache['tga:' + t].t === q.clock + q.ctx.TG_NONCE_S * 1000, 'agree kept for the nonce ' + JSON.stringify(q.cache['tga:' + t]));
  q.tg.say(TG1, '/start ' + t); tgcheck(q, t);
  ok(tgRows(q, TG1).length === 1 && tgRows(q, TG1)[0][3] === 'yes' && q.cache['tgc:' + TG1].v === 'yes|' + tgUser(TG1), 'a ticked verify: ' + JSON.stringify(tgRows(q, TG1)));
  [true, '1', 2, 'yes', [1], { agree: 1 }, 0].forEach(function (x, j) {
    var nn = nonce(), who = TG3 + 10 + j;
    tgcheck(q, nn, { agree: x }); q.tg.say(who, '/start ' + nn); tgcheck(q, nn);
    ok(!q.cache['tga:' + nn] && tgRows(q, who).length === 1 && tgRows(q, who)[0][3] === '', 'agree ' + JSON.stringify(x) + ' counted as the tick');
  });
  t = nonce(); q.tg.say(TG2, '/start ' + t); tgcheck(q, t);
  r = tgcheck(q, t, { agree: 1 });
  ok(r.verified && !q.cache['tga:' + t] && tgRows(q, TG2)[0][3] === '' && q.cache['tgc:' + TG2].v === '1|' + tgUser(TG2), 'agree after the verify ' + JSON.stringify(tgRows(q, TG2)));
  t = nonce(); tgcheck(q, t, { agree: 1 }); q.tg.say(TG2, '/start ' + t); tgcheck(q, t);
  ok(tgRows(q, TG2).length === 1 && tgRows(q, TG2)[0][3] === 'yes' && q.cache['tgc:' + TG2].v === 'yes|' + tgUser(TG2), 'a ticked verify after an unticked one ' + JSON.stringify(tgRows(q, TG2)));
  before = q.writes.length;
  t = nonce(); q.tg.say(TG2, '/start ' + t); tgcheck(q, t);
  delete q.cache['tgc:' + TG2];
  t = nonce(); q.tg.say(TG2, '/start ' + t); tgcheck(q, t);
  ok(tgRows(q, TG2).length === 1 && tgRows(q, TG2)[0][3] === 'yes' && q.writes.length === before && q.cache['tgc:' + TG2].v === 'yes|' + tgUser(TG2),
    'an unticked verify after a ticked one ' + JSON.stringify([tgRows(q, TG2), q.writes.slice(before)]));
  tmp = q.ctx.SpreadsheetApp.openById;
  q.ctx.SpreadsheetApp.openById = function () { throw new Error('boom'); };
  t = nonce(); tgcheck(q, t, { agree: 1 }); q.tg.say(TG3 + 20, '/start ' + t);
  t = nonce(); q.tg.say(TG3 + 21, '/start ' + t); tgcheck(q, t);
  ok(q.cache.tgq.v === waiting([TG3 + 20, TG3 + 21], [TG3 + 20]), 'the waiting adds and their ticks ' + q.cache.tgq.v);
  t = nonce(); tgcheck(q, t, { agree: 1 }); q.tg.say(TG3 + 21, '/start ' + t); tgcheck(q, t);
  ok(q.cache.tgq.v === waiting([TG3 + 20, TG3 + 21], [TG3 + 20, TG3 + 21]), 'a tick on a second verify of a waiting add ' + q.cache.tgq.v);
  q.ctx.SpreadsheetApp.openById = tmp;
  q.cache.tgq.v = JSON.stringify(JSON.parse(q.cache.tgq.v).concat([String(TG3 + 22)]));   // as 2026-11-03a queued it
  tgcheck(q, nonce());
  ok(tgRows(q, TG3 + 20)[0][3] === 'yes' && tgRows(q, TG3 + 21)[0][3] === 'yes' && tgRows(q, TG3 + 22).length === 1 && tgRows(q, TG3 + 22)[0][3] === '' && !q.cache.tgq,
    'the waiting adds once the sheet is back ' + JSON.stringify(contactRows(q).slice(-3)));
  // The tap's watch (3 Nov c, review): watch: 1 reads the bot by long poll (TG_LONG_S each) until TG_WATCH_S after the
  // tap, so a Start tapped meanwhile is answered at once, Back to the game button and all, though no phone asks (the
  // player's page is hidden behind Telegram). It stops early once its nonce is in; regular polls stay timeout 0.
  q = gsHarness({ token: true }); q.ctx.staffSetup();
  ok(q.ctx.TG_WATCH_S === 30 && q.ctx.TG_WATCH_MAX_S === 90 && q.ctx.TG_LONG_S === 20 && q.ctx.TG_TICK_MIN === 1,
    'watch timings ' + [q.ctx.TG_WATCH_S, q.ctx.TG_WATCH_MAX_S, q.ctx.TG_LONG_S, q.ctx.TG_TICK_MIN]);
  tgcheck(q, nonce());
  ok(q.tg.waits.join() === '0', 'a tgcheck long-polled ' + q.tg.waits);
  t = nonce(); q.clock += 2100; t0 = q.clock; gets = q.tg.gets; q.locks = [];
  r = q.call({ action: 'tgcheck', nonce: t, back: NETLIFY, app: 'tokens', agree: 1, watch: 1 });
  ok(r.ok && r.verified === false && q.tg.waits.slice(1).join() === '20,10' && q.tg.gets === gets + 2 && q.clock === t0 + 30000 && q.locks.join() === 'document' &&
    !q.cache['tg:watch'] && q.cache['tgb:' + t] && q.cache['tga:' + t], 'a watch with nothing to read ' + JSON.stringify([r, q.tg.waits, q.clock - t0, q.locks]));
  t = nonce(); q.clock += 2100; t0 = q.clock; gets = q.tg.gets; i = q.tg.sent.length;
  q.tg.wait = function () { q.tg.wait = null; q.clock += 4000; q.tg.say(TG1, '/start ' + t); };
  r = q.call({ action: 'tgcheck', nonce: t, back: PREVIEW, app: 'countries', agree: 1, watch: 1 });
  u = q.tg.sent[i] || {};
  ok(r.verified && r.badge === q.tgId(TG1) && r.sig === q.sig(r.badge) && q.tg.sent.length === i + 1 && u.text === TG_SAY.verified && u.at === t0 + 4000 &&
    JSON.stringify(u.markup) === backKb(PREVIEW + '?tg=' + t + '&app=countries') && tgRows(q, TG1)[0][3] === 'yes' && q.tg.gets === gets + 1 && q.clock === t0 + 4000,
    'Start 4 s into a watch ' + JSON.stringify([r, u, q.tg.gets - gets, q.clock - t0]));
  gets = q.tg.gets; q.clock += 2100;
  ok(q.call({ action: 'tgcheck', nonce: t, watch: 1 }).verified && q.tg.gets === gets, 'a watch for a nonce already verified read the bot');
  // Two taps: B taps 10 s into A's watch, whose run holds the lock, so B's call only moves 'tg:until' on and ends, and
  // B's page's plain tgcheck reads the cache, not the bot. A's Start at 12 s, B's at 35 s: A's run answers both as they
  // come and reads on until 30 s after B's tap. Then B's next tgcheck is verified from the cache.
  wa = nonce(); wb = nonce(); q.clock += 2100; t0 = q.clock; i = q.tg.sent.length; tmp = [];
  q.tg.wait = function (sec) {
    var at = q.clock - t0;
    if (at < 10000) {
      q.clock = t0 + 10000; q.docBusy = true; k = q.tg.gets;
      tmp.push(q.call({ action: 'tgcheck', nonce: wb, agree: 1, watch: 1 }), q.call({ action: 'tgcheck', nonce: wb, agree: 1 }), q.tg.gets - k);
      q.docBusy = false; q.clock = t0 + 12000; q.tg.say(TG2, '/start ' + wa);
    } else if (at < 35000) { q.clock = t0 + 35000; q.tg.say(TG3, '/start ' + wb); }
    else { q.tg.wait = null; q.clock += sec * 1000; }
  };
  gets = q.tg.gets;
  r = q.call({ action: 'tgcheck', nonce: wa, agree: 1, watch: 1 });
  u = q.tg.sent.slice(i);
  ok(r.verified && r.badge === q.tgId(TG2) && tmp[0].ok && tmp[0].verified === false && tmp[1].verified === false && tmp[2] === 0 && u.length === 2 &&
    u[0].chat === TG2 && u[0].at === t0 + 12000 && u[1].chat === TG3 && u[1].at === t0 + 35000 && q.clock === t0 + 40000 && q.tg.gets === gets + 3 && !q.cache['tg:watch'],
    'two taps, one watch ' + JSON.stringify([r.verified, tmp, u.map(function (x) { return [x.chat, x.at - t0]; }), q.clock - t0, q.tg.gets - gets]));
  gets = q.tg.gets; q.locks = []; r = tgcheck(q, wb);
  ok(r.verified && r.badge === q.tgId(TG3) && q.tg.gets === gets && q.locks.length === 0 && tgRows(q, TG3)[0][3] === 'yes', 'B after the watch ' + JSON.stringify(r));
  // While a watch reads ('tg:watch'), a tgcheck and tgTick neither wait for the lock nor read.
  q.cache['tg:watch'] = { v: '1', t: q.clock + 30000 }; q.locks = []; gets = q.tg.gets; q.clock += 2100;
  r = q.call({ action: 'tgcheck', nonce: nonce() }); q.ctx.tgTick();
  ok(r.ok && r.verified === false && q.locks.length === 0 && q.tg.gets === gets, 'a tgcheck and tgTick during a watch ' + JSON.stringify([q.locks, q.tg.gets - gets]));
  delete q.cache['tg:watch'];
  // One run reads at most TG_WATCH_MAX_S, however often taps move 'tg:until' on; at most TG_WATCH_MAX_S reads, should
  // Telegram answer a long poll at once; Telegram down: one try, then the watch ends; a throw: "not yet", one plain line.
  t = nonce(); q.clock += 2100; t0 = q.clock;
  q.tg.wait = function (sec) { q.clock += sec * 1000; q.cache['tg:until'] = { v: String(q.clock + 30000), t: q.clock + 35000 }; };
  r = q.call({ action: 'tgcheck', nonce: t, watch: 1 }); q.tg.wait = null;
  ok(r.verified === false && q.clock === t0 + 90000 && !q.cache['tg:watch'], 'a watch moved on without end ran ' + (q.clock - t0) + ' ms');
  q.tg.instant = true; gets = q.tg.gets; q.clock += 2100;
  r = q.call({ action: 'tgcheck', nonce: nonce(), watch: 1 }); q.tg.instant = false;
  ok(r.verified === false && q.tg.gets - gets === q.ctx.TG_WATCH_MAX_S, 'long polls Telegram answers at once: ' + (q.tg.gets - gets) + ' reads');
  tmp = q.ctx.UrlFetchApp.fetch; k = 0;
  q.ctx.UrlFetchApp.fetch = function (x, o) { k++; return tmp(x, o); };
  q.tg.down = true; q.clock += 2100; t0 = q.clock;
  r = q.call({ action: 'tgcheck', nonce: nonce(), watch: 1 });
  q.tg.down = false; q.ctx.UrlFetchApp.fetch = tmp;
  ok(r.ok && r.verified === false && k === 1 && q.clock === t0 && !q.cache['tg:watch'], 'a watch with Telegram down ' + JSON.stringify([r, k]));
  tmp = q.ctx.tgPoll_; q.ctx.tgPoll_ = function () { throw new Error('boom ' + TG_TOKEN + ' ' + TG1); };
  q.clock += 2100; r = q.call({ action: 'tgcheck', nonce: nonce(), watch: 1 }); q.ctx.tgPoll_ = tmp;
  ok(r.ok && r.verified === false && !q.cache['tg:watch'] && q.logs[q.logs.length - 1] === 'tgcheck: the poll failed', 'a throw in a watch ' + JSON.stringify(r));
  tmp = q.logs.join('\n');
  ok(nc.every(function (x) { return tmp.indexOf(x) < 0; }) && tmp.indexOf(String(TG1)) < 0 && tmp.indexOf(TG_TOKEN) < 0, 'a log line holds a nonce, a Telegram ID or the token:\n' + tmp);
  // Busy above 2000 tgchecks a minute, all phones together.
  q = gsHarness({ token: true }); q.ctx.staffSetup(); q.cache['tgn:' + nc[1]] = { v: String(TG1), t: q.clock + 99999 };
  for (i = 0; i < 2001; i++) r = q.call({ action: 'tgcheck', nonce: nc[1] });
  ok(r.error === 'busy', 'the 2001st tgcheck in a minute ' + JSON.stringify(r));

  // start in telegram mode: only a signed id spends a try, and its row says Contact yes.
  before = H.rows('Tries');
  r = start(H, id1);
  ok(r.ok === false && r.error === 'unverified' && r.mode === 'telegram' && typeof r.open === 'boolean' && H.rows('Tries') === before,
    'a start without a sig ' + JSON.stringify(r));
  [{ sig: '0'.repeat(32) }, { sig: sig1.toUpperCase() }, { sig: sig1.slice(0, 31) }, { sig: H.sig(id2) }, { sig: sig1 + '0' }].forEach(function (x) {
    ok(start(H, id1, x).error === 'unverified' && H.rows('Tries') === before, 'a start with sig ' + x.sig);
  });
  t = tok('ab');
  r = start(H, id1, { sig: sig1, token: t });
  row = H.tab('Tries').rows[H.rows('Tries') - 1];
  ok(r.ok && r.counted && r.tryNo === 1 && r.contact === true && r.mode === 'telegram' && row[10] === 'yes' && row[2] === id1,
    'a signed start ' + JSON.stringify(r) + ' ' + JSON.stringify(row));
  // No contact step: a Teal round earns at the desk at once.
  H.clock += 60000;
  r = H.call({ action: 'finish', token: t, score: S.tiers[1] + 20 });
  code = r.best && r.best.code;
  ok(r.ok && r.tier === 1 && r.contact === true && code === 'C-' + t.slice(0, 6).toUpperCase(), 'the finish ' + JSON.stringify(r));
  // The desk: the ticket QR (id and sig), a sig that isn't this id's, a none-mode ticket (no sig), a typed C- code.
  r = staff(H, { action: 'check', badge: id1, sig: sig1 });
  ok(r.ok && r.badge === id1 && r.contact === true && r.earned === 1 && r.used === false && r.mode === 'telegram', 'check by ticket QR ' + JSON.stringify(r));
  ['0'.repeat(32), H.sig(id2), sig1.toUpperCase(), 'zz'].forEach(function (s) {
    ok(staff(H, { action: 'check', badge: id1, sig: s }).error === 'badticket', 'check with sig ' + s + ' is not badticket');
  });
  ok(staff(H, { action: 'check', badge: id1, sig: '' }).ok === true, 'a ticket with no sig (none mode) is refused');
  [code, code.toLowerCase(), code.replace('-', ''), ' ' + code.slice(0, 4) + ' ' + code.slice(4) + ' ', code.toLowerCase().replace('-', ' - ')].forEach(function (c) {
    r = staff(H, { action: 'check', code: c, badge: A });
    ok(r.ok && r.badge === id1 && r.earned === 1, 'check by code ' + JSON.stringify(c) + ': ' + JSON.stringify(r));
  });
  ['C-ZZZZZZ', 'C-ABC', 'K-' + code.slice(2), 'CC-' + code.slice(2), code + '1'].forEach(function (c) {
    ok(staff(H, { action: 'check', code: c }).error === 'nocode', 'check by code ' + c + ' is not nocode');
  });
  // Two tries share a code's 6 characters: the finished one wins (a ticket shows a finished round's code).
  q = H.tgId(TG3); tmp = 'qq9zzz' + 'a'.repeat(14);
  start(H, q, { sig: H.sig(q), token: tmp });
  start(H, id2, { sig: H.sig(id2), token: 'qq9zzz' + 'b'.repeat(14) }); H.clock += 60000;
  H.call({ action: 'finish', token: 'qq9zzz' + 'b'.repeat(14), score: 100 });
  r = staff(H, { action: 'check', code: 'C-QQ9ZZZ' });
  ok(r.ok && r.badge === id2, 'check by a shared code prefix ' + JSON.stringify(r));
  // Claim with the resolved id; then the ticket and the code are both used.
  r = staff(H, { action: 'claim', badge: id1, tier: 'teal', item: 'x', staff: 'Ana', id: 'claimtg00001', how: 'scan' });
  ok(r.ok && staff(H, { action: 'check', code: code }).used === true && staff(H, { action: 'check', badge: id1, sig: sig1 }).used === true, 'claim ' + JSON.stringify(r));
  // None and badge modes: any id starts (no sig needed); a signed id still writes Contact yes, an unsigned one doesn't.
  staff(H, { action: 'setmode', mode: 'none', staff: 'Ana' });
  r = start(H, 'd'.repeat(64));
  row = H.tab('Tries').rows[H.rows('Tries') - 1];
  ok(r.ok && r.counted && r.mode === 'none' && row[10] === '', 'none mode: an unsigned start ' + JSON.stringify(r));
  q = H.tgId(TG3 + 7);
  r = start(H, q, { sig: H.sig(q) });
  ok(r.ok && r.counted && H.tab('Tries').rows[H.rows('Tries') - 1][10] === 'yes', 'none mode: a signed start has no Contact yes');
  staff(H, { action: 'setmode', mode: 'telegram', staff: 'Ana' });
  // Privacy: the contacts sheet never holds a player id, sig, token or score; the badge sheet never a Telegram number.
  tmp = JSON.stringify(H.contacts.sheets);
  ok(!/[0-9a-f]{32}/.test(tmp) && tmp.indexOf(t) < 0, 'the contacts sheet holds a player id, sig or token');
  tmp = JSON.stringify(H.bound.sheets);
  ok([TG1, TG2, TG3].every(function (x) { return tmp.indexOf(String(x)) < 0; }), 'the badge sheet holds a Telegram number');
  // Logs: never the token, a nonce, a Telegram number or a message.
  tmp = H.logs.join('\n');
  ok(tmp.indexOf(TG_TOKEN) < 0 && tmp.indexOf('7712345678') < 0 && nc.every(function (x) { return tmp.indexOf(x) < 0; }) &&
    [TG1, TG2, TG3].every(function (x) { return tmp.indexOf(String(x)) < 0; }) && tmp.indexOf('/start') < 0 && tmp.indexOf('boom') < 0,
    'a log line holds the token, a nonce, a Telegram number or a message:\n' + tmp);
  // telegramTest: getMe then deleteWebhook; the bot's name, a warning for another bot, Telegram's error, never the token.
  q = gsHarness(); q.ctx.telegramTest();
  ok(q.logs.indexOf(NOTE) > -1 && !q.tg.calls.length, 'telegramTest without TG_TOKEN ' + q.logs);
  q.props.TG_TOKEN = TG_TOKEN; q.ctx.telegramTest();
  ok(q.logs.indexOf('Telegram OK: @KlerosBoothBot') > -1 && q.tg.calls.join() === 'getMe,deleteWebhook' && q.logs.every(function (l) { return !/Warning|failed/.test(l); }),
    'telegramTest ' + JSON.stringify([q.logs, q.tg.calls]));
  q.tg.username = 'OtherBot'; q.ctx.telegramTest();
  ok(q.logs.some(function (l) { return /^Warning: this token is for @OtherBot/.test(l); }), 'telegramTest with another bot ' + q.logs.slice(-2));
  q.props.TG_TOKEN = 'bad' + TG_TOKEN; q.tg.calls = []; q.ctx.telegramTest();
  ok(q.logs[q.logs.length - 1] === 'Telegram failed: Unauthorized' && q.tg.calls.join() === 'getMe', 'telegramTest with a bad token ' + q.logs.slice(-1));
  q.props.TG_TOKEN = TG_TOKEN; q.tg.down = true; q.ctx.telegramTest();
  ok(q.logs.join('\n').indexOf(TG_TOKEN) < 0 && /^Telegram failed: /.test(q.logs[q.logs.length - 1]), 'telegramTest with Telegram down ' + q.logs.slice(-1));
  console.log('Booth web app: how players verify\n  ' + n + ' cases (Verify with row and dropdown, mode in every reply, setmode, menu, tgcheck and the bot, ' +
    'contacts rows and /stop, Back to the game button and its page and app, Curator info by the tick (agree, a later tick, waiting adds), the tap’s watch ' +
    '(long polls, Start answered at once, two taps, caps, Telegram down), offset, poll throttle and locks, Telegram down, a broken contacts sheet, tgTick every minute, ' +
    'signed starts, check by ticket QR or C- code, ' +
    'privacy, telegramTest)');
}
// The contacts sheet's Day for now, as Sheets keeps the "'yyyy-MM-dd" text.
function dayOf(h) { return h.ctx.Utilities.formatDate(new Date(h.clock), 'Asia/Kolkata', 'yyyy-MM-dd'); }

// ---- Booth web app: Telegram usernames and the desk's reset (3 Nov c) ----
// The bot keeps each verify's Telegram username (no @; '' when the player has none) next to the ID in the contacts
// sheet, in a Username column added at the end (an older 7-column header gets it from staffSetup or the first write),
// rewritten when it changes, and taken off another account's row that held it. The staff action reset finds a player
// by it (exact, any case, one leading @) and deletes their Tries and Badge claims rows under the lock, so they play 2
// fresh tries and can get merch again; the contacts row stays, and the log has the staff name and the counts only.
function checkReset() {
  var n = 0, H, q, r, t, tmp, before, logs, nn = 0, seq = 0, TG1 = 5550001234, TG2 = 5550009876, TG3 = 5550005555,
    OLD = 5550000001, id2, id3, HEAD7 = ['Day', 'Contact', 'Kind', 'Curator info', 'Event', 'Source', 'Id'];
  function ok(cond, msg) { n++; if (!cond) fail('Code.gs reset: ' + msg); }
  function nonce() { nn++; return ('Rs' + nn + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ').slice(0, 24); }
  function tok() { seq++; return ('rs' + seq + 'qwertyuiopasdfghjkzx').slice(0, 20); }
  // fromId sends /start with that username (undefined: tgUser's, null: none); a tgcheck past the 2 s throttle reads it.
  function verify(h, fromId, user) {
    var x = nonce();
    h.tg.say(fromId, '/start ' + x, { username: user }); h.clock += 2100;
    return h.call({ action: 'tgcheck', nonce: x });
  }
  function rowOf(h, id) { return h.contacts.sheets.Contacts.rows.slice(1).filter(function (x) { return x && String(x[1]) === String(id) && x[2] === 'telegram id'; }); }
  function nameOf(h, id) { var x = rowOf(h, id); return x.length === 1 ? x[0][7] : 'rows: ' + JSON.stringify(x); }
  function reset(h, name, more) {
    var b = { action: 'reset', key: h.props.STAFF_KEY, username: name, staff: 'Ana' }, k;
    for (k in more || {}) b[k] = more[k];
    return h.call(b);
  }
  // A signed try for player id, finished with that score (0: left unfinished); start's reply.
  function play(h, id, score) {
    var x = tok(), s = h.call({ action: 'start', badge: id, token: x, app: 'sights', sig: h.sig(id) });
    h.clock += 60000;
    if (score) h.call({ action: 'finish', token: x, score: score });
    return s;
  }
  function claim(h, id, tier, cid, more) {
    var b = { action: 'claim', key: h.props.STAFF_KEY, badge: id, tier: tier, item: 'x', staff: 'Ana', id: cid }, k;
    for (k in more || {}) b[k] = more[k];
    return h.call(b);
  }
  function triesOf(h, id) { return h.tab('Tries').rows.slice(1).filter(function (x) { return x && x[2] === id; }).length; }
  function claimsOf(h, id) { return h.tab('Badge claims').rows.slice(1).filter(function (x) { return x && x[1] === id; }).length; }
  if (!GS_SRC) return;
  // The header: an older 7-column one gets Username from staffSetup (its rows stay as they are) or from the bot's first
  // write; a header row that isn't the script's is left alone. (A new sheet's: checkServer.)
  q = gsHarness({ token: true }); tmp = q.contacts.sheets.Contacts;
  tmp.appendRow(HEAD7); tmp.appendRow(['\'2026-11-02', '\'' + OLD, 'telegram id', 'yes', 'Devcon VIII Mumbai', 'curate bot', '']);
  q.ctx.staffSetup();
  ok(tmp.rows[0].join() === HEAD7.concat('Username').join() && tmp.rows[1].length === 7 && tmp.getLastRow() === 2, 'staffSetup on a 7-column header ' + JSON.stringify(tmp.rows));
  // A player who verified before 2026-11-03c gets their username on their next verify, on the row they have.
  verify(q, OLD, 'Old_Name');
  ok(rowOf(q, OLD).length === 1 && nameOf(q, OLD) === 'Old_Name' && rowOf(q, OLD)[0][3] === 'yes', 'an older row on its next verify ' + JSON.stringify(rowOf(q, OLD)));
  q = gsHarness({ token: true }); tmp = q.contacts.sheets.Contacts; tmp.appendRow(HEAD7);
  r = verify(q, TG1, 'Ana_K');
  ok(r.verified && tmp.rows[0][7] === 'Username' && nameOf(q, TG1) === 'Ana_K', 'the bot’s first write on a 7-column header ' + JSON.stringify(tmp.rows));
  q = gsHarness({ token: true }); tmp = q.contacts.sheets.Contacts; tmp.appendRow(['Notes', 'x']); q.ctx.staffSetup();
  ok(tmp.rows[0].join() === 'Notes,x', 'a header row that isn’t the script’s was changed ' + JSON.stringify(tmp.rows[0]));
  // Stored as text on every /start NONCE, rewritten when it changes or goes; the same one again writes nothing.
  H = gsHarness({ token: true }); H.ctx.staffSetup();
  id2 = H.tgId(TG2); id3 = H.tgId(TG3);
  r = verify(H, TG1, 'Ana_K');
  ok(r.verified && r.badge === H.tgId(TG1) && nameOf(H, TG1) === 'Ana_K' && H.writes.indexOf('\'Ana_K') > -1 && H.cache['tgc:' + TG1].v === '1|Ana_K',
    'a verify keeps the username ' + JSON.stringify(rowOf(H, TG1)));
  before = H.writes.length;
  verify(H, TG1, 'Ana_K'); delete H.cache['tgc:' + TG1]; verify(H, TG1, 'Ana_K');
  ok(H.writes.length === before && nameOf(H, TG1) === 'Ana_K', 'the same username again wrote ' + JSON.stringify(H.writes.slice(before)));
  verify(H, TG1, 'Ana_Kay');
  ok(rowOf(H, TG1).length === 1 && nameOf(H, TG1) === 'Ana_Kay' && H.cache['tgc:' + TG1].v === '1|Ana_Kay', 'a changed username ' + JSON.stringify(rowOf(H, TG1)));
  verify(H, TG1, null);
  ok(nameOf(H, TG1) === '' && H.cache['tgc:' + TG1].v === '1|', 'a dropped username ' + JSON.stringify(rowOf(H, TG1)));
  // Not a Telegram username (4–32 letters, digits or _): kept as none.
  verify(H, TG1, 'Ana_K');
  ['abc', 'bad-name', 'x'.repeat(33), '@Ana_K', ' Ana_K', '=1+1', 5].forEach(function (u) {
    verify(H, TG1, u);
    ok(nameOf(H, TG1) === '', 'username ' + JSON.stringify(u) + ' was stored as ' + JSON.stringify(nameOf(H, TG1)));
  });
  // All digits stays text; a value cached by 2026-11-03b (no bar) reads the row once more and sets its username.
  verify(H, TG3 + 1, '12345');
  ok(nameOf(H, TG3 + 1) === '12345' && H.writes.indexOf('\'12345') > -1, 'an all-digit username is not text ' + JSON.stringify(rowOf(H, TG3 + 1)));
  // A 4-character username (collectible, sold on Fragment) is one too.
  verify(H, TG3 + 3, 'Nate');
  ok(nameOf(H, TG3 + 3) === 'Nate', 'a 4-character username ' + JSON.stringify(rowOf(H, TG3 + 3)));
  H.cache['tgc:' + TG1] = { v: '1', t: H.clock + 99999 };
  verify(H, TG1, 'Ana_K');
  ok(nameOf(H, TG1) === 'Ana_K' && H.cache['tgc:' + TG1].v === '1|Ana_K', 'a row cached by 2026-11-03b got no username ' + JSON.stringify(rowOf(H, TG1)));
  // A username is one account's at a time: another account verifying with it (any case) takes it, and the first row's
  // cache goes, so its next verify reads the sheet.
  verify(H, TG2, 'ana_k');
  ok(nameOf(H, TG1) === '' && nameOf(H, TG2) === 'ana_k' && !H.cache['tgc:' + TG1] && rowOf(H, TG1).length === 1,
    'a username another account now holds ' + JSON.stringify([rowOf(H, TG1), rowOf(H, TG2)]));
  // A failed add waits with its username; one queued by 2026-11-03b ([ID, ticked]) is added with none.
  tmp = H.ctx.SpreadsheetApp.openById; H.ctx.SpreadsheetApp.openById = function () { throw new Error('boom'); };
  r = verify(H, TG3, 'Cara_3');
  H.ctx.SpreadsheetApp.openById = tmp;
  ok(r.verified && H.cache.tgq && H.cache.tgq.v === JSON.stringify([[String(TG3), false, 'Cara_3']]), 'a waiting add ' + JSON.stringify(H.cache.tgq));
  H.cache.tgq.v = JSON.stringify(JSON.parse(H.cache.tgq.v).concat([[String(TG3 + 2), true]]));
  H.clock += 2100; H.call({ action: 'tgcheck', nonce: nonce() });
  ok(nameOf(H, TG3) === 'Cara_3' && nameOf(H, TG3 + 2) === '' && rowOf(H, TG3 + 2)[0][3] === 'yes' && !H.cache.tgq,
    'the waiting adds once the sheet is back ' + JSON.stringify([rowOf(H, TG3), rowOf(H, TG3 + 2)]));

  // reset. ana_k (TG2): a Teal round, a try left unfinished between Cara_3's (TG3) and the claim; Cara_3: one round
  // and a K- ticket claim. Its rows go, bottom up; Cara_3's stay in order.
  play(H, id2, S.tiers[1] + 40); play(H, id3, 100); play(H, id2, 0);
  ok(claim(H, id2, 'teal', 'claimrs00001').ok && claim(H, id3, 'gold', 'claimrs00002', { ticket: 'K-RST001' }).ok &&
    [triesOf(H, id2), claimsOf(H, id2), triesOf(H, id3), claimsOf(H, id3)].join() === '2,1,1,1', 'the reset cases’ rows');
  // The staff key, then an exact username only: nothing changes and nothing is logged.
  before = H.snap(); logs = H.logs.length;
  ok(H.call({ action: 'reset', username: 'ana_k' }).error === 'wrongkey' && reset(H, 'ana_k', { key: 'WRONG' }).error === 'wrongkey', 'reset without the staff key');
  [undefined, null, '', '   ', '@', 'ana', 'ana_', 'na_k', 'ana_k2', 'ana k', '@@ana_k', 'ana_k@', '@ ana_k', 'ana_k\n2', String(TG2), 'Ana_Kay',
    tgUser(TG2), 'Old_Name'].forEach(function (u) {
    r = reset(H, u);
    ok(JSON.stringify(r) === '{"ok":false,"error":"nouser"}', 'reset of ' + JSON.stringify(u) + ': ' + JSON.stringify(r));
  });
  ok(H.snap() === before && H.logs.length === logs, 'a refused reset wrote or logged ' + H.logs.slice(logs));
  // Found: one leading @, spaces round it, any case.
  tmp = H.contacts.sheets.Contacts.getLastRow();
  r = reset(H, '  @ANA_K ', { staff: '=Ana' });
  ok(r.ok === true && r.tries === 2 && r.claims === 1 && r.open === true && Array.isArray(r.soldOut) && r.mode === 'telegram' &&
    triesOf(H, id2) === 0 && claimsOf(H, id2) === 0 && H.rows('Tries') === 2 && H.tab('Tries').rows[1][2] === id3 && claimsOf(H, id3) === 1 &&
    H.rows('Badge claims') === 2, 'a reset ' + JSON.stringify(r) + ' ' + JSON.stringify(H.tab('Tries').rows.slice(1)));
  ok(nameOf(H, TG2) === 'ana_k' && H.contacts.sheets.Contacts.getLastRow() === tmp, 'the reset touched the contacts row ' + JSON.stringify(rowOf(H, TG2)));
  ok(H.logs.length === logs + 1 && H.logs[logs] === 'reset by \'=Ana: 2 tries, 1 claims', 'the reset’s log ' + JSON.stringify(H.logs.slice(logs)));
  // After it: 2 fresh tries, then the limit; the desk sees a new round and gives merch again.
  r = play(H, id2, S.tiers[2] + 20); q = play(H, id2, 0);
  ok(r.counted && r.tryNo === 1 && r.left === 1 && q.counted && q.tryNo === 2 && q.left === 0 && play(H, id2, 0).reason === 'limit', 'tries after a reset ' + JSON.stringify([r, q]));
  r = H.call({ action: 'check', key: H.props.STAFF_KEY, badge: id2, sig: H.sig(id2) });
  ok(r.ok && r.used === false && r.earned === 2 && r.triesUsed === 2 && claim(H, id2, 'purple', 'claimrs00003').ok, 'merch after a reset ' + JSON.stringify(r));
  // Nothing left to delete is still found; an all-digit name; a busy lock writes nothing.
  r = [reset(H, 'Cara_3'), reset(H, 'cara_3')].map(function (x) { return [x.ok, x.tries, x.claims].join(); });
  ok(r.join(' ') === 'true,1,1 true,0,0' && H.logs[H.logs.length - 1] === 'reset by Ana: 0 tries, 0 claims' && reset(H, '12345').ok === true &&
    reset(H, 'nate').ok === true, 'reset with nothing left, an all-digit or a 4-character name ' + JSON.stringify(r));
  H.lockBusy = true; before = H.snap();
  r = reset(H, 'ana_k');
  H.lockBusy = false;
  ok(r.error === 'busy' && H.snap() === before, 'a reset under a held lock ' + JSON.stringify(r));
  // After /stop the row is gone, so the name is too.
  H.tg.say(TG2, '/stop'); H.clock += 2100; H.call({ action: 'tgcheck', nonce: nonce() });
  ok(rowOf(H, TG2).length === 0 && reset(H, 'ana_k').error === 'nouser', 'a reset after /stop');
  // Never a username, a Telegram ID or a player id in a log line, nor a username in the badge sheet.
  tmp = H.logs.join('\n');
  ok(['ana_k', 'Ana_K', 'Cara_3', '12345', 'Nate', 'Old_Name', String(TG2), String(TG3), id2, id3].every(function (x) { return tmp.toLowerCase().indexOf(x.toLowerCase()) < 0; }),
    'a log line holds a username or an id:\n' + tmp);
  tmp = JSON.stringify(H.bound.sheets);
  ok(['ana_k', 'Ana_K', 'Cara_3', 'Username'].every(function (x) { return tmp.indexOf(x) < 0; }), 'the badge sheet holds a username');
  // No contacts tab: nouser. The contacts sheet broken: server, logged as 'error reset' only.
  q = gsHarness({ token: true }); q.ctx.staffSetup(); delete q.contacts.sheets.Contacts;
  ok(reset(q, 'ana_k').error === 'nouser', 'a reset with no Contacts tab');
  q.ctx.SpreadsheetApp.openById = function () { throw new Error('boom ana_k ' + TG2); };
  r = reset(q, 'ana_k');
  ok(r.ok === false && r.error === 'server' && q.logs[q.logs.length - 1] === 'error reset', 'a reset with the contacts sheet broken ' + JSON.stringify([r, q.logs.slice(-1)]));
  console.log('Booth web app: usernames and reset\n  ' + n + ' cases (Username header, stored and rewritten on each verify, kept as text, one account at a time, ' +
    'waiting adds, reset by exact username with the staff key, Tries and claims deleted bottom up, contact kept, 2 fresh tries and merch again, ' +
    'busy, /stop, logs with counts only)');
}

// ---- Rewards ----
// rewards.js and earn.js in vm "pages" that share one fake localStorage, like two tabs on one phone. No real DOM:
// every element is a stub that keeps textContent, hidden, value and attributes. v6 pages have no network; a badge-
// mode page (opts.server = a gsHarness) gets a CurateBadge stub whose post() calls Code.gs synchronously (or answers
// offline while server.offline is set), and a clock and timers tied to the harness clock. A v6 page may get a clock
// too (opts.clock = { clock: ms }), so a case can move it to another day. 3 Nov b: a link's href is its attribute, as
// in a browser (removeAttribute('href') empties it); an event records preventDefault (click() returns it); focus()
// counts; opts.url gives the page its address (location.origin, pathname, search, hash) and history.replaceState
// moves it, keeping each new address in ctx.history.urls (opts.nohistory: a browser without it).
function Store() { this.d = {}; }
Store.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this.d, k) ? this.d[k] : null; };
Store.prototype.setItem = function (k, v) { this.d[k] = String(v); };
Store.prototype.removeItem = function (k) { delete this.d[k]; };
function stubEl() {
  var attrs = {}, cls = {}, on = {}, el;
  el = { textContent: '', hidden: false, title: '', open: false, children: [], value: '', checked: false, disabled: false,
    className: '', style: { setProperty: function () {} }, focused: 0,
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
    removeAttribute: function (k) { delete attrs[k]; }, hasAttribute: function (k) { return k in attrs; },
    classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; },
      toggle: function (c) { if (cls[c]) delete cls[c]; else cls[c] = 1; }, contains: function (c) { return !!cls[c]; } },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, contains: function () { return false; },
    appendChild: function () {}, removeChild: function () {}, insertBefore: function () {}, focus: function () { this.focused++; },
    scrollIntoView: function () {}, setPointerCapture: function () {},
    addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); },
    fire: function (t) {
      var e = { defaultPrevented: false, stopPropagation: function () {}, target: null };
      e.preventDefault = function () { e.defaultPrevented = true; };
      (on[t] || []).forEach(function (fn) { fn(e); });
      return e;
    },
    click: function () { return this.fire('click'); } };
  Object.defineProperty(el, 'href', { enumerable: true, get: function () { return 'href' in attrs ? attrs.href : ''; },
    set: function (v) { attrs.href = String(v); } });
  return el;
}
var RW_SRC = ['site/config.js', 'site/curate/settings.js', 'site/curate/decks.js', 'site/curate/rules.js', 'site/curate/rewards.js',
  'site/curate/earn.js'].map(function (f) { return [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]; });
// The real badge.js, in its own vm with a window stub: its id() and ok() also serve the pages' CurateBadge stub.
var BADGE = (function () {
  var ctx = { console: console, navigator: {}, CURATE_SETTINGS: S, setTimeout: setTimeout, clearTimeout: clearTimeout };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(DIR, 'badge.js'), 'utf8'), ctx, { filename: 'badge.js' }); } catch (e) { fail('badge.js threw on load: ' + e.message); }
  return ctx.CurateBadge || null;
})();
function badgeHash(id) { return crypto.createHash('sha256').update((BADGE ? BADGE.SALT : '') + id).digest('hex'); }
// The Go banner as game.js builds it from begin()'s answer (badge mode) or canCount() (v6Began, the fallback).
function goLine(began) {
  var src = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8'), m = /function goText\(\) \{[\s\S]*?\n  \}/.exec(src);
  if (!m) { fail('game.js: goText() is missing'); return ''; }
  return new Function('began', 'S', m[0] + '\nreturn goText();')(began, S);
}
function page(ls, opts) {
  opts = opts || {};
  var k, els = {}, G = opts.server, clk = null, timers = [], on = {}, ctx = { console: console, localStorage: ls, location: { search: opts.kiosk ? '?kiosk=1' : '' },
    history: { state: null, urls: [], replaceState: function (st, t, u) {
      var x = new URL(String(u), ctx.location.href || 'https://test.invalid/curate/');
      ctx.history.urls.push(String(u));
      ctx.location.pathname = x.pathname; ctx.location.search = x.search; ctx.location.hash = x.hash; ctx.location.href = x.href;
    } },
    document: { hidden: false, activeElement: null, readyState: 'complete', getElementById: function (id) { return els[id] || (els[id] = stubEl()); },
      createElement: stubEl, addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); } },
    addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); }, setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 1; }, clearInterval: function () {}, performance: { now: function () { return 0; } },
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {} };
  ctx.window = ctx;
  if (opts.nohistory) delete ctx.history;
  if (opts.url) {
    k = new URL(opts.url);
    ctx.location = { origin: k.origin, protocol: k.protocol, host: k.host, pathname: k.pathname, search: k.search, hash: k.hash, href: k.href };
  }
  if (G || opts.clock) {
    clk = G || opts.clock;
    ctx.Date = function () { return arguments.length ? new (Function.prototype.bind.apply(Date, [null].concat([].slice.call(arguments))))() : new Date(clk.clock); };
    ctx.Date.now = function () { return clk.clock; }; ctx.Date.parse = Date.parse; ctx.Date.UTC = Date.UTC;
  }
  if (G) {
    ctx.setTimeout = function (fn, ms) { timers.push({ fn: fn, at: G.clock + (ms || 0) }); return timers.length; };
    ctx.clearTimeout = function (i) { if (timers[i - 1]) timers[i - 1].fn = null; };
    ctx.Uint8Array = Uint8Array;
    ctx.crypto = { getRandomValues: function (u) { return crypto.randomFillSync(u); } };
    ctx.CurateBadge = {
      SALT: BADGE.SALT, id: BADGE.id, ok: BADGE.ok, tail: BADGE.tail, endpoint: function () { return 'https://test/exec'; },
      can: function () { return { hash: !opts.nocrypto, camera: true, detector: true }; },
      read: function (raw, done) {
        var id = BADGE.id(raw);
        if (opts.nocrypto) return done('nocrypto');
        if (!BADGE.ok(id, raw)) return done('notbadge', { id: id });
        done(null, { id: id, tail: BADGE.tail(id), hash: badgeHash(id) });
      },
      // None mode's phone id: the same salted hash as a badge (3 Nov).
      hash: function (bid, done) { if (opts.nocrypto) return done('nocrypto'); done(null, badgeHash(bid)); },
      // G.lose: the server acts but the reply is lost on the way back (a dropped connection). ctx.posts: every body sent.
      post: function (body, done, o) {
        var j;
        ctx.posts.push({ body: JSON.parse(JSON.stringify(body)), opts: o || null });
        if (G.offline) return done('offline');
        j = G.call(JSON.parse(JSON.stringify(body)));
        if (G.lose) { G.lose = false; return done('offline'); }
        done(null, j);
      },
      loadJsQR: function (done) { done(true); },
      // The QR maker (3 Nov): a stub element that remembers its text; the real one is checked in checkBadgeJs.
      loadQR: function (done) { done(true); },
      qr: function (text) { var el = stubEl(); el.setAttribute('data-text', text); return el; }
    };
    ctx.posts = [];
  }
  els['hdr-logo'] = stubEl(); els['hdr-logo'].setAttribute('href', '/');   // as in the shell
  vm.createContext(ctx);
  RW_SRC.forEach(function (f) {
    vm.runInContext(f[1], ctx, { filename: f[0] });
    if (/settings/.test(f[0])) ctx.CURATE_SETTINGS.server.endpoint = G ? 'https://test/exec' : '';
    // The core cases below were written for "only Gold needs a check-in"; pin that rule so they keep testing
    // the ticket logic, and cover the live setting (checkinNeededFrom 1) in its own cases with opts.need.
    if (/rules/.test(f[0])) ctx.CURATE_SETTINGS.checkinNeededFrom = opts.need || 3;
    if (/rules/.test(f[0]) && opts.settings) opts.settings(ctx.CURATE_SETTINGS);
    if (/config/.test(f[0]) && opts.config) opts.config(ctx.KLEROS_BOOTH_CONFIG);
  });
  ctx.CurateRewards.init({ show: function (v) { ctx.view = v; }, say: function (s) { ctx.said = s; },
    reset: function () { ctx.didReset = (ctx.didReset || 0) + 1; ctx.CurateRewards.refreshBrief(); },
    nudge: function () { ctx.nudged = (ctx.nudged || 0) + 1; } });
  ctx.text = function (id) { return els[id] ? els[id].textContent : ''; };
  ctx.el = function (id) { return ctx.document.getElementById(id); };
  // Moves the shared clock on and runs the timers that are due (badge-mode pages only).
  ctx.tick = function (ms) {
    G.clock += ms;
    timers.slice().forEach(function (t) { if (t.fn && t.at <= G.clock) { var fn = t.fn; t.fn = null; fn(); } });
  };
  // Fires a document or window event (visibilitychange, pageshow, …) at what the page listens with.
  ctx.fire = function (t, e) { (on[t] || []).forEach(function (fn) { fn(e || {}); }); };
  return ctx;
}
// One round through the public API, as game.js calls it: startShift when the clock starts, then finishShift.
function playShift(pg, final) {
  var r = pg.CurateRewards.startShift('sights');
  pg.CurateRewards.finishShift({ deck: 'sights', final: final, raw: final, caught: 3, fakesSeen: 4, listed: 5, goodsSeen: 6,
    evidence: 1, wrong: 0, leaks: 1, trust: 85, reviewed: 10, counted: r.counted, shiftNo: r.shiftNo, code: r.code, misses: [] });
  return r;
}
function stamp(pg) { pg.CurateRewards.showTicket(); pg.el('tb-staff-btn').click(); pg.el('staff-ok').click(); }
function self(tier, merch) {
  var m = merch || (tier === 3 ? { tg: 'joined', x: 1, li: 1, quiz: 1 } : tier === 2 ? { tg: 'joined', x: 1, li: 1 } : {});
  return JSON.stringify({ ticket: 'K-ABC123', name: 'Ana', confirmed: true, newsletter: false, merch: m });
}
function checkRewards() {
  var n = 0, ls, a, b, c, kept, m, k, T = S.tiers, PER = S.countedTries, clock, DAY = 24 * 3600 * 1000;
  // Scores inside each tier, read from settings.js so a retune keeps these cases meaningful.
  var EVERY = Math.floor(T[1] / 2), LOW = Math.floor(T[1] / 4), TEAL = Math.floor((T[1] + T[2]) / 2),
    PURPLE = Math.floor((T[2] + T[3]) / 2), GOLD = T[3] + 50, GOLD2 = T[3] + 150;
  function ok(cond, msg) { n++; if (!cond) fail('rewards.js: ' + msg); }
  function stored(l) { return JSON.parse(l.getItem('kleros_devcon_curate')); }
  // Two tabs: once one tab has used the phone’s tries (countedTries, v6: 2), a stale tab neither counts one more
  // nor drops the other tab's best or stamp.
  ls = new Store(); a = page(ls); b = page(ls);
  for (k = 0; k < PER; k++) playShift(a, [TEAL, PURPLE][k] || EVERY);
  ok(!b.CurateRewards.startShift('sights').counted, 'a stale tab counted try ' + (PER + 1));
  ok(stored(ls).counted === PER && stored(ls).best.final === (PER > 1 ? PURPLE : TEAL), 'a stale tab dropped the other tab’s counted rounds or best');
  stamp(a);
  kept = JSON.stringify(stored(ls).collected);
  ok(stored(ls).collected && stored(ls).collected.tier === (PER > 1 ? 2 : 1), 'the staff stamp did not save the best tier');
  b.CurateRewards.startShift('sights'); b.CurateRewards.showTicket();
  ok(JSON.stringify(stored(ls).collected) === kept && b.CurateRewards.model().state === 'collected', 'a stale tab lost the stamp');
  // The check-in ticket already covers a game tier at or below it: no second claimable ticket.
  ls = new Store(); ls.setItem('kleros_devcon_self', self(3)); c = page(ls); playShift(c, GOLD2);
  ok(c.CurateRewards.model().state === 'checkin', 'check-in Gold plus game Gold is still claimable');
  ls = new Store(); ls.setItem('kleros_devcon_self', self(1)); c = page(ls); playShift(c, PURPLE);
  m = c.CurateRewards.model();
  ok(m.state === 'live' && m.t === 2 && m.code === 'K-ABC123', 'check-in Teal plus game Purple is not a live K- Purple ticket');
  // Everyone has nothing to stamp, and a later Teal round still counts.
  ls = new Store(); c = page(ls); playShift(c, EVERY); stamp(c);
  ok(c.el('tb-staff-btn').hidden && !stored(ls).collected, 'an Everyone ticket can be stamped');
  playShift(c, TEAL);
  m = c.CurateRewards.model();
  ok(m.state === 'live' && m.t === 1, 'a Teal round after an Everyone ticket is not live Teal');
  // A mid-day retune never downgrades a ticket, and a lower tier never replaces it.
  ls = new Store(); playShift(page(ls), GOLD);
  c = page(ls, { settings: function (s) { s.tiers = [0, T[1], T[2], T[3] + 100]; } });
  ok(c.CurateRewards.model().g === 3, 'raising the Gold threshold downgraded an earned Gold ticket');
  playShift(c, GOLD + 20);
  ok(stored(ls).best.final === GOLD, 'a Purple ' + (GOLD + 20) + ' replaced a Gold ' + GOLD);
  // Sold-out notes read as plain sentences for every tier.
  [['teal', TEAL], ['purple', PURPLE], ['gold', GOLD]].forEach(function (t) {
    var l = new Store(), p;
    // Gold needs a confirmed check-in; a Teal check-in alone already covers Teal and Purple sold down to Teal.
    if (t[0] === 'gold') l.setItem('kleros_devcon_self', JSON.stringify({ ticket: 'K-Z', confirmed: true, merch: {} }));
    p = page(l, { settings: function (s) { s.soldOut = [t[0]]; } });
    playShift(p, t[1]); p.CurateRewards.showTicket();
    ok(/gone for today/.test(p.text('t-note')) && !/ss are|gamchas/.test(p.text('t-note')), 'sold-out note for ' + t[0] + ': ' + p.text('t-note'));
  });
  // A duplicate check-in (merch.claimed): the merch already went with it, so the game names no reward.
  ls = new Store(); ls.setItem('kleros_devcon_self', self(0, { claimed: 'email' })); c = page(ls);
  ok(/^You already checked in at the booth/.test(c.text('welcome-text')), 'duplicate check-in welcome: ' + c.text('welcome-text'));
  playShift(c, GOLD2);
  ok(c.text('rep-tier-line') === 'Merch goes with your first check-in. Play for fun.', 'duplicate check-in report: ' + c.text('rep-tier-line'));
  ok(c.el('rep-gold').hidden !== false && c.CurateRewards.model().state === 'dup', 'duplicate check-in is offered a Gold check-in');
  // Kiosk: one round is one visitor, capped at kioskMaxTier, and the ticket's button is Next curator.
  c = page(new Store(), { kiosk: true });
  playShift(c, TEAL); playShift(c, LOW);
  m = c.CurateRewards.model();
  ok(m.t === 0 && m.best.final === LOW, 'the next kiosk visitor inherited an earlier best');
  playShift(c, GOLD2); c.CurateRewards.showTicket();
  ok(c.CurateRewards.model().t === S.kioskMaxTier && c.text('t-again') === 'Next curator', 'kiosk cap or Next curator');
  ok(!c.el('hdr-logo').hasAttribute('href'), 'the kiosk logo keeps a link');
  // The one-item rule shows once, whether or not the configured merch note already says it.
  [null, 'While stocks last'].forEach(function (note) {
    var p = page(new Store(), note ? { config: function (cfg) { cfg.merch.note = note; } } : {});
    var hits = (p.text('ladder-fine').match(/one item per person/ig) || []).length;
    ok(hits === 1, 'ladder fine print with note ' + (note || 'from config.js') + ': ' + p.text('ladder-fine'));
  });
  // v6 §4: the title's tries line counts down, and a collected ticket never says how many are left.
  if (PER === 2) {
    ls = new Store(); c = page(ls); playShift(c, LOW); c.CurateRewards.refreshBrief();
    ok(c.text('ladder-fine').indexOf('1 of 2 tries left.') === 0, 'tries line after one try: ' + c.text('ladder-fine'));
    playShift(c, LOW); c.CurateRewards.refreshBrief();
    ok(c.text('ladder-fine').indexOf('Both tries used. Play for fun.') === 0, 'tries line after two: ' + c.text('ladder-fine'));
    ls = new Store(); c = page(ls); playShift(c, TEAL); stamp(c); c.CurateRewards.refreshBrief();
    ok(c.text('ladder-fine').indexOf('left') < 0, 'tries line after a stamp: ' + c.text('ladder-fine'));
    a = page(new Store());
    ok(a.text('ladder-fine').indexOf('2 tries count for merch.') === 0, 'tries line before a try: ' + a.text('ladder-fine'));
    // A round just for fun says what its score reached and that it wins no merch, never a reward (2 Nov: the
    // bare “Purple score” box said nothing), then why: here the merch was already collected.
    playShift(c, PURPLE);
    ok(c.text('rep-tier-line') === 'Your score reached Purple, but this round wins no merch.', 'just-for-fun tier line: ' + c.text('rep-tier-line'));
    ok(c.text('rep-tries') !== '', 'just-for-fun after collecting says nothing about why');
    // After both tries: the same tier line, and the why starts with the tries.
    ls = new Store(); c = page(ls); playShift(c, LOW); playShift(c, LOW); playShift(c, PURPLE);
    ok(c.text('rep-tier-line') === 'Your score reached Purple, but this round wins no merch.' &&
      c.text('rep-tries').indexOf('Both tries used.') === 0, 'just-for-fun after two tries: ' + c.text('rep-tier-line') + ' / ' + c.text('rep-tries'));
  }
  // 2 tries per phone for the whole event (2 Nov, user: “2 tries per ticket”): a new day, or the last booth day,
  // gives no new tries and keeps the best ticket; a try left on day 1 is still the phone’s on day 2.
  clock = { clock: Date.parse('2026-11-03T12:00:00+05:30') };
  ls = new Store(); c = page(ls, { clock: clock });
  m = c.CurateRewards.canCount();
  ok(goLine({ counted: m.counted, shiftNo: m.next, tries: m.tries }) === 'Try 1 of ' + PER + ' · Go!', 'Go banner for try 1');
  playShift(c, TEAL);
  ok(c.text('rep-tries') === 'Try 1 of ' + PER + ' · ' + (PER - 1) + (PER === 2 ? ' try' : ' tries') + ' left', 'Results after try 1: ' + c.text('rep-tries'));
  c.CurateRewards.showTicket();
  ok(c.text('tb-shift').split(' · ').length === 3, 'the ticket back names a day for today’s round: ' + c.text('tb-shift'));
  // 00:01 IST the next day (the booth’s midnight): the phone’s second try is still its own, and still its last.
  clock.clock = Date.parse('2026-11-04T00:01:00+05:30'); c = page(ls, { clock: clock });
  m = c.CurateRewards.canCount();
  ok(m.counted && m.next === 2 && m.left === PER - 1 && m.tries === PER && m.perDay === undefined, 'day 2 after one try on day 1: ' + JSON.stringify(m));
  ok(goLine({ counted: m.counted, shiftNo: m.next, tries: m.tries }) === 'Try 2 of ' + PER + ' · Go!', 'Go banner for try 2 on day 2');
  clock.clock = Date.parse('2026-11-04T12:00:00+05:30'); c = page(ls, { clock: clock });
  a = playShift(c, LOW);
  ok(a.counted && a.shiftNo === 2 && c.text('rep-tries') === (PER > 2 ? 'Try 2 of ' + PER + ' · ' + (PER - 2) + ' tries left' : 'Both tries used'),
    'try 2 on day 2: ' + JSON.stringify(a) + ' ' + c.text('rep-tries'));
  // 5 Nov, then 6 Nov (the last booth day).
  [DAY, DAY].forEach(function (d) {
    var p;
    clock.clock += d; p = page(ls, { clock: clock });
    m = p.CurateRewards.canCount();
    ok(!m.counted && m.reason === 'limit' && stored(ls).counted === PER, 'a new day gave this phone new tries: ' + JSON.stringify(m));
    ok(p.CurateRewards.model().state === 'live' && p.CurateRewards.model().best.final === TEAL, 'a new day dropped the phone’s best ticket');
    p.CurateRewards.refreshBrief();
    ok(p.text('ladder-fine').indexOf('Both tries used. Play for fun.') === 0 && !daily(p.text('ladder-fine')), 'tries line on a later day: ' + p.text('ladder-fine'));
    ok(!playShift(p, PURPLE).counted && p.text('rep-tries') === 'Both tries used. Your Teal ticket still counts.' && !daily(p.text('rep-tries')),
      'a fun round on a later day: ' + p.text('rep-tries'));
    ok(!daily(p.text('welcome-text')) && p.text('welcome-text').indexOf('today') < 0, 'welcome chip says today: ' + p.text('welcome-text'));
    p.CurateRewards.showTicket();
    ok(p.text('tb-shift').indexOf('Try 1 of ' + PER + ' · ') === 0 && p.text('tb-shift').split(' · ').length === 4,
      'the ticket back of a best round from another day names no day: ' + p.text('tb-shift'));
    ok(goLine({ counted: false, reason: 'limit', tries: PER }) === 'Just for fun · Go!', 'Go banner for a fun round');
  });
  // Both tries spent on rounds that never finished (a reload mid-round): no ticket, and none promised.
  ls = new Store(); c = page(ls); c.CurateRewards.startShift('sights'); c.CurateRewards.startShift('sights');
  c = page(ls); c.CurateRewards.showTicket();
  ok(c.text('t-tier') === 'No ticket yet' && c.text('t-hint') === (PER === 2 ? 'Both tries used.' : 'All ' + PER + ' tries used.') &&
    c.text('t-again') === 'Play for fun', 'no ticket after spent tries: ' + c.text('t-hint') + ' / ' + c.text('t-again'));
  ls = new Store(); c = page(ls); c.CurateRewards.showTicket();
  ok(c.text('t-hint') === 'Play a round for merch.', 'no ticket before a try: ' + c.text('t-hint'));
  // The live rule (checkinNeededFrom 1, anti-replay): without a check-in a Teal score shows the Everyone ticket
  // plus a "check in to claim" strip; with a confirmed check-in it is a live K- ticket; a kiosk round gets stickers.
  if (S.checkinNeededFrom === 1) {
    ls = new Store(); c = page(ls, { need: 1 }); playShift(c, TEAL); c.CurateRewards.showTicket();
    m = c.CurateRewards.model();
    ok(m.t === 0 && m.pending === 1 && c.el('t-gold').hidden === false && /^Teal score\. Check in/.test(c.text('t-gold-text')),
      'need 1, no check-in: Teal is not pending with a check-in strip (' + c.text('t-gold-text') + ')');
    // A confirmed check-in is already Teal by itself, so the game adds a ticket only above it.
    ls = new Store(); ls.setItem('kleros_devcon_self', self(0)); c = page(ls, { need: 1 }); playShift(c, PURPLE);
    m = c.CurateRewards.model();
    ok(m.state === 'live' && m.t === 2 && m.code === 'K-ABC123', 'need 1, confirmed check-in: Purple is not a live K- ticket');
    c = page(new Store(), { kiosk: true, need: 1 }); playShift(c, GOLD2);
    ok(c.CurateRewards.model().t === 0, 'need 1, kiosk: a tablet round is above stickers without a check-in');
  }
  console.log('Rewards\n  ' + n + ' ticket and storage cases (two tabs, check-in, Everyone, retune, sold out, duplicate, kiosk, tries line, 2 tries per phone with none back on a later day, check-in for all merch)');
}

// ---- Badge mode ----
// rewards.js and earn.js with server.endpoint set, against Code.gs in the harness above (spec 9.B): a scan spends
// nothing, a try counts at Start, a ticket above stickers unlocks with a contact, the kiosk keeps nothing.
function checkBadgeMode() {
  var n = 0, G = gsHarness({ mode: 'badge' }), T = S.tiers, LOW = Math.floor(T[1] / 4), TEAL = Math.floor((T[1] + T[2]) / 2),
    PURPLE = Math.floor((T[2] + T[3]) / 2), GOLD = T[3], ls, p, q, r, m, rows, k, kls, best, before;   // Gold: the server caps scores at the best round
  function ok(cond, msg) { n++; if (!cond) fail('badge mode: ' + msg); }
  function R(pg) { return pg.CurateRewards; }
  function begin(pg, fun) { var out; R(pg).begin('sights', { fun: !!fun }, function (x) { out = x; }); return out; }
  function setB(pg, raw) { var out; R(pg).setBadge(raw, function (x) { out = x; }); return out; }
  // One round as game.js plays it: the clock starts (startShift), ms later the round ends (finishShift).
  function play(pg, final, o) {
    var i = R(pg).startShift('sights');
    o = o || {};
    G.clock += o.ms || 30000;
    R(pg).finishShift({ deck: 'sights', final: final, raw: final, caught: 3, fakesSeen: 4, listed: 5, goodsSeen: 6, evidence: 1,
      wrong: 0, leaks: o.leaks == null ? 1 : o.leaks, trust: 85, reviewed: 10, entries: 10, endedBy: 'done', counted: i.counted,
      shiftNo: i.shiftNo, code: i.code, misses: [], reason: o.reason || '' });
    return i;
  }
  function contact(pg, v) { pg.el('contact-input').value = v; pg.el('contact-form').fire('submit'); }
  function clean(l) { return Object.keys(l.d).every(function (x) { return l.d[x].indexOf('@') < 0 && !/AB12CD34|ZZ99YY88/.test(l.d[x]); }); }
  G.ctx.staffSetup();
  // Scan, then two counted tries; the first Teal round is locked until a contact is left.
  ls = new Store(); p = page(ls, { server: G });
  ok(R(p).online === true, 'online is false with an endpoint');
  ok(p.text('ladder-fine').indexOf('Your Devcon badge gives 2 tries for merch.') === 0, 'title fine line: ' + p.text('ladder-fine'));
  R(p).renderIntro();
  ok(p.text('intro-note') === 'Your Devcon badge gives 2 tries for merch.' && !p.el('intro-scan').hidden && p.el('intro-priv').hidden === true,
    'intro before a scan: ' + p.text('intro-note'));
  ok(setB(p, 'not a badge').error === 'notbadge', 'a non-badge scan');
  r = setB(p, 'AB12CD34');
  ok(r && r.ok && p.text('intro-badge') === 'Badge …CD34 · Try 1 of 2' && G.rows('Tries') === 1, 'a scan: ' + JSON.stringify(r) + ' ' + p.text('intro-badge') + ', Tries rows ' + G.rows('Tries'));
  r = begin(p);
  ok(r && r.ok && r.counted && r.shiftNo === 1 && G.rows('Tries') === 2, 'Start spends try 1 ' + JSON.stringify(r));
  ok(goLine(r) === 'Try 1 of 2 · Go!', 'Go banner for try 1: ' + goLine(r));
  r = play(p, TEAL);
  ok(p.text('rep-tries') === 'Try 1 of 2 · 1 try left', 'Results after try 1: ' + p.text('rep-tries'));
  ok(/^C-[A-Z0-9]{6}$/.test(r.code || ''), 'game code ' + r.code);
  m = R(p).model();
  ok(m.state === 'locked' && m.t === 1 && m.pending === 0, 'a Teal round before a contact is not locked ' + JSON.stringify({ s: m.state, t: m.t, p: m.pending }));
  ok(p.el('rep-gold').hidden !== false && p.el('t-gold').hidden !== false && p.text('to-ticket') === 'Unlock my merch ticket',
    'Results: a check-in strip, or to-ticket ' + p.text('to-ticket'));
  ok(p.text('rep-company') === '1 wrong entry got through.' && p.el('rep-save').hidden, 'company line or save line: ' + p.text('rep-company') + ' / ' + p.text('rep-save'));
  R(p).showTicket();
  ok(!p.el('contact').hidden && p.text('t-code') === '······', 'a locked ticket shows its code or hides the contact step');
  contact(p, 'bob');
  ok(p.text('contact-msg') === 'Enter an email or a @Telegram handle.' && G.contacts.sheets.Contacts.getLastRow() === 1, 'a bad contact: ' + p.text('contact-msg'));
  p.el('contact-curator').checked = true;
  contact(p, 'ana@example.org');
  m = R(p).model();
  ok(m.state === 'live' && /^C-[A-Z0-9]{6}$/.test(p.text('t-code')), 'the ticket after a contact: ' + m.state + ' ' + p.text('t-code'));
  R(p).showTicket();
  ok(/^Try 1 of 2 · \w{3} \d{1,2} \w{3} · \d\d:\d\d · \S/.test(p.text('tb-shift')), 'the ticket back names no day: ' + p.text('tb-shift'));
  rows = G.contacts.sheets.Contacts.rows;
  ok(G.contacts.sheets.Contacts.getLastRow() === 2 && rows[1][1] === 'ana@example.org' && rows[1][3] === 'yes', 'the contact row ' + JSON.stringify(rows[1]));
  ok(clean(ls), 'localStorage holds a contact or a badge code: ' + JSON.stringify(ls.d));
  R(p).refreshBrief();
  ok(p.text('ladder-fine').indexOf('1 of 2 tries left.') === 0, 'title after try 1: ' + p.text('ladder-fine'));
  r = begin(p);
  ok(r && r.ok && r.shiftNo === 2, 'Start spends try 2 ' + JSON.stringify(r));
  play(p, LOW);
  r = begin(p);
  ok(r && r.ok === false && r.error === 'limit' && p.text('intro-note') === 'Both tries used.', 'a third Start ' + JSON.stringify(r) + ' ' + p.text('intro-note'));
  r = begin(p, true);
  ok(r && r.ok && r.counted === false && r.reason === 'limit' && goLine(r) === 'Just for fun · Go!', 'Play for fun after two tries ' + JSON.stringify(r));
  play(p, PURPLE, { reason: r.reason });
  ok(p.text('rep-tier-line') === 'Your score reached Purple, but this round wins no merch.' &&
    p.text('rep-tries') === 'Both tries used. Your Teal ticket still counts.', 'a fun round after two tries: ' + p.text('rep-tier-line') + ' / ' + p.text('rep-tries'));
  ok(R(p).model().t === 1, 'a fun Purple round raised the ticket');
  // 2 tries per badge for the whole event (2 Nov, user: “2 tries per ticket”): the next day and the last booth day
  // give none back, neither on this phone (no midnight reset in the browser) nor on a fresh one (the server's count).
  before = G.rows('Tries'); G.clock += 24 * 3600 * 1000; R(p).renderIntro();
  ok(p.text('intro-note') === 'Both tries used.' && p.el('intro-go').hidden, 'the next day, before status answers: ' + p.text('intro-note'));
  R(p).refreshStatus(true); R(p).refreshBrief();
  ok(p.text('ladder-fine').indexOf('Both tries used. Play for fun.') === 0 && !daily(p.text('ladder-fine')), 'the next day, title: ' + p.text('ladder-fine'));
  r = begin(p);
  ok(r && r.ok === false && r.error === 'limit', 'a Start the next day ' + JSON.stringify(r));
  [G.clock, Date.parse('2026-11-06T10:00:00Z')].forEach(function (t) {
    var pg;
    G.clock = t; pg = page(new Store(), { server: G }); setB(pg, 'AB12CD34');
    ok(pg.text('intro-badge') === 'Badge …CD34' && pg.text('intro-note') === 'Both tries used.' && pg.el('intro-go').hidden,
      'another phone on ' + new Date(t).toISOString().slice(0, 10) + ': ' + pg.text('intro-badge') + ' / ' + pg.text('intro-note'));
    r = begin(pg, true); play(pg, TEAL, { reason: r && r.reason });
    ok(r && r.reason === 'limit' && pg.text('rep-tries') === 'Both tries used. Your Teal ticket still counts.' && !daily(pg.text('rep-tries')),
      'a fun round on a later day: ' + pg.text('rep-tries'));
  });
  ok(G.rows('Tries') === before, 'a later day added a Tries row for a badge with no tries left');
  // Company line in plain words, both modes.
  [page(new Store(), { server: G }), page(new Store())].forEach(function (pg, i) {
    [[0, 'No wrong entry got through.'], [1, '1 wrong entry got through.'], [3, '3 wrong entries got through.']].forEach(function (c) {
      if (i === 0) begin(pg, true);
      play(pg, LOW, { leaks: c[0], reason: i === 0 ? 'nobadge' : '' });
      ok(pg.text('rep-company') === c[1], (i ? 'v6' : 'badge mode') + ' company line for ' + c[0] + ': ' + pg.text('rep-company'));
    });
  });
  // Late unlock from the intro, on another phone: no try spent.
  q = page(new Store(), { server: G });
  setB(q, 'ZZ99YY88'); begin(q); play(q, TEAL);
  q = page(new Store(), { server: G });
  rows = G.rows('Tries');
  r = setB(q, 'ZZ99YY88');
  ok(!q.el('intro-unlock').hidden && q.text('intro-unlock') === 'Unlock my Teal ticket', 'late unlock button: ' + q.text('intro-unlock'));
  R(q).showTicket();
  ok(R(q).model().state === 'locked', 'late unlock: the ticket is not locked');
  contact(q, '@ana_k');
  ok(R(q).model().state === 'live' && G.rows('Tries') === rows, 'late unlock: not live, or a try was spent');
  // A start whose reply is lost: the next Start sends the same token, so the try is not spent twice.
  q = page(new Store(), { server: G });
  setB(q, 'LL11MM22');
  G.offline = true; r = begin(q); G.offline = false;
  ok(r && r.ok === false && r.error === 'offline' && q.text('intro-note') === 'Can’t reach the merch list. Try again, or play for fun.',
    'an offline Start: ' + JSON.stringify(r) + ' ' + q.text('intro-note'));
  rows = G.rows('Tries'); G.lose = true; begin(q);
  ok(G.rows('Tries') === rows + 1, 'a start with a lost reply was not saved');
  r = begin(q);
  ok(r && r.ok && r.counted && r.shiftNo === 1 && G.rows('Tries') === rows + 1, 'the retried Start spent another try ' + JSON.stringify(r));
  // A finish the server refuses (5 s round): the round wins nothing.
  play(q, TEAL, { ms: 5000 });
  ok(q.text('rep-save') === 'This round couldn’t be saved, so it wins no merch.', 'a refused finish: ' + q.text('rep-save'));
  // An offline finish keeps trying, shows Try again, and saves once the list answers.
  q = page(new Store(), { server: G });
  setB(q, 'QQ11WW22'); begin(q);
  G.offline = true; play(q, PURPLE);
  ok(q.text('rep-save') === 'Not saved yet. Trying again…' && q.el('to-ticket').disabled, 'an unsaved finish: ' + q.text('rep-save'));
  q.tick(3000); q.tick(6000);
  ok(!q.el('rep-retry').hidden, 'no Try again while the finish is stuck: ' + q.text('rep-save'));
  G.offline = false; q.el('rep-retry').click();
  ok(q.el('rep-save').hidden && q.text('to-ticket') === 'Unlock my merch ticket', 'Try again did not save the finish: ' + q.text('rep-save'));
  // A finish still unsent when the page closes goes out on the next load.
  ls = new Store(); q = page(ls, { server: G });
  setB(q, 'RR77TT88'); begin(q);
  G.offline = true; play(q, GOLD); G.offline = false;
  best = (JSON.parse(ls.getItem('kleros_devcon_curate_badge') || '{}').pending || {}).score;
  ok(best === GOLD, 'an unsent finish is not kept on the phone');
  q = page(ls, { server: G });
  ok(!JSON.parse(ls.getItem('kleros_devcon_curate_badge') || '{}').pending && R(q).model().state === 'locked' && R(q).model().t === 3,
    'an unsent finish was not sent on the next load');
  // Paused (the Switches tab): Start refused, the title and intro say so.
  G.tab('Switches').rows[1][1] = false; delete G.cache.switches;
  q = page(new Store(), { server: G });
  setB(q, 'PP33OO44');
  ok(q.text('intro-note') === 'Merch is paused right now.', 'paused intro: ' + q.text('intro-note'));
  r = begin(q);
  ok(r && r.ok === false && r.error === 'paused', 'Start while paused ' + JSON.stringify(r));
  R(q).refreshStatus(true); R(q).refreshBrief();
  ok(q.text('ladder-fine').indexOf('Merch is paused right now. Play for fun.') === 0, 'paused title: ' + q.text('ladder-fine'));
  G.tab('Switches').rows[1][1] = true; delete G.cache.switches;
  // Kiosk: the badge is the identity (no cap); a locked ticket holds; idle resets and leaves nothing behind.
  kls = new Store(); k = page(kls, { server: G, kiosk: true });
  setB(k, 'KK55JJ66'); begin(k); play(k, GOLD);
  ok(R(k).model().t === 3, 'a kiosk Gold round is capped: ' + R(k).model().t);
  ok(!kls.getItem('kleros_devcon_curate_badge'), 'the kiosk stored a badge');
  R(k).showTicket();
  k.tick(25000);
  ok(!k.el('contact').hidden && !k.didReset, 'a locked kiosk ticket did not hold 25 s');
  k.tick(S.kioskIdleMs);
  ok(k.didReset === 1 && Object.keys(kls.d).length === 0, 'the kiosk did not reset after kioskIdleMs, or kept ' + JSON.stringify(kls.d));
  r = begin(k, true);
  play(k, TEAL, { reason: r && r.reason });
  ok(k.text('rep-tier-line') === 'Your score reached Teal, but this round wins no merch.' &&
    k.text('rep-tries') === 'No badge scanned. Scan it next round to play for merch.', 'an unscanned kiosk round: ' + k.text('rep-tier-line') + ' / ' + k.text('rep-tries'));
  // No crypto.subtle (http, old browsers): play for fun.
  q = page(new Store(), { server: G, nocrypto: true }); R(q).renderIntro();
  ok(q.text('intro-note') === 'This browser can’t read badges. Play for fun.', 'no crypto: ' + q.text('intro-note'));
  // A fun round with no ticket promises no new tries, ever (v6, per phone; 2 Nov: no “New tries tomorrow”).
  q = page(new Store());
  [0, 1, 2].forEach(function () { playShift(q, LOW); });
  ok(q.text('rep-tries') === 'Both tries used.', 'a v6 fun round with no ticket: ' + q.text('rep-tries'));
  console.log('Badge mode\n  ' + n + ' cases (scan, 2 tries per badge, none back on a later day, locked ticket and contact, late unlock, lost replies, refused and unsent finishes, paused, kiosk)');
}

// ---- Telegram and none modes (3 Nov) ----
// rewards.js against Code.gs with Verify with on Telegram (the bot answers through the fake Bot API) or None: the
// verify link and its nonce, the wait, verified then Start, an unverified start, the ticket's QR text (read back as
// the desk reads it), the booth tablet's QR, and none mode's phone id with the contact step it keeps. 3 Nov b (spec 2):
// the consent tick the link waits on, back and app on every tgcheck, and the way back from the bot's Back to the game
// button (?tg=NONCE&app=APP).
var CONSENT = 'I want to play this game and learn how Kleros Curate works, fully decentralised. I agree to get Telegram messages ' +
  'on how to take part in real contests across Kleros apps. Leave any time: send /stop to the bot.';   // the owner's words
function checkTelegramMode() {
  var n = 0, G = gsHarness({ token: true }), T = S.tiers, TG = S.telegram || {}, TEAL = Math.floor((T[1] + T[2]) / 2),
    TG1 = 5550001234, TG2 = 5550009876, LINK = /^https:\/\/t\.me\/KlerosBoothBot\?start=([A-Za-z0-9]{24})$/, ls, p, q, k, kls, r, m, a,
    nn, rows, id, rec, qr, before, e, c, u, t0, w, i, TGKEY = 'kleros_devcon_curate_tg', CKEY = 'kleros_devcon_curate_consent',
    HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), GAME_JS = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8'),
    PREVIEW = 'https://deploy-preview-12--kleros-devcon.netlify.app/curate/';
  function ok(cond, msg) { n++; if (!cond) fail('telegram mode: ' + msg); }
  function R(pg) { return pg.CurateRewards; }
  function begin(pg, fun) { var out; R(pg).begin('sights', { fun: !!fun }, function (x) { out = x; }); return out; }
  function play(pg, final) {
    var i = R(pg).startShift('sights');
    G.clock += 30000;
    R(pg).finishShift({ deck: 'sights', final: final, raw: final, caught: 3, fakesSeen: 4, listed: 5, goodsSeen: 6, evidence: 1,
      wrong: 0, leaks: 1, trust: 85, reviewed: 10, entries: 10, endedBy: 'done', counted: i.counted, shiftNo: i.shiftNo, code: i.code,
      misses: [], reason: '' });
    return i;
  }
  function shown(pg, id) { return pg.el(id).hidden === false; }
  function nonceOf(pg) { var x = LINK.exec(pg.el('intro-tg').href || ''); return x ? x[1] : ''; }
  // The consent tick, as a tap on the box (or its label) sets it; on false unticks it.
  function TICK(pg, on) { var x = pg.el('intro-consent'); x.checked = on !== false; x.fire('change'); }
  // The link before the tick: no href (a tap goes nowhere), dimmed and still read as a link.
  function inert(pg) { var x = pg.el('intro-tg'); return !x.hasAttribute('href') && x.href === '' && x.getAttribute('aria-disabled') === 'true' && x.getAttribute('role') === 'link'; }
  function tgchecks(pg, from) { return pg.posts.slice(from || 0).filter(function (x) { return x.body.action === 'tgcheck'; }); }
  // No wait from the nonce x on this browser (the verify state's own nonce, untapped, is fine).
  function noWait(l, x) { var w = stored(l, TGKEY) || {}; return w.n !== x && !w.tap; }
  function stored(l, key) { return JSON.parse(l.getItem(key || 'kleros_devcon_curate_badge') || 'null'); }
  function got(l, key) { return stored(l, key) || {}; }   // the same, never null (a missing record fails a case, not the run)
  // The desk's reading of a ticket QR (site/staff/desk.js gameTicket): KC1, the id and the sig, lower-cased.
  function deskCheck(text) {
    var x = String(text).split('.'), b = { action: 'check', key: G.props.STAFF_KEY, badge: String(x[1] || '').toLowerCase() };
    if (x[2]) b.sig = x[2].toLowerCase();
    return G.call(b);
  }
  ok(TG.bot === 'KlerosBoothBot' && G.ctx.TG_BOT === TG.bot, 'settings.js telegram.bot ' + TG.bot + ' / Code.gs TG_BOT ' + G.ctx.TG_BOT + ' (the spec’s bot)');
  G.ctx.staffSetup();
  // Before verifying: the consent tick and the link (a real <a> with the bot and a 24-character nonce), no Start and
  // no Play for fun. 3 Nov b: the link has no href until the box is ticked.
  ls = new Store(); p = page(ls, { server: G });
  ok(R(p).mode() === 'telegram' && p.text('ladder-fine').indexOf('Verify with Telegram: 2 tries for merch.') === 0, 'title line ' + p.text('ladder-fine'));
  R(p).renderIntro();
  nn = (stored(ls, TGKEY) || {}).n || '';
  ok(/^[A-Za-z0-9]{24}$/.test(nn) && shown(p, 'intro-tg') && p.text('intro-tg') === 'Verify with Telegram' && inert(p) && nonceOf(p) === '' &&
    shown(p, 'intro-priv') && p.el('intro-consent').checked === false && /\bid="intro-tg"/.test(HTML.match(/<a\b[^>]*>/g).join(' ')),
    'the verify link before the tick ' + p.el('intro-tg').href + ' / ' + p.text('intro-tg') + ' / ' + p.el('intro-tg').getAttribute('aria-disabled'));
  ok(!shown(p, 'intro-go') && !shown(p, 'intro-fun') && !shown(p, 'intro-scan') && !shown(p, 'intro-cancel') && !shown(p, 'intro-change'),
    'Start, Play for fun, Scan, Cancel or Use another Telegram shows before verifying');
  ok(p.text('intro-note') === 'Verify with Telegram to play: 2 tries for merch.' && p.text('intro-priv-text') === CONSENT,
    'intro note ' + p.text('intro-note') + ' / consent ' + p.text('intro-priv-text'));
  // The markup: a real checkbox, a <label for> that rewards.js fills, the Privacy link beside it; the link has no href
  // of its own (an href in the page would work before the tick).
  a = (/<div\b[^>]*\bid="intro-priv"[^>]*>([\s\S]*?)<\/div>/.exec(HTML) || [])[1] || '';
  ok(/<input\b(?=[^>]*\btype="checkbox")(?=[^>]*\bid="intro-consent")[^>]*>/.test(a) && /<label\b(?=[^>]*\bfor="intro-consent")(?=[^>]*\bid="intro-priv-text")[^>]*><\/label>/.test(a) &&
    /<a\b[^>]*\bhref="#curate-privacy"[^>]*>Privacy<\/a>/.test(a) && !/\bhref=/.test((/<a\b[^>]*\bid="intro-tg"[^>]*>/.exec(HTML) || ['href='])[0]),
    'index.html: #intro-priv needs input#intro-consent (checkbox), label[for=intro-consent]#intro-priv-text and the Privacy link; #intro-tg no href');
  rows = G.rows('Tries');
  r = begin(p, true); q = begin(p);
  ok(r && r.ok === false && r.error === 'unverified' && q && q.error === 'unverified' && G.rows('Tries') === rows, 'a round before verifying ' + JSON.stringify([r, q]));
  // A tap before the tick: nothing opens, no wait, no tgcheck; the note says why and the box takes focus.
  k = p.posts.length; c = p.el('intro-consent').focused;
  e = p.el('intro-tg').click();
  ok(e.defaultPrevented && p.text('intro-note') === 'Tick the box first.' && !got(ls, TGKEY).tap && p.posts.length === k && R(p).tgWaiting() === false &&
    p.el('intro-consent').focused === c + 1 && inert(p) && shown(p, 'intro-priv') && p.text('intro-tg') === 'Verify with Telegram',
    'a tap before the tick ' + p.text('intro-note') + ' / ' + (p.posts.length - k) + ' posts');
  // Ticked: kept on this browser, and the link gets its href at once. Unticked: forgotten, and the link inert again.
  TICK(p);
  c = stored(ls, CKEY);
  ok(c && c.v === 1 && c.at === G.clock && nonceOf(p) === nn && p.el('intro-tg').getAttribute('aria-disabled') === null && p.el('intro-tg').getAttribute('role') === null &&
    p.text('intro-note') === 'Verify with Telegram to play: 2 tries for merch.' && p.el('intro-consent').checked === true && shown(p, 'intro-priv'),
    'the tick ' + JSON.stringify(c) + ' / ' + p.el('intro-tg').href + ' / ' + p.text('intro-note'));
  TICK(p, false);
  ok(ls.getItem(CKEY) === null && inert(p) && p.el('intro-consent').checked === false, 'unticking ' + JSON.stringify(ls.d));
  TICK(p);
  R(p).setBadge('AB12CD34', function (x) { r = x; });
  ok(got(ls, TGKEY).n === nn && r && r.error === 'mode' && !stored(ls), 'the nonce is not kept, or a badge scan counts: ' + JSON.stringify(r));
  // A reload keeps the link (its nonce) and the tick. The tap starts the wait and asks at once, naming the page to come
  // back to, the app and the tick (this page has no origin: back is empty, which the server ignores). 3 Nov c: that
  // ask is the watch, sent with keepalive and not waited on (the server reads the bot by long poll for 30 s; nothing
  // comes here); the usual asks follow every pollMs, with the tick and no watch.
  q = page(ls, { server: G }); R(q).renderIntro();
  ok(nonceOf(q) === nn && q.el('intro-consent').checked === true && q.el('intro-tg').getAttribute('aria-disabled') === null, 'a reload made a new nonce or lost the tick');
  before = G.tg.gets; k = p.posts.length; t0 = G.clock; w = G.tg.waits.length;
  e = p.el('intro-tg').click();
  m = tgchecks(p, k);
  ok(!e.defaultPrevented && p.text('intro-note') === 'Tap Start in the Kleros Booth bot, then come back here.' && p.text('intro-tg') === 'Open Telegram again' &&
    nonceOf(p) === nn && shown(p, 'intro-cancel') && !shown(p, 'intro-fun') && !shown(p, 'intro-priv') && got(ls, TGKEY).tap > 0, 'tgwait ' + p.text('intro-note'));
  ok(m.length === 1 && m[0].body.nonce === nn && m[0].body.back === '' && m[0].body.app === 'sights' && m[0].body.agree === 1 && m[0].body.watch === 1 &&
    m[0].opts && m[0].opts.keepalive === true && m[0].opts.timeoutMs > G.ctx.TG_WATCH_MAX_S * 1000 && G.tg.waits.slice(w).join() === '20,10' &&
    G.tg.gets === before + 2 && G.clock === t0 + 30000, 'the tap’s tgcheck ' + JSON.stringify([m, G.tg.waits.slice(w), G.clock - t0]));
  p.tick(TG.pollMs);
  m = tgchecks(p, k);
  ok(G.tg.gets === before + 3 && G.tg.waits.slice(-1).join() === '0' && m.length === 2 && m[1].body.nonce === nn && m[1].body.back === '' && m[1].body.app === 'sights' &&
    m[1].body.agree === 1 && m[1].body.watch === undefined && m[1].opts && m[1].opts.timeoutMs === S.server.statusTimeoutMs && !m[1].opts.keepalive &&
    p.text('intro-note') === 'Tap Start in the Kleros Booth bot, then come back here.', 'the first poll ' + JSON.stringify(m));
  // A reload during the wait asks at once, with the same nonce.
  G.clock += 2100; q = page(ls, { server: G });
  ok(q.posts.some(function (x) { return x.body.action === 'tgcheck' && x.body.nonce === nn; }), 'a reload while waiting did not ask about the nonce');
  // In Telegram the page is hidden: no polls. Back on it: one at once, which sees the Start the player tapped.
  p.document.hidden = true; before = p.posts.length;
  p.tick(TG.pollMs); p.tick(TG.pollMs);
  ok(p.posts.length === before, 'a hidden page polled ' + (p.posts.length - before) + ' times');
  // The player taps Start in Telegram: the id and its sig are kept, never the Telegram number.
  G.tg.say(TG1, '/start ' + nn);
  p.document.hidden = false; p.fire('visibilitychange');
  id = G.tgId(TG1); rec = stored(ls);
  ok(p.text('intro-badge') === 'Telegram ✓ · Try 1 of 2' && shown(p, 'intro-go') && p.text('intro-go') === 'Start' && shown(p, 'intro-fun') &&
    p.text('intro-change') === 'Use another Telegram' && !shown(p, 'intro-tg') && !shown(p, 'intro-cancel') && !shown(p, 'intro-priv'),
    'verified intro ' + p.text('intro-badge') + ' / ' + p.text('intro-note'));
  ok(rec && rec.v === 2 && rec.kind === 'tg' && rec.hash === id && rec.sig === G.sig(id) && rec.mode === 'telegram' && !ls.getItem(TGKEY) &&
    JSON.stringify(ls.d).indexOf(String(TG1)) < 0 && got(ls, CKEY).v === 1, 'the stored id ' + JSON.stringify(rec));
  R(p).refreshBrief();
  ok(p.text('ladder-fine').indexOf('Telegram ✓ · 2 tries for merch.') === 0, 'title line once verified ' + p.text('ladder-fine'));
  // Start carries the sig; the try's row says Contact yes, so a Teal round is a live ticket with no contact step.
  r = begin(p);
  m = p.posts.filter(function (x) { return x.body.action === 'start'; });
  ok(r && r.ok && r.counted && r.shiftNo === 1 && m.length === 1 && m[0].body.sig === rec.sig && G.tab('Tries').rows[G.rows('Tries') - 1][10] === 'yes',
    'Start ' + JSON.stringify(r));
  play(p, TEAL);
  m = R(p).model();
  ok(m.state === 'live' && m.t === 1 && p.text('to-ticket') === 'Show my merch ticket', 'Results after a Teal round ' + m.state + ' / ' + p.text('to-ticket'));
  R(p).showTicket();
  qr = 'KC1.' + id.toUpperCase() + '.' + rec.sig.toUpperCase();
  ok(R(p).qrText() === qr && p.el('t-qr').getAttribute('data-qr') === qr && p.el('t-qr').getAttribute('data-drawn') === qr && shown(p, 't-qr') &&
    /^[0-9A-Z.]+$/.test(qr), 'the ticket QR ' + p.el('t-qr').getAttribute('data-qr'));
  ok(p.text('t-hint') === 'Show this QR at the merch desk.' && / · Telegram ✓$/.test(p.text('t-org')) && /^C-[A-Z0-9]{6}$/.test(p.text('t-code')) &&
    p.el('contact').hidden !== false, 'the ticket ' + p.text('t-hint') + ' / ' + p.text('t-org') + ' / ' + p.text('t-code'));
  // The desk reads it: the QR, a QR with a wrong sig, the C- code typed under it; then a claim with the id it names.
  r = deskCheck(qr);
  ok(r.ok && r.badge === id && r.contact === true && r.earned === 1, 'the desk scanning the ticket ' + JSON.stringify(r));
  ok(deskCheck(qr.slice(0, -1) + (qr.slice(-1) === '0' ? '1' : '0')).error === 'badticket', 'a ticket QR with a wrong sig');
  r = G.call({ action: 'check', key: G.props.STAFF_KEY, code: p.text('t-code').toLowerCase() });
  ok(r.ok && r.badge === id && r.earned === 1, 'the desk typing the C- code ' + JSON.stringify(r));
  // A stored sig the server doesn't know (forged, or another TG_SECRET): Start drops the id and shows the link again.
  q = new Store();
  q.setItem('kleros_devcon_curate_badge', JSON.stringify({ v: 2, kind: 'tg', hash: G.tgId(TG2), tail: '', sig: '0'.repeat(32), best: null,
    contact: false, collected: false, mode: 'telegram', pending: null, at: G.clock }));
  q = page(q, { server: G }); R(q).renderIntro();
  ok(q.text('intro-badge') === 'Telegram ✓ · Try 1 of 2', 'a stored Telegram id at load ' + q.text('intro-badge'));
  rows = G.rows('Tries');
  r = begin(q);
  ok(r && r.ok === false && r.error === 'unverified' && G.rows('Tries') === rows && inert(q) && shown(q, 'intro-tg') && shown(q, 'intro-priv') &&
    !q.el('intro-consent').checked && !shown(q, 'intro-go') && !(stored(q.localStorage) || {}).hash, 'an unverified start ' + JSON.stringify(r));
  TICK(q);
  ok(LINK.test(q.el('intro-tg').href), 'the link after an unverified start, ticked ' + q.el('intro-tg').href);
  // Use another Telegram: the id goes, a new link shows.
  R(p).forgetBadge();
  ok(!stored(ls) && shown(p, 'intro-tg') && LINK.test(p.el('intro-tg').href) && nonceOf(p) !== nn && shown(p, 'intro-priv') && p.el('intro-consent').checked,
    'Use another Telegram (the tick kept on this browser)');
  // Cancel forgets the wait; no answer for waitMs: a new nonce and "No answer from Telegram yet".
  nn = nonceOf(p); p.el('intro-tg').click(); p.el('intro-cancel').click();
  ok(!shown(p, 'intro-cancel') && p.text('intro-tg') === 'Verify with Telegram' && nonceOf(p) !== nn && !got(ls, 'kleros_devcon_curate_tg').tap, 'Cancel');
  nn = nonceOf(p); p.el('intro-tg').click(); p.tick(TG.waitMs);
  ok(p.text('intro-note') === 'No answer from Telegram yet. Try again.' && nonceOf(p) && nonceOf(p) !== nn && !shown(p, 'intro-cancel'),
    'after waitMs ' + p.text('intro-note'));
  // The list unreachable while verifying: two missed answers, then Try again asks at once.
  nn = nonceOf(p); p.el('intro-tg').click();
  G.offline = true; p.tick(TG.pollMs); p.tick(TG.pollMs); G.offline = false;
  ok(p.text('intro-note') === 'Can’t reach the merch list. Try again.' && p.text('intro-go') === 'Try again' && !shown(p, 'intro-fun'),
    'offline while verifying ' + p.text('intro-note'));
  G.tg.say(TG1, '/start ' + nn); G.clock += 2100;
  r = begin(p);
  ok(r && r.error === 'unverified' && p.text('intro-badge') === 'Telegram ✓ · Try 2 of 2', 'Try again after offline ' + p.text('intro-badge') + ' / ' + p.text('intro-note'));
  // The bot not set up (no TG_TOKEN): say so, offer nothing.
  q = gsHarness(); q.ctx.staffSetup();
  k = page(new Store(), { server: q }); R(k).renderIntro();
  ok(k.text('intro-note') === 'Telegram check isn’t ready yet. Ask the booth staff.' && !shown(k, 'intro-tg') && !shown(k, 'intro-go') && !shown(k, 'intro-fun'),
    'no bot token ' + k.text('intro-note'));
  // A badge-mode id stored before the switch to Telegram (v1) is dropped: ids never mix.
  q = new Store();
  q.setItem('kleros_devcon_curate_badge', JSON.stringify({ v: 1, hash: badgeHash('AB12CD34'), tail: 'CD34', best: null, contact: true, collected: false,
    pending: null, at: G.clock }));
  k = page(q, { server: G }); R(k).renderIntro();
  ok(!(stored(q) || {}).hash && shown(k, 'intro-tg') && !k.text('intro-badge'), 'a stored badge under Telegram mode ' + JSON.stringify(stored(q)));
  // The booth tablet: the link as a QR for the visitor's phone, asked about at once, nothing stored. 3 Nov b: the
  // visitor ticks the box on the tablet first (kept in memory for this visitor only); no QR and no wait before.
  kls = new Store(); k = page(kls, { server: G, kiosk: true }); R(k).renderIntro();
  ok(shown(k, 'intro-priv') && k.text('intro-priv-text') === CONSENT && !k.el('intro-consent').checked && !shown(k, 'intro-qr') && !shown(k, 'intro-tg') &&
    !k.el('intro-qr-img').getAttribute('data-qr') && R(k).tgWaiting() === false && tgchecks(k).length === 0 && Object.keys(kls.d).length === 0,
    'the kiosk before the tick ' + k.el('intro-qr-img').getAttribute('data-qr'));
  TICK(k);
  a = k.el('intro-qr-img').getAttribute('data-qr') || '';
  ok(LINK.test(a) && shown(k, 'intro-qr') && !shown(k, 'intro-tg') && !shown(k, 'intro-priv') && k.text('intro-qr-cap') === 'Scan with your phone camera, tap Start in Telegram.' &&
    R(k).tgWaiting() === true && Object.keys(kls.d).length === 0, 'the kiosk QR ' + a + ' ' + JSON.stringify(kls.d));
  // The tick hid the box it had focus on (3 Nov c, review): the QR takes it (role img, its label names the bot), or
  // the note while the QR isn't drawn yet. Both can take focus from script only (tabindex -1); the kiosk asks no watch.
  ok(k.el('intro-qr-img').focused === 1 && k.el('intro-note').focused === 0 && tgchecks(k).every(function (x) { return !x.body.watch; }) &&
    /<div\b(?=[^>]*\bid="intro-qr-img")(?=[^>]*\btabindex="-1")(?=[^>]*\brole="img")(?=[^>]*\baria-label="[^"]*Kleros Booth bot)[^>]*>/.test(HTML) &&
    /<p\b(?=[^>]*\bid="intro-note")(?=[^>]*\btabindex="-1")[^>]*>/.test(HTML), 'the kiosk tick: focus to the QR (' + k.el('intro-qr-img').focused + ')');
  c = page(new Store(), { server: G, kiosk: true }); c.CurateBadge.loadQR = function (done) { done(false); };
  R(c).renderIntro(); TICK(c);
  ok(!shown(c, 'intro-qr') && !shown(c, 'intro-priv') && c.el('intro-note').focused === 1 && c.el('intro-qr-img').focused === 0 && c.text('intro-note'),
    'the kiosk tick before the QR is drawn: focus to the note (' + c.el('intro-note').focused + ')');
  G.tg.say(TG2, '/start ' + LINK.exec(a)[1]);
  G.clock += 2100; k.tick(TG.pollMs);
  ok(k.text('intro-badge') === 'Telegram ✓ · Try 1 of 2' && !shown(k, 'intro-qr') && Object.keys(kls.d).length === 0 && R(k).tgWaiting() === false,
    'the kiosk after the visitor verified ' + k.text('intro-badge') + ' ' + JSON.stringify(kls.d));
  // 3 Nov review: verifying re-arms the tablet's idle reset (game.js hands rewards.js its idleNudge), so the visitor
  // gets a full idle period to look back from Telegram; nothing on the tablet was tapped.
  ok(k.nudged === 1 && /var ui = \{[^}]*\bnudge: idleNudge\b/.test(GAME_JS),
    'verifying did not re-arm the kiosk idle reset (nudged ' + k.nudged + ')');
  // The next visitor (every return to the title on a tablet): the box unticked again, no QR until they tick it.
  R(k).refreshBrief(); R(k).renderIntro();
  ok(!k.text('intro-badge') && shown(k, 'intro-priv') && !k.el('intro-consent').checked && !shown(k, 'intro-qr') && R(k).tgWaiting() === false &&
    Object.keys(kls.d).length === 0, 'the next kiosk visitor ' + k.text('intro-badge') + ' / ticked ' + k.el('intro-consent').checked);
  // No answer within waitMs on the tablet: no new QR nobody waits on (the idle reset may take it back to the title),
  // and a Try again that makes a new QR and a new wait.
  k = page(new Store(), { server: G, kiosk: true }); R(k).renderIntro(); TICK(k);
  a = k.el('intro-qr-img').getAttribute('data-qr');
  k.tick(TG.waitMs);
  before = k.posts.length; k.tick(TG.pollMs); k.tick(TG.pollMs);
  ok(k.text('intro-note') === 'No answer from Telegram yet. Try again.' && !shown(k, 'intro-qr') && k.el('intro-qr-img').getAttribute('data-qr') === '' &&
    shown(k, 'intro-go') && k.text('intro-go') === 'Try again' && R(k).tgWaiting() === false && k.posts.length === before,
    'the kiosk after waitMs ' + k.text('intro-note') + ' / ' + k.text('intro-go') + ' / ' + (k.posts.length - before) + ' polls');
  r = begin(k);
  ok(r && r.error === 'unverified' && LINK.test(k.el('intro-qr-img').getAttribute('data-qr') || '') && k.el('intro-qr-img').getAttribute('data-qr') !== a &&
    shown(k, 'intro-qr') && !shown(k, 'intro-go') && R(k).tgWaiting() === true && k.text('intro-note') !== 'No answer from Telegram yet. Try again.',
    'Try again on the kiosk ' + k.el('intro-qr-img').getAttribute('data-qr'));
  // An Everyone ticket carries the QR too (with the live clock, no C- code): the desk scans it, sees under Teal, and
  // a check-in K- code then opens any tier.
  ls = new Store(); p = page(ls, { server: G }); R(p).renderIntro(); TICK(p);
  nn = nonceOf(p); G.tg.say(TG2 + 1, '/start ' + nn); p.el('intro-tg').click(); p.tick(TG.pollMs);
  id = G.tgId(TG2 + 1); rec = stored(ls);
  r = begin(p);
  ok(rec && rec.hash === id && r && r.counted, 'a third player verified and started ' + JSON.stringify(r));
  // The QR maker fails to load (Wi-Fi dropped): the QR stays hidden, then draws on its own 4 s later.
  q = p.CurateBadge.loadQR; k = 0;
  p.CurateBadge.loadQR = function (done) { k++; done(false); };
  play(p, Math.floor(T[1] / 2));
  R(p).showTicket();
  qr = 'KC1.' + id.toUpperCase() + '.' + rec.sig.toUpperCase();
  a = k;
  ok(R(p).model().t === 0 && p.el('t-qr').getAttribute('data-qr') === qr && !shown(p, 't-qr') && k > 0, 'a QR whose maker failed to load ' +
    p.el('t-qr').getAttribute('data-qr') + ' (' + k + ' loads)');
  R(p).showTicket(); p.tick(4000);
  ok(k === a + 2 && !shown(p, 't-qr'), 'the QR load was not tried again, or twice at once (' + (k - a) + ' loads)');
  p.CurateBadge.loadQR = q; p.tick(4000);
  ok(p.el('t-qr').getAttribute('data-drawn') === qr && shown(p, 't-qr') && shown(p, 't-live') && !shown(p, 't-code') && p.text('t-hint') === 'Show this at the booth.',
    'the Everyone ticket QR ' + p.el('t-qr').getAttribute('data-drawn') + ' / ' + p.text('t-hint'));
  r = deskCheck(qr);
  ok(r.ok && r.badge === id && r.earned === 0 && r.game && r.game.tier === 0, 'the desk scanning an Everyone ticket ' + JSON.stringify(r));
  r = G.call({ action: 'claim', key: G.props.STAFF_KEY, badge: id, tier: 'purple', item: 'x', ticket: 'K-EVR123', staff: 'Ana', id: 'claimevr0001', how: 'scan' });
  ok(r.ok, 'an Everyone ticket with a check-in K- code ' + JSON.stringify(r));

  // Back to the game (3 Nov b). Each tgcheck names this page (location.origin + /curate/) and the app picked; the
  // bot's button opens that page with ?tg=NONCE&app=APP in whatever browser Telegram picks. There the nonce becomes the
  // wait (ticked: its link needed the tick), tg and app leave the address bar, init asks at once, and game.js opens that
  // app's intro (landed(), once). The player's first browser verifies too once it shows again.
  // 3 Nov c (review): the player taps Start 4 s after the tap, their page hidden behind Telegram and asking nothing; the
  // tap's watch reads it at once, so the bot answers then, button and all, with no other phone and no tgTick.
  ls = new Store(); p = page(ls, { server: G, url: PREVIEW + '?lite=0' });
  R(p).setPref('deck', 'countries'); R(p).renderIntro(); TICK(p); nn = nonceOf(p);
  k = p.posts.length; t0 = G.clock; i = G.tg.sent.length;
  G.tg.wait = function () { G.tg.wait = null; p.document.hidden = true; G.clock += 4000; G.tg.say(TG2 + 2, '/start ' + nn); };   // in Telegram
  p.el('intro-tg').click();
  m = tgchecks(p, k);
  ok(m.length === 1 && m[0].body.nonce === nn && m[0].body.back === PREVIEW && m[0].body.app === 'countries' && m[0].body.watch === 1 &&
    G.cache['tgb:' + nn] && G.cache['tgb:' + nn].v === JSON.stringify({ back: PREVIEW, app: 'countries' }), 'the tap names the page and app ' + JSON.stringify(m));
  u = G.tg.sent[i] || {};
  a = u.markup ? u.markup.inline_keyboard[0][0].url : '';
  ok(a === PREVIEW + '?tg=' + nn + '&app=countries' && u.markup.inline_keyboard[0][0].text === '▶️ Back to the game' && u.at === t0 + 4000 && G.tg.sent.length === i + 1 &&
    p.posts.length === k + 1, 'the bot’s Back to the game, 4 s after the tap ' + JSON.stringify([u, G.tg.sent.length - i, p.posts.length - k]));
  kls = new Store(); q = page(kls, { server: G, url: a });
  m = tgchecks(q); id = G.tgId(TG2 + 2); rec = stored(kls);
  ok(q.location.search === '' && q.location.pathname === '/curate/' && q.history.urls.join() === '/curate/' && m.length === 1 && m[0].body.nonce === nn &&
    rec && rec.kind === 'tg' && rec.hash === id && rec.sig === G.sig(id) && !kls.getItem(TGKEY) && got(kls, CKEY).v === 1 && R(q).getPref('deck') === 'countries',
    'landing from the bot ' + JSON.stringify([q.history.urls, m.length, rec, kls.d]));
  ok(R(q).landed() === 'countries' && R(q).landed() === '', 'landed() names the app, once');
  R(q).renderIntro();
  ok(q.text('intro-badge') === 'Telegram ✓ · Try 1 of 2' && shown(q, 'intro-go') && !shown(q, 'intro-tg') && !shown(q, 'intro-priv'), 'the landed intro ' + q.text('intro-badge'));
  p.document.hidden = false; p.fire('visibilitychange');
  ok((stored(ls) || {}).hash === id, 'the first browser after Back to the game ' + JSON.stringify(stored(ls)));
  // game.js boot, after the title shows (and after rewards.js init took the nonce): that app's intro, as its card's tap.
  a = (/function boot\(\) \{[\s\S]*?\n  \}/.exec(GAME_JS) || [''])[0];
  ok(a.indexOf('rw(\'init\'') > -1 && a.indexOf('goBrief()') > -1 && a.indexOf('rw(\'landed\')') > a.indexOf('goBrief()') &&
    a.indexOf('rw(\'landed\')') > a.indexOf('rw(\'init\'') && /setDeck\(land\)[^}]*rw\('setPref', 'deck', deckId\)[^}]*showIntro\(\)/.test(a),
    'game.js boot() must open the landed app’s intro after init and the title');
  // A nonce the bot hasn't seen yet: the wait from now (the other params and the hash stay), asked about at once.
  nn = 'LandAbcdefghij0123456789';
  kls = new Store(); q = page(kls, { server: G, url: 'https://devcon.kleros.io/curate/?lite=0&tg=' + nn + '&app=tokens&x=1#top' });
  m = tgchecks(q); rec = stored(kls, TGKEY);
  ok(q.history.urls.join() === '/curate/?lite=0&x=1#top' && q.location.search === '?lite=0&x=1' && q.location.hash === '#top' && rec && rec.n === nn &&
    rec.at === G.clock && rec.tap === G.clock && got(kls, CKEY).v === 1 && m.length === 1 && m[0].body.nonce === nn && m[0].body.app === 'tokens' &&
    m[0].body.back === 'https://devcon.kleros.io/curate/' && R(q).tgWaiting() === true && R(q).landed() === 'tokens',
    'landing with a nonce not seen yet ' + JSON.stringify([q.history.urls, rec, m.length]));
  R(q).renderIntro();
  ok(q.text('intro-note') === 'Tap Start in the Kleros Booth bot, then come back here.' && nonceOf(q) === nn && !shown(q, 'intro-priv'), 'the landed wait ' + q.text('intro-note'));
  G.tg.say(TG2 + 3, '/start ' + nn); G.clock += 2100; q.tick(TG.pollMs);
  ok((stored(kls) || {}).hash === G.tgId(TG2 + 3) && q.text('intro-badge') === 'Telegram ✓ · Try 1 of 2', 'the landed wait, verified ' + q.text('intro-badge'));
  // An id already verified on this browser wins: the nonce is ignored (no wait, no tgcheck), the address bar cleaned;
  // the app's intro still opens.
  rec = stored(ls); nn = 'Othr' + 'Abcdefghijklmnopqrst';
  q = page(ls, { server: G, url: 'https://devcon.kleros.io/curate/?tg=' + nn + '&app=tokens' });
  ok(stored(ls).hash === rec.hash && !ls.getItem(TGKEY) && tgchecks(q).every(function (x) { return x.body.nonce !== nn; }) && q.history.urls.join() === '/curate/' &&
    R(q).landed() === 'tokens', 'landing on a browser already verified ' + JSON.stringify([stored(ls, TGKEY), q.history.urls]));
  // Ignored, apart from cleaning the address bar: a bad nonce, an unknown app (the nonce still counts), a booth tablet
  // (its own visitor only; kiosk stays), no server (v6), another mode; a browser with no history API still lands. (The
  // stub's intro is never hidden, so the verify state may make its own nonce: never with a tap, never the landed one.)
  ['short', 'x'.repeat(41), 'abc-def_ghijklmnopqrstu', '%41' + 'a'.repeat(20), ''].forEach(function (x) {
    var l = new Store(), g = page(l, { server: G, url: 'https://devcon.kleros.io/curate/?tg=' + x + '&app=countries' });
    ok(g.history.urls.join() === '/curate/' && noWait(l, x) && !l.getItem(CKEY) && R(g).landed() === '' && tgchecks(g).length === 0 &&
      R(g).getPref('deck') === 'sights', 'landing with nonce ' + JSON.stringify(x) + ' ' + JSON.stringify(l.d));
  });
  // A nonce of another length (16 to 40, as Code.gs takes) survives a reload.
  nn = 'UnknownApp0123456789abcdefABCDEF';
  kls = new Store(); q = page(kls, { server: G, url: 'https://devcon.kleros.io/curate/?app=evil&tg=' + nn });
  ok(got(kls, TGKEY).n === nn && R(q).landed() === '' && R(q).getPref('deck') === 'sights' && q.history.urls.join() === '/curate/', 'landing with an unknown app');
  G.clock += 2100; q = page(kls, { server: G });
  ok(tgchecks(q).some(function (x) { return x.body.nonce === nn; }) && R(q).tgWaiting() === true, 'a reload after landing with a 32-character nonce');
  kls = new Store(); k = page(kls, { server: G, kiosk: true, url: 'https://devcon.kleros.io/curate/?kiosk=1&tg=' + nn + '&app=countries' });
  ok(R(k).kiosk === true && k.history.urls.join() === '/curate/?kiosk=1' && Object.keys(kls.d).length === 0 && R(k).landed() === '' && tgchecks(k).length === 0,
    'landing on the booth tablet ' + JSON.stringify([k.history.urls, kls.d]));
  kls = new Store(); k = page(kls, { url: 'https://devcon.kleros.io/curate/?tg=' + nn + '&app=countries' });
  ok(R(k).online === false && k.history.urls.join() === '/curate/' && !kls.getItem(TGKEY) && !kls.getItem(CKEY) && R(k).landed() === '', 'landing in v6 mode');
  kls = new Store();
  kls.setItem('kleros_devcon_curate_badge', JSON.stringify({ v: 2, kind: 'device', hash: 'd'.repeat(64), tail: '', best: null, contact: false, collected: false,
    mode: 'none', pending: null, at: G.clock }));
  k = page(kls, { server: G, url: 'https://devcon.kleros.io/curate/?tg=' + nn + '&app=countries' });
  ok(noWait(kls, nn) && !kls.getItem(CKEY) && R(k).landed() === '' && tgchecks(k).length === 0 && k.history.urls.join() === '/curate/',
    'landing in none mode ' + JSON.stringify([kls.d, tgchecks(k).length]));
  kls = new Store(); k = page(kls, { server: G, nohistory: true, url: 'https://devcon.kleros.io/curate/?tg=' + nn + '&app=countries' });
  ok(got(kls, TGKEY).n === nn && R(k).landed() === 'countries', 'landing without a history API');
  // Any page sends its back (the server keeps only its own hosts): localhost is sent and ignored; a file page sends none.
  [['http://localhost:8080/curate/?x=1', 'http://localhost:8080/curate/'], ['file:///Users/x/site/curate/index.html', '']].forEach(function (x) {
    var l = new Store(), g = page(l, { server: G, url: x[0] }), y;
    R(g).renderIntro(); TICK(g); y = nonceOf(g); g.el('intro-tg').click();
    ok(tgchecks(g).length === 1 && tgchecks(g)[0].body.back === x[1] && !G.cache['tgb:' + y], 'back from ' + x[0] + ': ' + JSON.stringify(tgchecks(g)));
  });
  // 3 Nov c (review): a wait saved by a page from before the tick, this browser with no tick kept, asks with agree 0,
  // so its contacts row has Curator info empty; the rows of players who ticked here say yes. The privacy notice beside
  // the tick gives the tick's purpose, not Kleros news.
  kls = new Store(); nn = 'OldPage0123456789abcdefg';
  kls.setItem(TGKEY, JSON.stringify({ n: nn, at: G.clock, tap: G.clock }));
  G.clock += 2100; q = page(kls, { server: G });
  m = tgchecks(q);
  ok(m.length === 1 && m[0].body.nonce === nn && m[0].body.agree === 0 && !m[0].body.watch && !kls.getItem(CKEY), 'a wait from before the tick ' + JSON.stringify(m));
  G.tg.say(TG2 + 9, '/start ' + nn); G.clock += 2100; q.tick(TG.pollMs);
  a = G.contacts.sheets.Contacts.rows.filter(function (x) { return x && x[2] === 'telegram id'; }).map(function (x) { return [String(x[1]), x[3]]; });
  ok((stored(kls) || {}).hash === G.tgId(TG2 + 9) && JSON.stringify(a) === JSON.stringify([[TG1, 'yes'], [TG2, 'yes'], [TG2 + 1, 'yes'], [TG2 + 2, 'yes'],
    [TG2 + 3, 'yes'], [TG2 + 9, '']].map(function (x) { return [String(x[0]), x[1]]; })), 'Curator info by tick (the tablet’s and a landed page’s too) ' + JSON.stringify(a));
  a = ((/<p\b[^>]*\bid="cp-tg"[^>]*>([\s\S]*?)<\/p>/.exec(HTML) || [])[1] || '').replace(/\s+/g, ' ');
  ok(a.indexOf('to send you Telegram messages through the Kleros Booth bot on how to take part in real contests across Kleros apps.') > -1 &&
    a.indexOf('Kleros news') < 0 && CONSENT.indexOf('real contests across Kleros apps') > -1, 'index.html #cp-tg must give the tick’s purpose: ' + a);
  // game.js never focuses the link before the tick (no href: it can't take focus) or a control in a hidden wrapper.
  ok(/function focusOn\(ids\) \{[\s\S]*?aria-disabled[\s\S]*?\n  \}/.test(GAME_JS) && /function focusOn\(ids\) \{[\s\S]*?parentNode[\s\S]*?\n  \}/.test(GAME_JS),
    'game.js focusOn() must skip an aria-disabled control and one whose wrapper is hidden');

  // None mode: the phone makes its own id (salted hash of 24 random characters); the contact step stays.
  q = gsHarness({ mode: 'none' }); q.ctx.staffSetup();
  ls = new Store(); p = page(ls, { server: q }); R(p).renderIntro();
  rec = stored(ls);
  ok(R(p).mode() === 'none' && rec && rec.kind === 'device' && /^[0-9a-f]{64}$/.test(rec.hash) && !rec.sig && p.text('intro-note') === 'Your phone gets 2 tries for merch.' &&
    shown(p, 'intro-go') && shown(p, 'intro-fun') && !shown(p, 'intro-tg') && !shown(p, 'intro-scan') && !shown(p, 'intro-change') && !shown(p, 'intro-priv'),
    'none mode intro ' + p.text('intro-note') + ' ' + JSON.stringify(rec));
  ok(p.posts.some(function (x) { return x.body.action === 'status' && x.body.badge === rec.hash; }), 'none mode: the new id’s tries were not asked');
  k = page(ls, { server: q }); R(k).renderIntro();
  ok(stored(ls).hash === rec.hash, 'a reload made a second phone id');
  G = q;   // play() moves this server's clock
  r = begin(p);
  ok(r && r.ok && r.counted && q.tab('Tries').rows[q.rows('Tries') - 1][10] === '' && q.tab('Tries').rows[q.rows('Tries') - 1][2] === rec.hash, 'none mode Start ' + JSON.stringify(r));
  play(p, TEAL);
  ok(R(p).model().state === 'locked' && p.text('to-ticket') === 'Unlock my merch ticket', 'none mode: a Teal round is not locked until a contact');
  R(p).showTicket();
  p.el('contact-input').value = 'ana@example.org'; p.el('contact-form').fire('submit');
  R(p).showTicket();
  qr = 'KC1.' + rec.hash.toUpperCase() + '.';
  ok(R(p).model().state === 'live' && R(p).qrText() === qr && p.el('t-qr').getAttribute('data-qr') === qr && / · This phone$/.test(p.text('t-org')) &&
    p.text('t-hint') === 'Show this QR at the merch desk.', 'none mode ticket ' + p.el('t-qr').getAttribute('data-qr') + ' / ' + p.text('t-org'));
  r = deskCheck(qr);
  ok(r.ok && r.badge === rec.hash && r.contact === true && r.earned === 1, 'the desk scanning a none-mode ticket ' + JSON.stringify(r));
  console.log('Telegram and none modes\n  ' + n + ' cases (consent tick: link inert until ticked, kept, unticked, kiosk per visitor; verify link and nonce, no play ' +
    'before verifying, wait, back, app and the tick on every tgcheck, the tap’s watch (keepalive; the bot answers Start while the page is hidden), ' +
    'a wait from before the tick, the privacy notice, the tablet’s focus after the tick, Back to the game landing: nonce taken, address bar cleaned, app intro, verified, ignored cases; ' +
    'reload, hidden page, verified then Start, Contact yes, ticket QR read by ' +
    'the desk, unverified start, another Telegram, Cancel, waitMs, offline, no bot token, a badge id dropped, kiosk QR, kiosk idle after verifying and after waitMs, ' +
    'Everyone ticket QR and a K- code, QR load retry, none mode id, contact step and QR)');
}

// ---- Staff desk (3 Nov review) ----
// site/staff/desk.js in a vm against stub elements and a booth script (gsHarness) whose replies wait until flush(), so a
// reply can land while a screen is open. Today: Advanced follows a mode the sheet reports while it is open; 3 Nov c:
// Advanced's Reset a player (a confirm names the player, then the sheet's reset), each request sent kept in `sent`.
function checkDesk() {
  var n = 0, G = gsHarness({ token: true }), els = {}, waiting = [], sent = [], radios, ctx, ls = new Store(), TGB = 5550007777, bob, x, r;
  function ok(cond, msg) { n++; if (!cond) fail('desk.js: ' + msg); }
  function flush() { var w = waiting; waiting = []; w.forEach(function (f) { f(); }); }
  function radio(v) { return radios.filter(function (r) { return r.value === v; })[0]; }
  G.ctx.staffSetup(); G.ctx.writeMode_('none');
  radios = ['telegram', 'badge', 'none'].map(function (v) { var r = stubEl(); r.value = v; return r; });
  ls.setItem('kleros_curate_desk', JSON.stringify({ key: G.props.STAFF_KEY, staff: 'Ana' }));
  ctx = { console: console, localStorage: ls, location: { search: '' }, navigator: {}, CURATE_SETTINGS: S, KLEROS_BOOTH_CONFIG: {},
    confirm: function () { return true; }, scrollTo: function () {},
    document: { readyState: 'complete', addEventListener: function () {}, createElement: stubEl,
      getElementById: function (id) { return els[id] || (els[id] = stubEl()); },
      querySelectorAll: function (q) { return q === 'input[name="adv-mode"]' ? radios : []; },
      querySelector: function (q) { return q === 'input[name="adv-mode"]:checked' ? radios.filter(function (r) { return r.checked; })[0] || null : null; } },
    CurateBadge: { endpoint: function () { return 'https://test/exec'; },
      post: function (body, done) {
        sent.push(JSON.parse(JSON.stringify(body)));
        waiting.push(function () { done(null, G.call(JSON.parse(JSON.stringify(body)))); });
      } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(STAFF, 'desk.js'), 'utf8'), ctx, { filename: 'desk.js' });
  // Advanced opened before the first reply: the spec's Telegram guess, pre-selected.
  ok(els.home.hidden === false && waiting.length === 1, 'home did not ask for stats');
  els['adv-go'].click();
  ok(els.adv.hidden === false && els['adv-now'].textContent === 'Now: players verify with Telegram.' && radio('telegram').checked && els['adv-apply'].disabled,
    'Advanced before any reply ' + els['adv-now'].textContent);
  // The stats reply says None while Advanced is open: the panel follows (its line, its selection, Change disabled).
  flush();
  ok(els['adv-now'].textContent === 'Now: players verify with no check.' && radio('none').checked && !radio('telegram').checked && els['adv-apply'].disabled &&
    els['h-mode'].textContent === 'Players verify with no check.', 'Advanced after a reply said none: ' + els['adv-now'].textContent + ' / ' +
    radios.filter(function (r) { return r.checked; }).map(function (r) { return r.value; }));
  // Once the lead picked a mode, a later reply moves the line but never their pick (Cancel, then home asks again).
  els['adv-cancel'].click(); els['adv-go'].click();
  ok(waiting.length === 1 && radio('none').checked && els['adv-now'].textContent === 'Now: players verify with no check.', 'Advanced opened again');
  radio('none').checked = false; radio('telegram').checked = true; els['adv-modes'].fire('change');
  els['adv-confirm'].value = 'change'; els['adv-confirm'].fire('input');
  ok(!els['adv-apply'].disabled, 'Telegram picked and CHANGE typed against none: Change for everyone is still off');
  G.ctx.writeMode_('badge');
  flush();
  ok(els['adv-now'].textContent === 'Now: players verify with their badge.' && radio('telegram').checked && !radio('badge').checked && !els['adv-apply'].disabled,
    'a reply moved the lead’s pick: ' + els['adv-now'].textContent);
  // Reset a player (3 Nov c). Bob_K verified with the bot, played both tries (a Teal round) and got merch.
  G.tg.say(TGB, '/start DeskResetNonce0123456789', { username: 'Bob_K' }); G.clock += 2100;
  G.call({ action: 'tgcheck', nonce: 'DeskResetNonce0123456789' });
  bob = G.tgId(TGB);
  ['deskrs1qwertyuiopasd', 'deskrs2qwertyuiopasd'].forEach(function (t, i) {
    G.call({ action: 'start', badge: bob, token: t, app: 'sights', sig: G.sig(bob) }); G.clock += 60000;
    if (!i) G.call({ action: 'finish', token: t, score: S.tiers[1] + 40 });
  });
  r = G.call({ action: 'claim', key: G.props.STAFF_KEY, badge: bob, tier: 'teal', item: 'x', staff: 'Ana', id: 'deskrs00001' });
  ok(r.ok && G.rows('Tries') === 3 && G.rows('Badge claims') === 2, 'Bob_K’s rows ' + JSON.stringify(r));
  // Advanced opens with the section empty and Reset player off; a name (one @ and spaces dropped) turns it on.
  els['adv-cancel'].click(); flush(); els['adv-go'].click();
  ok(els['rs-name'].value === '' && els['rs-go'].disabled && els['rs-ask'].hidden && els['rs-msg'].textContent === '', 'Reset a player as Advanced opens');
  els['rs-name'].value = '  @ '; els['rs-name'].fire('input');
  ok(els['rs-go'].disabled, 'Reset player is on for a name of only @');
  els['rs-name'].value = '  @Bob_K '; els['rs-name'].fire('input');
  ok(!els['rs-go'].disabled, 'a name typed: Reset player is still off');
  // Its confirm names the player, with the spec's words; Cancel, or editing the name, closes it with nothing sent.
  x = sent.length; els['rs-go'].click();
  ok(els['rs-ask'].hidden === false && els['rs-go'].hidden === true && sent.length === x &&
    els['rs-q'].textContent === 'Reset @Bob_K? Their tries and merch record are deleted: they can play 2 new tries and get merch again.', 'the confirm: ' + els['rs-q'].textContent);
  els['rs-no'].click();
  ok(els['rs-ask'].hidden && !els['rs-go'].hidden && sent.length === x, 'the confirm’s Cancel');
  els['rs-go'].click(); els['rs-name'].value = 'Bob_K2'; els['rs-name'].fire('input');
  ok(els['rs-ask'].hidden && !els['rs-go'].hidden && els['rs-q'].textContent === '' && sent.length === x, 'editing the name left the confirm open');
  // Yes, reset: one request with the name as typed (no @), Advanced's two buttons off until the reply (the lead's
  // mode change is ready: Telegram picked, CHANGE typed), then Done with the counts, and the box empty.
  radio('telegram').checked = true; radio('badge').checked = false; els['adv-confirm'].value = 'CHANGE'; els['adv-confirm'].fire('input');
  els['rs-name'].value = '@bob_k'; els['rs-name'].fire('input'); els['rs-go'].click(); els['rs-yes'].click();
  ok(sent.length === x + 1 && JSON.stringify(sent[x]) === JSON.stringify({ action: 'reset', username: 'bob_k', staff: 'Ana', key: G.props.STAFF_KEY }) &&
    els['rs-msg'].textContent === 'Resetting @bob_k…' && els['rs-ask'].hidden && els['rs-go'].disabled && els['adv-apply'].disabled,
    'Yes, reset: ' + JSON.stringify(sent.slice(x)) + ' / ' + els['rs-msg'].textContent);
  els['rs-yes'].click(); els['adv-apply'].click();
  ok(sent.length === x + 1, 'a second request went while the reset was out');
  flush();
  ok(els['rs-msg'].textContent === 'Done: @bob_k can start again. (2 tries, 1 merch deleted)' && els['rs-name'].value === '' && els['rs-go'].disabled &&
    !els['adv-apply'].disabled && G.rows('Tries') === 1 && G.rows('Badge claims') === 1 && els.adv.hidden === false, 'after the reset: ' + els['rs-msg'].textContent);
  // Again (nothing left: the counts say so, 1 try in the singular), then a name the sheet doesn't have: kept in the box.
  G.call({ action: 'start', badge: bob, token: 'deskrs3qwertyuiopasd', app: 'sights', sig: G.sig(bob) });
  els['rs-name'].value = 'Bob_K'; els['rs-name'].fire('input'); els['rs-go'].click(); els['rs-yes'].click(); flush();
  ok(els['rs-msg'].textContent === 'Done: @Bob_K can start again. (1 try, 0 merch deleted)', 'one try: ' + els['rs-msg'].textContent);
  els['rs-name'].value = 'Bob'; els['rs-name'].fire('input');
  ok(els['rs-msg'].textContent === '', 'typing kept the last result');
  els['rs-go'].click(); els['rs-yes'].click(); flush();
  ok(els['rs-msg'].textContent === 'That user is not in the DB.' && els['rs-name'].value === 'Bob' && !els['rs-go'].disabled, 'nouser: ' + els['rs-msg'].textContent);
  // The sheet busy, then a script from before 2026-11-03c (no reset action): the desk's usual lines.
  G.lockBusy = true; els['rs-name'].value = 'Bob_K'; els['rs-go'].click(); els['rs-yes'].click(); flush(); G.lockBusy = false;
  ok(els['rs-msg'].textContent === 'Can’t reach the list. Check the connection, then try again.', 'busy: ' + els['rs-msg'].textContent);
  r = G.ctx.STAFF_.reset; delete G.ctx.STAFF_.reset;
  els['rs-go'].click(); els['rs-yes'].click(); flush(); G.ctx.STAFF_.reset = r;
  ok(els['rs-msg'].textContent === 'The booth sheet script can’t reset players yet. Ask the booth lead to update it.', 'an older script: ' + els['rs-msg'].textContent);
  // A reply that lands after Advanced closed changes nothing on screen, and Advanced opens clean again.
  els['rs-go'].click(); els['rs-yes'].click(); els['adv-cancel'].click(); flush();
  ok(els.adv.hidden && els['rs-msg'].textContent.indexOf('Done') < 0, 'a late reset reply: ' + els['rs-msg'].textContent);
  els['adv-go'].click();
  ok(els['rs-msg'].textContent === '' && els['rs-name'].value === '' && els['rs-ask'].hidden && !els['rs-go'].hidden, 'Advanced opened after a reset');
  // A mode change out holds Reset player off; a wrong key goes back to the key screen.
  radio('telegram').checked = true; radio('badge').checked = false; els['adv-confirm'].value = 'CHANGE'; els['adv-confirm'].fire('input');
  els['rs-name'].value = 'Bob_K'; els['rs-name'].fire('input'); els['adv-apply'].click();
  ok(els['rs-go'].disabled && sent[sent.length - 1].action === 'setmode', 'Reset player while a mode change is out');
  flush(); flush(); els['adv-go'].click();   // the mode change, then home's stats
  G.props.STAFF_KEY = 'NEWKEY2345678ABC';
  els['rs-name'].value = 'Bob_K'; els['rs-name'].fire('input'); els['rs-go'].click(); els['rs-yes'].click(); flush();
  ok(els.setup.hidden === false && els.adv.hidden, 'a wrong key did not go back to the key screen');
  console.log('Staff desk\n  ' + n + ' cases (Advanced follows a mode reply while open, keeps the lead’s pick; Reset a player: the confirm, Cancel, ' +
    'one request at a time, Done with the counts, not in the DB, busy, an older script, a late reply, a wrong key)');
}

// ---- badge.js ----
// The shared badge module, loaded for real: ids stay the v6 desk's, Kleros's own links and ticket codes are not
// badges; both pages load it (defer, before the scripts that use it) and neither loads jsQR up front.
function checkBadgeJs() {
  var n = 0, B = BADGE;
  function ok(cond, msg) { n++; if (!cond) fail('badge.js: ' + msg); }
  if (!B) return fail('badge.js: window.CurateBadge is missing');
  ['endpoint', 'can', 'id', 'ok', 'tail', 'hash', 'read', 'post', 'scan', 'loadJsQR', 'loadQR', 'qr'].forEach(function (f) { ok(typeof B[f] === 'function', f + ' is missing'); });
  ok(B.qr('KC1.X') === null, 'qr() draws before loadQR() is done');
  // The QRs the game draws (3 Nov), end to end: badge.js qr() with the vendored qrcode-generator makes an <svg>; drawn
  // to pixels here and read with the vendored jsQR, it gives back the exact text (the ticket the desk parses, the
  // tablet's Telegram link). A ticket is upper case, so it must fit the compact alphanumeric kind (version 5, 37 modules).
  (function () {
    var ctx = { console: console, navigator: {}, CURATE_SETTINGS: S }, hex = crypto.createHash('sha256').update('qr').digest('hex');
    function node(tag) { var a = {}; return { tag: tag, a: a, kids: [], setAttribute: function (k, v) { a[k] = String(v); }, appendChild: function (c) { this.kids.push(c); return c; } }; }
    ctx.window = ctx; ctx.document = { createElementNS: function (ns, tag) { return node(tag); } };
    vm.createContext(ctx);
    try {
      ['qrcode.js', 'jsQR.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(DIR, 'vendor', f), 'utf8'), ctx, { filename: 'vendor/' + f }); });
      vm.runInContext(fs.readFileSync(path.join(DIR, 'badge.js'), 'utf8'), ctx, { filename: 'badge.js' });
    } catch (e) { return fail('badge.js: the QR files threw on load: ' + e.message); }
    [['KC1.' + hex.toUpperCase() + '.' + hex.slice(0, 32).toUpperCase(), 37], ['KC1.' + hex.toUpperCase() + '.', 33],
      ['https://t.me/KlerosBoothBot?start=aB3dE5fG7hJ9kL1mN2pQ4rS6', 0]].forEach(function (c) {
      var svg = ctx.CurateBadge.qr(c[0]), N, d, S4 = 4, w, px, re = /M(\d+) (\d+)h(\d+)v1h-\d+z/g, mm, x, y, i, j, got, min = 99;
      if (!svg || svg.tag !== 'svg') return ok(false, 'qr() made no <svg> for ' + c[0]);
      N = Number((svg.a.viewBox || '').split(' ')[2]);
      d = (svg.kids[1] || { a: {} }).a.d || '';
      w = N * S4; px = new Uint8ClampedArray(w * w * 4).fill(255);
      while ((mm = re.exec(d))) {
        min = Math.min(min, +mm[1], +mm[2]);
        for (y = +mm[2] * S4; y < (+mm[2] + 1) * S4; y++) for (x = +mm[1] * S4; x < (+mm[1] + +mm[3]) * S4; x++) { i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
      }
      j = ctx.jsQR(px, w, w);
      got = j ? j.data : null;
      ok(got === c[0], 'the QR for ' + c[0].slice(0, 20) + '… reads back as ' + got);
      ok(min === 4 && (svg.kids[0] || { a: {} }).a.fill === '#fff' && svg.kids[1].a.fill === '#000', 'the QR has no 4-module quiet zone, or is not dark on white');
      if (c[1]) ok(N - 8 <= c[1], c[0].slice(0, 12) + '… makes a ' + (N - 8) + '-module QR, more than ' + c[1] + ' (not the alphanumeric kind)');
    });
  })();
  // post() (3 Nov c, review): opts.keepalive reaches fetch, so the Telegram tap's ask outlives the page; the rest as ever.
  (function () {
    var inits = [], ctx = { console: console, navigator: {}, CURATE_SETTINGS: { server: { endpoint: 'https://script.google.com/macros/s/X/exec' } },
      setTimeout: function () { return 1; }, clearTimeout: function () {} };
    ctx.window = ctx;
    ctx.fetch = function (url, init) { inits.push(init); return { then: function () { return { then: function () {} }; } }; };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(DIR, 'badge.js'), 'utf8'), ctx, { filename: 'badge.js' });
    ctx.CurateBadge.post({ action: 'tgcheck' }, function () {}, { keepalive: true, timeoutMs: 120000 });
    ctx.CurateBadge.post({ action: 'status' }, function () {});
    ok(inits.length === 2 && inits[0].keepalive === true && inits[1].keepalive === false && inits.every(function (x) {
      return x.method === 'POST' && x.credentials === 'omit' && x.headers['Content-Type'] === 'text/plain;charset=utf-8';
    }), 'post() and keepalive ' + JSON.stringify(inits));
  })();
  ok(B.SALT === 'kleros-devcon-badge|', 'SALT changed: the desk and the game would hash apart from the v6 desk');
  [['?id=AB12CD34', 'AB12CD34'], ['https://x/t/AB12CD34', 'AB12CD34'], ['AB12CD34', 'AB12CD34'], [' ab12-cd34 ', 'AB12CD34'],
    ['https://x/ticket?ref=XYZ9', 'TICKETXYZ9'], ['https://x/u/abc12/badge', 'UABC12BADGE']].forEach(function (c) {
    ok(B.id(c[0]) === c[1], 'id(' + c[0] + ') is ' + B.id(c[0]) + ', want ' + c[1]);
  });
  ['https://devcon.kleros.io/curate/', 'KABC123', 'BADGEONLY', '12345678', ''].forEach(function (raw) {
    ok(!B.ok(B.id(raw), raw), raw + ' passes as a badge');
  });
  ok(B.ok('AB12CD34', 'AB12CD34') && B.tail('AB12CD34') === 'CD34', 'AB12CD34 is not a badge, or its tail');
  ok(badgeHash('AB12CD34') === crypto.createHash('sha256').update('kleros-devcon-badge|AB12CD34').digest('hex'), 'hash');
  [['site/curate/index.html', ['settings.js', 'badge.js', 'rewards.js', 'earn.js', 'game.js']],
    ['site/staff/index.html', ['settings.js', 'badge.js', 'desk.js']]].forEach(function (pg) {
    var src = fs.readFileSync(path.join(ROOT, pg[0]), 'utf8'), tags = src.match(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g) || [],
      order = tags.map(function (t) { return /src="([^"]*)"/.exec(t)[1].split('/').pop(); });
    ok(tags.every(function (t) { return /\sdefer\b/.test(t) && /src="\//.test(t); }), pg[0] + ': every script is defer and root-absolute');
    ok(pg[1].every(function (f, i) { return order.indexOf(f) > -1 && (!i || order.indexOf(f) > order.indexOf(pg[1][i - 1])); }),
      pg[0] + ': scripts out of order: ' + order.join(', '));
    ok(order.indexOf('jsQR.js') < 0 && order.indexOf('qrcode.js') < 0, pg[0] + ': jsQR or qrcode loads up front');
  });
  ok(!fs.existsSync(path.join(STAFF, 'vendor')), 'site/staff/vendor is back (jsQR lives in /curate/vendor/)');
  console.log('badge.js\n  ' + n + ' cases (ids, badge test, hash salt, ticket and Telegram QRs read back with jsQR, post() and keepalive, script order in both pages)');
}

// ---- GL watchdog ----
// The real watchdog() from gl.js, fed synthetic frame timestamps: a steady 30 fps browser cap must keep GL.
function checkWatchdog() {
  var src = fs.readFileSync(path.join(DIR, 'gl.js'), 'utf8'), fn = /\n  function watchdog\(ts\) \{[\s\S]*?\n  \}\n/.exec(src), out = [];
  if (!fn) return warn('gl.js: watchdog() not found, so its regression check did not run');
  function run(gen) {
    var ctx = { lastTs: 0, ivals: [], level: 0, dprCap: 2, swayOn: true, cw: 0, failed: '' }, rand = mulberry32(11), t = 1000, i;
    vm.createContext(ctx);
    vm.runInContext('function fail(w) { failed = w; }' + fn[0], ctx);
    for (i = 0; i < 180 && !ctx.failed; i++) { t += gen(rand); if (ctx.watchdog(t)) break; }
    return ctx.failed ? 'static' : 'level ' + ctx.level;
  }
  [['steady 16.7 ms', function () { return 16.7; }, 'level 0'],
    ['steady 33.3 ms ±0.3 (browser cap)', function (r) { return 33.3 + (r() - 0.5) * 0.6; }, 'level 1'],
    ['random 16.7 / 33.3 / 50 ms', function (r) { return [16.7, 33.3, 50][Math.floor(r() * 3)]; }, 'static'],
    ['random 20–70 ms', function (r) { return 20 + 50 * r(); }, 'static']].forEach(function (c) {
    var got = run(c[1]);
    if (got !== c[2]) fail('gl.js watchdog: ' + c[0] + ' gives ' + got + ', expected ' + c[2]);
    out.push(pad(c[0], 34) + got);
  });
  console.log('GL watchdog\n  ' + out.join('\n  '));
}

// ---- Simulation (§2.8, v5 brief §4, v6 brief §4) ----
// Model: lognormal decision time (SIGMA), +PICK_S when the player taps Wrong (pick mode: tap the wrong part),
// 0.25 s per card for the fly-out and landing. No windows, no timeouts: a card waits until it is decided, and
// the round ends at the clock. v6: the full-screen flash after each decision pauses the round clock, so it adds
// no time here. The best of the tries actually played counts (2 counted tries per badge for the whole event; 60%
// play 1, 40% play 2), the second try +3% accuracy and −10% time. Accuracy is the chance of the right call on a
// card; pick is the chance of tapping the right part after rightly marking a fake Wrong (otherwise a random other
// part). A real entry marked Wrong taps any part.
var RUNS = 20000, SIGMA = 0.5, PICK_S = 0.8, OVERHEAD_S = 0.25;
var PLAYS = [[1, 0.6], [2, 0.4]];
var PROFILES = [   // name, mix share, accuracy, mean decision s, pick accuracy
  ['Expert', 0.07, 0.95, 1.7, 0.95], ['Strong', 0.20, 0.90, 2.2, 0.9], ['Average', 0.38, 0.82, 2.8, 0.8],
  ['Casual', 0.25, 0.72, 3.5, 0.65], ['Novice', 0.10, 0.62, 4.3, 0.5]
];
// 2 Nov: one 90 s round, no time bonus; Gold = a perfect round (best of 2 tries): §2.8's 26 / 36 / 24 / 14.
// 3 Nov c (owner: kinder points, 100 a right answer and 10 a wrong one, Teal at 6 right, Purple at 8, Gold for 10 of 10):
// simulated 4.5 / 21.4 / 49.9 / 24.2 %, so about half the players reach Purple and a quarter Gold, by the owner's choice.
// With 5 fakes a round (so Correct on everything stays under Teal), 3 Nov: 4.5 / 21.2 / 50.2 / 24 %.
var TARGET = { standard: [5, 21, 50, 24] }, TOLERANCE = 4;
function gauss(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }
function lognormal(rand, mean) { return Math.exp(Math.log(mean) - SIGMA * SIGMA / 2 + SIGMA * gauss(rand)); }
function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }
// The parts of an item, in field order (pick mode numbers them 1–4).
function partsOf(it) {
  var D2 = W.CURATE_DECKS, k;
  for (k in D2) if (D2[k].lists[it.list]) return D2[k].lists[it.list].fields.map(function (f) { return f[0]; });
  return [];
}
function anyPart(it, rand) { var p = partsOf(it); return p[Math.floor(rand() * p.length)]; }
function wrongPart(it, rand) {
  var p = partsOf(it).filter(function (k) { return k !== it.bad && (it.also || []).indexOf(k) < 0; });
  return p[Math.floor(rand() * p.length)];
}

// One round with the real rules. `play(item, rand)` returns { action, pick, secs } (secs Infinity = idle).
function playRound(deckId, relaxed, play, rand, last) {
  var run = R.buildRun(deckId, last, rand), sc = R.newScore(), len = S.seconds,
    t = 0, decided = 0, i, it, d, o;
  for (i = 0; i < run.items.length; i++) {
    it = run.items[i];
    d = play(it, rand);
    if (t + d.secs > len) break;   // the card on screen at time-out is discarded
    t += d.secs;
    o = R.judge(it, d.action, d.pick);
    R.apply(sc, it, o);
    decided++;
    t += OVERHEAD_S;
  }
  R.finish(sc);
  return { score: sc, decided: decided, ids: run.items.map(function (x) { return x.id; }) };
}
// A player profile: the right call with probability acc. Every challenge picks a part (brief §4).
function player(acc, mean, pickAcc) {
  return function (it, rand) {
    var right = rand() < acc, ch = it.bad ? right : !right, pk = '';
    if (ch) pk = !it.bad ? anyPart(it, rand) : rand() < pickAcc ? it.bad : wrongPart(it, rand);
    return { action: ch ? 'challenge' : 'letThrough', pick: pk, secs: lognormal(rand, mean) + (ch ? PICK_S : 0) };
  };
}
// Blind strategies. Random fast swiping picks a random part, so its fake is spotted only 1 time in 4.
function lazy(kind) {
  return function (it, rand) {
    if (kind === 'idle') return { action: 'letThrough', pick: '', secs: Infinity };
    var ch = kind === 'challenge' || (kind === 'random' && rand() < 0.5);
    return { action: ch ? 'challenge' : 'letThrough', pick: ch ? anyPart(it, rand) : '',
             secs: lognormal(rand, 0.45) + (ch ? 0.3 : 0) };
  };
}
var DECK_IDS = Object.keys(D || {});
function simProfile(prof, relaxed, rand) {
  var one = [0, 0, 0, 0], best = [0, 0, 0, 0], scores = [], bests = [], decided = [], r, k, n, u, b, res, last, deck;
  for (r = 0; r < RUNS; r++) {
    u = rand(); n = 0;
    for (k = 0; k < PLAYS.length && n === 0; k++) { u -= PLAYS[k][1]; if (u < 0) n = PLAYS[k][0]; }
    n = n || 1;
    b = 0; last = [];
    deck = DECK_IDS[Math.floor(rand() * DECK_IDS.length)];   // each player picks one app and replays it
    for (k = 0; k < n; k++) {
      res = playRound(deck, relaxed, player(Math.min(0.99, prof[2] + 0.03 * (k ? 1 : 0)), prof[3] * (k ? 0.9 : 1), prof[4]),
        rand, last);
      last = res.ids;
      if (k === 0) { scores.push(res.score.final); decided.push(res.decided); one[R.tierFor(res.score.final)]++; }
      b = Math.max(b, res.score.final);
    }
    best[R.tierFor(b)]++;
    bests.push(b);
  }
  return { one: one, best: best, bests: bests, median: median(scores), decided: median(decided) };
}
function shares(c) { return c.map(function (x) { return Math.round(pct(x, RUNS)); }); }
function simulate() {
  var rand = mulberry32(2026), modes = ['standard'];
  // The sim never plays more tries than count for the whole event.
  if (PLAYS[PLAYS.length - 1][0] > S.countedTries) fail('the simulation plays ' + PLAYS[PLAYS.length - 1][0] + ' tries, settings count ' + S.countedTries);
  modes.forEach(function (mode) {
    var relaxed = mode === 'relaxed', mix = [0, 0, 0, 0], all = [];
    console.log('\nSimulation, ' + mode + ' (' + RUNS + ' players per profile; E/T/P/G = Everyone/Teal/Purple/Gold %)');
    console.log('  ' + pad('Profile', 10) + pad('mix', 6) + pad('acc/time/pick', 16) + pad('decided', 9) + pad('median', 8) +
      pad('one round', 14) + 'best of plays');
    PROFILES.forEach(function (p) {
      var s = simProfile(p, relaxed, rand), i;
      for (i = 0; i < 4; i++) mix[i] += p[1] * pct(s.best[i], RUNS);
      s.bests.forEach(function (b) { all.push([b, p[1] / RUNS]); });
      console.log('  ' + pad(p[0], 10) + pad(Math.round(p[1] * 100) + '%', 6) + pad(p[2] + '/' + p[3] + 's/' + p[4], 16) +
        pad(s.decided, 9) + pad(s.median, 8) + pad(shares(s.one).join('/'), 14) + shares(s.best).join('/'));
    });
    mix = mix.map(function (x) { return Math.round(x * 10) / 10; });
    console.log('  Mix: ' + mix.join(' / ') + ' %   (target ≈ ' + TARGET[mode].join(' / ') + ' %, ±' + TOLERANCE + ')' +
      '   tiers ' + S.tiers.join(' / '));
    if (FIT && !relaxed) fit(all);
    mix.forEach(function (x, i) {
      if (Math.abs(x - TARGET[mode][i]) > TOLERANCE) {
        (relaxed ? warn : fail)(mode + ' mix tier ' + i + ' is ' + x + '%, TARGET says ' + TARGET[mode][i] + '% ±' + TOLERANCE);
      }
    });
  });
  simLazy(rand);
}
// --fit: the thresholds that put the weighted best-of-plays scores at the TARGET shares, rounded to 5 points.
// Paste them into settings.js tiers, then run --sim again: the lazy check still has the last word.
function fit(all) {
  var cut = [], acc = 0, i = 0, goal = 0, t;
  all.sort(function (a, b) { return a[0] - b[0]; });
  for (t = 0; t < 3; t++) {
    goal += TARGET.standard[t] / 100;
    while (i < all.length && acc + all[i][1] <= goal) { acc += all[i][1]; i++; }
    cut.push(Math.round((i < all.length ? all[i][0] : all[all.length - 1][0]) / 5) * 5);
  }
  console.log('  Fit: tiers [0, ' + cut.join(', ') + '] would give about ' + TARGET.standard.join(' / ') + ' %');
}
// Lazy strategies must never reach Teal. Random fast swiping is reported only: it calls 10 entries by coin flip
// and picks a random part, right 1 time in 4 (v4, no pick: about 7% reached Teal); see the README notes. 3 Nov c:
// the part no longer scores and Teal is 6 right, so random swiping (5 right in 10 on average) reaches Teal far more;
// Correct on everything is 5 right (5 fakes a round), so it stays a failure. A round here is one try, so the lazy
// lines hold for each try.
function simLazy(rand) {
  console.log('\nLazy strategies, standard (' + RUNS + ' rounds each)');
  [['let', 'Correct on everything'], ['challenge', 'Wrong on everything'], ['idle', 'Idle'],
    ['random', 'Random swiping (0.45 s)']].forEach(function (s) {
    var scores = [], teal = 0, r, f;
    for (r = 0; r < RUNS; r++) {
      f = playRound(DECK_IDS[r % DECK_IDS.length], false, lazy(s[0]), rand, []).score.final;
      scores.push(f);
      if (R.tierFor(f) >= 1) teal++;
    }
    console.log('  ' + pad(s[1], 28) + 'median ' + lpad(median(scores), 4) + '   max ' + lpad(Math.max.apply(null, scores), 4) +
      '   reaches Teal ' + pct(teal, RUNS) + '%');
    if (s[0] !== 'random' && teal) fail(s[1] + ' reached Teal in ' + teal + ' rounds');
  });
  // Gold stays reachable at any calm pace: speed doesn't score, so a flawless round (every call and pick right)
  // reaches Gold whether it takes 1.7 s or 6 s per decision.
  [1.7, 6].forEach(function (secs) {
    var gold = 0, r;
    for (r = 0; r < 300; r++) {
      if (playRound(DECK_IDS[r % DECK_IDS.length], false, player(1, secs, 1), rand, []).score.final >= S.tiers[3]) gold++;
    }
    console.log('  ' + pad('Flawless, ' + secs + ' s each', 28) + 'reaches Gold ' + pct(gold, 300) + '%');
    if (gold < 285) fail('a flawless round at ' + secs + ' s a decision reaches Gold in only ' + pct(gold, 300) + '% of rounds');
  });
}

// ---- Main ----
checkSettings();
try { checkScoring(); } catch (e) { fail('scoring: the checks threw ' + e.stack); }
checkCredits();
checkSchema();
checkDealing();
checkLint();
checkCopy();
try { checkServer(); } catch (e) { fail('Code.gs: the server checks threw ' + e.message); }
try { checkVerify(); } catch (e) { fail('Code.gs verify: the checks threw ' + e.stack); }
try { checkReset(); } catch (e) { fail('Code.gs reset: the checks threw ' + e.stack); }
try { checkRewards(); } catch (e) { fail('rewards.js: the ticket checks threw ' + e.message); }
try { checkBadgeMode(); } catch (e) { fail('badge mode: the checks threw ' + e.stack); }
try { checkTelegramMode(); } catch (e) { fail('telegram mode: the checks threw ' + e.stack); }
try { checkDesk(); } catch (e) { fail('desk.js: the checks threw ' + e.stack); }
try { checkBadgeJs(); } catch (e) { fail('badge.js: the checks threw ' + e.message); }
checkWatchdog();
checkSizes();
if (SIM) simulate();
// Not automated (spec 9.G): check these by hand before the booth opens.
console.log('Manual QA before opening\n' +
  '  the intro, up to Verify with Telegram / Start, fits above the fold at 375×548\n' +
  '  Verify with Telegram on an iPhone and an Android phone against the live script: the link does nothing until the box is ticked, then opens the ' +
  'Telegram app, Start: the bot answers within a second or two (the tap’s watch), and its Back to the game button opens the app picked, verified\n' +
  '  the merch desk scanning a ticket QR on another phone, and typing its C- code\n' +
  '  a full kiosk cycle on the tablet: the visitor ticks the box, the Telegram QR (VoiceOver reads it next), they verify on their phone, round, ticket, reset (the next one starts unticked)\n' +
  '  badge mode only if it is switched on: a badge scan on an iPhone (jsQR) and on an Android phone (BarcodeDetector)\n' +
  '  the full guide in apps-script/staff-desk/README.md (2 tries per player for the whole event; delete test rows after)');
warnings.forEach(function (w) { console.log('warn  ' + w); });
if (errors.length) {
  errors.forEach(function (e) { console.log('FAIL  ' + e); });
  console.log('\n' + errors.length + ' failure(s).');
  process.exit(1);
}
console.log('\nAll checks passed' + (SIM ? ', simulation included.' : '. Add --sim for the tier simulation.'));
