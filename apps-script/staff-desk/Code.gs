// Kleros booth at Devcon: one small web app behind the Curate game's tries, its Telegram check and newsletter contact
// step, and the staff merch desk at /staff/. Bound to the badge list Sheet (Extensions › Apps Script); the contacts go
// to a separate Sheet by id. Separate from the booth check-in backend (apps-script/Code.gs), which it never touches.
// Public actions (no key): status, start, finish, contact, tgcheck. Staff actions (staff key): check, claim, stats,
// setmode.
// Players verify as the Switches "Verify with" cell says: Telegram (the default: the bot @KlerosBoothBot, read by
// tgcheck and the 5-minute tgTick trigger polling getUpdates, no webhook), badge (a scanned Devcon badge) or none (a
// random id made on the phone).
// Whatever the mode, the "badge" field is the player id, 64 hex characters, so tries, claims and stats never change.
// Player data never goes to the contacts Sheet and contacts never go to the badge Sheet: the badge Sheet holds only
// a yes/no "contact given" flag per player. A Telegram ID sits in the contacts Sheet only (the player id is an HMAC
// of it). Setup (paste, run staffSetup, add TG_TOKEN, run telegramTest, deploy): apps-script/staff-desk/README.md.
// staffSetup also installs tgTick, so /stop is read even when no phone is verifying (and after the web app is archived).
var SCRIPT_V = '2026-11-03a';   // shown by doGet and status: tells the owner which pasted copy is live
var SHEET_ID = '';   // empty: the Sheet this script is bound to (the badge list); else that Sheet's id
var CONTACTS_SHEET_ID = '1LzRQ9IizuRMrqWAclFuY2v0bONkgxb2ezvXPbVsBtIc';   // the newsletter contacts, a separate Sheet
var CLAIMS = 'Badge claims', TRIES = 'Tries', SWITCHES = 'Switches', CONTACTS = 'Contacts';   // tab names
var CLAIM_HEAD = ['Time', 'Badge (hashed)', 'Tier', 'Item', 'Ticket', 'Staff', 'Id', 'How'];   // How added at the end only
var TRY_HEAD = ['Token', 'Day', 'Badge (hashed)', 'Try', 'Started', 'Finished', 'Score', 'Tier', 'App', 'Kiosk', 'Contact'];
var CONTACT_HEAD = ['Day', 'Contact', 'Kind', 'Curator info', 'Event', 'Source', 'Id'];   // no badge, score or token, ever
var SWITCH_ROWS = ['Merch open', 'Teal sold out', 'Purple sold out', 'Gold sold out', 'Verify with'];   // labels in Switches!A, read by label
var SWITCH_DEFAULTS = [true, false, false, false, 'Telegram'];   // a missing label takes its default; Verify with is text, not a checkbox
var MODES = ['telegram', 'badge', 'none'];   // how players verify: the Verify with cell lower-cased; anything else reads as telegram
var MODE_NAMES = ['Telegram', 'Badge', 'None'];   // the Verify with dropdown, in MODES order
var TIERS = [0, 300, 550, 750];   // = settings.js tiers (scripts/curate-check.js fails if they differ)
var TIER_KEYS = ['teal', 'purple', 'gold'];   // tier 1..3
var APPS = ['sights', 'countries', 'tokens'];   // deck ids (checked against decks.js)
var ENDED = ['done', 'time', 'quit'];   // how a round ended (accepted for the record; not stored)
var TRIES_PER_BADGE = 2;          // counted tries per badge for the whole event, never reset daily (= settings.js countedTries, checked)
var MAX_SCORE = 750;              // the best possible round under settings.js: answers only, no time bonus (checked)
var MIN_ROUND_MS = 8000;          // start → finish at least: banners plus 10 fast decisions
var MAX_SEND_MS = 6 * 60 * 60 * 1000;   // start → finish received at most: pauses and dead Wi-Fi fit in 6 h
var LOCK_MS = 6000;               // tryLock wait: the server answers 'busy' well before the client gives up (20 s)
var CAP_STARTS = 60, CAP_CONTACTS = 20, CAP_TGCHECKS = 2000;   // per minute, all players together: above it the reply is 'busy'
var SWITCH_CACHE_S = 20;          // switches are re-read at most every 20 s (an edit of Switches clears it at once)
var TZ = 'Asia/Kolkata';          // booth times and the Day column: Devcon VIII is in Mumbai
var TG_BOT = 'KlerosBoothBot';    // the bot's username (= settings.js telegram.bot): players open t.me/KlerosBoothBot?start=NONCE
var TG_API = 'https://api.telegram.org/bot';   // + token + '/' + method; the token lives in Script properties (TG_TOKEN)
var TG_POLL_S = 2;                // getUpdates runs at most every 2 s for all phones together
var TG_LOCK_MS = 4000;            // tryLock wait for the poll; a phone that doesn't get it just asks again
var TG_NONCE_S = 21600;           // a nonce's Telegram ID stays cached 6 h (the cache's maximum)
var TG_TICK_MIN = 5;              // tgTick reads the bot every 5 min when no phone does: /stop needs no verifying phone
var NONCE_RE = /^[A-Za-z0-9]{16,40}$/;   // the phone makes 24 such characters per verify link
// The bot's answers: plain text, no web3 words. Sent in the Telegram app, not shown by the game.
var TG_SAY = {
  verified: '✅ You’re verified for the Kleros Curate game. Go back to the game to play.\n\nYou’ll also get Kleros news here. We keep your Telegram ID only. Send /stop any time to leave, and we delete it.',
  help: 'This bot verifies players for the Kleros Curate game at the Kleros booth. Open devcon.kleros.io/curate and tap Verify with Telegram.',
  stopped: 'Done: you’re off Kleros news and your Telegram ID is deleted. Your game tries still count.',
  stopRetry: 'Sorry, that didn’t go through. Please send /stop again in a minute.'   // the delete failed: STOPPED only once it's gone
};

// All "now" comes from here, so the check script can move the clock.
function now_() { return new Date(); }

// ---- Transport ----
// Body: JSON text sent as text/plain (no CORS preflight). Every reply is JSON with ok; errors are identifier
// codes (lowercase letters only) that clients switch on, never prose and never a raw exception message.
var PUBLIC_ = { status: status_, start: start_, finish: finish_, contact: contact_, tgcheck: tgcheck_ };
var STAFF_ = { check: check_, claim: claim_, stats: stats_, setmode: setmode_ };

function doPost(e) {
  var action = '', d;
  try {
    try { d = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (x) { throw fail_('badrequest'); }
    if (!d || typeof d !== 'object') throw fail_('badrequest');
    action = String(d.action || '');
    if (PUBLIC_.hasOwnProperty(action)) return json_(withSwitches_(PUBLIC_[action](d)));
    if (!STAFF_.hasOwnProperty(action)) throw fail_('badrequest');
    if (!staffOk_(d.key)) throw fail_('wrongkey');
    return json_(withSwitches_(STAFF_[action](d)));
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    // Never the request body; for a contact not even the message (it carries a visitor's email or handle), nor for
    // tgcheck (its poll handles Telegram IDs and message text).
    Logger.log('error ' + action.slice(0, 12) + (action === 'contact' || action === 'tgcheck' ? '' : ': ' + (err && err.message)));
    return json_({ ok: false, error: 'server' });
  }
}
// Opening the /exec URL in a private window shows the script is alive and which pasted copy is live.
function doGet() { return json_({ ok: true, service: 'kleros booth', v: SCRIPT_V }); }

// An Error that becomes { ok: false, error: code }.
function fail_(code) { var e = new Error(code); e.code = code; return e; }
// Every action's reply carries the switches (open, soldOut and the verify mode), so the game and the desk always
// show the current state.
function withSwitches_(o) {
  var sw;
  if (o.open === undefined || o.soldOut === undefined || o.mode === undefined) {
    sw = switches_();
    if (o.open === undefined) o.open = sw.open;
    if (o.soldOut === undefined) o.soldOut = sw.soldOut;
    if (o.mode === undefined) o.mode = sw.mode;
  }
  return o;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- Lock and caps ----
// Writes run under one script lock, kept short: validation, caps and the switches come before it; inside it
// only the reads the decision needs, the write and a flush. A lock not had within LOCK_MS answers busy, and the
// client retries with the same token or id.
function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) throw fail_('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}
// A per-minute counter for all badges together: bounds sheet growth from a flood (a retry counts too).
function cap_(name, max) {
  var cache = CacheService.getScriptCache(), k = 'cap:' + name + ':' + Utilities.formatDate(now_(), TZ, 'yyyyMMddHHmm');
  var n = (Number(cache.get(k)) || 0) + 1;
  cache.put(k, String(n), 120);
  if (n > max) throw fail_('busy');
}

// ---- Validation ----
// The player id. Badge mode: the browser sends a salted SHA-256 of the badge's normalised id (site/curate/badge.js),
// never the code itself; none mode: the same hash of the phone's random id; telegram mode: tgId_, from tgcheck.
function badgeOf_(d) { var b = String(d.badge || ''); if (!/^[0-9a-f]{64}$/.test(b)) throw fail_('badbadge'); return b; }
function tokenOf_(d) { var t = String(d.token || ''); if (!/^[a-z0-9]{16,24}$/.test(t)) throw fail_('badtoken'); return t; }
function appOf_(d) { return APPS.indexOf(d.app) < 0 ? '' : d.app; }
function endedOf_(d) { return ENDED.indexOf(d.endedBy) < 0 ? '' : d.endedBy; }
// The score check as a code, or '' when fine (decided before the lock, raised in the spec's order inside it).
function scoreErr_(s) {
  if (typeof s !== 'number' || !isFinite(s) || Math.floor(s) !== s || s < 0) return 'badscore';
  return s > MAX_SCORE ? 'toohigh' : '';
}
// The tier is always derived here from the score; a tier sent by a browser is ignored.
function tierFor_(score) { var t = 0, i; for (i = 1; i < TIERS.length; i++) if (score >= TIERS[i]) t = i; return t; }
function cleanId_(v) { return String(v || '').replace(/[^a-z0-9]/g, '').slice(0, 24); }
// Visitor and staff text is stored as plain text: anything starting with = + - @ tab or CR can't run as a formula.
function plain_(v) { v = String(v == null ? '' : v).slice(0, 200); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }

// ---- Sheets ----
function book_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function contactsBook_() { return SpreadsheetApp.openById(CONTACTS_SHEET_ID); }
// A tab with its header row; made on first use, so a forgotten staffSetup never breaks an action. An existing
// empty tab (the contacts tab starts that way) gets its headers too.
function tab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); }
  return sh;
}
function rows_(sh, cols) { var n = sh.getLastRow() - 1; return n < 1 ? [] : sh.getRange(2, 1, n, cols).getValues(); }
// Reads (status, check, stats) write nothing: a missing tab reads as empty.
function peek_(name, cols) { var sh = book_().getSheetByName(name); return sh ? rows_(sh, cols) : []; }
// Ids and tokens are written as text, so an all-digit one is never turned into a number.
function text_(v) { return v ? "'" + v : ''; }
// Day is written as text ("'" + yyyy-MM-dd: a bare date string would be parsed into a Date); a Date that slipped
// in still reads right. A Date is told by its tag, not instanceof, so one from the check script's vm counts.
// The Tries Day column is a record only: tries never depend on it. dayKey_ also dates contacts and stats' handouts.
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function dayKey_(v) { return isDate_(v) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).replace(/^'/, ''); }
function hhmm_(v) { return Utilities.formatDate(new Date(v), TZ, 'HH:mm'); }
function dayName_(v) { return Utilities.formatDate(new Date(v), TZ, 'EEE d MMM'); }

// ---- Tries ----
// Tries columns: 0 Token, 1 Day, 2 Badge, 3 Try, 4 Started, 5 Finished, 6 Score, 7 Tier, 8 App, 9 Kiosk, 10 Contact.
function triesTab_() { return tab_(book_(), TRIES, TRY_HEAD); }
function triesRows_(sh) { return rows_(sh, TRY_HEAD.length); }
function done_(r) { return r[5] !== '' && r[5] !== null && r[6] !== '' && r[6] !== null; }
// The badge's best finished round over all days (ties: the earlier one), or null.
function best_(rows, badge) {
  var b = null, i, r;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (String(r[2]) !== badge || !done_(r)) continue;
    if (!b || Number(r[6]) > Number(b[6])) b = r;
  }
  if (!b) return null;
  return { score: Number(b[6]), tier: Number(b[7]) || 0, app: String(b[8] || ''), at: hhmm_(b[5]), day: dayName_(b[5]),
    code: 'C-' + String(b[0]).slice(0, 6).toUpperCase(), tryNo: Number(b[3]) || 0 };
}
// All the badge's counted tries, whatever their Day: TRIES_PER_BADGE is for the whole event, never per day.
function triesOf_(rows, badge) {
  var out = [], i;
  for (i = 0; i < rows.length; i++) if (String(rows[i][2]) === badge) out.push(rows[i]);
  return out;
}
// A badge has given its contact when any of its rows says yes.
function contactGiven_(rows, badge) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][2]) === badge && rows[i][10] === 'yes') return true;
  return false;
}
// What the game shows for a badge: tries used and left (of the whole event's), best round, contact given, merch collected.
function badgeState_(rows, badge, collected) {
  var n = triesOf_(rows, badge).length;
  return { triesUsed: n, left: Math.max(0, TRIES_PER_BADGE - n), best: best_(rows, badge), contact: contactGiven_(rows, badge),
    collected: !!collected };
}

// ---- Badge claims ----
// Claims columns: 0 Time, 1 Badge, 2 Tier, 3 Item, 4 Ticket, 5 Staff, 6 Id, 7 How. One row per merch item given.
function claimsTab_() { return tab_(book_(), CLAIMS, CLAIM_HEAD); }
function claimRows_(sh) { return rows_(sh, CLAIM_HEAD.length); }
function findBadge_(rows, badge) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][1]) === badge) return rows[i];
  return null;
}
function findTicket_(rows, ticket) {
  if (!ticket) return null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][4]) === ticket) return rows[i];
  return null;
}
function used_(row) { return { at: hhmm_(row[0]), day: dayName_(row[0]), tier: row[2], item: row[3] }; }
function collected_(badge) { return !!findBadge_(peek_(CLAIMS, CLAIM_HEAD.length), badge); }

// ---- Switches ----
// The owner's cutoff: Switches!A2:B10, matched by label (a sorted or moved row still reads right). A checkbox cell
// counts as on only when it is true (ticked); Verify with is text from its dropdown, and anything but Badge or None
// (blank, a typo) reads as Telegram. Cached briefly; onEdit, the menu and setmode clear the cache at once.
function switches_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('switches'), vals = SWITCH_DEFAULTS.slice(), seen = {};
  var sh, rows, i, k, out;
  // A copy cached by the previous version of this script has no mode: re-read it.
  if (hit) { try { out = JSON.parse(hit); if (out && out.mode) return out; } catch (x) { /* re-read below */ } }
  sh = book_().getSheetByName(SWITCHES);
  if (sh) {
    rows = sh.getRange(2, 1, 9, 2).getValues();
    for (i = 0; i < rows.length; i++) {
      k = SWITCH_ROWS.indexOf(String(rows[i][0]).trim());
      if (k >= 0 && !seen[k]) {
        seen[k] = true;
        vals[k] = typeof SWITCH_DEFAULTS[k] === 'boolean' ? rows[i][1] === true : String(rows[i][1]).trim();
      }
    }
  }
  k = String(vals[4]).toLowerCase();
  out = { open: vals[0], soldOut: [], mode: MODES.indexOf(k) < 0 ? 'telegram' : k };
  for (i = 0; i < TIER_KEYS.length; i++) if (vals[i + 1]) out.soldOut.push(TIER_KEYS[i]);
  cache.put('switches', JSON.stringify(out), SWITCH_CACHE_S);
  return out;
}

// ---- Public: status ----
// The title, the intro and the scanner ask this. No lock, no write. Anyone holding a player id can read its
// state (accepted: README, Accepted risk). tg says whether the bot token is set (Telegram can verify at all).
function status_(d) {
  var badge = d.badge ? badgeOf_(d) : '', sw = switches_();
  var out = { ok: true, v: SCRIPT_V, tiers: TIERS, maxScore: MAX_SCORE, open: sw.open, soldOut: sw.soldOut,
    mode: sw.mode, tg: !!tgToken_(), perBadge: TRIES_PER_BADGE, badge: null };
  if (badge) out.badge = badgeState_(peek_(TRIES, TRY_HEAD.length), badge, collected_(badge));
  return out;
}

// ---- Public: start ----
// Spends a try: called when the player taps Start (never on scan). A try counts when it starts; quitting never
// refunds it. The client makes the token; a retried start with the same token never spends a second try.
// A badge has TRIES_PER_BADGE for the whole event: a new day gives no new tries (Day is only recorded).
// Telegram mode: only an id signed by tgcheck can start (no row otherwise). A signed id gave its Telegram ID to the
// contacts Sheet when it verified, so its row says Contact yes at once, in any mode.
function start_(d) {
  var badge = badgeOf_(d), token = tokenOf_(d), app = appOf_(d), kiosk = d.kiosk === true, signed, sw, r, st, out;
  cap_('start', CAP_STARTS);
  sw = switches_();
  signed = sigOk_(badge, d.sig);
  // Returned, not thrown, so the reply carries the mode: a phone still in another mode learns it here.
  if (sw.mode === 'telegram' && !signed) return { ok: false, error: 'unverified' };
  r = locked_(function () {
    var sh = triesTab_(), rows = triesRows_(sh), claims = claimRows_(claimsTab_()), day = dayKey_(now_()), i, n, row;
    var collected = !!findBadge_(claims, badge);
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) !== token) continue;
      if (String(rows[i][2]) !== badge) throw fail_('badtoken');
      return { rows: rows, collected: collected, counted: true, tryNo: Number(rows[i][3]) || 1 };
    }
    if (collected) return { rows: rows, collected: true, counted: false, reason: 'collected' };
    if (!sw.open) return { rows: rows, collected: false, counted: false, reason: 'paused' };
    n = triesOf_(rows, badge).length;
    if (n >= TRIES_PER_BADGE) return { rows: rows, collected: false, counted: false, reason: 'limit' };
    row = [text_(token), "'" + day, badge, n + 1, now_(), '', '', '', app, kiosk ? 'yes' : '', signed ? 'yes' : ''];
    sh.appendRow(row);
    SpreadsheetApp.flush();
    rows.push([token, day, badge, n + 1, row[4], '', '', '', app, row[9], row[10]]);   // as read back
    return { rows: rows, collected: false, counted: true, tryNo: n + 1 };
  });
  st = badgeState_(r.rows, badge, r.collected);
  out = { ok: true, counted: r.counted, perBadge: TRIES_PER_BADGE, left: st.left, best: st.best, contact: st.contact,
    collected: st.collected, open: sw.open, soldOut: sw.soldOut, mode: sw.mode };
  if (r.counted) out.tryNo = r.tryNo; else out.reason = r.reason;
  return out;
}

// ---- Public: finish ----
// Records the round's score once per token, between MIN_ROUND_MS and MAX_SEND_MS after its start (the window
// bounds delivery, not play: a paused or offline round still saves). The tier is derived here.
// relaxed and endedBy are accepted but not stored (no column needs them).
function finish_(d) {
  var token = tokenOf_(d), score = d.score, bad = scoreErr_(score), r, rows, st;
  r = locked_(function () {
    var sh = triesTab_(), all = triesRows_(sh), i, row, now, ms, tier;
    for (i = 0; i < all.length; i++) if (String(all[i][0]) === token) break;
    if (i === all.length) throw fail_('badtoken');
    row = all[i];
    // Already finished: the same score is a retry whose reply was lost (checked before the time window).
    if (done_(row)) { if (Number(row[6]) === score) return { rows: all, row: row }; throw fail_('used'); }
    now = now_();
    ms = now.getTime() - new Date(row[4]).getTime();
    if (ms < MIN_ROUND_MS) throw fail_('early');
    if (ms > MAX_SEND_MS) throw fail_('late');
    if (bad) throw fail_(bad);
    tier = tierFor_(score);
    sh.getRange(i + 2, 6, 1, 3).setValues([[now, score, tier]]);   // Finished, Score, Tier
    SpreadsheetApp.flush();
    row[5] = now; row[6] = score; row[7] = tier;
    return { rows: all, row: row };
  });
  rows = r.rows;
  st = badgeState_(rows, String(r.row[2]), collected_(String(r.row[2])));   // best already includes this round
  return { ok: true, score: Number(r.row[6]), tier: Number(r.row[7]) || 0, best: st.best, contact: st.contact,
    collected: st.collected, left: st.left, perBadge: TRIES_PER_BADGE };
}

// ---- Public: contact ----
// The newsletter contact (email or @Telegram) that unlocks a ticket above stickers, also from a later visit (no
// token: the badge's own finished round is the proof). The contact goes to the contacts Sheet only; the badge
// Sheet gets a yes in its Contact column. Nothing of this request is ever logged.
function contact_(d) {
  var badge = badgeOf_(d), c = String(d.contact == null ? '' : d.contact).trim(), id = cleanId_(d.id), kind;
  kind = c.length > 120 ? '' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) ? 'email' :
    /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(c) ? 'telegram' : '';
  if (!kind) throw fail_('badcontact');
  cap_('contact', CAP_CONTACTS);
  locked_(function () {
    var sh = triesTab_(), rows = triesRows_(sh), cache = CacheService.getScriptCache(), last = -1, earned = false;
    var given = false, i;
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i][2]) !== badge) continue;
      last = i;
      if (rows[i][10] === 'yes') given = true;
      if (done_(rows[i]) && Number(rows[i][7]) >= 1) earned = true;
    }
    // No contact is ever taken for a badge without an earned ticket: blocks scripted lists of other people's emails.
    if (!earned) throw fail_('notry');
    if (given) return;   // one contacts row per badge (also a retry whose reply was lost)
    // A cache hit means the contacts row was written but the flag write failed: don't add it twice.
    if (!(id.length >= 6 && cache.get('contact:' + id))) {
      // Booth day only (no time) and no kiosk flag: the row can't be matched to a Tries row by timing.
      tab_(contactsBook_(), CONTACTS, CONTACT_HEAD).appendRow(["'" + dayKey_(now_()), plain_(c), kind,
        d.curator === true ? 'yes' : '', plain_(String(d.event == null ? '' : d.event).slice(0, 60)), 'curate', text_(id)]);
      if (id.length >= 6) cache.put('contact:' + id, '1', 21600);
    }
    sh.getRange(last + 2, 11, 1, 1).setValue('yes');   // Contact on the badge's latest try
    SpreadsheetApp.flush();
  });
  return { ok: true, contact: true };
}

// ---- Public: tgcheck ----
// The phone asks every few seconds whether its nonce came back through the bot. Verified: the player id and its
// signature, which the phone keeps, sends with start and puts in its ticket QR. Until the nonce is cached, this call
// may poll Telegram (tgPollOnce_: at most once every TG_POLL_S for all phones and tgTick together). A phone that
// doesn't get the poll's lock hears "not yet" and asks again; so does one whose poll failed, so phones keep asking.
// A nonce is a bearer secret for 6 h: whoever holds the link verifies as whoever tapped Start (accepted: README).
function tgcheck_(d) {
  var nonce = String(d.nonce || ''), cache, tg, id;
  if (!NONCE_RE.test(nonce)) throw fail_('badrequest');
  if (!tgToken_()) throw fail_('notelegram');
  cap_('tgcheck', CAP_TGCHECKS);
  cache = CacheService.getScriptCache();
  tg = cache.get('tgn:' + nonce);
  if (!tg && !cache.get('tg:polled')) {
    try { tgPollOnce_(); } catch (x) { Logger.log('tgcheck: the poll failed'); }   // never its message (Telegram IDs, text)
    tg = cache.get('tgn:' + nonce);
  }
  if (!tg) return { ok: true, verified: false };
  id = tgId_(tg);
  return { ok: true, verified: true, badge: id, sig: sig_(id) };
}

// ---- Telegram ----
// Telegram mode: the phone makes a nonce and opens t.me/KlerosBoothBot?start=NONCE; the player taps Start and the
// bot gets "/start NONCE" from their Telegram user ID. No webhook: tgcheck and the tgTick trigger poll getUpdates. The
// player id is an HMAC of that ID under TG_SECRET (Script properties), so the raw ID never reaches the badge Sheet or
// the game; only the contacts Sheet holds it, for Kleros news, until the player sends /stop.
// The bot token, nonces, Telegram IDs and message text are never logged.
function tgToken_() { return String(PropertiesService.getScriptProperties().getProperty('TG_TOKEN') || '').trim(); }
// The HMAC key: made by staffSetup, or here on first use. Changing it gives every Telegram player new ids, and so
// new tries: never change it during the event.
function tgSecret_() {
  var props = PropertiesService.getScriptProperties(), k = props.getProperty('TG_SECRET');
  if (!k) { k = newSecret_(); props.setProperty('TG_SECRET', k); }
  return k;
}
// 32 random letters and digits, from two random UUIDs (a secure random source, unlike Math.random).
function newSecret_() {
  var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '', i;
  var b = Utilities.computeHmacSha256Signature(Utilities.getUuid(), Utilities.getUuid());
  for (i = 0; i < 32; i++) s += a.charAt(((b[i] + 256) % 256) % a.length);
  return s;
}
// HMAC-SHA256 under TG_SECRET as lowercase hex. Apps Script returns signed bytes (-128..127).
function hmacHex_(msg) {
  var b = Utilities.computeHmacSha256Signature(msg, tgSecret_()), s = '', i, v;
  for (i = 0; i < b.length; i++) { v = (b[i] + 256) % 256; s += (v < 16 ? '0' : '') + v.toString(16); }
  return s;
}
// A Telegram user ID → its player id (64 hex, like a badge hash), and a player id → its signature (32 hex).
function tgId_(tgUserId) { return hmacHex_('tg|' + tgUserId); }
function sig_(id) { return hmacHex_('sig|' + id).slice(0, 32); }
// Whether sig is this player id's signature: compared over every character, whatever differs first.
function sigOk_(badge, sig) {
  var got = String(sig || ''), want, diff = 0, i;
  if (!/^[0-9a-f]{32}$/.test(got) || !/^[0-9a-f]{64}$/.test(String(badge))) return false;
  want = sig_(String(badge));
  for (i = 0; i < 32; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
// One Bot API GET: Telegram's reply, or { ok: false } when it can't be reached. A fetch error is never rethrown or
// logged: its message can carry the URL, and so the token.
function tgCall_(token, method, query) {
  var res, o;
  try {
    res = UrlFetchApp.fetch(TG_API + token + '/' + method + (query ? '?' + query : ''), { muteHttpExceptions: true });
    o = JSON.parse(res.getContentText());
  } catch (x) { return { ok: false, description: 'no answer from Telegram' }; }
  if (!o || typeof o !== 'object') return { ok: false, description: 'no answer from Telegram' };
  if (res.getResponseCode() !== 200) o.ok = false;
  return o;
}
// One read of the bot's messages, for tgcheck and the tgTick trigger alike: at most once every TG_POLL_S for all of
// them, under the document lock (never the script lock, so starts, finishes and claims never wait on Telegram). Both
// take this same lock, so two runs never read one TG_OFFSET at once. Not had within TG_LOCK_MS: no read this time.
function tgPollOnce_() {
  // A web app may get no document lock (null outside a document's context): the user lock is then the same kind
  // of separate lock (every run executes as the owner).
  var cache = CacheService.getScriptCache(), lock = LockService.getDocumentLock() || LockService.getUserLock();
  if (!lock.tryLock(TG_LOCK_MS)) return;
  try {
    if (!cache.get('tg:polled')) { try { tgPoll_(); } finally { cache.put('tg:polled', '1', TG_POLL_S); } }
  } finally { lock.releaseLock(); }
}
// Time-driven, every TG_TICK_MIN (installed by staffSetup): reads the bot when no phone does (badge or none mode, a
// quiet spell, after Devcon), so /stop always deletes the ID within minutes. Telegram keeps unread messages 24 h only.
function tgTick() {
  if (!tgToken_()) return;
  try { tgPollOnce_(); } catch (x) { Logger.log('tgTick: the poll failed'); }   // never its message
}
// Installs tgTick once (a second staffSetup finds it and adds none).
function tgTrigger_() {
  var t = ScriptApp.getProjectTriggers(), i;
  for (i = 0; i < t.length; i++) if (t[i].getHandlerFunction() === 'tgTick') return;
  ScriptApp.newTrigger('tgTick').timeBased().everyMinutes(TG_TICK_MIN).create();
}
// Reads the bot's new private messages once and answers them: "/start NONCE" caches the nonce's Telegram ID for
// tgcheck and adds the ID to the contacts Sheet; "/stop" deletes it; anything else gets the help text. TG_OFFSET
// (Script properties) marks what was read. Telegram down or refusing: nothing changes, the next poll tries again.
// The contacts Sheet only feeds Kleros news, so a write to it that fails never stops verifying or the offset: a
// failed add waits in the cache ('tgq', 6 h, like the nonces) for the next poll, and a failed /stop asks the player
// to send it again (STOPPED only once the rows are gone; a /stop also drops a waiting add, so it never comes back).
function tgPoll_() {
  var props = PropertiesService.getScriptProperties(), token = tgToken_(), offset = Number(props.getProperty('TG_OFFSET')) || 0;
  var cache = CacheService.getScriptCache(), next = offset, out = [], bot = '@' + TG_BOT.toLowerCase(), book = {};
  var q = tgQueue_(), queued = q.length, left = [], res, i, u, m, w, cmd, id;
  for (i = 0; i < q.length; i++) { try { addTgContact_(q[i], book); } catch (x) { left.push(q[i]); } }   // last poll's failed adds
  q = left;
  res = tgCall_(token, 'getUpdates', 'offset=' + offset + '&timeout=0&limit=100&allowed_updates=' + encodeURIComponent('["message"]'));
  if (res.ok && Array.isArray(res.result)) {
    for (i = 0; i < res.result.length; i++) {
      u = res.result[i] || {};
      if (typeof u.update_id === 'number' && u.update_id >= next) next = u.update_id + 1;
      m = u.message;
      if (!m || !m.chat || m.chat.type !== 'private' || !m.from || m.from.is_bot) continue;
      w = (typeof m.text === 'string' ? m.text.trim() : '').split(/\s+/);
      cmd = w[0].toLowerCase();
      id = String(m.from.id);
      if (cmd.slice(-bot.length) === bot) cmd = cmd.slice(0, -bot.length);   // /start@KlerosBoothBot
      if (cmd === '/start' && w.length === 2 && NONCE_RE.test(w[1])) {
        cache.put('tgn:' + w[1], id, TG_NONCE_S);
        try { addTgContact_(id, book); } catch (x) { if (q.indexOf(id) < 0) q.push(id); }
        out.push([m.chat.id, TG_SAY.verified]);
      } else if (cmd === '/stop') {
        q = q.filter(function (x) { return x !== id; });
        try { removeTgContact_(id, book); out.push([m.chat.id, TG_SAY.stopped]); } catch (x) { out.push([m.chat.id, TG_SAY.stopRetry]); }
      } else {
        out.push([m.chat.id, TG_SAY.help]);   // also /start without a valid nonce: no contact saved
      }
    }
    if (next !== offset) props.setProperty('TG_OFFSET', String(next));
  }
  if (q.length || queued) tgQueueSave_(q);
  tgSend_(token, out);
}
// Telegram IDs whose contacts row failed to save, for the next poll (cache only: 6 h, the most a nonce lasts too).
function tgQueue_() {
  var q;
  try { q = JSON.parse(CacheService.getScriptCache().get('tgq') || '[]'); } catch (x) { q = []; }
  return Array.isArray(q) ? q.map(String) : [];
}
function tgQueueSave_(q) {
  var cache = CacheService.getScriptCache();
  if (q.length) cache.put('tgq', JSON.stringify(q.slice(-500)), TG_NONCE_S); else cache.remove('tgq');
}
// The bot's answers, sent together. A lost answer is not retried: the game shows the result anyway.
function tgSend_(token, out) {
  var reqs = [], i;
  for (i = 0; i < out.length; i++) {
    reqs.push({ url: TG_API + token + '/sendMessage', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: out[i][0], text: out[i][1], disable_web_page_preview: true }) });
  }
  if (!reqs.length) return;
  try { UrlFetchApp.fetchAll(reqs); } catch (x) { /* never rethrown or logged: its message can carry the token */ }
}
// The contacts tab for one poll (book: {}), opened once: a sheet that can't be opened isn't tried again in that poll,
// so a broken contacts Sheet costs one failed open per poll, not one per message. Throws while it can't be had.
function tgBook_(book) {
  if (!book.sh && !book.bad) {
    try { book.sh = tab_(contactsBook_(), CONTACTS, CONTACT_HEAD); } catch (x) { book.bad = true; }
  }
  if (!book.sh) throw new Error('contacts sheet');
  return book.sh;
}
// A verified Telegram ID in the contacts Sheet, once (Kind 'telegram id'; no player id, score or token, as ever).
function addTgContact_(tgId, book) {
  var id = String(tgId), cache = CacheService.getScriptCache(), sh, rows, i;
  if (cache.get('tgc:' + id)) return;
  sh = tgBook_(book || {});
  rows = rows_(sh, 3);
  for (i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).replace(/^'/, '') === id && String(rows[i][2]) === 'telegram id') { cache.put('tgc:' + id, '1', 21600); return; }
  }
  sh.appendRow(["'" + dayKey_(now_()), text_(id), 'telegram id', '', 'Devcon VIII Mumbai', 'curate bot', '']);
  cache.put('tgc:' + id, '1', 21600);
}
// /stop: every contacts row of this Telegram ID goes (bottom up, so the row numbers ahead stay right).
function removeTgContact_(tgId, book) {
  var id = String(tgId), sh = tgBook_(book || {}), rows = rows_(sh, 3), i;
  for (i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]).replace(/^'/, '') === id && String(rows[i][2]) === 'telegram id') sh.deleteRow(i + 2);
  }
  CacheService.getScriptCache().remove('tgc:' + id);
}

// ---- Staff: check ----
// What the desk shows after a scan (no write): red when the player already got merch; else the game's best round,
// whether the contact was given, and the tier it earns. A game tier counts at the desk only with the contact given.
// The desk sends the player id from a badge or a ticket QR (with the ticket's signature, if any), or a typed C- code.
// The reply names the resolved id, and the desk claims with it.
function check_(d) {
  var badge, claim, st, out;
  if (d.code != null && d.code !== '') badge = codeBadge_(d.code);
  else {
    badge = badgeOf_(d);
    if (d.sig && !sigOk_(badge, d.sig)) throw fail_('badticket');
  }
  claim = findBadge_(peek_(CLAIMS, CLAIM_HEAD.length), badge);
  st = badgeState_(peek_(TRIES, TRY_HEAD.length), badge, !!claim);
  out = { ok: true, badge: badge, used: !!claim, game: st.best, contact: st.contact, triesUsed: st.triesUsed, earned: earned_(st) };
  if (claim) out.last = used_(claim);
  return out;
}
// A ticket's C- code (any case, spaces, no dash) → the player id of the Tries row whose Token starts with it. A
// finished row wins: a ticket always shows a finished round's code.
function codeBadge_(code) {
  var c = String(code).toLowerCase().replace(/[\s-]/g, ''), rows, i, any = '';
  if (!/^c[a-z0-9]{6}$/.test(c)) throw fail_('nocode');
  c = c.slice(1);
  rows = peek_(TRIES, TRY_HEAD.length);
  for (i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).slice(0, 6).toLowerCase() !== c) continue;
    if (done_(rows[i])) return String(rows[i][2]);
    if (!any) any = String(rows[i][2]);
  }
  if (!any) throw fail_('nocode');
  return any;
}
function earned_(st) { return st.contact && st.best ? st.best.tier : 0; }

// ---- Staff: claim ----
// Check and save under one lock, so two staff phones can't both give merch for the same badge. A collected badge
// is red before the switches are looked at, so it stays red while merch is paused.
function claim_(d) {
  var badge = badgeOf_(d), tier = String(d.tier || ''), k = TIER_KEYS.indexOf(tier) + 1, id = cleanId_(d.id);
  var ticket = String(d.ticket || '').toUpperCase().trim(), sw;
  if (!k || (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket))) throw fail_('badrequest');
  sw = switches_();
  return locked_(function () {
    var sh = claimsTab_(), rows = claimRows_(sh), i, row, st;
    // A retried claim that was already saved stays green (no cache: the sheet is the record), and says what was
    // saved: staff may have tapped another item since.
    if (id.length >= 6) for (i = 0; i < rows.length; i++) {
      if (String(rows[i][6]) === id && String(rows[i][1]) === badge) return { ok: true, again: true, tier: String(rows[i][2]), item: String(rows[i][3]) };
    }
    row = findBadge_(rows, badge);
    if (row) return { ok: false, used: true, last: used_(row) };
    row = findTicket_(rows, ticket);
    if (row) return { ok: false, ticketUsed: true, last: used_(row) };
    if (!sw.open) return { ok: false, error: 'paused' };
    if (sw.soldOut.indexOf(tier) >= 0) return { ok: false, error: 'soldout' };
    // A check-in ticket (K-) allows any open tier: staff read its colour. Otherwise the game must have earned it.
    if (ticket.indexOf('K-') !== 0) {
      st = badgeState_(triesRows_(triesTab_()), badge, false);
      if (k > earned_(st)) return { ok: false, error: 'notearned', earned: earned_(st), contact: st.contact };
    }
    sh.appendRow([now_(), badge, tier, plain_(String(d.item || '').slice(0, 60)), ticket,
      plain_(String(d.staff || '').slice(0, 40)), text_(id), d.how === 'typed' ? 'typed' : 'scan']);
    SpreadsheetApp.flush();   // written before the lock is released, so the next phone's check sees it
    return { ok: true };
  });
}

// ---- Staff: stats ----
// Today's handouts per tier, for pacing the stock.
function stats_() {
  var rows = peek_(CLAIMS, 3), k = dayKey_(now_()), out = { teal: 0, purple: 0, gold: 0 }, i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i][0] !== '' && dayKey_(new Date(rows[i][0])) === k && out.hasOwnProperty(rows[i][2])) out[rows[i][2]]++;
  }
  return { ok: true, today: out, v: SCRIPT_V };
}

// ---- Staff: setmode ----
// The desk's hidden Advanced control (behind a warning and a typed CHANGE): how every player verifies, on every
// phone, within a minute. Logged with the staff name, so the owner can see who changed it.
function setmode_(d) {
  var mode = String(d.mode || '');
  if (MODES.indexOf(mode) < 0) throw fail_('badrequest');
  writeMode_(mode);
  Logger.log('mode ' + mode + ' by ' + plain_(String(d.staff || '').slice(0, 40)));
  return { ok: true, mode: mode };
}

// ---- Staff key ----
function staffOk_(k) {
  var want = PropertiesService.getScriptProperties().getProperty('STAFF_KEY');
  return !!want && String(k || '') === want;
}
function newKey_() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k = '', i;
  for (i = 0; i < 16; i++) k += a.charAt(Math.floor(Math.random() * a.length));
  return k;
}
// Makes a new key (after Devcon, or if it leaked): every staff phone then asks for it again.
function newStaffKey() {
  var k = newKey_();
  PropertiesService.getScriptProperties().setProperty('STAFF_KEY', k);
  Logger.log('Staff key: ' + k);
}

// ---- Setup ----
// The one function the owner runs (Extensions › Apps Script › staffSetup › Run). Safe to run again: it never
// deletes or reorders tabs or rows, keeps an existing staff key and Telegram secret, and adds the tgTick trigger once.
function staffSetup() {
  var ss = book_(), cs = contactsBook_(), props = PropertiesService.getScriptProperties(), key = props.getProperty('STAFF_KEY');
  var claims = tab_(ss, CLAIMS, CLAIM_HEAD), contacts;
  // An older 7-column header row gets How at the end; old rows keep it empty.
  if (claims.getRange(1, 1, 1, 1).getValues()[0][0] === 'Time' && claims.getRange(1, 8, 1, 1).getValues()[0][0] === '') {
    claims.getRange(1, 8, 1, 1).setValue('How');
  }
  claims.setFrozenRows(1);
  protect_(claims);
  protect_(tab_(ss, TRIES, TRY_HEAD));
  protect_(switchesTab_(ss));
  contacts = tab_(cs, CONTACTS, CONTACT_HEAD);
  contacts.setFrozenRows(1);
  protect_(contacts);
  // Owner-only is real only when nobody else can edit the file.
  if (ss.getEditors().length > 1 || cs.getEditors().length > 1) {
    Logger.log('Warning: other people can edit this sheet. Share it with nobody else, or they can flip the switches and read the staff key.');
  }
  if (!key) { key = newKey_(); props.setProperty('STAFF_KEY', key); }
  tgSecret_();   // made once, never logged
  tgTrigger_();   // once: reads /stop every TG_TICK_MIN, also when no phone is verifying
  CacheService.getScriptCache().remove('switches');
  Logger.log('Staff key: ' + key);
  Logger.log('Ready (' + SCRIPT_V + '): Badge claims, Tries, Switches (with Verify with); Contacts in the contacts sheet.');
  Logger.log(tgToken_() ? 'Telegram: ready' :
    'Telegram: add TG_TOKEN in Project Settings › Script properties, then run telegramTest');
  Logger.log('Telegram: the bot is read every ' + TG_TICK_MIN + ' minutes (trigger tgTick), so /stop works without a verifying phone.');
}
// Run after pasting the bot token into Script properties (TG_TOKEN): checks it with getMe, then removes any webhook
// (getUpdates fails while one is set). Logs the bot's username or Telegram's error, never the token.
function telegramTest() {
  var token = tgToken_(), me, hook;
  if (!token) { Logger.log('Telegram: add TG_TOKEN in Project Settings › Script properties, then run telegramTest'); return; }
  me = tgCall_(token, 'getMe', '');
  if (!me.ok || !me.result) { Logger.log('Telegram failed: ' + tgSays_(me, token)); return; }
  Logger.log('Telegram OK: @' + me.result.username);
  if (String(me.result.username).toLowerCase() !== TG_BOT.toLowerCase()) {
    Logger.log('Warning: this token is for @' + me.result.username + ', but the game links to @' + TG_BOT + '.');
  }
  hook = tgCall_(token, 'deleteWebhook', '');
  if (!hook.ok) Logger.log('Telegram failed (deleteWebhook): ' + tgSays_(hook, token));
}
// Telegram's error text, cut short, with the token blanked should it ever appear.
function tgSays_(o, token) { return String(o.description || 'no answer').split(token).join('…').slice(0, 200); }
// Only the owner can edit the tab (the owner can't be removed from a protection, so it stays).
function protect_(sh) {
  var p = sh.protect();
  p.setDescription('Owner only');
  p.removeEditors(p.getEditors());
  p.setWarningOnly(false);
}

// ---- Switches tab and menu ----
var SWITCH_NOTE = 'Tick or untick: the game and the desk follow within a minute. A tick stays on until you untick it. ' +
  'Verify with changes how every player verifies, on every phone: leave it on Telegram.';
var TIER_NAMES_ = ['Teal', 'Purple', 'Gold'];
var MODE_SAY_ = { telegram: 'Telegram', badge: 'their badge', none: 'no check' };
// The Switches tab, made with its rows and checkboxes when missing; a missing label row is added with its default.
function switchesTab_(ss) {
  var sh = ss.getSheetByName(SWITCHES), i;
  if (!sh) {
    sh = ss.insertSheet(SWITCHES);
    sh.appendRow(['Switch', 'On']);
    sh.setFrozenRows(1);
    sh.getRange(7, 1, 1, 1).setValue(SWITCH_NOTE);
  }
  for (i = 0; i < SWITCH_ROWS.length; i++) switchRow_(sh, i);
  return sh;
}
// The sheet row (2..10) of switch i, found by label; when missing, written into the first free row (never row 7,
// the note) with its default: a checkbox (checkboxes first: inserting them clears the cell to unticked), or for
// Verify with a text cell with a Telegram / Badge / None dropdown.
function switchRow_(sh, i) {
  var rows = sh.getRange(2, 1, 9, 1).getValues(), free = -1, j;
  for (j = 0; j < rows.length; j++) {
    if (String(rows[j][0]).trim() === SWITCH_ROWS[i]) return j + 2;
    if (free < 0 && String(rows[j][0]) === '' && j + 2 !== 7) free = j + 2;
  }
  if (free < 0) throw new Error('Switches: no free row in A2:A10 for ' + SWITCH_ROWS[i]);
  sh.getRange(free, 1, 1, 1).setValue(SWITCH_ROWS[i]);
  if (typeof SWITCH_DEFAULTS[i] === 'boolean') sh.getRange(free, 2, 1, 1).insertCheckboxes();
  else sh.getRange(free, 2, 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MODE_NAMES, true).build());
  sh.getRange(free, 2, 1, 1).setValue(SWITCH_DEFAULTS[i]);
  return free;
}
// Writes the Verify with cell (mode: one of MODES) and clears the cache, so every phone follows within a minute.
function writeMode_(mode) {
  var sh = switchesTab_(book_());
  sh.getRange(switchRow_(sh, 4), 2, 1, 1).setValue(MODE_NAMES[MODES.indexOf(mode)]);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('switches');
}
// The menu's three Verify with items: the owner's own way to change it (the desk has one too, well hidden).
function menuMode_(mode) {
  writeMode_(mode);
  book_().toast('Players now verify with ' + MODE_SAY_[mode] + '. Every phone follows within a minute.');
}
function verifyTelegram() { menuMode_('telegram'); }
function verifyBadge() { menuMode_('badge'); }
function verifyNone() { menuMode_('none'); }
// Writes switch i (on: true/false, or null to flip it), clears the cache so it applies at once, and toasts.
function setSwitch_(i, on) {
  var ss = book_(), sh = switchesTab_(ss), row = switchRow_(sh, i), name;
  if (on === null) on = sh.getRange(row, 2, 1, 1).getValues()[0][0] !== true;
  sh.getRange(row, 2, 1, 1).setValue(on);
  CacheService.getScriptCache().remove('switches');
  name = TIER_NAMES_[i - 1];
  ss.toast(i === 0 ? (on ? 'Merch open.' : 'Merch paused. The game and the desk follow within a minute.') :
    on ? name + ' sold out. Stays on until you untick it.' : name + ' back in.');
}
function pauseMerch() { setSwitch_(0, false); }
function openMerch() { setSwitch_(0, true); }
function toggleTeal() { setSwitch_(1, null); }
function togglePurple() { setSwitch_(2, null); }
function toggleGold() { setSwitch_(3, null); }
function showStaffKey() {
  var k = PropertiesService.getScriptProperties().getProperty('STAFF_KEY');
  SpreadsheetApp.getUi().alert(k ? 'Staff key: ' + k + '\nGive it to the booth staff only, never to visitors.' :
    'No staff key yet. Run staffSetup first (Extensions › Apps Script).');
}
// Simple trigger: the Kleros booth menu (browser Sheets only; the phone app has no custom menus).
function onOpen() {
  try {
    var m = SpreadsheetApp.getUi().createMenu('Kleros booth');
    m.addItem('Pause merch', 'pauseMerch');
    m.addItem('Reopen merch', 'openMerch');
    m.addSeparator();
    m.addItem('Teal: sold out / back', 'toggleTeal');
    m.addItem('Purple: sold out / back', 'togglePurple');
    m.addItem('Gold: sold out / back', 'toggleGold');
    m.addSeparator();
    m.addItem('Players verify with Telegram', 'verifyTelegram');
    m.addItem('Players verify with badge', 'verifyBadge');
    m.addItem('Players verify with no check', 'verifyNone');
    m.addSeparator();
    m.addItem('Show staff key', 'showStaffKey');
    m.addToUi();
  } catch (x) { /* a simple trigger must never throw at the owner */ }
}
// Simple trigger: a box ticked or a Verify with picked by hand (also from the Sheets phone app) applies at once.
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === SWITCHES) CacheService.getScriptCache().remove('switches');
  } catch (x) { /* never throw at the owner */ }
}
