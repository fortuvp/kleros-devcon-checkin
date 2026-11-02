// Kleros booth at Devcon: one small web app behind the Curate game's badge tries, its newsletter contact step and
// the staff merch desk at /staff/. Bound to the badge list Sheet (Extensions › Apps Script); the contacts go to a
// separate Sheet by id. Separate from the booth check-in backend (apps-script/Code.gs), which it never touches.
// Public actions (no key): status, start, finish, contact. Staff actions (staff key): check, claim, stats.
// Badge data never goes to the contacts Sheet and contacts never go to the badge Sheet: the badge Sheet holds only
// a yes/no "contact given" flag per badge. Setup (paste, run staffSetup, deploy): apps-script/staff-desk/README.md.
var SCRIPT_V = '2026-11-02b';   // shown by doGet and status: tells the owner which pasted copy is live
var SHEET_ID = '';   // empty: the Sheet this script is bound to (the badge list); else that Sheet's id
var CONTACTS_SHEET_ID = '1LzRQ9IizuRMrqWAclFuY2v0bONkgxb2ezvXPbVsBtIc';   // the newsletter contacts, a separate Sheet
var CLAIMS = 'Badge claims', TRIES = 'Tries', SWITCHES = 'Switches', CONTACTS = 'Contacts';   // tab names
var CLAIM_HEAD = ['Time', 'Badge (hashed)', 'Tier', 'Item', 'Ticket', 'Staff', 'Id', 'How'];   // How added at the end only
var TRY_HEAD = ['Token', 'Day', 'Badge (hashed)', 'Try', 'Started', 'Finished', 'Score', 'Tier', 'App', 'Kiosk', 'Contact'];
var CONTACT_HEAD = ['Day', 'Contact', 'Kind', 'Curator info', 'Event', 'Source', 'Id'];   // no badge, score or token, ever
var SWITCH_ROWS = ['Merch open', 'Teal sold out', 'Purple sold out', 'Gold sold out'];   // labels in Switches!A, read by label
var SWITCH_DEFAULTS = [true, false, false, false];   // a missing label takes its default
var TIERS = [0, 300, 550, 750];   // = settings.js tiers (scripts/curate-check.js fails if they differ)
var TIER_KEYS = ['teal', 'purple', 'gold'];   // tier 1..3
var APPS = ['sights', 'countries', 'tokens'];   // deck ids (checked against decks.js)
var ENDED = ['done', 'time', 'quit'];   // how a round ended (accepted for the record; not stored)
var PER_DAY = 2;                  // = settings.js countedPerDay (checked)
var MAX_SCORE = 750;              // the best possible round under settings.js: answers only, no time bonus (checked)
var MIN_ROUND_MS = 8000;          // start → finish at least: banners plus 10 fast decisions
var MAX_SEND_MS = 6 * 60 * 60 * 1000;   // start → finish received at most: pauses and dead Wi-Fi fit in 6 h
var LOCK_MS = 6000;               // tryLock wait: the server answers 'busy' well before the client gives up (20 s)
var CAP_STARTS = 60, CAP_CONTACTS = 20;   // per minute, all badges together: above it the reply is 'busy'
var SWITCH_CACHE_S = 20;          // switches are re-read at most every 20 s (an edit of Switches clears it at once)
var TZ = 'Asia/Kolkata';          // booth days and times: Devcon VIII is in Mumbai

// All "now" comes from here, so the check script can move the clock.
function now_() { return new Date(); }

// ---- Transport ----
// Body: JSON text sent as text/plain (no CORS preflight). Every reply is JSON with ok; errors are identifier
// codes (lowercase letters only) that clients switch on, never prose and never a raw exception message.
var PUBLIC_ = { status: status_, start: start_, finish: finish_, contact: contact_ };
var STAFF_ = { check: check_, claim: claim_, stats: stats_ };

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
    // Never the request body; for a contact not even the message (it carries a visitor's email or handle).
    Logger.log('error ' + action.slice(0, 12) + (action === 'contact' ? '' : ': ' + (err && err.message)));
    return json_({ ok: false, error: 'server' });
  }
}
// Opening the /exec URL in a private window shows the script is alive and which pasted copy is live.
function doGet() { return json_({ ok: true, service: 'kleros booth', v: SCRIPT_V }); }

// An Error that becomes { ok: false, error: code }.
function fail_(code) { var e = new Error(code); e.code = code; return e; }
// Every action's reply carries the switches, so the game and the desk always show the current state.
function withSwitches_(o) {
  var sw;
  if (o.open === undefined || o.soldOut === undefined) { sw = switches_(); o.open = sw.open; o.soldOut = sw.soldOut; }
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
// The browser sends a salted SHA-256 of the badge's normalised id (site/curate/badge.js), never the code itself.
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
// in still compares right. A Date is told by its tag, not instanceof, so one from the check script's vm counts.
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
// Today's tries for the badge (booth day in TZ).
function today_(rows, badge) {
  var k = dayKey_(now_()), out = [], i;
  for (i = 0; i < rows.length; i++) if (String(rows[i][2]) === badge && dayKey_(rows[i][1]) === k) out.push(rows[i]);
  return out;
}
// A badge has given its contact when any of its rows says yes.
function contactGiven_(rows, badge) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][2]) === badge && rows[i][10] === 'yes') return true;
  return false;
}
// What the game shows for a badge: tries left today, best round, contact given, merch collected.
function badgeState_(rows, badge, collected) {
  var n = today_(rows, badge).length;
  return { today: n, left: Math.max(0, PER_DAY - n), best: best_(rows, badge), contact: contactGiven_(rows, badge),
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
// The owner's cutoff: Switches!A2:B10, matched by label (a sorted or moved row still reads right). A cell counts as
// on only when it is true (a ticked checkbox). Cached briefly; onEdit and the menu clear the cache at once.
function switches_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('switches'), vals = SWITCH_DEFAULTS.slice(), seen = {};
  var sh, rows, i, k, out;
  if (hit) { try { return JSON.parse(hit); } catch (x) { /* re-read below */ } }
  sh = book_().getSheetByName(SWITCHES);
  if (sh) {
    rows = sh.getRange(2, 1, 9, 2).getValues();
    for (i = 0; i < rows.length; i++) {
      k = SWITCH_ROWS.indexOf(String(rows[i][0]).trim());
      if (k >= 0 && !seen[k]) { seen[k] = true; vals[k] = rows[i][1] === true; }
    }
  }
  out = { open: vals[0], soldOut: [] };
  for (i = 0; i < TIER_KEYS.length; i++) if (vals[i + 1]) out.soldOut.push(TIER_KEYS[i]);
  cache.put('switches', JSON.stringify(out), SWITCH_CACHE_S);
  return out;
}

// ---- Public: status ----
// The title, the intro and the scanner ask this. No lock, no write. Anyone holding a badge's hash can read its
// state (accepted: README, Accepted risk).
function status_(d) {
  var badge = d.badge ? badgeOf_(d) : '', sw = switches_();
  var out = { ok: true, v: SCRIPT_V, tiers: TIERS, maxScore: MAX_SCORE, open: sw.open, soldOut: sw.soldOut,
    perDay: PER_DAY, badge: null };
  if (badge) out.badge = badgeState_(peek_(TRIES, TRY_HEAD.length), badge, collected_(badge));
  return out;
}

// ---- Public: start ----
// Spends a try: called when the player taps Start (never on scan). A try counts when it starts; quitting never
// refunds it. The client makes the token; a retried start with the same token never spends a second try.
function start_(d) {
  var badge = badgeOf_(d), token = tokenOf_(d), app = appOf_(d), kiosk = d.kiosk === true, sw, r, st, out;
  cap_('start', CAP_STARTS);
  sw = switches_();
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
    n = today_(rows, badge).length;
    if (n >= PER_DAY) return { rows: rows, collected: false, counted: false, reason: 'limit' };
    row = [text_(token), "'" + day, badge, n + 1, now_(), '', '', '', app, kiosk ? 'yes' : '', ''];
    sh.appendRow(row);
    SpreadsheetApp.flush();
    rows.push([token, day, badge, n + 1, row[4], '', '', '', app, row[9], '']);   // as read back
    return { rows: rows, collected: false, counted: true, tryNo: n + 1 };
  });
  st = badgeState_(r.rows, badge, r.collected);
  out = { ok: true, counted: r.counted, perDay: PER_DAY, left: st.left, best: st.best, contact: st.contact,
    collected: st.collected, open: sw.open, soldOut: sw.soldOut };
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
    collected: st.collected, left: st.left, perDay: PER_DAY };
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

// ---- Staff: check ----
// What the desk shows after a scan (no write): red when the badge already got merch; else the game's best round,
// whether the contact was given, and the tier it earns. A game tier counts at the desk only with the contact given.
function check_(d) {
  var badge = badgeOf_(d), claim = findBadge_(peek_(CLAIMS, CLAIM_HEAD.length), badge);
  var st = badgeState_(peek_(TRIES, TRY_HEAD.length), badge, !!claim);
  var out = { ok: true, used: !!claim, game: st.best, contact: st.contact, today: st.today, earned: earned_(st) };
  if (claim) out.last = used_(claim);
  return out;
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
// deletes or reorders tabs or rows, and it keeps an existing staff key.
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
  CacheService.getScriptCache().remove('switches');
  Logger.log('Staff key: ' + key);
  Logger.log('Ready (' + SCRIPT_V + '): Badge claims, Tries, Switches; Contacts in the contacts sheet.');
}
// Only the owner can edit the tab (the owner can't be removed from a protection, so it stays).
function protect_(sh) {
  var p = sh.protect();
  p.setDescription('Owner only');
  p.removeEditors(p.getEditors());
  p.setWarningOnly(false);
}

// ---- Switches tab and menu ----
var SWITCH_NOTE = 'Tick or untick: the game and the desk follow within a minute. A tick stays on until you untick it.';
var TIER_NAMES_ = ['Teal', 'Purple', 'Gold'];
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
// The sheet row (2..10) of switch i, found by label; when missing, written into the first free row with a
// checkbox set to its default (checkboxes first: inserting them clears the cell to unticked).
function switchRow_(sh, i) {
  var rows = sh.getRange(2, 1, 9, 1).getValues(), free = -1, j;
  for (j = 0; j < rows.length; j++) {
    if (String(rows[j][0]).trim() === SWITCH_ROWS[i]) return j + 2;
    if (free < 0 && String(rows[j][0]) === '' && j + 2 !== 7) free = j + 2;
  }
  if (free < 0) throw new Error('Switches: no free row in A2:A10 for ' + SWITCH_ROWS[i]);
  sh.getRange(free, 1, 1, 1).setValue(SWITCH_ROWS[i]);
  sh.getRange(free, 2, 1, 1).insertCheckboxes();
  sh.getRange(free, 2, 1, 1).setValue(SWITCH_DEFAULTS[i]);
  return free;
}
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
    m.addItem('Show staff key', 'showStaffKey');
    m.addToUi();
  } catch (x) { /* a simple trigger must never throw at the owner */ }
}
// Simple trigger: a box ticked by hand (also from the Sheets phone app) applies at once.
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === SWITCHES) CacheService.getScriptCache().remove('switches');
  } catch (x) { /* never throw at the owner */ }
}
