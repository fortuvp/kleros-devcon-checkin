#!/usr/bin/env node
// Curate game checks: content schema and facts, round dealing, ES5 lint, user copy (banned words, web3 words
// outside the Crypto exchange app, and Curate’s jargon on the play screen) and file sizes; with --sim, the §2.8
// tier simulation (v5 pick model; 2 Nov: 2 counted tries per badge for the whole event). Badge tries (2 Nov): the booth web app
// (apps-script/staff-desk/Code.gs) runs here against an in-memory Sheets stub, and rewards.js, earn.js and badge.js
// run against it in fake pages.
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
    'undoMs', 'soldOut', 'substitutes', 'ranks', 'fallbackMerch', 'server', 'badge', 'contact'], i, cfg, fm,
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
    if (typeof ct.monthly !== 'string' || !ct.monthly) fail('settings.js: contact.monthly is empty');
  })(S.server || {}, S.badge || {}, S.contact || {});
  // 2 Nov (user): 2 tries per ticket, the Devcon badge, for the whole event. Nothing counts tries per day any more.
  ['countedPerDay', 'lastDay'].forEach(function (k) {
    if (S[k] !== undefined) fail('settings.js: ' + k + ' is gone (countedTries is per badge or phone for the whole event, never per day)');
  });
  ['catch', 'evidence', 'letThrough', 'wrongChallenge', 'leak', 'streakEvery', 'streakBonus'].forEach(function (k) {
    if (typeof S.points[k] !== 'number') fail('settings.js: points.' + k + ' is not a number');
  });
  // 2 Nov: no time bonus (the score is the answers) and one 90 s round for everyone (no More time).
  ['perSecondLeft', 'bonusMaxMistakes', 'bonusMinEvidence', 'relaxedBonus'].forEach(function (k) {
    if (S.points[k] !== undefined) fail('settings.js: points.' + k + ' is gone (no time bonus)');
  });
  if (S.relaxedSeconds !== undefined) fail('settings.js: relaxedSeconds is gone (one round length for everyone)');
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
    if (daily(t)) { hits++; fail(where + ': user copy counts tries by the day (' + daily(t) + '): ' + t.trim().slice(0, 70)); }
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
var BUDGETS = {
  // settings.js +0.5 KB and earn.js: the Earn for real sign-up (30 Oct); +0.25 KB: separate desk and sign-up sheets (2 Nov).
  'settings.js': [4.8 * KB, 0, true], 'earn.js': [6 * KB, 2.5 * KB], 'decks.js': [47.5 * KB, 13.75 * KB, true], 'rules.js': [9.2 * KB, 0, true],
  'credits.js': [12 * KB, 2.75 * KB, true],
  // game.js +0.25 KB gz: a stale start reply is ignored and the scanner skips non-badge codes (2 Nov review).
  'objects.js': [33.5 * KB, 12.5 * KB], 'gl.js': [21 * KB, 8.25 * KB], 'game.js': [58 * KB, 18.75 * KB],
  // rewards.js +0.5 KB gz in v6: the tries line, the early-end headline and the just-for-fun tier line.
  'rewards.js': [78 * KB, 25 * KB], 'index.html': [77 * KB, 22 * KB], 'badge.js': [10 * KB, 4 * KB]
};
var TOTAL = [330 * KB, 104 * KB];   // eager files only: gl.js loads later, and only where WebGL runs; jsQR only to scan
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
  // jsQR loads only when a phone without a built-in QR reader scans a badge: reported apart, out of the total.
  (function (p) {
    var buf = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (!buf) return fail('site/curate/vendor/jsQR.js is missing (the iPhone badge reader)');
    console.log('  ' + pad('vendor/jsQR', 12) + lpad(buf.length, 6) + ' / ' + lpad(zlib.gzipSync(buf, { level: 9 }).length, 5) + '   lazy: only when a scan needs it');
    if (!fs.existsSync(path.join(DIR, 'vendor', 'jsQR-LICENSE.txt'))) fail('site/curate/vendor/jsQR-LICENSE.txt is missing');
  })(path.join(DIR, 'vendor', 'jsQR.js'));
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
var GS_SRC = fs.existsSync(GS) ? fs.readFileSync(GS, 'utf8') : '';
var GS_T0 = Date.parse('2026-11-03T05:00:00Z');   // 10:30 IST on the first booth day
function gsHarness(opts) {
  opts = opts || {};
  var H = { clock: GS_T0, lockBusy: false, offline: false, logs: [], toasts: [], alerts: [], writes: [] }, cache = {}, props = {};
  function coerce(v) {
    H.writes.push(v);
    if (typeof v !== 'string') return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00+05:30');
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v.charAt(0) === '\'') return v.slice(1);
    return v;
  }
  function Sheet(name) { this.name = name; this.rows = []; this.prot = []; this.frozen = 0; }
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
      insertCheckboxes: function () { for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) if (cell(i, j) === '') put(i, j, false); }
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
  var ui = { createMenu: function () { return ui; }, addItem: function () { return ui; }, addSeparator: function () { return ui; },
    addToUi: function () {}, alert: function (s) { H.alerts.push(String(s)); } };
  var ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return H.bound; },
      openById: function (id) { if (id === ctx.CONTACTS_SHEET_ID && id) return H.contacts; throw new Error('no sheet ' + id); },
      flush: function () {}, getUi: function () { return ui; }
    },
    LockService: { getScriptLock: function () { return { tryLock: function () { return !H.lockBusy; }, releaseLock: function () {} }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { var e = cache[k]; return e && e.t > H.clock ? e.v : null; },
      put: function (k, v, s) { cache[k] = { v: String(v), t: H.clock + (s || 600) * 1000 }; },
      remove: function (k) { delete cache[k]; } }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = String(v); } }; } },
    Utilities: { formatDate: fmt },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { s: s, setMimeType: function () { return this; } }; } },
    Logger: { log: function (s) { H.logs.push(String(s)); } }
  };
  vm.createContext(ctx);
  vm.runInContext(GS_SRC, ctx, { filename: 'Code.gs' });
  ctx.now_ = function () { return new Date(H.clock); };
  H.ctx = ctx; H.props = props; H.cache = cache;
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
  // 2. In sync with settings.js and decks.js: the server derives the tier itself, from the same thresholds.
  H = gsHarness();
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
  ok(H.contacts.sheets.Contacts.rows[0].join() === 'Day,Contact,Kind,Curator info,Event,Source,Id' && !H.bound.sheets.Contacts, 'Contacts headers, in the contacts sheet only');
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
  r = gsHarness(); r.clock = Date.parse('2026-11-03T18:29:00Z');
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
  r = H.call({ action: 'finish', token: t1, score: 615, tier: 3, relaxed: false, endedBy: 'done' });
  ok(r.ok && r.score === 615 && r.tier === 2 && r.best && r.best.score === 615 && r.perBadge === 2 && r.left === 0,
    'the tier comes from the score, not the body ' + JSON.stringify(r));
  ok(r.best && /^C-[A-Z0-9]{6}$/.test(r.best.code) && r.best.code === 'C-' + t1.slice(0, 6).toUpperCase(), 'best.code ' + (r.best || {}).code);
  H.clock += 7 * HOUR;
  ok(H.call({ action: 'finish', token: t1, score: 615 }).ok === true, 'the same finish again (7 h later) is not ok');
  ok(H.call({ action: 'finish', token: t1, score: 616 }).error === 'used', 'a second score for one token');
  ok(H.call({ action: 'finish', token: t2, score: 400 }).error === 'late', 'a finish 10 h after its start');
  ok(H.call({ action: 'finish', token: 'unknowntoken12345', score: 1 }).error === 'badtoken', 'an unknown token');
  t3 = tok(); start(H, C, t3); H.clock += 60000;
  ok(H.call({ action: 'finish', token: t3, score: maxScore() + 1 }).error === 'toohigh', 'a score above the best possible round');
  ok(H.call({ action: 'finish', token: t3, score: -1 }).error === 'badscore' && H.call({ action: 'finish', token: t3, score: 3.5 }).error === 'badscore', 'badscore');
  // 6. status: the best across days, with its game code and time.
  r = H.call({ action: 'status', badge: A });
  ok(r.ok && r.v && r.tiers.join() === S.tiers.join() && r.maxScore === maxScore() && r.badge && r.badge.best && r.badge.best.score === 615 &&
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
  ok(!/[0-9a-f]{64}/.test(tmp) && [t1, t2, t4].every(function (t) { return tmp.indexOf(t) < 0; }) && tmp.indexOf('615') < 0, 'the contacts sheet holds a badge, token or score');
  tmp = JSON.stringify(H.bound.sheets);
  ok(tmp.indexOf('@') < 0 && tmp.indexOf('ana@example.org') < 0 && tmp.indexOf('ana_k') < 0, 'the badge sheet holds a contact');
  ok(H.writes.indexOf('\'\t=1') > -1, 'the event \\t=1 is not written as \'\\t=1');
  r = H.call({ action: 'check', key: H.props.STAFF_KEY, badge: A });
  ok(r.ok && r.contact === true && r.earned === 2 && r.used === false && r.game && r.game.score === 615 && r.triesUsed === 2 &&
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
  r = gsHarness(); r.ctx.staffSetup();
  start(r, A); start(r, A);
  r.tab('Tries').rows[1][1] = new Date('2026-11-01T00:00:00+05:30'); r.tab('Tries').rows[2][1] = '2026-11-02';
  ok(start(r, A).reason === 'limit', 'tries with an earlier Day (a Date, or text) gave new tries');
  // 11. Caps and the lock: busy, and nothing written.
  r = gsHarness(); r.ctx.staffSetup();
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
  console.log('Booth web app (Code.gs)\n  ' + n + ' cases (setup, sync with settings.js, 2 tries per badge, no new tries on a new day, finish, status, contacts sheet, claims, switches, caps, lock)');
}

// ---- Rewards ----
// rewards.js and earn.js in vm "pages" that share one fake localStorage, like two tabs on one phone. No real DOM:
// every element is a stub that keeps textContent, hidden, value and attributes. v6 pages have no network; a badge-
// mode page (opts.server = a gsHarness) gets a CurateBadge stub whose post() calls Code.gs synchronously (or answers
// offline while server.offline is set), and a clock and timers tied to the harness clock. A v6 page may get a clock
// too (opts.clock = { clock: ms }), so a case can move it to another day.
function Store() { this.d = {}; }
Store.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this.d, k) ? this.d[k] : null; };
Store.prototype.setItem = function (k, v) { this.d[k] = String(v); };
Store.prototype.removeItem = function (k) { delete this.d[k]; };
function stubEl() {
  var attrs = {}, cls = {}, on = {};
  return { textContent: '', hidden: false, title: '', href: '', open: false, children: [], value: '', checked: false, disabled: false,
    className: '', style: { setProperty: function () {} },
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
    removeAttribute: function (k) { delete attrs[k]; }, hasAttribute: function (k) { return k in attrs; },
    classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; },
      toggle: function (c) { if (cls[c]) delete cls[c]; else cls[c] = 1; }, contains: function (c) { return !!cls[c]; } },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, contains: function () { return false; },
    appendChild: function () {}, removeChild: function () {}, insertBefore: function () {}, focus: function () {},
    scrollIntoView: function () {}, setPointerCapture: function () {},
    addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); },
    fire: function (t) {
      var e = { preventDefault: function () {}, stopPropagation: function () {}, target: null };
      (on[t] || []).forEach(function (fn) { fn(e); });
    },
    click: function () { this.fire('click'); } };
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
  var els = {}, G = opts.server, clk = null, timers = [], ctx = { console: console, localStorage: ls, location: { search: opts.kiosk ? '?kiosk=1' : '' },
    document: { hidden: false, activeElement: null, readyState: 'complete', getElementById: function (id) { return els[id] || (els[id] = stubEl()); },
      createElement: stubEl, addEventListener: function () {} },
    addEventListener: function () {}, setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 1; }, clearInterval: function () {}, performance: { now: function () { return 0; } },
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {} };
  ctx.window = ctx;
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
      // G.lose: the server acts but the reply is lost on the way back (a dropped connection).
      post: function (body, done) {
        var j;
        if (G.offline) return done('offline');
        j = G.call(JSON.parse(JSON.stringify(body)));
        if (G.lose) { G.lose = false; return done('offline'); }
        done(null, j);
      },
      loadJsQR: function (done) { done(true); }
    };
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
    reset: function () { ctx.didReset = (ctx.didReset || 0) + 1; ctx.CurateRewards.refreshBrief(); } });
  ctx.text = function (id) { return els[id] ? els[id].textContent : ''; };
  ctx.el = function (id) { return ctx.document.getElementById(id); };
  // Moves the shared clock on and runs the timers that are due (badge-mode pages only).
  ctx.tick = function (ms) {
    G.clock += ms;
    timers.slice().forEach(function (t) { if (t.fn && t.at <= G.clock) { var fn = t.fn; t.fn = null; fn(); } });
  };
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
  var n = 0, G = gsHarness(), T = S.tiers, LOW = Math.floor(T[1] / 4), TEAL = Math.floor((T[1] + T[2]) / 2),
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
  ok(p.text('intro-note') === 'Your Devcon badge gives 2 tries for merch.' && !p.el('intro-scan').hidden, 'intro before a scan: ' + p.text('intro-note'));
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

// ---- badge.js ----
// The shared badge module, loaded for real: ids stay the v6 desk's, Kleros's own links and ticket codes are not
// badges; both pages load it (defer, before the scripts that use it) and neither loads jsQR up front.
function checkBadgeJs() {
  var n = 0, B = BADGE;
  function ok(cond, msg) { n++; if (!cond) fail('badge.js: ' + msg); }
  if (!B) return fail('badge.js: window.CurateBadge is missing');
  ['endpoint', 'can', 'id', 'ok', 'tail', 'hash', 'read', 'post', 'scan', 'loadJsQR'].forEach(function (f) { ok(typeof B[f] === 'function', f + ' is missing'); });
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
    ok(order.indexOf('jsQR.js') < 0, pg[0] + ': jsQR loads up front');
  });
  ok(!fs.existsSync(path.join(STAFF, 'vendor')), 'site/staff/vendor is back (jsQR lives in /curate/vendor/)');
  console.log('badge.js\n  ' + n + ' cases (ids, badge test, hash salt, script order in both pages)');
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
var TARGET = { standard: [26, 36, 24, 14] }, TOLERANCE = 4;   // 2 Nov: one 90 s round, no time bonus; Gold = a perfect round (best of 2 tries)
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
    console.log('  Mix: ' + mix.join(' / ') + ' %   (§2.8: ≈ ' + TARGET[mode].join(' / ') + ' %, ±' + TOLERANCE + ')' +
      '   tiers ' + S.tiers.join(' / '));
    if (FIT && !relaxed) fit(all);
    mix.forEach(function (x, i) {
      if (Math.abs(x - TARGET[mode][i]) > TOLERANCE) {
        (relaxed ? warn : fail)(mode + ' mix tier ' + i + ' is ' + x + '%, §2.8 says ' + TARGET[mode][i] + '% ±' + TOLERANCE);
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
// and picks a random part, right 1 time in 4 (v4, no pick: about 7% reached Teal); see the README notes.
// A round here is one try, so the lazy lines hold for each of the day’s tries.
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
checkCredits();
checkSchema();
checkDealing();
checkLint();
checkCopy();
try { checkServer(); } catch (e) { fail('Code.gs: the server checks threw ' + e.message); }
try { checkRewards(); } catch (e) { fail('rewards.js: the ticket checks threw ' + e.message); }
try { checkBadgeMode(); } catch (e) { fail('badge mode: the checks threw ' + e.stack); }
try { checkBadgeJs(); } catch (e) { fail('badge.js: the checks threw ' + e.message); }
checkWatchdog();
checkSizes();
if (SIM) simulate();
// Not automated (spec 9.G): check these by hand before the booth opens.
console.log('Manual QA before opening\n' +
  '  the intro, up to Start / Scan your badge, fits above the fold at 375×548\n' +
  '  a badge scan on an iPhone (jsQR) and on an Android phone (BarcodeDetector)\n' +
  '  a full kiosk cycle on the tablet: scan, round, locked ticket, unlock, reset, scan\n' +
  '  the full guide in apps-script/staff-desk/README.md (2 tries per badge for the whole event; delete test rows after)');
warnings.forEach(function (w) { console.log('warn  ' + w); });
if (errors.length) {
  errors.forEach(function (e) { console.log('FAIL  ' + e); });
  console.log('\n' + errors.length + ' failure(s).');
  process.exit(1);
}
console.log('\nAll checks passed' + (SIM ? ', simulation included.' : '. Add --sim for the tier simulation.'));
