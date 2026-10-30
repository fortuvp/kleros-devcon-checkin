# Earn for real: sign-up sheet

The Curate game's Results screen has a one-field form: *Get paid to keep lists clean. Kleros pays curators $5,000+ every month.* Visitors leave a Telegram handle or an email. Those sign-ups go to a Google Sheet you own, through this small web app. It is separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei), so it needs nobody else's access.

The form stays hidden until `earn.endpoint` in `site/curate/settings.js` is set, so no sign-up is lost before the sheet exists. To look at the form before then, open `/curate/?earnpreview=1`.

## Set it up (about 5 minutes)

1. In Google Drive, signed in with your Kleros account, create a Google Sheet, for example *Curate earn sign-ups*.
2. In that Sheet, open **Extensions › Apps Script**. Delete the sample code, paste all of [`Code.gs`](Code.gs), and save.
3. Click **Deploy › New deployment**, choose **Web app**, and set *Execute as: Me* and *Who has access: Anyone*. Click **Deploy** and approve the permissions (the script only edits this Sheet).
4. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should show `{"ok":true,...}`.
5. Put it in `site/curate/settings.js`: `earn: { endpoint: 'https://script.google.com/macros/s/…/exec', monthly: '$5,000+' }`. Commit and deploy the site.
6. Test it: play a round at `/curate/`, send a handle from Results, and a row appears in the *Earn sign-ups* tab (time, contact, email or telegram, app, score, event, source, id).

To change the code later, use **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same.

## How it behaves

- The game checks the field (an email, or a Telegram handle of 5 to 32 letters, digits or `_`), and the script checks it again.
- A sign-up that can't be sent (no signal, or the script is down) waits on the phone and goes out on the next visit. Each one carries an id, and the script skips an id it already saved, so retries never duplicate a row.
- A booth tablet (`?kiosk=1`) keeps nothing between visitors.
- Text is stored as plain text: anything starting with `=`, `+`, `-` or `@` can't run as a formula.

## Personal data

The Sheet holds people's contacts. Share it only with whoever follows up, use it only to tell them how to start curating, and delete a row when someone asks. The form links to the check-in page's privacy notice (`/#privacy`); ask Wei Wei, who is its contact, to add one line covering these sign-ups.
