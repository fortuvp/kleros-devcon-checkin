// Kleros Curate game: "Earn for real" sign-ups (Telegram or email) from devcon.kleros.io/curate/.
// A tiny standalone web app, separate from the booth check-in backend (apps-script/Code.gs): it only appends
// rows to the Google Sheet it is bound to. Setup (5 minutes): apps-script/earn-signups/README.md.
var SHEET = 'Earn sign-ups';
var HEAD = ['Time', 'Contact', 'Kind', 'App', 'Score', 'Event', 'Source', 'Id'];
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, TG = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

function doPost(e) {
  var out = { ok: false };
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var contact = String(d.contact || '').trim();
    var kind = EMAIL.test(contact) ? 'email' : TG.test(contact) ? 'telegram' : '';
    if (d.action !== 'earn' || !kind || contact.length > 120) throw new Error('bad request');
    var id = String(d.id || '').replace(/[^a-z0-9]/g, '').slice(0, 24);
    var cache = CacheService.getScriptCache();
    if (id && cache.get('earn:' + id)) { out.ok = true; return json_(out); }   // a retry of a saved sign-up
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      sheet_().appendRow([new Date(), plain_(contact), kind, plain_(d.app), Math.max(0, Math.min(99999, Number(d.score) || 0)),
        plain_(d.event), plain_(d.source), id]);
    } finally { lock.releaseLock(); }
    if (id) cache.put('earn:' + id, '1', 21600);
    out.ok = true;
  } catch (err) { out.error = String((err && err.message) || err); }
  return json_(out);
}
// Opening the /exec URL in a browser shows the script is alive.
function doGet() { return json_({ ok: true, service: 'curate earn sign-ups' }); }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
// Visitor text is stored as plain text: anything starting with = + - @ can't run as a formula.
function plain_(v) { v = String(v == null ? '' : v).slice(0, 200); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
