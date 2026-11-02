// Kleros Curate at Devcon: one small web app for the game owner's own Google Sheet, separate from the booth
// check-in backend (apps-script/Code.gs). Two jobs:
//   1. "Earn for real" sign-ups from the game's Results (public: a Telegram handle or an email).
//   2. The staff badge desk (/curate/desk/): one merch item per Devcon badge. Needs the staff key.
// Setup (5 minutes): apps-script/curate-sheet/README.md.
var EARN = 'Earn sign-ups', CLAIMS = 'Badge claims';
var EARN_HEAD = ['Time', 'Contact', 'Kind', 'App', 'Score', 'Event', 'Source', 'Id'];
var CLAIM_HEAD = ['Time', 'Badge (hashed)', 'Tier', 'Item', 'Ticket', 'Staff', 'Id'];
var TIERS = ['teal', 'purple', 'gold'];
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, TG = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action === 'earn') return json_(earn_(d));
    if (d.action === 'check' || d.action === 'claim' || d.action === 'stats') {
      if (!staffOk_(d.key)) return json_({ ok: false, error: 'wrong key' });
      return json_(d.action === 'check' ? check_(d) : d.action === 'claim' ? claim_(d) : stats_());
    }
    return json_({ ok: false, error: 'bad request' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
// Opening the /exec URL in a browser shows the script is alive.
function doGet() { return json_({ ok: true, service: 'curate sheet' }); }

// ---- Earn for real ----
function earn_(d) {
  var contact = String(d.contact || '').trim();
  var kind = EMAIL.test(contact) ? 'email' : TG.test(contact) ? 'telegram' : '';
  if (!kind || contact.length > 120) return { ok: false, error: 'bad contact' };
  var id = cleanId_(d.id);
  if (seen_('earn:' + id)) return { ok: true };   // a retry of a saved sign-up
  locked_(function () {
    tab_(EARN, EARN_HEAD).appendRow([new Date(), plain_(contact), kind, plain_(d.app), clampNum_(d.score),
      plain_(d.event), plain_(d.source), id]);
  });
  remember_('earn:' + id);
  return { ok: true };
}

// ---- Badge desk ----
// The page sends a SHA-256 of the badge's code, never the code itself.
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
function used_(row) { return { at: Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'HH:mm'), tier: row[2], item: row[3] }; }
function check_(d) {
  var row = findBadge_(tab_(CLAIMS, CLAIM_HEAD), badgeOf_(d));
  return row ? { ok: true, used: true, last: used_(row) } : { ok: true, used: false };
}
// Check and save under one lock, so two staff phones can't both give merch for the same badge.
function claim_(d) {
  var badge = badgeOf_(d), tier = String(d.tier || ''), ticket = String(d.ticket || '').toUpperCase().trim(), id = cleanId_(d.id), out;
  if (TIERS.indexOf(tier) < 0) return { ok: false, error: 'bad tier' };
  if (ticket && !/^[KC]-[A-Z0-9]{6}$/.test(ticket)) return { ok: false, error: 'bad ticket code' };
  if (seen_('claim:' + id)) return { ok: true };   // a retry of a saved claim
  locked_(function () {
    var sh = tab_(CLAIMS, CLAIM_HEAD), row = findBadge_(sh, badge), tRow;
    if (row) { out = { ok: false, used: true, last: used_(row) }; return; }
    tRow = findTicket_(sh, ticket);
    if (tRow) { out = { ok: false, ticketUsed: true, last: used_(tRow) }; return; }
    sh.appendRow([new Date(), badge, tier, plain_(String(d.item || '').slice(0, 60)), ticket, plain_(String(d.staff || '').slice(0, 40)), id]);
    out = { ok: true };
  });
  if (out.ok) remember_('claim:' + id);
  return out;
}
// Today's handouts per tier, for pacing the stock.
function stats_() {
  var sh = tab_(CLAIMS, CLAIM_HEAD), n = sh.getLastRow() - 1, tz = Session.getScriptTimeZone(), today, rows, out = { teal: 0, purple: 0, gold: 0 }, i;
  if (n < 1) return { ok: true, today: out };
  today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  rows = sh.getRange(2, 1, n, 3).getValues();
  for (i = 0; i < rows.length; i++) {
    if (Utilities.formatDate(new Date(rows[i][0]), tz, 'yyyy-MM-dd') === today && out[rows[i][2]] !== undefined) out[rows[i][2]]++;
  }
  return { ok: true, today: out };
}

// ---- Staff key ----
// Run staffSetup once from the editor: it makes a random key and logs it. Give it to the booth staff only.
function staffSetup() {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k = '', i;
  for (i = 0; i < 16; i++) k += a.charAt(Math.floor(Math.random() * a.length));
  PropertiesService.getScriptProperties().setProperty('STAFF_KEY', k);
  Logger.log('Staff key: ' + k);
}
function staffOk_(k) {
  var want = PropertiesService.getScriptProperties().getProperty('STAFF_KEY');
  return !!want && String(k || '') === want;
}

// ---- Helpers ----
function tab_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); }
  return sh;
}
function locked_(fn) { var lock = LockService.getScriptLock(); lock.waitLock(10000); try { fn(); } finally { lock.releaseLock(); } }
function cleanId_(v) { return String(v || '').replace(/[^a-z0-9]/g, '').slice(0, 24); }
function seen_(k) { return k.length > 6 && !!CacheService.getScriptCache().get(k); }
function remember_(k) { if (k.length > 6) CacheService.getScriptCache().put(k, '1', 21600); }
function clampNum_(v) { return Math.max(0, Math.min(99999, Number(v) || 0)); }
// Visitor text is stored as plain text: anything starting with = + - @ can't run as a formula.
function plain_(v) { v = String(v == null ? '' : v).slice(0, 200); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
