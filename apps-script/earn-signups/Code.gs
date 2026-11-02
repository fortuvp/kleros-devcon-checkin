// Kleros Curate at Devcon: the game's "Earn for real" sign-ups (a Telegram handle or an email from Results), in
// the game owner's own Google Sheet. Separate from the booth check-in backend (apps-script/Code.gs) and from the
// staff badge desk (apps-script/staff-desk/). Public: no key. Setup: apps-script/earn-signups/README.md.
var SHEET_ID = '';   // empty: the Sheet this script is bound to (Extensions › Apps Script); else that Sheet's id
var EARN = 'Earn sign-ups';
var EARN_HEAD = ['Time', 'Contact', 'Kind', 'App', 'Score', 'Event', 'Source', 'Id'];
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, TG = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(d.action === 'earn' ? earn_(d) : { ok: false, error: 'bad request' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
// Opening the /exec URL in a browser shows the script is alive.
function doGet() { return json_({ ok: true, service: 'earn sign-ups' }); }

function earn_(d) {
  var contact = String(d.contact || '').trim();
  var kind = EMAIL.test(contact) ? 'email' : TG.test(contact) ? 'telegram' : '';
  if (!kind || contact.length > 120) return { ok: false, error: 'bad contact' };
  var id = cleanId_(d.id);
  if (seen_('earn:' + id)) return { ok: true };   // a retry of a saved sign-up
  // appendRow is atomic on its own: no lock needed.
  tab_().appendRow([new Date(), plain_(contact), kind, plain_(d.app), clampNum_(d.score), plain_(d.event), plain_(d.source), id]);
  remember_('earn:' + id);
  return { ok: true };
}

// ---- Helpers ----
function tab_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(EARN);
  if (!sh) { sh = ss.insertSheet(EARN); sh.appendRow(EARN_HEAD); sh.setFrozenRows(1); }
  return sh;
}
function cleanId_(v) { return String(v || '').replace(/[^a-z0-9]/g, '').slice(0, 24); }
function seen_(k) { return k.length > 6 && !!CacheService.getScriptCache().get(k); }
function remember_(k) { if (k.length > 6) CacheService.getScriptCache().put(k, '1', 21600); }
function clampNum_(v) { return Math.max(0, Math.min(99999, Number(v) || 0)); }
// Visitor text is stored as plain text: anything starting with = + - @ can't run as a formula.
function plain_(v) { v = String(v == null ? '' : v).slice(0, 200); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
