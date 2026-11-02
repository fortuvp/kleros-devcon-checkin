// Kleros Devcon staff desk: the badge list behind /staff/, one merch item per Devcon badge. A small web app for
// its own Google Sheet, separate from the booth check-in backend (apps-script/Code.gs) and from the game's Earn
// for real sign-ups (apps-script/earn-signups/). Every request needs the staff key, and staff never open the
// Sheet: the desk asks this script, so a badge can be checked without anyone editing the list by hand.
// Setup (5 minutes): apps-script/staff-desk/README.md.
var SHEET_ID = '';   // empty: the Sheet this script is bound to (Extensions › Apps Script); else that Sheet's id
var CLAIMS = 'Badge claims';
var CLAIM_HEAD = ['Time', 'Badge (hashed)', 'Tier', 'Item', 'Ticket', 'Staff', 'Id'];
var TIERS = ['teal', 'purple', 'gold'];
var TZ = 'Asia/Kolkata';   // Devcon VIII is in Mumbai: claim times and today's counts use booth time

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action !== 'check' && d.action !== 'claim' && d.action !== 'stats') return json_({ ok: false, error: 'bad request' });
    if (!staffOk_(d.key)) return json_({ ok: false, error: 'wrong key' });
    return json_(d.action === 'check' ? check_(d) : d.action === 'claim' ? claim_(d) : stats_());
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
// Opening the /exec URL in a browser shows the script is alive.
function doGet() { return json_({ ok: true, service: 'staff desk' }); }

// ---- Badges ----
// The page sends a SHA-256 of the badge's normalised id, never the code itself.
function badgeOf_(d) { var b = String(d.badge || ''); if (!/^[0-9a-f]{64}$/.test(b)) throw new Error('bad badge'); return b; }
function findBadge_(sh, badge) {
  var n = sh.getLastRow() - 1, rows, i;
  if (n < 1) return null;
  rows = sh.getRange(2, 1, n, 5).getValues();   // Time, Badge, Tier, Item, Ticket
  for (i = 0; i < rows.length; i++) if (rows[i][1] === badge) return rows[i];
  return null;
}
function findTicket_(sh, ticket) {
  var n = sh.getLastRow() - 1, rows, i;
  if (!ticket || n < 1) return null;
  rows = sh.getRange(2, 1, n, 5).getValues();
  for (i = 0; i < rows.length; i++) if (String(rows[i][4]) === ticket) return rows[i];
  return null;
}
function used_(row) {
  var t = new Date(row[0]);
  return { at: Utilities.formatDate(t, TZ, 'HH:mm'), day: Utilities.formatDate(t, TZ, 'EEE d MMM'), tier: row[2], item: row[3] };
}
function check_(d) {
  var row = findBadge_(tab_(), badgeOf_(d));
  return row ? { ok: true, used: true, last: used_(row) } : { ok: true, used: false };
}
// Check and save under one lock, so two staff phones can't both give merch for the same badge.
function claim_(d) {
  var badge = badgeOf_(d), tier = String(d.tier || ''), ticket = String(d.ticket || '').toUpperCase().trim(), id = cleanId_(d.id), out;
  if (TIERS.indexOf(tier) < 0) return { ok: false, error: 'bad tier' };
  if (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket)) return { ok: false, error: 'bad ticket code' };
  if (seen_('claim:' + id)) return { ok: true };   // a retry of a saved claim
  locked_(function () {
    var sh = tab_(), row = findBadge_(sh, badge), tRow;
    if (row) { out = { ok: false, used: true, last: used_(row) }; return; }
    tRow = findTicket_(sh, ticket);
    if (tRow) { out = { ok: false, ticketUsed: true, last: used_(tRow) }; return; }
    sh.appendRow([new Date(), badge, tier, plain_(String(d.item || '').slice(0, 60)), ticket, plain_(String(d.staff || '').slice(0, 40)), id]);
    SpreadsheetApp.flush();   // written before the lock is released, so the next phone's check sees it
    out = { ok: true };
  });
  if (out.ok) remember_('claim:' + id);
  return out;
}
// Today's handouts per tier, for pacing the stock.
function stats_() {
  var sh = tab_(), n = sh.getLastRow() - 1, today, rows, out = { teal: 0, purple: 0, gold: 0 }, i;
  if (n < 1) return { ok: true, today: out };
  today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  rows = sh.getRange(2, 1, n, 3).getValues();
  for (i = 0; i < rows.length; i++) {
    if (Utilities.formatDate(new Date(rows[i][0]), TZ, 'yyyy-MM-dd') === today && out[rows[i][2]] !== undefined) out[rows[i][2]]++;
  }
  return { ok: true, today: out };
}

// ---- Staff key ----
// Run staffSetup once from the editor: it makes the Badge claims tab and a random key, and logs the key. Give it
// to the booth staff only. Running it again makes a new key (every staff phone then asks for it).
function staffSetup() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k = '', i;
  tab_();
  for (i = 0; i < 16; i++) k += a.charAt(Math.floor(Math.random() * a.length));
  PropertiesService.getScriptProperties().setProperty('STAFF_KEY', k);
  Logger.log('Staff key: ' + k);
}
function staffOk_(k) {
  var want = PropertiesService.getScriptProperties().getProperty('STAFF_KEY');
  return !!want && String(k || '') === want;
}

// ---- Helpers ----
function tab_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(CLAIMS);
  if (!sh) { sh = ss.insertSheet(CLAIMS); sh.appendRow(CLAIM_HEAD); sh.setFrozenRows(1); }
  return sh;
}
function locked_(fn) { var lock = LockService.getScriptLock(); lock.waitLock(10000); try { fn(); } finally { lock.releaseLock(); } }
function cleanId_(v) { return String(v || '').replace(/[^a-z0-9]/g, '').slice(0, 24); }
function seen_(k) { return k.length > 6 && !!CacheService.getScriptCache().get(k); }
function remember_(k) { if (k.length > 6) CacheService.getScriptCache().put(k, '1', 21600); }
// Staff text is stored as plain text: anything starting with = + - @ can't run as a formula.
function plain_(v) { v = String(v == null ? '' : v).slice(0, 200); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
