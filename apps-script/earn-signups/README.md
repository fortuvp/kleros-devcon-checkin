# Earn for real: sign-ups from the Curate game

The game's Results screen has a one-field form (*Get paid to keep lists clean. Kleros pays curators $5,000+ every month.*) for a Telegram handle or an email. Sign-ups go to the game owner's own Google Sheet through this small Apps Script web app. It is separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei) and from the staff badge desk (`apps-script/staff-desk/`): no badge data here, no contacts there.

Until `earn.endpoint` in `site/curate/settings.js` is set, the form stays hidden. To look at it before then, open `/curate/?earnpreview=1`.

## Set it up (about 5 minutes)

1. Create a Google Sheet for the sign-ups, for example *Kleros Devcon 2026 · Curate earn sign-ups*. Keep it separate from the Booth Leads Database (its `setup()` deletes any tab it doesn't know) and from the staff desk's badge Sheet.
2. In that Sheet, open **Extensions › Apps Script**. Delete the sample code, paste all of [`Code.gs`](Code.gs), and save.
3. Click **Deploy › New deployment**, choose **Web app**, and set *Execute as: Me* and *Who has access: Anyone*. Click **Deploy** and approve the permissions.
4. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should show `{"ok":true,"service":"earn sign-ups"}`.
5. Put it in `site/curate/settings.js`: `earn: { endpoint: 'https://script.google.com/macros/s/…/exec', monthly: '$5,000+' }`. Commit and deploy the site.
6. Test it: play a round at `/curate/` and send a handle from Results. A row appears in the *Earn sign-ups* tab (the script makes it on the first sign-up). Delete the test row.

## How it behaves

- **Checked twice:** the game checks the field (an email, or a Telegram handle of 5 to 32 letters, digits or `_`), and the script checks it again.
- **Nothing is lost:** an unsent sign-up waits on the phone and goes out on the next visit; each carries an id, and the script skips an id it already saved. A booth tablet (`?kiosk=1`) keeps nothing between visitors.
- **Plain text only:** anything starting with `=`, `+`, `-` or `@` is stored so it can't run as a formula.

## Personal data

The Sheet holds people's contacts. Share it only with whoever follows up, use the contacts only to tell people how to start curating, and delete a row when someone asks. The form links to the check-in page's privacy notice (`/#privacy`), whose contact is Wei Wei.
