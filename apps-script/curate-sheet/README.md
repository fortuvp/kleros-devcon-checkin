# Curate sheet: earn sign-ups and the badge desk

One small Google Apps Script web app, owned by the game owner and separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei). It writes to a Google Sheet you own:

- **Earn sign-ups:** the game's Results screen has a one-field form (*Get paid to keep lists clean. Kleros pays curators $5,000+ every month.*) for a Telegram handle or an email.
- **Badge claims:** the staff-only merch desk at `/curate/desk/` gives **one merch item per Devcon badge**, whatever email or phone the visitor used. This is the sybil guard: the check-in's own dedupe works per email or Telegram account, and the email confirmation is off.

Until `sheetApp.endpoint` in `site/curate/settings.js` is set, the sign-up form stays hidden and the desk says the sheet isn't set up. To look at the form before then, open `/curate/?earnpreview=1`.

## Set it up (about 5 minutes)

1. In Google Drive, signed in with your Kleros account, create a Google Sheet, for example *Curate booth sheet*. Keep it separate from the Booth Leads Database: that backend's `setup()` deletes any tab it doesn't know.
2. In that Sheet, open **Extensions › Apps Script**. Delete the sample code, paste all of [`Code.gs`](Code.gs), and save.
3. In the function menu pick **staffSetup** and click **Run**. Approve the permissions. Then open **Execution log** and copy the *Staff key*. Give it to the booth staff only, never to visitors.
4. Click **Deploy › New deployment**, choose **Web app**, and set *Execute as: Me* and *Who has access: Anyone*. Click **Deploy**.
5. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should show `{"ok":true,"service":"curate sheet"}`.
6. Put it in `site/curate/settings.js`: `sheetApp: { endpoint: 'https://script.google.com/macros/s/…/exec' }`. Commit and deploy the site.
7. Test it:
   - **Sign-ups:** play a round at `/curate/` and send a handle from Results. A row appears in the *Earn sign-ups* tab.
   - **Desk:** on a staff phone, open `https://devcon.kleros.io/curate/desk/`, enter the key and your name, and scan a badge. A row appears in *Badge claims*. Scan the same badge again: it turns red.

To change the code later, use **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same. To change the staff key, run `staffSetup` again; every staff phone then asks for the new key.

## Staff card: merch desk

1. The visitor shows their ticket (game or check-in). Check the clock ticks and read the **colour**. Stickers need no scan.
2. On your phone, tap **Scan badge** and point it at the code on their **Devcon badge**. If the camera won't read it, tap **Type the badge code**.
3. **Red, *Already got merch*:** this badge already got an item (it shows what and when). No more merch; stickers are fine.
4. **Green, *New badge*:** tap the item you hand over, in the ticket's colour (Teal flip-flops, Purple copper bottle or gamcha, Gold kurta). Optionally type the ticket code (K-… or C-…), so the same ticket can't be used with a second badge.
5. Hand over the item only after the screen says ***Give: …***.

## How it behaves

- **Only a fingerprint of the badge leaves the phone.** The desk sends a SHA-256 of the badge code, never the code itself, and the sheet stores that.
- **Two phones can't both give.** The check and the save happen under one lock, so two staff scanning the same badge at the same moment can't both see green.
- **Retries never duplicate.** Each claim and sign-up carries an id, and the script skips an id it already saved.
- **The home screen shows today's count per tier**, for pacing the stock.
- **iPhones work too.** iPhone browsers can't read barcodes on their own, so the desk carries jsQR (Apache-2.0, `site/curate/desk/vendor/`), loaded on the desk page only. Android Chrome uses its built-in reader (QR, Aztec, Data Matrix, PDF417 and common barcodes); jsQR reads QR only.
- **Sign-ups:** the game checks the field (an email, or a Telegram handle of 5 to 32 letters, digits or `_`), and the script checks it again. An unsent sign-up waits on the phone and goes out on the next visit. A booth tablet (`?kiosk=1`) keeps nothing between visitors.
- **Plain text only:** anything starting with `=`, `+`, `-` or `@` is stored so it can't run as a formula.

## Personal data

The Sheet holds people's contacts and badge fingerprints. Share it only with whoever follows up or runs the booth, use the contacts only to tell people how to start curating, and delete a row when someone asks. The form links to the check-in page's privacy notice (`/#privacy`), whose contact is Wei Wei.
