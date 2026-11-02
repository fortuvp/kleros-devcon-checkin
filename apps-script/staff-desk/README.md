# Kleros booth script: badge tries, newsletter contacts, staff merch desk

One small Google Apps Script web app ([`Code.gs`](Code.gs)) runs everything the Curate game (`/curate/`) and the staff merch desk (`/staff/`) need from a server:

- **Badge tries.** A player scans their Devcon badge to start a counted try: **2 tries per badge for the whole event** (3–6 Nov; a new day gives no new tries), on any phone or the booth tablet. The best score is kept on the badge list.
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
3. Copy the **Web app URL** (it ends in `/exec`) and open it in a **private window**: it must show `{"ok":true,"service":"kleros booth","v":"2026-11-02c"}` without a sign-in. Optional: `curl -L -H 'Content-Type: text/plain' -d '{"action":"status"}' <url>`.
4. Paste the URL into `site/curate/settings.js` as `server: { endpoint: 'https://script.google.com/macros/s/…/exec', … }` (the `/a/macros/kleros.io/s/…` form works too) and publish the site.
5. **Calibrate on day 1, before announcing badge play.** On a staff phone open `https://devcon.kleros.io/staff/?test=1` (saves nothing). Scan two different badges: their ids must differ (the page warns otherwise). Type one badge's printed code and compare it with its scan. Then set `badge.pattern` in `settings.js` to a regex that fits the id (for example `^[A-Z0-9]{12}$`), and `badge.typed: false` if typed and scanned ids differ, and publish.

## Test it, step by step (before opening)

About 30 minutes with two phones and the kiosk tablet. Each step says what you should see. `node scripts/curate-check.js` already runs these flows against stubbed Sheets, so this guide is about the deployment, the cameras, the sharing and the real screens.

**The rule you are testing:** each Devcon badge gets **2 counted tries for the whole event** (3–6 Nov), not 2 a day. A try counts when Start is tapped. A new day gives no new tries. The best counted score decides the merch.

**Before you start**

- Use **made-up test codes** (`TEST0001`, `TEST0002`, …), typed with *Type the code*. Each code has its own 2 tries for the whole event, so take a fresh code when you need fresh tries. Once `badge.pattern` is set, make up codes that fit it.
- Don't test with a real visitor's badge. A staff badge you test with keeps its spent tries until you delete its rows (*Clean up*, below).
- You need: your phone (game), a staff phone (desk), the kiosk tablet, and a private window on a laptop as a "second phone".

### 1. The checks (2 min, on a laptop)

1. `node scripts/curate-check.js` ends with *All checks passed*. It proves, among others: a third start is refused, and a new day (00:01 Mumbai time, and the last booth day) gives no new tries, on the server and in the browser.
2. `node scripts/curate-check.js --sim` also passes (tier shares).

### 2. The deployment

1. Open the `/exec` URL in a **private window**: `{"ok":true,"service":"kleros booth","v":"2026-11-02c"}`, no sign-in. An older `v` means the new code isn't deployed: **Manage deployments › ✏️ › New version**.
2. Optional: `curl -L -H 'Content-Type: text/plain' -d '{"action":"status"}' <url>` shows `"perBadge":2`.
3. `settings.js` has the `/exec` URL in `server.endpoint`, and the site is published.

### 3. Game on your phone: the 2 tries

1. Open `/curate/`. Under the prize strip: *Your Devcon badge gives 2 tries for merch.*
2. Pick an app. The intro shows **Scan your badge**. Tap it, then *Type the code*: `TEST0001`. You see *Badge …0001 · Try 1 of 2* and **Start**. *Tries* in the sheet is still empty: a scan spends nothing.
3. Tap **Start**. The banner says *Try 1 of 2 · Go!*. *Tries* now has a row: *Day* today, *Try* 1.
4. Play to Teal or better (300+). Results: *Saving your score…*, then *Try 1 of 2 · 1 try left*. The row gets *Finished*, *Score* and *Tier*.
5. Tap **Unlock my merch ticket**. The ticket shows the tier with the code hidden (`······`). Leave an email, tap **Unlock**: the C- code appears. The contacts sheet has one row (no badge, no time); the *Tries* row has *Contact* = yes.
6. Back on the title: *1 of 2 tries left.*
7. **Play again**: *Badge …0001 · Try 2 of 2*. Start (*Try 2 of 2 · Go!*), play any score. Results: *Try 2 of 2 · Both tries used*, or *Try 2 of 2 · Your best, Teal, still counts.* when this round scored lower.
8. **Try 3:** the intro says *Both tries used.* and offers only *Play for fun*. Play it: *Just for fun · Go!*, then *Your score reached …, but this round wins no merch.* and *Both tries used. Your Teal ticket still counts.* *Tries* still has exactly 2 rows for this badge.
9. **Another phone:** in the private window open `/curate/`, type `TEST0001`: *Both tries used.* The tries belong to the badge, not the phone.
10. **Another day:** the next morning (or any later booth day), type `TEST0001` again: still *Both tries used.* To check it now instead: in *Tries*, change both rows' *Day* to yesterday. Nothing changes, because *Day* is only a record. Put the dates back.
11. Tap the ticket: it turns over to *Try 1 of 2 · Tue 3 Nov · 14:32 · Travel guide app* (your try, its day and time, and the app).
12. *Not your badge?* on the intro forgets the badge; the next scan starts afresh.

### 4. Desk on a staff phone

1. Open `/staff/`, enter the staff key and your first name. *Handed out today* shows the counts.
2. **Scan badge** › type `TEST0001`: green, *New badge*, *Game: Teal · … pts. Give up to Teal.*
3. Tap an item: ***Give: …***. *Badge claims* gets a row with *How* = typed. *Handed out today* goes up by one.
4. Type `TEST0001` again: red, *Already got merch*.
5. In the game, `TEST0001` now says *This badge already got its merch.* and offers only *Play for fun*.
6. **No contact yet:** with `TEST0002`, play to Teal but don't unlock. The desk says *Game: Teal · … pts, but no email or Telegram yet.* Unlock in the game, tap **Check again**: *Give up to Teal.*
7. **Check-in ticket:** a badge with no game score says *No game score. Stickers only, unless they show a check-in ticket.* Type a check-in K- code: every open tier is offered.

### 5. Switches

1. Untick **Merch open** (or **Kleros booth › Pause merch**). Within a minute: the title says *Merch is paused right now. Play for fun.*, Start is gone from the intro (no try spent), the desk says *Merch is paused*. Tick it again.
2. Tick **Gold sold out**. The Gold chip says *Gone today*; a Gold ticket says *Kleros kurta: gone for today. Your Gold score gets …*; the desk's Gold button is off. Untick it.

### 6. Kiosk tablet

1. Open `/curate/?kiosk=1` and allow the camera.
2. Tap **Scan your badge** (front camera) or *Type the code* `TEST0003`, Start, play to Teal, unlock with an email.
3. 20 s after the ticket opens it resets to *Scan your badge*. Nothing is remembered: the next visitor scans again.
4. On your phone, type `TEST0003`: *Badge …0003 · Try 2 of 2*. The tablet's try counted for the badge.

### 7. Bad connection

1. Scan a badge, turn on airplane mode, then tap Start: *Can’t reach the merch list. Try again, or play for fun.* No try is spent.
2. Start online, turn on airplane mode before the round ends: *Not saved yet. Trying again…*. Turn it off: the score saves and the ticket button wakes up.

### 8. Fallback (only while `server.endpoint` is empty)

The game keeps 2 counted tries **per phone, for the whole event** (no new tries on a new day either), tickets above Everyone need a confirmed check-in on the same phone, and staff hold the ticket code 2 s to mark it Collected. The desk says *Not connected yet*. Test it locally: `python3 -m http.server -d site 8000`, open `http://localhost:8000/curate/` and play 2 rounds (*Try 1 of 2*, *Try 2 of 2*). The intro then says *Both tries used. This round is for fun.*, and so it stays on later days.

### 9. Clean up (don't skip)

- Delete every test row from *Tries*, *Badge claims* and the contacts sheet's *Contacts*. A test row left in *Tries* keeps that badge's tries spent for the whole event.
- *Merch open* ticked, no *sold out* ticks.
- On your phone: *Not your badge?* on the intro (or clear the site's data) so it forgets `TEST0001`.

**Changing the code or the points later.** After changing `tiers` or points in `settings.js`, paste `Code.gs` again with the same values (`TIERS`, `TRIES_PER_BADGE` = `countedTries`, `MAX_SCORE`; `node scripts/curate-check.js` fails when they differ), then **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same and `/exec` shows the new `v`. Saving without a new version leaves the old code live.

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
6. **Asked about tries?** Each badge gets **2 tries for the whole event**, not 2 a day; a new day gives none back. The best score counts. Both used: they can still play for fun.

## Kiosk tablet

Allow the camera: **Settings › Safari › Camera › Allow** (or **aA › Website Settings › Camera › Allow**). Test one full cycle before opening: scan → round → locked ticket → unlock → reset → scan. The tablet keeps nothing between visitors. Never open the desk on the kiosk tablet (its staff key would be reachable).

## Runbook

- **Script down or quota hit:** the game plays for fun and the desk can't check: hand out stickers only, fix, and redeploy with **Manage deployments › New version** (same URL). Don't empty `endpoint` mid-event: phones would switch modes.
- **A badge's tries spent by mistake** (a staff test, a wrong code typed): delete its rows in *Tries*. Nothing else gives tries back; a new day doesn't.
- **Staff key leaked or lost:** run `newStaffKey` (every staff phone then asks for the new one), or **Kleros booth › Show staff key**.
- **After Devcon:** run `newStaffKey`, then archive the deployment (**Manage deployments › Archive**).
- **Contacts:** export as plain text (or put `'` before cells) before opening in Excel. Import into the newsletter tool with **double opt-in** (a confirmation email).

## How it behaves

- **Only a fingerprint of the badge leaves the phone.** `site/curate/badge.js` turns the badge code into one id and sends a salted SHA-256 of it; the sheet stores that, never the code. The salt is public: it hides the code from a casual look, not from someone who can guess badge codes.
- **A try counts when it starts** (the player taps Start, never on scan); quitting doesn't refund it. Each badge has **2 tries for the whole event** (`TRIES_PER_BADGE`): every row of the badge in *Tries* counts, whatever its *Day*, so a new day gives none back. *Day* (Mumbai time, `TZ`) is kept as a record only. A retried start with the same token never spends a second try.
- **The server decides the tier.** It derives the tier from the score with its own copy of the thresholds; a tier sent by a browser is ignored.
- **One finish per try**, received 8 s to 6 h after its start (the 6 h bounds delivery, not play: a paused or offline round still saves).
- **A contact is only taken for a badge with an earned round** (Teal or better), one contacts row per badge.
- **At the desk a game tier counts only once the contact was given.** A check-in ticket (`K-` code typed) allows any open tier: staff read its colour.
- **Two phones can't both give.** Every write re-checks under one lock and flushes before releasing it. A lock not had within 6 s answers *busy* and the phone retries with the same id, so a save that went through but lost its reply is recognised, not refused.
- **Per-minute caps** (60 starts, 20 contacts for all badges together) bound sheet growth from a flood.
- **Plain text only:** anything a visitor or staff types that starts with `=`, `+`, `-`, `@`, a tab or a return is stored so it can't run as a formula.

## Accepted risk

The browser reports the score. The server issues a try token at start, accepts one finish per token between 8 s and 6 h after the start, rejects scores above 750 (the best possible round: answers only, no time bonus) and derives the tier itself. A determined player with devtools can still post a forged score for their own badge within those rules (at most Gold, once per try). The desk still gives one item per physical lanyard badge, and a typed made-up badge code only buys rounds that can never be collected, because the desk scans the real badge (typed desk claims are marked `typed`).

Also accepted: with a photo of someone's worn badge QR, anyone can burn that badge's 2 tries (for the whole event), read its best score and its collected/contact flags, and post a forged score for it; none of this yields merch for them. The endpoint is public: the per-minute caps bound sheet growth, and a flood answers *busy* to everyone for that minute.

## For developers: the API

`POST` the `/exec` URL with a JSON body as `text/plain;charset=utf-8` (no CORS preflight). Every reply is JSON with `ok`. Action replies also carry `open` and `soldOut` (the switches); a thrown error replies `{ ok: false, error: <code> }` only.

| Action | Key | Request | Reply |
|---|---|---|---|
| `status` | – | `badge?` | `v, tiers, maxScore, perBadge, badge: { triesUsed, left, best, contact, collected } \| null` |
| `start` | – | `badge, token, app, kiosk` | `counted, tryNo \| reason ('collected' \| 'paused' \| 'limit'), perBadge, left, best, contact, collected` |
| `finish` | – | `token, score, relaxed, endedBy` | `score, tier, best, contact, collected, left, perBadge` |
| `contact` | – | `badge, contact, curator, id, event, kiosk` | `contact: true` |
| `check` | staff | `badge` | `used, last?, game, contact, triesUsed, earned` |
| `claim` | staff | `badge, tier, item, ticket, staff, id, how` | `ok` (a retried `id` already saved: `ok, again, tier, item` as saved), or `used + last`, `ticketUsed + last`, `error: 'paused' \| 'soldout'`, `error: 'notearned' + earned, contact` |
| `stats` | staff | – | `today: { teal, purple, gold }, v` |

`perBadge` = the counted tries each badge has for the whole event (2); `triesUsed` = how many it has started; `left` = what remains (`limit` once it is 0, on any day). `best` = `{ score, tier, app, at, day, code, tryNo }`; `stats.today` is today's handouts (stock pacing). Error codes (lowercase identifiers; clients switch on them, never on prose): `badrequest`, `wrongkey`, `server`, `busy`, `badbadge`, `badtoken`, `badscore`, `toohigh`, `used`, `early`, `late`, `badcontact`, `notry`, `paused`, `soldout`, `notearned`. Treat `busy`, `server` and transport failures as *try again*. `node scripts/curate-check.js` runs this script against stubbed Sheets.

## Personal data

The badge list holds badge fingerprints, tries, scores, items and staff first names, and no contact details. The contacts sheet holds what visitors typed for the newsletter, with their consent, and nothing about their badge or game. Share neither.
