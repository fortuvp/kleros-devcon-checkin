# Kleros booth script: badge tries, newsletter contacts, staff merch desk

One small Google Apps Script web app ([`Code.gs`](Code.gs)) runs everything the Curate game (`/curate/`) and the staff merch desk (`/staff/`) need from a server:

- **Badge tries.** A player scans their Devcon badge to start a counted try: 2 a day per badge, on any phone or the booth tablet. The best score is kept on the badge list.
- **Newsletter contact.** A round that reaches Teal or better unlocks its ticket only after the player leaves an email or a @Telegram handle for the Kleros newsletter.
- **Merch desk.** Staff scan the badge: red if it already got merch, else green with the tier the game earned.
- **Cutoff.** A *Switches* tab only you can edit pauses merch or marks a tier sold out.

It is separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei) and never touches it. Until `server.endpoint` in `site/curate/settings.js` is set, the game keeps its per-phone behaviour and the desk says *Not connected yet*.

## Two sheets, kept apart

| Sheet | Tabs | Holds |
|---|---|---|
| **Badge list** (the script is bound to it) | *Badge claims*, *Tries*, *Switches* | Badge fingerprints, tries, scores, items handed over, and one yes/no *Contact* flag per badge. Never an email or a handle. |
| **Contacts** (`CONTACTS_SHEET_ID` in `Code.gs`) | *Contacts* | Day, email or @handle, kind, curator info yes/no, event, source, id. Never a badge, a score or a token, and no time of day, so a row can't be matched to a try by timing. |

The separation is by purpose: you own both, so they are not unlinkable for you.

## Set it up (about 10 minutes)

0. **Both sheets: share with nobody.** In each sheet, **Share** must list only fortunato@kleros.io and *General access* must be *Restricted*. Only then are the switches and the staff key yours alone. (The contacts sheet id sits in the public code: harmless while access is Restricted.)
1. Open the **badge list** sheet › **Extensions › Apps Script**. Delete the sample code, paste all of [`Code.gs`](Code.gs) and **Save**. In the function menu pick **staffSetup**, click **Run** and allow access. Open the **Execution log**: copy the *Staff key* (for the booth staff only, never visitors) and read any line starting *Warning:* (someone else can edit a sheet: fix the sharing, then run it again). It makes the tabs, ticks *Merch open*, and protects every tab. Running it again is safe and keeps the key.
2. **Deploy › New deployment › Web app.** *Execute as:* **Me**. *Who has access:* **Anyone**. If only *Anyone with a Google account* or *Anyone within kleros.io* is offered, stop: ask the Workspace admin to allow it, or deploy from an account that allows it, before the booth opens (phones would show offline).
3. Copy the **Web app URL** (it ends in `/exec`) and open it in a **private window**: it must show `{"ok":true,"service":"kleros booth","v":"2026-11-02b"}` without a sign-in. Optional: `curl -L -H 'Content-Type: text/plain' -d '{"action":"status"}' <url>`.
4. Paste the URL into `site/curate/settings.js` as `server: { endpoint: 'https://script.google.com/macros/s/…/exec', … }` (the `/a/macros/kleros.io/s/…` form works too) and publish the site.
5. **Calibrate on day 1, before announcing badge play.** On a staff phone open `https://devcon.kleros.io/staff/?test=1` (saves nothing). Scan two different badges: their ids must differ (the page warns otherwise). Type one badge's printed code and compare it with its scan. Then set `badge.pattern` in `settings.js` to a regex that fits the id (for example `^[A-Z0-9]{12}$`), and `badge.typed: false` if typed and scanned ids differ, and publish.

## Test it once, end to end (before opening)

1. **Game, your phone:** open `/curate/`, pick an app, **Scan your badge** (or *Type the code*: any made-up code such as `TEST1234` works while `badge.pattern` is empty), **Start**, and play a round to Teal or better. Results say *Saving your score…*, then **Unlock my merch ticket** shows the locked ticket. Leave your email and tap **Unlock**: the C- code appears.
2. **Sheets:** *Tries* has the round with its score and *Contact* = yes; the contacts sheet has one row, with no badge and no time.
3. **Desk, a staff phone:** open `/staff/`, enter the staff key, scan or type the same badge: green, *Game: … Give up to …*. Tap an item: ***Give: …***. Check the badge again: red, *Already got merch*.
4. **Switches:** untick *Merch open*. Within a minute the game's title says *Merch is paused right now.* and the desk says *Merch is paused*. Tick it again.
5. **Clean up:** delete your test rows from *Tries*, *Badge claims* and *Contacts* (you are the owner).

`node scripts/curate-check.js` runs the same flows against stubbed Sheets, so this test is about the deployment, the camera and the sharing.

**Changing the code or the points later.** After changing `tiers` or points in `settings.js`, paste `Code.gs` again with the same values (`TIERS`, `PER_DAY`, `MAX_SCORE`; `node scripts/curate-check.js` fails when they differ), then **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same and `/exec` shows the new `v`. Saving without a new version leaves the old code live.

## Switches: pause merch, mark a tier sold out

The *Switches* tab has four checkboxes: **Merch open**, **Teal sold out**, **Purple sold out**, **Gold sold out**. Tick or untick them by hand (works from the Sheets phone app), or in the browser use the **Kleros booth** menu: *Pause merch*, *Reopen merch*, *Teal / Purple / Gold: sold out / back*, *Show staff key*. The game and the desk follow within a minute.

- **Merch paused:** the game says so and offers play for fun (no try is spent); the desk won't record any item (stickers only).
- **A tier sold out:** the game says that tier is out; the desk disables its buttons.
- A tick stays on until you untick it. `soldOut` in `settings.js` is only a static fallback.

## Staff card: merch desk

1. Open **devcon.kleros.io/staff** on your own phone (never on the kiosk tablet), tap **Scan badge** and point it at the **Devcon badge on their lanyard**: never a phone screen, a photo or paper. If the camera won't read it, type the code printed on the badge.
2. ***Can't reach the list***: hand over nothing, tap **Try again**.
3. **Red, *Already got merch*:** this badge already got an item. Stickers only.
4. **Green, *New badge*:** the screen says what the game earned, for example *Game: Purple · 812 pts. Give up to Purple.* Tap the item you hand over; give it only after the screen says ***Give: …***.
   - *No email or Telegram yet:* ask them to scan their badge in the game and tap **Unlock**, then tap **Check again**.
   - *No game score* or *under Teal:* stickers, unless they show a check-in ticket: type its K- code and read its colour.
5. **Amber** explains why not: merch paused, a tier sold out, or not earned yet.

## Kiosk tablet

Allow the camera: **Settings › Safari › Camera › Allow** (or **aA › Website Settings › Camera › Allow**). Test one full cycle before opening: scan → round → locked ticket → unlock → reset → scan. The tablet keeps nothing between visitors. Never open the desk on the kiosk tablet (its staff key would be reachable).

## Runbook

- **Script down or quota hit:** the game plays for fun and the desk can't check: hand out stickers only, fix, and redeploy with **Manage deployments › New version** (same URL). Don't empty `endpoint` mid-event: phones would switch modes.
- **Staff key leaked or lost:** run `newStaffKey` (every staff phone then asks for the new one), or **Kleros booth › Show staff key**.
- **After Devcon:** run `newStaffKey`, then archive the deployment (**Manage deployments › Archive**).
- **Contacts:** export as plain text (or put `'` before cells) before opening in Excel. Import into the newsletter tool with **double opt-in** (a confirmation email).

## How it behaves

- **Only a fingerprint of the badge leaves the phone.** `site/curate/badge.js` turns the badge code into one id and sends a salted SHA-256 of it; the sheet stores that, never the code. The salt is public: it hides the code from a casual look, not from someone who can guess badge codes.
- **A try counts when it starts** (the player taps Start, never on scan); quitting doesn't refund it. Days are booth days in Mumbai time (`TZ`). A retried start with the same token never spends a second try.
- **The server decides the tier.** It derives the tier from the score with its own copy of the thresholds; a tier sent by a browser is ignored.
- **One finish per try**, received 8 s to 6 h after its start (the 6 h bounds delivery, not play: a paused or offline round still saves).
- **A contact is only taken for a badge with an earned round** (Teal or better), one contacts row per badge.
- **At the desk a game tier counts only once the contact was given.** A check-in ticket (`K-` code typed) allows any open tier: staff read its colour.
- **Two phones can't both give.** Every write re-checks under one lock and flushes before releasing it. A lock not had within 6 s answers *busy* and the phone retries with the same id, so a save that went through but lost its reply is recognised, not refused.
- **Per-minute caps** (60 starts, 20 contacts for all badges together) bound sheet growth from a flood.
- **Plain text only:** anything a visitor or staff types that starts with `=`, `+`, `-`, `@`, a tab or a return is stored so it can't run as a formula.

## Accepted risk

The browser reports the score. The server issues a try token at start, accepts one finish per token between 8 s and 6 h after the start, rejects scores above 750 (the best possible round: answers only, no time bonus) and derives the tier itself. A determined player with devtools can still post a forged score for their own badge within those rules (at most Gold, once per try). The desk still gives one item per physical lanyard badge, and a typed made-up badge code only buys rounds that can never be collected, because the desk scans the real badge (typed desk claims are marked `typed`).

Also accepted: with a photo of someone's worn badge QR, anyone can burn that badge's 2 daily tries, read its best score and its collected/contact flags, and post a forged score for it; none of this yields merch for them. The endpoint is public: the per-minute caps bound sheet growth, and a flood answers *busy* to everyone for that minute.

## For developers: the API

`POST` the `/exec` URL with a JSON body as `text/plain;charset=utf-8` (no CORS preflight). Every reply is JSON with `ok`. Action replies also carry `open` and `soldOut` (the switches); a thrown error replies `{ ok: false, error: <code> }` only.

| Action | Key | Request | Reply |
|---|---|---|---|
| `status` | – | `badge?` | `v, tiers, maxScore, perDay, badge: { today, left, best, contact, collected } \| null` |
| `start` | – | `badge, token, app, kiosk` | `counted, tryNo \| reason ('collected' \| 'paused' \| 'limit'), perDay, left, best, contact, collected` |
| `finish` | – | `token, score, relaxed, endedBy` | `score, tier, best, contact, collected, left, perDay` |
| `contact` | – | `badge, contact, curator, id, event, kiosk` | `contact: true` |
| `check` | staff | `badge` | `used, last?, game, contact, today, earned` |
| `claim` | staff | `badge, tier, item, ticket, staff, id, how` | `ok` (a retried `id` already saved: `ok, again, tier, item` as saved), or `used + last`, `ticketUsed + last`, `error: 'paused' \| 'soldout'`, `error: 'notearned' + earned, contact` |
| `stats` | staff | – | `today: { teal, purple, gold }, v` |

`best` = `{ score, tier, app, at, day, code, tryNo }`. Error codes (lowercase identifiers; clients switch on them, never on prose): `badrequest`, `wrongkey`, `server`, `busy`, `badbadge`, `badtoken`, `badscore`, `toohigh`, `used`, `early`, `late`, `badcontact`, `notry`, `paused`, `soldout`, `notearned`. Treat `busy`, `server` and transport failures as *try again*. `node scripts/curate-check.js` runs this script against stubbed Sheets.

## Personal data

The badge list holds badge fingerprints, tries, scores, items and staff first names, and no contact details. The contacts sheet holds what visitors typed for the newsletter, with their consent, and nothing about their badge or game. Share neither.
