# Staff desk: one merch item per Devcon badge

The staff-only merch desk at `/staff/` keeps a list of the badges that already got merch, in its own Google Sheet and small Apps Script web app. It is separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei) and from the game's *Earn for real* sign-ups (`apps-script/earn-signups/`).

This is the sybil guard: the check-in's own dedupe works per email or Telegram account and the email confirmation is off, so one person with several emails could claim several times. The desk gives **one merch item per Devcon badge**, whatever email or phone the visitor used.

**Staff never open the Sheet.** The desk asks the script: scanning a badge only checks it, and only tapping the item handed over adds a row. Every request needs the staff key. The Sheet is protected so only its owner can edit it.

Until `staffDesk.endpoint` in `site/curate/settings.js` is set, the desk says *Not connected yet* and checks nobody.

## Set it up (about 5 minutes)

1. Create a Google Sheet for the badge list (for Devcon 2026: *Kleros Devcon 2026 · Staff desk badges*, owned by fortunato@kleros.io). Keep it separate from the Booth Leads Database: that backend's `setup()` deletes any tab it doesn't know.
2. In that Sheet, open **Extensions › Apps Script**. Delete the sample code, paste all of [`Code.gs`](Code.gs), and save. (`SHEET_ID` can stay empty here; set it only if you paste the code into a standalone script.)
3. In the function menu pick **staffSetup** and click **Run**. Approve the permissions. It makes the *Badge claims* tab and a staff key: open **Execution log** and copy the *Staff key*. Give it to the booth staff only, never to visitors. Times and today's counts use Mumbai time (`TZ` in the code).
4. Click **Deploy › New deployment**, choose **Web app**, and set *Execute as: Me* and *Who has access: Anyone*. Click **Deploy**.
5. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should show `{"ok":true,"service":"staff desk"}`.
6. Put it in `site/curate/settings.js`: `staffDesk: { endpoint: 'https://script.google.com/macros/s/…/exec', … }`. Commit and deploy the site.
7. Test it:
   - **Badge format first:** on a staff phone, open `https://devcon.kleros.io/staff/?test=1` and scan one real Devcon VIII badge, on an Android phone and on an iPhone, then type the code printed on it (if any). Test mode saves nothing: it shows the raw text and the id the desk uses. All three ids must match. Then set `staffDesk.badgePattern` in `settings.js` to a regex that fits that id (for example `^[A-Z0-9]{12}$` for a 12-character code) and deploy, so a phone ticket, a photo or the back of the badge is refused. If the printed code differs from the QR's id, tell staff to scan only.
   - **Desk:** open `https://devcon.kleros.io/staff/`, enter the key and your name, and scan a badge. Tap an item: a row appears in *Badge claims*. Scan the same badge again: it turns red. Delete this test row before opening.

To change the code later, use **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same. To change the staff key, run `staffSetup` again; every staff phone then asks for the new key.

## Staff card: merch desk

1. The visitor shows their ticket (game or check-in). Check the clock ticks and read the **colour**. Stickers need no scan.
2. On your phone, open **devcon.kleros.io/staff**, tap **Scan badge** and point it at the code on their **Devcon badge**: only the lanyard badge, never a phone screen, a photo or the back of the badge (the desk refuses codes that don't look like a badge). If the camera won't read it, tap **Type the badge code**.
3. If it says ***Can't reach the sheet***, don't hand anything over: tap **Try again**.
4. **Red, *Already got merch*:** this badge already got an item (it shows what, which day and when). No more merch; stickers are fine.
5. **Green, *New badge*:** optionally type the ticket code (K-… or C-…, so the same ticket can't go with a second badge), then tap the item you hand over in the ticket's colour (Teal flip-flops, Purple copper bottle or gamcha, Gold kurta). Only checking? Tap **Next badge**: nothing is saved.
6. Hand over the item only after the screen says ***Give: …***.

## How it behaves

- **Only a fingerprint of the badge leaves the phone.** The desk turns the badge code into one id (a URL keeps its id, everything upper-cased, letters and digits only), so scanning and typing give the same id, then sends a SHA-256 of it; the sheet stores that, not the code. The salt is public, so it hides the code from a casual look, not from someone who can guess badge codes.
- **Two phones can't both give.** The save re-checks the badge under one lock and flushes the sheet before releasing it, so two staff scanning the same badge at the same moment can't both save it.
- **Slow or lost replies are safe.** Every request gives up after 12 s with a clear *Try again*, a reply for an earlier badge is ignored, and a retried save reuses its id, so a save that went through but lost its reply is recognised, not refused.
- **The home screen shows today's count per tier**, for pacing the stock.
- **iPhones work too.** iPhone browsers can't read barcodes on their own, so the desk carries jsQR (Apache-2.0, `site/staff/vendor/`), loaded on the desk page only. Android Chrome uses its built-in reader (QR, Aztec, Data Matrix, PDF417 and common barcodes); jsQR reads QR only.
- **Plain text only:** a staff name starting with `=`, `+`, `-` or `@` is stored so it can't run as a formula.

## Personal data

The Sheet holds badge fingerprints, items and staff first names, no contact details. Share it only with whoever runs the booth.
