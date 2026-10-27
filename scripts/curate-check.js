#!/usr/bin/env node
// Curate game checks: content schema, shift dealing, ES5 lint and file sizes; with --sim, the §2.8 tier
// simulation. Node 22, no dependencies. It runs the very settings.js, decks.js and rules.js the phones load.
//   node scripts/curate-check.js          checks only
//   node scripts/curate-check.js --sim    checks, then 20,000 simulated players per profile
// Exits non-zero on any failure. Run it after every change to settings.js, decks.js or rules.js.
// A deliberate retune (README stock runbook) moves the tier mix away from §2.8 on purpose: the --sim table
// then shows the new shares; update TARGET below once the team agrees on them.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

var ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'site', 'curate');
var SIM = process.argv.indexOf('--sim') > -1;
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
  var keys = ['v', 'seconds', 'relaxedSeconds', 'entries', 'fakes', 'windows', 'rushAt', 'graceMs', 'points', 'trust',
    'tiers', 'checkinNeededFrom', 'countedPerDay', 'kioskMaxTier', 'kioskResetMs', 'kioskIdleMs', 'staffHoldMs',
    'undoMs', 'soldOut', 'substitutes', 'ranks', 'fallbackMerch'], i, cfg, fm, tk = ['teal', 'purple', 'gold'];
  if (!S) return fail('settings.js: window.CURATE_SETTINGS is missing');
  keys.forEach(function (k) { if (S[k] === undefined) fail('settings.js: missing ' + k); });
  ['catch', 'evidence', 'letThrough', 'autoListed', 'wrongChallenge', 'leak', 'streakEvery', 'streakBonus',
    'perSecondLeft', 'bonusMaxMistakes'].forEach(function (k) {
    if (typeof S.points[k] !== 'number') fail('settings.js: points.' + k + ' is not a number');
  });
  ['leak', 'wrongChallenge'].forEach(function (k) {
    if (typeof S.trust[k] !== 'number') fail('settings.js: trust.' + k + ' is not a number');
  });
  if (S.tiers.length !== 4 || S.tiers[0] !== 0) fail('settings.js: tiers must be [0, teal, purple, gold]');
  for (i = 1; i < S.tiers.length; i++) if (S.tiers[i] <= S.tiers[i - 1]) fail('settings.js: tiers must rise');
  for (i = 1; i < S.windows.length; i++) if (S.windows[i][0] <= S.windows[i - 1][0]) fail('settings.js: windows must rise');
  if (S.windows[0][0] !== 0) fail('settings.js: the first window must start at 0 s');
  if (S.ranks.length !== 4) fail('settings.js: ranks needs 4 names');
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

// ---- Schema ----
var SHAPES = ['coin', 'shield', 'tag', 'arch', 'bridge', 'dome', 'temple', 'tower', 'minarets', 'wave', 'station',
  'palace', 'park', 'block', 'house'];
var MARKS = ['kleros', 'btc', 'eth', 'dollar', 'tether', 'diamond', 'hex', 'bang'];
var MARKED = ['coin', 'shield', 'tag'];   // wallet objects always carry a mark; landmarks never need one
function okMark(m) { return MARKS.indexOf(m) > -1 || /^[A-Z]$/.test(m); }
function okObj(o, where) {
  if (!o || SHAPES.indexOf(o.shape) < 0) fail(where + ': obj.shape ' + (o && o.shape) + ' not allowed');
  if (o && !/^#[0-9a-f]{6}$/i.test(o.color || '')) fail(where + ': obj.color ' + (o && o.color) + ' is not #rrggbb');
  if (o && o.mark !== undefined && !okMark(o.mark)) fail(where + ': obj.mark ' + o.mark + ' not allowed');
  if (o && MARKED.indexOf(o.shape) > -1 && o.mark === undefined) fail(where + ': a ' + o.shape + ' needs a mark');
}
// Walks every string in a value and calls fn(string, path).
function strings(v, at, fn) {
  var k;
  if (typeof v === 'string') return fn(v, at);
  if (v && typeof v === 'object') for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) strings(v[k], at + '.' + k, fn);
}
var COUNTS = [];   // per list: [deck, list, good, fake, card tells], printed in the summary
// #policy is one line (nowrap, ellipsis): no policy may be longer than the Tokens one, 61 characters.
var POLICY_MAX = 61;
// The wrong-evidence toast line, exactly as game.js ruling() builds it from a field label.
var EV_LINE = '\'The problem was the “\' + lab + \'” line.\'';
function evLine(lab) { return 'The problem was the “' + lab + '” line.'; }
var EV_LINES = [];
// Every field label must read inside that sentence: no quotes or end punctuation, short enough for a toast.
function checkLabel(where, lab) {
  var line = evLine(lab);
  if (/[“”"‘’'.,:;!?]$|[“”"]/.test(lab)) fail(where + ': label ' + lab + ' breaks ' + line);
  if (line.length > 80) fail(where + ': ' + line + ' is ' + line.length + ' characters (max 80)');
  if (EV_LINES.indexOf(line) < 0) EV_LINES.push(line);
}
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
  if (it.twin !== null && typeof it.twin !== 'string') fail(where + ': twin must be a string or null');
  if ([1, 2, 3].indexOf(it.lvl) < 0) fail(where + ': lvl must be 1, 2 or 3');
  okObj(it.obj, where);
  if (it.bad !== null && keys.indexOf(it.bad) < 0) fail(where + ': bad ' + it.bad + ' is not a field of ' + it.list);
  if (!Array.isArray(it.also)) fail(where + ': also must be an array');
  else it.also.forEach(function (k) { if (keys.indexOf(k) < 0) fail(where + ': also has unknown field ' + k); });
  if (typeof it.why !== 'string' || !it.why) fail(where + ': why is missing');
  else if (it.why.length > 80) fail(where + ': why is ' + it.why.length + ' characters (max 80)');
  if (it.bad) {
    if (it.tell !== 'card' && it.tell !== 'know') fail(where + ': a fake needs tell card or know');
    if (typeof it.fix !== 'string' || !it.fix) fail(where + ': a fake needs a fix');
    if (it.f[it.bad] === it.fix) fail(where + ': fix equals the shown value');
  } else if (it.tell || it.fix) fail(where + ': a good entry has a tell or fix');
  // The Coin row is words only, so it reads on any phone and to screen readers.
  if (it.f.coin && /[₿◈]/.test(it.f.coin)) fail(where + ': coin text uses a glyph');
}
function checkSchema() {
  var ids = {}, dk;
  if (!D) return fail('decks.js: window.CURATE_DECKS is missing');
  if (!D.wallet || !D.mumbai) fail('decks.js: wallet and mumbai decks are both required');
  strings(D, 'CURATE_DECKS', function (s, at) {
    if (/http|[<>]/i.test(s)) fail('decks.js ' + at + ': contains http, < or >');
  });
  for (dk in D) {
    (function (deck) {
      var c = deck.copy || {}, entries = 0, fakes = 0, lk, li, per = {};
      if (deck.id !== dk) fail(dk + ': id must equal its key');
      if (typeof deck.client !== 'string') fail(dk + ': client is missing');
      ['story1', 'payoff', 'switchTo', 'repSwitch', 'quoteBy'].forEach(function (k) {
        if (typeof c[k] !== 'string' || !c[k]) fail(dk + ': copy.' + k + ' is missing');
      });
      if (!c.quotes || c.quotes.length !== 3) fail(dk + ': copy.quotes needs 3 lines (trust ≥ 90, 70–89, < 70)');
      if (c.payoffs && (c.payoffs.length !== 3 || c.payoffs.some(function (x) { return x.indexOf('{trust}') < 0; }))) {
        fail(dk + ': copy.payoffs needs 3 lines (trust ≥ 90, 70–89, < 70), each with {trust}');
      }
      if (!deck.hero || deck.hero.length !== 3) fail(dk + ': hero needs 3 specs');
      else deck.hero.forEach(function (o, i) { okObj(o, dk + ' hero[' + i + ']'); });
      for (lk in deck.lists) {
        li = deck.lists[lk];
        if (!li.name || !li.policy || !li.fields || li.fields.length !== 3) fail(dk + '.' + lk + ': name, policy and 3 fields needed');
        if (li.objField && !li.fields.some(function (f) { return f[0] === li.objField; })) fail(dk + '.' + lk + ': objField is not a field');
        if (li.policy && li.policy.length > POLICY_MAX) fail(dk + '.' + lk + ': policy is ' + li.policy.length + ' characters (max ' + POLICY_MAX + ')');
        (li.fields || []).forEach(function (f) { checkLabel(dk + '.' + lk, f[1]); });
        per[lk] = [0, 0, 0];
      }
      if (deck.easy && !deck.lists[deck.easy]) fail(dk + ': easy list ' + deck.easy + ' does not exist');
      if (deck.late && !deck.lists[deck.late]) fail(dk + ': late list ' + deck.late + ' does not exist');
      for (lk in deck.split) {
        if (!deck.lists[lk]) fail(dk + ': split names unknown list ' + lk);
        entries += deck.split[lk][0]; fakes += deck.split[lk][1];
      }
      if (entries !== S.entries || fakes !== S.fakes) fail(dk + ': split adds up to ' + entries + '/' + fakes + ', settings say ' + S.entries + '/' + S.fakes);
      (deck.items || []).forEach(function (it) {
        checkItem(deck, it, ids, false);
        if (per[it.list]) { per[it.list][it.bad ? 1 : 0]++; if (it.bad && it.tell === 'card') per[it.list][2]++; }
      });
      (deck.practice || []).forEach(function (it) { checkItem(deck, it, ids, true); });
      if (!deck.practice || deck.practice.length !== 2 || !deck.practice[0].bad || deck.practice[1].bad) {
        fail(dk + ': practice needs 2 items, a fake then a good entry');
      }
      for (lk in per) {
        COUNTS.push([dk, lk, per[lk][0], per[lk][1], per[lk][2]]);
        // At least half the fakes per list can be caught from the card plus the policy.
        if (per[lk][1] && per[lk][2] * 2 < per[lk][1]) fail(dk + '.' + lk + ': only ' + per[lk][2] + ' of ' + per[lk][1] + ' fakes are card tells (need ≥ 50%)');
      }
    })(D[dk]);
  }
  console.log('Content');
  COUNTS.forEach(function (c) {
    console.log('  ' + pad(c[0] + '.' + c[1], 16) + lpad(c[2], 3) + ' good ' + lpad(c[3], 3) + ' fake  (' + c[4] + ' card tells)');
  });
  // The sentence lives in game.js: make sure it is still the one rendered here.
  try {
    if (fs.readFileSync(path.join(DIR, 'game.js'), 'utf8').indexOf(EV_LINE) < 0) warn('game.js: the wrong-evidence line is no longer ' + EV_LINE + '; update evLine() here');
  } catch (e) { warn('game.js could not be read: ' + e.message); }
  console.log('Wrong-evidence lines\n  ' + EV_LINES.join('\n  '));
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
// Returns the problems with one dealt shift (empty when it follows §2.4).
function runProblems(deck, run, practiceIds) {
  var p = [], items = run.items, ids = {}, twins = {}, per = {}, fakes = 0, rf = 0, rg = 0, i, it, k, open;
  function easy(x) { return deck.easy ? x.list === deck.easy : x.lvl === 1; }
  if (run.deck !== deck.id) p.push('deck is ' + run.deck);
  if (items.length !== S.entries) p.push(items.length + ' entries');
  for (i = 0; i < items.length; i++) {
    it = items[i];
    if (ids[it.id]) p.push('duplicate ' + it.id);
    ids[it.id] = 1;
    if (it.twin) { if (twins[it.twin]) p.push('two of twin ' + it.twin); twins[it.twin] = 1; }
    if (practiceIds[it.id]) p.push('practice item ' + it.id);
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
  open.forEach(function (x) { if (x.bad && x.tell !== 'card') p.push('the opening fake is not a card tell'); });
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
        // Like a phone: the previous shift’s ids are passed in, so the next shift avoids them where it can.
        repeats += run.items.filter(function (x) { return last.indexOf(x.id) > -1; }).length;
        last = run.items.map(function (x) { return x.id; });
      }
      if (bad) fail(deck.id + ': ' + bad + ' of ' + BUILDS + ' dealt shifts break §2.4, first: ' + first);
      // buildRun must not touch the deck: items are copies.
      run.items[0].why = 'changed';
      if (deck.items.some(function (x) { return x.why === 'changed'; })) fail(deck.id + ': buildRun returns the deck’s own objects');
      out.push('  ' + pad(deck.id, 8) + BUILDS + ' shifts, ' + bad + ' broken, ' +
        (Math.round(100 * repeats / (BUILDS - 1)) / 100) + ' entries repeated from the previous shift on average');
    })(D[dk]);
  }
  // A missing rand falls back to Math.random.
  if (R.buildRun('wallet', []).items.length !== S.entries) fail('buildRun without rand failed');
  console.log('Dealing');
  out.forEach(function (l) { console.log(l); });
}

// ---- ES5 lint ----
// Blanks comments, strings and regex literals (keeping newlines), so words in copy such as "let it through"
// are not mistaken for code. Backticks are kept so a template literal is still caught.
function codeOnly(src) {
  var out = '', i = 0, n = src.length, c, q, prev = '', j, word;
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
  var files = fs.readdirSync(DIR).filter(function (f) { return /\.js$/.test(f); }).sort(), hits = 0;
  files.forEach(function (f) {
    var lines;
    try { lines = codeOnly(fs.readFileSync(path.join(DIR, f), 'utf8')).split('\n'); } catch (e) { return; }
    lines.forEach(function (line, i) {
      LINT.forEach(function (rule) {
        if (rule[0].test(line)) { hits++; fail('site/curate/' + f + ':' + (i + 1) + ': ES5 only, found ' + rule[1]); }
      });
    });
  });
  console.log('ES5 lint\n  ' + files.length + ' file(s): ' + files.join(', ') + (hits ? '' : ', clean'));
}

// ---- Sizes ----
// Budgets in bytes: [raw, gzip] (0 = no limit). P1’s own files fail when over; the rest only warn.
// Revised after the first review round: §8.1’s numbers were set before the build and every file but P1’s
// outgrew them, so the check only warned. Each budget is now the measured size plus about 10%, and the eager
// total (everything but the lazy gl.js) is held under 60 KB gz. Unminified on purpose: no build step, and the
// source stays readable. Raise a budget only with a reason, and keep the eager total under 60 KB gz.
var KB = 1024;
var BUDGETS = {
  'settings.js': [3 * KB, 0, true], 'decks.js': [24 * KB, 7 * KB, true], 'rules.js': [8 * KB, 0, true],
  'objects.js': [23 * KB, 9 * KB], 'gl.js': [38 * KB, 14 * KB], 'game.js': [44 * KB, 14.5 * KB],
  'rewards.js': [41 * KB, 13.5 * KB], 'index.html': [61 * KB, 17 * KB]
};
var TOTAL = [196 * KB, 60 * KB];   // eager files only: gl.js loads later, and only where WebGL runs
function checkSizes() {
  var total = 0, totalGz = 0;
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
    (TOTAL[1] / KB) + ' KB gz, before gl.js');
  if (total > TOTAL[0] || totalGz > TOTAL[1]) warn('site/curate is over the total budget (eager files)');
}

// ---- Rewards ----
// rewards.js in vm "pages" that share one fake localStorage, like two tabs on one phone. No network, no real DOM:
// every element is a stub that keeps textContent, hidden and attributes.
function Store() { this.d = {}; }
Store.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this.d, k) ? this.d[k] : null; };
Store.prototype.setItem = function (k, v) { this.d[k] = String(v); };
function stubEl() {
  var attrs = {}, cls = {}, on = {};
  return { textContent: '', hidden: false, title: '', href: '', open: false, children: [], style: { setProperty: function () {} },
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
    removeAttribute: function (k) { delete attrs[k]; }, hasAttribute: function (k) { return k in attrs; },
    classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; },
      toggle: function (c) { if (cls[c]) delete cls[c]; else cls[c] = 1; }, contains: function (c) { return !!cls[c]; } },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, contains: function () { return false; },
    appendChild: function () {}, removeChild: function () {}, focus: function () {}, setPointerCapture: function () {},
    addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); },
    click: function () { (on.click || []).forEach(function (fn) { fn({ stopPropagation: function () {}, target: null }); }); } };
}
var RW_SRC = ['site/config.js', 'site/curate/settings.js', 'site/curate/decks.js', 'site/curate/rules.js', 'site/curate/rewards.js']
  .map(function (f) { return [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]; });
function page(ls, opts) {
  opts = opts || {};
  var els = {}, ctx = { console: console, localStorage: ls, location: { search: opts.kiosk ? '?kiosk=1' : '' },
    document: { hidden: false, activeElement: null, getElementById: function (id) { return els[id] || (els[id] = stubEl()); },
      createElement: stubEl, addEventListener: function () {} },
    addEventListener: function () {}, setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 1; }, clearInterval: function () {}, performance: { now: function () { return 0; } },
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {} };
  ctx.window = ctx;
  els['hdr-logo'] = stubEl(); els['hdr-logo'].setAttribute('href', '/');   // as in the shell
  vm.createContext(ctx);
  RW_SRC.forEach(function (f) {
    vm.runInContext(f[1], ctx, { filename: f[0] });
    if (/rules/.test(f[0]) && opts.settings) opts.settings(ctx.CURATE_SETTINGS);
  });
  ctx.CurateRewards.init({});
  ctx.text = function (id) { return els[id] ? els[id].textContent : ''; };
  ctx.el = function (id) { return ctx.document.getElementById(id); };
  return ctx;
}
// One shift through the public API, as game.js calls it: startShift when the clock starts, then finishShift.
function playShift(pg, final) {
  var r = pg.CurateRewards.startShift('wallet');
  pg.CurateRewards.finishShift({ deck: 'wallet', final: final, raw: final, caught: 3, fakesSeen: 4, listed: 5, goodsSeen: 6,
    evidence: 1, wrong: 0, leaks: 1, trust: 85, reviewed: 10, counted: r.counted, shiftNo: r.shiftNo, code: r.code, misses: [] });
  return r;
}
function stamp(pg) { pg.CurateRewards.showTicket(); pg.el('tb-staff-btn').click(); pg.el('staff-ok').click(); }
function self(tier, merch) {
  var m = merch || (tier === 3 ? { tg: 'joined', x: 1, li: 1, quiz: 1 } : tier === 2 ? { tg: 'joined', x: 1, li: 1 } : {});
  return JSON.stringify({ ticket: 'K-ABC123', name: 'Ana', confirmed: true, newsletter: false, merch: m });
}
function checkRewards() {
  var n = 0, ls, a, b, c, kept, m;
  function ok(cond, msg) { n++; if (!cond) fail('rewards.js: ' + msg); }
  function stored(l) { return JSON.parse(l.getItem('kleros_devcon_curate')); }
  // Two tabs: a stale tab neither counts a 4th shift nor drops the other tab's best or stamp.
  ls = new Store(); a = page(ls); b = page(ls);
  playShift(a, 600); playShift(a, 1000); playShift(a, 300);
  ok(!b.CurateRewards.startShift('wallet').counted, 'a stale tab counted a 4th shift');
  ok(stored(ls).counted === 3 && stored(ls).best.final === 1000, 'a stale tab dropped the other tab’s counted shifts or best');
  stamp(a);
  kept = JSON.stringify(stored(ls).collected);
  ok(stored(ls).collected && stored(ls).collected.tier === 2, 'the staff stamp did not save a Purple collect');
  b.CurateRewards.startShift('wallet'); b.CurateRewards.showTicket();
  ok(JSON.stringify(stored(ls).collected) === kept && b.CurateRewards.model().state === 'collected', 'a stale tab lost the stamp');
  // The check-in ticket already covers a game tier at or below it: no second claimable ticket.
  ls = new Store(); ls.setItem('kleros_devcon_self', self(3)); c = page(ls); playShift(c, 1600);
  ok(c.CurateRewards.model().state === 'checkin', 'check-in Gold plus game Gold is still claimable');
  ls = new Store(); ls.setItem('kleros_devcon_self', self(1)); c = page(ls); playShift(c, 1000);
  m = c.CurateRewards.model();
  ok(m.state === 'live' && m.t === 2 && m.code === 'K-ABC123', 'check-in Teal plus game Purple is not a live K- Purple ticket');
  // Everyone has nothing to stamp, and a later Teal shift still counts.
  ls = new Store(); c = page(ls); playShift(c, 300); stamp(c);
  ok(c.el('tb-staff-btn').hidden && !stored(ls).collected, 'an Everyone ticket can be stamped');
  playShift(c, 600);
  m = c.CurateRewards.model();
  ok(m.state === 'live' && m.t === 1, 'a Teal shift after an Everyone ticket is not live Teal');
  // A mid-day retune never downgrades a ticket, and a lower tier never replaces it.
  ls = new Store(); playShift(page(ls), 1500);
  c = page(ls, { settings: function (s) { s.tiers = [0, 450, 950, 1550]; } });
  ok(c.CurateRewards.model().g === 3, 'raising the Gold threshold downgraded today’s Gold ticket');
  playShift(c, 1520);
  ok(stored(ls).best.final === 1500, 'a Purple 1520 replaced a Gold 1500');
  // Sold-out notes read as plain sentences for every tier.
  [['teal', 600], ['purple', 1000], ['gold', 1500]].forEach(function (t) {
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
  playShift(c, 1600);
  ok(c.text('rep-tier-line') === 'Merch goes with your first check-in. Play for fun.', 'duplicate check-in report: ' + c.text('rep-tier-line'));
  ok(c.el('rep-gold').hidden !== false && c.CurateRewards.model().state === 'dup', 'duplicate check-in is offered a Gold check-in');
  // Kiosk: one shift is one visitor, capped at kioskMaxTier, and the ticket's button is Next curator.
  c = page(new Store(), { kiosk: true });
  playShift(c, 600); playShift(c, 150);
  m = c.CurateRewards.model();
  ok(m.t === 0 && m.best.final === 150, 'the next kiosk visitor inherited an earlier best');
  playShift(c, 1600); c.CurateRewards.showTicket();
  ok(c.CurateRewards.model().t === S.kioskMaxTier && c.text('t-again') === 'Next curator', 'kiosk cap or Next curator');
  ok(!c.el('hdr-logo').hasAttribute('href'), 'the kiosk logo keeps a link');
  console.log('Rewards\n  ' + n + ' ticket and storage cases (two tabs, check-in, Everyone, retune, sold out, duplicate, kiosk)');
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

// ---- Simulation (§2.8) ----
// Model: lognormal decision time (SIGMA), +0.5 s when the player taps evidence, 0.25 s per card for the
// fly-out and landing; the best of the shifts actually played (55% play 1, 25% play 2, 20% play 3), each later
// shift +3% accuracy and −10% time. Accuracy is the chance of the right call on a card the player decides.
var RUNS = 20000, SIGMA = 0.5, EVIDENCE_S = 0.5, OVERHEAD_S = 0.25;
var PLAYS = [[1, 0.55], [2, 0.25], [3, 0.20]];
var PROFILES = [   // name, mix share, accuracy, mean decision s, evidence rate; then §2.8 targets for reference
  ['Expert', 0.07, 0.95, 1.7, 0.7], ['Strong', 0.20, 0.90, 2.2, 0.5], ['Average', 0.38, 0.82, 2.8, 0.3],
  ['Casual', 0.25, 0.72, 3.5, 0.15], ['Novice', 0.10, 0.62, 4.3, 0.05]
];
var TARGET = { standard: [27, 36, 30, 7], relaxed: [18, 38, 40, 4] }, TOLERANCE = 4;
function gauss(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }
function lognormal(rand, mean) { return Math.exp(Math.log(mean) - SIGMA * SIGMA / 2 + SIGMA * gauss(rand)); }
function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }

// One shift with the real rules. `play(item, rand)` returns { action, evidence, secs } (secs Infinity = idle).
function shift(deckId, relaxed, play, rand, last) {
  var run = R.buildRun(deckId, last, rand), sc = R.newScore(), len = relaxed ? S.relaxedSeconds : S.seconds,
    t = 0, grace = 0, decided = 0, i, it, w, d, o;
  for (i = 0; i < run.items.length; i++) {
    it = run.items[i];
    w = R.windowFor(t, relaxed);
    if (w) w += grace;
    d = play(it, rand);
    if (w && d.secs > w) d = { action: 'timeout', evidence: '', secs: w };
    if (t + d.secs > len) break;   // the card on screen at time-out is discarded
    t += d.secs;
    o = R.judge(it, d.action, d.evidence);
    R.apply(sc, it, o);
    grace = o.correct ? 0 : S.graceMs / 1000;
    decided++;
    t += OVERHEAD_S;
  }
  R.finish(sc, len - t, decided === run.items.length, relaxed);
  return { score: sc, decided: decided, ids: run.items.map(function (x) { return x.id; }) };
}
// A player profile: right call with probability acc; evidence on a challenge with probability ev (sharp when
// the call is right, since the player saw the flaw; a wrong challenge marks some line).
function player(acc, mean, ev) {
  return function (it, rand) {
    var right = rand() < acc, ch = it.bad ? right : !right, mark = ch && rand() < ev;
    return { action: ch ? 'challenge' : 'letThrough', evidence: mark ? (it.bad && right ? it.bad : 'x') : '',
             secs: lognormal(rand, mean) + (mark ? EVIDENCE_S : 0) };
  };
}
function lazy(kind) {
  return function (it, rand) {
    if (kind === 'idle') return { action: 'letThrough', evidence: '', secs: Infinity };
    var ch = kind === 'challenge' || (kind === 'random' && rand() < 0.5);
    return { action: ch ? 'challenge' : 'letThrough', evidence: '', secs: lognormal(rand, 0.45) };
  };
}
function simProfile(prof, relaxed, rand) {
  var one = [0, 0, 0, 0], best = [0, 0, 0, 0], scores = [], decided = [], r, k, n, u, b, res, last, deck;
  for (r = 0; r < RUNS; r++) {
    u = rand(); n = 0;
    for (k = 0; k < PLAYS.length && n === 0; k++) { u -= PLAYS[k][1]; if (u < 0) n = PLAYS[k][0]; }
    n = n || 1;
    b = 0; last = [];
    deck = r % 2 ? 'mumbai' : 'wallet';   // both clients share the rules; half the players pick each
    for (k = 0; k < n; k++) {
      res = shift(deck, relaxed, player(Math.min(0.99, prof[2] + 0.03 * (k ? 1 : 0)), prof[3] * (k ? 0.9 : 1), prof[4]),
        rand, last);
      last = res.ids;
      if (k === 0) { scores.push(res.score.final); decided.push(res.decided); one[R.tierFor(res.score.final)]++; }
      b = Math.max(b, res.score.final);
    }
    best[R.tierFor(b)]++;
  }
  return { one: one, best: best, median: median(scores), decided: median(decided) };
}
function shares(c) { return c.map(function (x) { return Math.round(pct(x, RUNS)); }); }
function simulate() {
  var rand = mulberry32(2026), modes = ['standard', 'relaxed'];
  modes.forEach(function (mode) {
    var relaxed = mode === 'relaxed', mix = [0, 0, 0, 0];
    console.log('\nSimulation, ' + mode + ' (' + RUNS + ' players per profile; E/T/P/G = Everyone/Teal/Purple/Gold %)');
    console.log('  ' + pad('Profile', 10) + pad('mix', 6) + pad('acc/time/ev', 16) + pad('decided', 9) + pad('median', 8) +
      pad('one shift', 14) + 'best of plays');
    PROFILES.forEach(function (p) {
      var s = simProfile(p, relaxed, rand), i;
      for (i = 0; i < 4; i++) mix[i] += p[1] * pct(s.best[i], RUNS);
      console.log('  ' + pad(p[0], 10) + pad(Math.round(p[1] * 100) + '%', 6) + pad(p[2] + '/' + p[3] + 's/' + p[4], 16) +
        pad(s.decided, 9) + pad(s.median, 8) + pad(shares(s.one).join('/'), 14) + shares(s.best).join('/'));
    });
    mix = mix.map(function (x) { return Math.round(x * 10) / 10; });
    console.log('  Mix: ' + mix.join(' / ') + ' %   (§2.8: ≈ ' + TARGET[mode].join(' / ') + ' %, ±' + TOLERANCE + ')');
    mix.forEach(function (x, i) {
      if (Math.abs(x - TARGET[mode][i]) > TOLERANCE) {
        (relaxed ? warn : fail)(mode + ' mix tier ' + i + ' is ' + x + '%, §2.8 says ' + TARGET[mode][i] + '% ±' + TOLERANCE);
      }
    });
  });
  simLazy(rand);
}
// Lazy strategies must never reach Teal; random fast taps are reported only.
function simLazy(rand) {
  console.log('\nLazy strategies, standard (' + RUNS + ' shifts each)');
  [['let', 'Let everything through'], ['challenge', 'Challenge everything'], ['idle', 'Idle'],
    ['random', 'Random fast taps (0.45 s)']].forEach(function (s) {
    var scores = [], teal = 0, r, f;
    for (r = 0; r < RUNS; r++) {
      f = shift(r % 2 ? 'mumbai' : 'wallet', false, lazy(s[0]), rand, []).score.final;
      scores.push(f);
      if (R.tierFor(f) >= 1) teal++;
    }
    console.log('  ' + pad(s[1], 28) + 'median ' + lpad(median(scores), 4) + '   max ' + lpad(Math.max.apply(null, scores), 4) +
      '   reaches Teal ' + pct(teal, RUNS) + '%');
    if (s[0] !== 'random' && teal) fail(s[1] + ' reached Teal in ' + teal + ' shifts');
  });
}

// ---- Main ----
checkSettings();
checkSchema();
checkDealing();
checkLint();
try { checkRewards(); } catch (e) { fail('rewards.js: the ticket checks threw ' + e.message); }
checkWatchdog();
checkSizes();
if (SIM) simulate();
warnings.forEach(function (w) { console.log('warn  ' + w); });
if (errors.length) {
  errors.forEach(function (e) { console.log('FAIL  ' + e); });
  console.log('\n' + errors.length + ' failure(s).');
  process.exit(1);
}
console.log('\nAll checks passed' + (SIM ? ', simulation included.' : '. Add --sim for the tier simulation.'));
