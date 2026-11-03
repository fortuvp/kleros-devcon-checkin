# Kleros booth script: player tries, Telegram check, newsletter contacts, staff merch desk

One small Google Apps Script web app ([`Code.gs`](Code.gs)) runs everything the Curate game (`/curate/`) and the staff merch desk (`/staff/`) need from a server:

- **Player tries.** Each player gets **2 counted tries for the whole event** (3–6 Nov; a new day gives no new tries), on any phone or the booth tablet. The best score is kept on the badge list.
- **Points and tiers.** 100 points for each right answer, 10 for a wrong one (an entry left undecided when time runs out scores 0; no other bonus). So the tier follows right answers: **Teal 600** (6 right), **Purple 800** (8 right), **Gold 1,000** (10 out of 10). A round deals 10 entries, 5 of them fake, so tapping Correct (or Wrong) on everything without reading is 5 right: stickers only.
- **Telegram check (the default).** Devcon VIII has no badges, so players prove who they are with Telegram: they tick one consent box, the game opens the bot **@KlerosBoothBot**, they tap **Start**, and the bot's **▶️ Back to the game** button takes them straight back, verified. One Telegram account = 2 tries and 1 merch item. The tick agrees to Telegram messages on how to take part in real contests across Kleros apps, so verifying adds their Telegram ID (a number) and their Telegram username (if they have one) to the contacts sheet with *Curator info* yes (the game tells the script the box was ticked); sending `/stop` to the bot deletes both.
- **Newsletter contact** (badge and no-check modes only). A round that reaches Teal or better unlocks its ticket only after the player leaves an email or a @Telegram handle. In Telegram mode verifying is the contact, so there is no such step.
- **Merch desk.** Staff scan the QR on the player's game ticket (on their phone): red if that player already got merch, else green with the tier the game earned. Its hidden *Advanced* panel can also **reset a player** by Telegram username: their tries and merch record go, so they can play 2 new tries and get merch again.
- **Cutoff and mode.** A *Switches* tab only you can edit pauses merch, marks a tier sold out, and says how players verify (*Verify with*).

It is separate from the booth check-in backend (`apps-script/Code.gs`, owned by Wei Wei) and never touches it. Until `server.endpoint` in `site/curate/settings.js` is set, the game keeps its per-phone behaviour and the desk says *Not connected yet*.

## How players verify (*Verify with*)

| *Verify with* | A player is | What stops a second helping |
|---|---|---|
| **Telegram** (normal) | a Telegram account, checked through @KlerosBoothBot | a second Telegram account (each needs a phone number) |
| **Badge** | a scanned Devcon badge QR (players can't type the code) | a second physical badge. Only if Devcon badges have a QR code. |
| **None** | a random id made on the phone | nothing: anyone can replay in a private window and come back for more merch (honour system) |

Whatever the mode, the API's `badge` field and the sheets' *Badge (hashed)* column hold the **player id**: 64 hex characters. In Telegram mode it is an HMAC of the Telegram ID under a secret only the script knows, so the badge list never holds a Telegram ID.

## Two sheets, kept apart

| Sheet | Tabs | Holds |
|---|---|---|
| **Badge list** (the script is bound to it) | *Badge claims*, *Tries*, *Switches* | Player ids (fingerprints), tries, scores, items handed over, and one yes/no *Contact* flag per player. Never an email, a handle or a Telegram ID. |
| **Contacts** (`CONTACTS_SHEET_ID` in `Code.gs`) | *Contacts* | Day, email or @handle or Telegram ID, kind (`email`, `telegram`, `telegram id`), curator info yes/no (yes for a Telegram ID when the game reported the tick; empty when it came from a page opened before the tick existed), event, source (`curate`, `curate bot`), id, username (a Telegram ID's username, without @, when the player has one; written since 2026-11-03c). Never a player id, a score or a token, and no time of day, so a row can't be matched to a try by timing. |

The separation is by purpose: you own both (and the script's secret), so they are not unlinkable for you.

## Update to 2026-11-03c (already set up: 5 minutes)

This version scores kinder: **100 points for each right answer, 10 for a wrong one** (no evidence or streak bonus), so **Teal is 600** (6 right), **Purple 800** (8 right) and **Gold 1,000** (10 out of 10). A round now deals 5 fakes of 10 (it was 4), so 10 blind taps on Correct are 5 right, under Teal. A round played before the update keeps the tier it earned then. The bot now also keeps the player's Telegram **username** next to their Telegram ID, and the desk's hidden **Advanced** panel gets **Reset a player**: type a Telegram username (without @) and that player's tries and merch record are deleted, so they can play 2 new tries and get merch again. In this order:

1. Badge list sheet › **Extensions › Apps Script**: delete the old code, paste all of [`Code.gs`](Code.gs), **Save**.
2. Run **staffSetup** once: it adds *Username* at the end of the contacts sheet's header row (older rows keep it empty). It keeps the staff key, the secret and the one `tgTick` trigger.
3. **Deploy › Manage deployments › ✏️ Edit › Version: New version › Deploy** (never *New deployment*: the URL must stay).
4. The `/exec` URL in a private window shows `"v":"2026-11-03c"`. No need to run telegramTest again.
5. **Publish the site** right away (the game with the new points, the desk with *Reset a player*).
6. **Reload every page already open:** the booth tablet's `/curate/?kiosk=1`, any staff phone with the game open, and the desk on every staff phone. Going back to the title (the tablet's reset) doesn't reload the page.

Why this order: the game takes its tiers from the script, and the script refuses any score above its best possible round. With the new script first, a round still played on an old page tops out at 750 and so at Teal, for the few minutes until the reload. With the new game first, the old script would refuse every score above 750 as too high. Coming from 2026-11-03a or older, this update also brings 2026-11-03b's changes (the consent tick, the *Back to the game* button, `tgTick` every minute): staffSetup swaps the trigger too.

A player who verified before this version has no username on record, so *Reset a player* can't find them until they verify again (their next *Start* in the bot adds it). Neither can a player with no Telegram username. For them, delete their rows by hand (Runbook).

## Set it up (about 15 minutes)

0. **Both sheets: share with nobody.** In each sheet, **Share** must list only fortunato@kleros.io and *General access* must be *Restricted*. Only then are the switches and the staff key yours alone. (The contacts sheet id sits in the public code: harmless while access is Restricted.)
1. Open the **badge list** sheet › **Extensions › Apps Script**. Delete the old code, paste all of [`Code.gs`](Code.gs) and **Save**.
2. **The bot token.** The bot already exists (BotFather, username **KlerosBoothBot**). In Apps Script open **Project Settings** (the ⚙️ on the left) › **Script properties** › **Add script property**: property `TG_TOKEN`, value the token BotFather gave you. **Save script properties.** The token goes there and nowhere else: never in the code, the repo, a chat or a sheet.
3. In the function menu pick **staffSetup**, click **Run** and allow access (it now also asks to connect to an external service, which is Telegram, and to run when you're not present, which is the `tgTick` trigger). Open the **Execution log**: copy the *Staff key* (for the booth staff only, never visitors), read any line starting *Warning:* (someone else can edit a sheet: fix the sharing, then run it again), and check it says *Telegram: ready*. It makes the tabs, ticks *Merch open*, sets *Verify with* to *Telegram*, makes the script's Telegram secret (`TG_SECRET`, never shown), protects every tab and installs a trigger, `tgTick`, that reads the bot every minute (so `/stop` works, and a slow *Start* gets its answer, even when no phone is verifying; see it under **Triggers**, the ⏰ on the left). Running it again is safe: it keeps the key and the secret and replaces the trigger instead of adding a second one.
4. Pick **telegramTest** › **Run**. The log must say *Telegram OK: @KlerosBoothBot*. It also removes any webhook from the bot: the script reads the bot's messages itself, which a webhook would block. *Telegram failed: Unauthorized* means a wrong token: fix `TG_TOKEN` and run it again.
5. **Deploy.**
   - **Already deployed** (the live booth URL in `settings.js`): **Deploy › Manage deployments › ✏️ Edit › Version: New version › Deploy**. The URL stays the same. Never **New deployment** here: it makes a new URL, and every phone would keep talking to the old code.
   - **First time only:** **Deploy › New deployment › Web app.** *Execute as:* **Me**. *Who has access:* **Anyone**. If only *Anyone with a Google account* or *Anyone within kleros.io* is offered, stop: ask the Workspace admin to allow it, or deploy from an account that allows it, before the booth opens (phones would show offline).
6. Open the **Web app URL** (it ends in `/exec`) in a **private window**: it must show `{"ok":true,"service":"kleros booth","v":"2026-11-03c"}` without a sign-in. An older `v` means the new version isn't deployed. Optional: `curl -L -H 'Content-Type: text/plain' -d '{"action":"status"}' <url>` shows `"mode":"telegram"` and `"tg":true`.
7. First time only: paste the URL into `site/curate/settings.js` as `server: { endpoint: 'https://script.google.com/macros/s/…/exec', … }` (the `/a/macros/kleros.io/s/…` form works too) and publish the site.
8. **Badge mode only** (if you ever switch to it): calibrate first. On a staff phone open `https://devcon.kleros.io/staff/?test=1` (saves nothing). Scan two different badges: their ids must differ (the page warns otherwise). Then set `badge.pattern` in `settings.js` to a regex that fits the id (for example `^[A-Z0-9]{12}$`) and publish.

## Test it, step by step (before opening)

About 30 minutes with two phones (each with Telegram), the kiosk tablet and a laptop. Each step says what you should see. `node scripts/curate-check.js` already runs these flows against stubbed Sheets and a fake Telegram, so this guide is about the deployment, the bot, the cameras, the sharing and the real screens.

**The rule you are testing:** each Telegram account gets **2 counted tries for the whole event** (3–6 Nov), not 2 a day, and **1 merch item**. A try counts when Start is tapped. A new day gives no new tries. The best counted score decides the merch.

**Before you start**

- Test with your own Telegram account and a colleague's. Each has its own 2 tries for the whole event; the tries you spend stay spent until you delete the rows (*Clean up*, below).
- Don't test with a visitor's phone or Telegram.

### 1. The checks (2 min, on a laptop)

1. `node scripts/curate-check.js` ends with *All checks passed*. It proves, among others: a start without a valid Telegram signature is refused, a third start is refused, and a new day gives no new tries.
2. `node scripts/curate-check.js --sim` also passes (tier shares).

### 2. The deployment

1. The `/exec` URL in a private window shows `"v":"2026-11-03c"`, no sign-in.
2. `telegramTest` says *Telegram OK: @KlerosBoothBot*.
3. *Switches* has a fifth row, **Verify with**, set to **Telegram** (a dropdown: Telegram, Badge, None).
4. **Triggers** (⏰) lists one trigger: `tgTick`, time-driven, every minute.
5. The contacts sheet's header row ends with **Username**.

### 3. Game on your phone: verify, then the 2 tries

1. Open `/curate/` and pick an app. The intro says *Verify with Telegram to play: 2 tries for merch.* and has one tick box, next to the *Privacy* link: *I want to play this game and learn how Kleros Curate works, fully decentralised. I agree to get Telegram messages on how to take part in real contests across Kleros apps. Leave any time: send /stop to the bot.* The only buttons are **Verify with Telegram** and *Pick another app*: no *Play for fun* before verifying.
2. Tap **Verify with Telegram** without ticking the box: nothing opens. Tick it (reload: it stays ticked on this browser).
3. Tap **Verify with Telegram**: the Telegram app opens the Kleros Booth bot. Tap **Start**. Within a second or two the bot answers *✅ You’re verified. Tap below to go back to the game.* with one button, **▶️ Back to the game**. The contacts sheet gets one row: *Contact* = your Telegram ID (a number), *Kind* = telegram id, *Curator info* = yes, *Source* = curate bot, *Username* = your Telegram username without @ (empty if you have none). *Tries* is still empty.
4. Tap **▶️ Back to the game**. The game opens (in the browser Telegram picks, maybe its own) on the app you picked, already verified: *Telegram ✓ · Try 1 of 2* and **Start**. Switching back to your first browser by hand works too: within a few seconds it says the same. (Coming back before tapping Start shows *Tap Start in the Kleros Booth bot, then come back here.*)
5. Tap **Start**. *Tries* gets a row: *Try* 1, *Contact* = yes (verifying gave the contact).
6. Play to Teal or better (600+: 6 right answers). Results offer **Show my merch ticket** at once (no email step). The ticket shows a QR, the C- code under it, a live clock and *Telegram ✓*.
7. **Play again**: Try 2 of 2. **Try 3:** only *Play for fun*. *Tries* still has exactly 2 rows for you.
8. **Another phone:** in a private window open `/curate/`, verify with the **same** Telegram account: *Both tries used.* The tries belong to the Telegram account, not the phone. The contacts sheet still has one row for you.
9. **Another Telegram account** (your colleague's phone): its own *Try 1 of 2*.
10. **Leaving the news:** send `/stop` to the bot. Within a minute (at once while a phone is verifying) it answers *Done: you’re off Kleros news and your Telegram ID is deleted. Your game tries still count.* Your contacts row is gone; the game still knows your tries. (Verifying again adds the row back.)
11. *Use another Telegram* on the intro forgets the account on this phone and goes back to *Verify with Telegram*.

### 4. Desk on a staff phone

1. Open `/staff/`, enter the staff key and your first name. Home says *Players verify with Telegram.*, with **Scan ticket** and *Type the ticket code*. *Handed out today* shows the counts.
2. **Scan ticket** › the QR on your phone's game ticket: green, *New player*, *Game: Teal · … pts. Give up to Teal.*
3. Tap an item: ***Give: …***. *Badge claims* gets a row. *Handed out today* goes up by one.
4. Scan the same ticket again: red, *Already got merch*. The game now offers you only *Play for fun*.
5. **Typed code:** with your colleague's ticket, tap *Type the ticket code* and type its C- code (lower case, spaces or no dash work too): the same answer as a scan.
6. **Check-in ticket:** play a round under 600 (5 right or fewer) and open its ticket: an *Everyone* ticket has the QR too. Scan it: *Game: … pts, under Teal. Stickers only, unless they show a check-in ticket.* Type a check-in K- code in the box: every open tier is offered.
7. **Advanced** (tiny, at the very bottom of home) opens the *Verify with* control behind a red warning. Look, but don't change it here.
8. **Reset a player**, in Advanced below the mode switch: type your own Telegram username, without @ (any case), tap **Reset player**. It asks *Reset @NAME? Their tries and merch record are deleted: they can play 2 new tries and get merch again.* Tap **Yes, reset**: *Done: @NAME can start again.* with the counts (for example *2 tries, 1 merch deleted*). Your rows are gone from *Tries* and *Badge claims*; your contacts row stays. Reload the game on your phone: *Try 1 of 2* again. Now type your username with one letter missing: *That user is not in the DB.* (only an exact match counts). Then **Cancel** out of Advanced.

### 5. Switches

1. Untick **Merch open** (or **Kleros booth › Pause merch**). Within a minute: the title says *Merch is paused right now. Play for fun.*, Start is gone from the intro (no try spent), the desk says *Merch is paused*. Tick it again.
2. Tick **Gold sold out**. The Gold chip says *Gone today*; a Gold ticket says the kurta is gone for today; the desk's Gold button is off. Untick it.
3. **Verify with**, before opening only: **Kleros booth › Players verify with no check**. Within a minute a fresh private window says *Your phone gets 2 tries for merch.* and the desk says *Players verify with no check.* Then **Kleros booth › Players verify with Telegram** and check the game asks for Telegram again. Your Telegram tries are unchanged: the same account always gets the same player id.

### 6. Kiosk tablet

1. Open `/curate/?kiosk=1` and allow the camera.
2. The verify step shows the consent tick box and no QR yet (the tablet can't open a visitor's Telegram). Tick it: a **QR** appears instead of a link, and takes the focus. Scan it with your phone's camera, tap **Start** in Telegram. The tablet goes on to **Start** by itself, and waits a full minute from then before it resets. The bot's **▶️ Back to the game** opens the game on your phone, verified as the same account: harmless (the same 2 tries).
3. Play to Teal. 20 s after the ticket opens it resets. Nothing is remembered: the next visitor starts with the box unticked and verifies again.
4. On your phone, verify with the same Telegram: the tablet's try counted for your account.
5. Leave a new QR unscanned for 5 minutes: *No answer from Telegram yet. Try again.* with **Try again** (a new QR); untouched, the tablet goes back to the title within a minute.

### 7. Bad connection

1. Verify, turn on airplane mode, then tap Start: *Can’t reach the merch list. Try again, or play for fun.* No try is spent.
2. Start online, turn on airplane mode before the round ends: *Not saved yet. Trying again…*. Turn it off: the score saves and the ticket button wakes up.

### 8. Fallback (only while `server.endpoint` is empty)

The game keeps 2 counted tries **per phone, for the whole event** (no new tries on a new day either), tickets above Everyone need a confirmed check-in on the same phone, and staff hold the ticket code 2 s to mark it Collected. The desk says *Not connected yet*. Test it locally: `python3 -m http.server -d site 8000`, open `http://localhost:8000/curate/` and play 2 rounds (*Try 1 of 2*, *Try 2 of 2*). The intro then says *Both tries used. This round is for fun.*, and so it stays on later days.

### 9. Clean up (don't skip)

- Delete every test row from *Tries*, *Badge claims* and the contacts sheet's *Contacts*. For a Telegram account with a username, the desk's **Advanced › Reset a player** deletes its *Tries* and *Badge claims* rows in one go. By hand, to find a player's rows: a ticket's C- code is the first 6 characters of its *Token* in *Tries*; that row's *Badge (hashed)* is the player id in every other row and in *Badge claims*. A test row left in *Tries* keeps that account's tries spent for the whole event. `/stop` to the bot deletes your contacts row.
- *Verify with* = **Telegram**, *Merch open* ticked, no *sold out* ticks.
- On your phone: *Use another Telegram* on the intro (or clear the site's data).

**Changing the code or the points later.** After changing `tiers` or points in `settings.js`, paste `Code.gs` again with the same values (`TIERS`, `TRIES_PER_BADGE` = `countedTries`, `MAX_SCORE`; `node scripts/curate-check.js` fails when they differ), then **Deploy › Manage deployments › ✏️ › Version: New version**. The URL stays the same and `/exec` shows the new `v`. Saving without a new version leaves the old code live.

## Switches: pause merch, mark a tier sold out, Verify with

The *Switches* tab has four checkboxes, **Merch open**, **Teal sold out**, **Purple sold out**, **Gold sold out**, and one dropdown, **Verify with** (*Telegram*, *Badge*, *None*). Change them by hand (works from the Sheets phone app), or in the browser use the **Kleros booth** menu: *Pause merch*, *Reopen merch*, *Teal / Purple / Gold: sold out / back*, *Players verify with Telegram / badge / no check*, *Show staff key*. The game and the desk follow within a minute.

- **Merch paused:** the game says so and offers play for fun (no try is spent); the desk won't record any item (stickers only).
- **A tier sold out:** the game says that tier is out; the desk disables its buttons.
- A tick stays on until you untick it. `soldOut` in `settings.js` is only a static fallback.
- **Verify with changes how every player verifies, on every phone, within a minute.** Leave it on **Telegram**. Blank or anything unknown counts as Telegram. Besides the sheet, only the desk's hidden **Advanced** control changes it (a red warning, then staff type CHANGE); the log records who (*mode … by* their name). A phone whose saved player belongs to another mode forgets it, so a switch and back costs Telegram players nothing (the same account gets the same id) but sends badge or phone players back to the start.

## Staff card: merch desk

1. Open **devcon.kleros.io/staff** on your own phone (never on the kiosk tablet), tap **Scan ticket** and point it at the **QR on the player's game ticket**, on their phone. Look at the ticket's live clock: a still screenshot is not a ticket. If the camera won't read it, tap *Type the ticket code* and type the C- code under the QR.
2. ***Can't reach the list***: hand over nothing, tap **Try again**.
3. **Red, *Already got merch*:** this player already got an item. Stickers only.
4. **Green, *New player*:** the screen says what the game earned, for example *Game: Purple · 820 pts. Give up to Purple.* Tap the item you hand over; give it only after the screen says ***Give: …***.
   - *No email or Telegram yet* (badge or no-check mode only): ask them to unlock their ticket in the game, then tap **Check again**.
   - *No game score* or *under Teal:* stickers, unless they show a check-in ticket: type its K- code and read its colour. (An *Everyone* ticket has a QR too: scan it first.)
   - **No game ticket at all** (never played) but a check-in K- ticket: there is nothing to scan here. Use the check-in merch desk (devcon.kleros.io/admin), or they play one round and show its ticket.
5. **Amber** explains why not: merch paused, a tier sold out, not earned yet, or *Not a game ticket* (they showed something else: ask for the QR on their Curate ticket).
6. **Asked about tries?** Each Telegram account gets **2 tries for the whole event**, not 2 a day; a new day gives none back. The best score counts. Both used: they can still play for fun.
7. **Never touch Advanced** unless the booth lead says so. That includes *Reset a player*: it deletes a player's tries and merch record, so they can play 2 new tries and get merch again.

## Kiosk tablet

Allow the camera: **Settings › Safari › Camera › Allow** (or **aA › Website Settings › Camera › Allow**). In Telegram mode the tablet shows a QR that the visitor scans with their own phone to verify. Test one full cycle before opening: verify → round → ticket → reset. The tablet keeps nothing between visitors. Never open the desk on the kiosk tablet (its staff key would be reachable).

## Runbook

- **Script down or quota hit:** phones verified earlier can still play for fun; new players see *Can’t reach the merch list* and can’t play until it’s back (Telegram mode has no play before verifying). The desk can’t check: hand out stickers only, fix, and redeploy with **Manage deployments › ✏️ › New version** (same URL). Switching *Verify with* doesn’t help here, because phones learn the mode from the script. Don’t empty `endpoint` mid-event: phones would switch modes.
- **Players stuck on *Tap Start in the Kleros Booth bot*:** run **telegramTest**. *Unauthorized*: the token was revoked or mistyped: put the right one in `TG_TOKEN` (no redeploy needed: the script reads it on every request). Players already verified keep playing: their starts never ask Telegram. Players who see *Telegram check isn’t ready yet* mean `TG_TOKEN` is empty. If Telegram stays down and the booth lead decides so, *Verify with* = **None** (honour system) until it is back.
- **Bot token leaked:** in BotFather, `/revoke` the token, put the new one in `TG_TOKEN`, run **telegramTest**.
- **Contacts sheet broken** (moved, trashed, or the script lost access to it): players still verify and play. Telegram IDs that couldn't be saved wait 6 hours and are added once it works again; a `/stop` then gets *Please send /stop again in a minute*. Fix the sharing or `CONTACTS_SHEET_ID`.
- **Never change or delete `TG_SECRET`** (Script properties) during the event: every Telegram player would get a new player id, and so 2 fresh tries and another item.
- **A player's tries spent by mistake** (a staff test, a broken round the booth lead wants to give back): on the desk, **Advanced › Reset a player** with their Telegram username (without @; any case; only an exact match counts, anything else says *That user is not in the DB.*). It deletes all their rows in *Tries* and *Badge claims*, so they get 2 new tries and can get merch again; their contacts row stays. The log says who reset and how many rows went, never whom. A player with no username, or who verified before 2026-11-03c and not since, isn't found: delete their rows by hand (find them through the ticket's C- code: *Clean up*, above). Nothing else gives tries back; a new day doesn't.
- **Staff key leaked or lost:** run `newStaffKey` (every staff phone then asks for the new one), or **Kleros booth › Show staff key**.
- **After Devcon:** run `newStaffKey`, then archive the deployment (**Manage deployments › Archive**). Archiving leaves the `tgTick` trigger running, so `/stop` keeps deleting Telegram IDs, as the bot and the privacy notice promise. Delete the trigger (**Triggers** ⏰) only once the bot is retired and that promise no longer stands (Telegram keeps unread messages for 24 hours only).
- **Contacts:** export as plain text (or put `'` before cells) before opening in Excel. Import emails into the newsletter tool with **double opt-in** (a confirmation email). Telegram IDs (*Kind* telegram id) can only be reached through the bot.

## How it behaves

- **Telegram check.** The phone makes a one-off code (24 letters and digits) and opens `t.me/KlerosBoothBot?start=CODE`; the player taps Start, and Telegram hands the bot `/start CODE` with their Telegram user ID. The script has no webhook: when a phone asks `tgcheck`, and every minute through the `tgTick` trigger, it reads the bot's new messages (`getUpdates`), at most once every 2 s for all of them together, under a lock of its own, so starts, finishes and claims never wait on Telegram. The tap on **Verify with Telegram** sends one more `tgcheck` (`watch`), which the phone doesn't wait for: the script holds a long poll open from then until 30 s after the latest tap (90 s at most), so the bot answers *Start* within a second, though the player's page, hidden behind Telegram, asks nothing meanwhile. During a watch the other phones and `tgTick` only read the cache. The script remembers CODE → Telegram ID for 6 h and answers the phone with the player id (an HMAC-SHA256 of the ID under `TG_SECRET`) and a signature. The raw ID goes only to the contacts sheet, with the username the *Start* came with.
- **The bot's answers:** `/start CODE` → *✅ You’re verified. Tap below to go back to the game.* (and the ID joins the contacts sheet, once, with *Curator info* yes when the game reported the tick, and the username, kept up to date by each *Start*); `/start` alone or anything else → a short help text; `/stop` → every contacts row with that Telegram ID is deleted. A broken contacts sheet never stops verifying: an ID it can't save waits in the cache (6 h) for the next read, and a `/stop` it can't apply answers *Please send /stop again in a minute* instead of *Done*. The log never holds the bot token, a code, a Telegram ID, a username or a message.
- **Back to the game.** The verified answer carries one button, *▶️ Back to the game*, the only answer with one. It opens the page the phone verified from with `?tg=CODE&app=APP`: that page, in whatever browser Telegram opens, takes the code, verifies at once and opens the app the player had picked. The phone tells the script that page in `tgcheck` (`back`, `app`), and the script keeps it only when it is the game's `/curate/` on `devcon.kleros.io`, `kleros-devcon.netlify.app` or a `deploy-preview-N--kleros-devcon.netlify.app` (https, nothing after `/curate/`) and the app is a known deck; anything else (`localhost`, another site) is ignored and the button opens `https://devcon.kleros.io/curate/`.
- **The consent tick.** The game's **Verify with Telegram** works only once the player ticks the box (remembered on that browser), and its `tgcheck` then says so (`agree`). The script writes *Curator info* yes on a *telegram id* row only for a code that came with it. A page opened before the tick existed sends none, so its player's row has it empty until they verify again from the new game (the row then gets yes). Rows written before 2026-11-03b have it empty.
- **In Telegram mode a start needs the signature.** Without it: `unverified`, no row. A signed start marks *Contact* yes at once.
- **The ticket QR** carries the player id and its signature (`KC1.<id>.<sig>`), on every live ticket (an *Everyone* one too, so a check-in K- code can be typed after the scan). The desk checks the signature (a wrong one is `badticket`). A typed C- code finds the try whose *Token* starts with it.
- **Badge mode:** `site/curate/badge.js` turns the badge code into one id and sends a salted SHA-256 of it; the sheet stores that, never the code. The salt is public: it hides the code from a casual look, not from someone who can guess badge codes. **None mode:** the same hash of a random id made on the phone.
- **A try counts when it starts** (the player taps Start, never on verify or scan); quitting doesn't refund it. Each player has **2 tries for the whole event** (`TRIES_PER_BADGE`): every row of the player in *Tries* counts, whatever its *Day*, so a new day gives none back. *Day* (Mumbai time, `TZ`) is kept as a record only. A retried start with the same token never spends a second try.
- **The server decides the tier.** It derives the tier from the score with its own copy of the thresholds (`TIERS` = 0, 600, 800, 1000: 100 points per right answer and 10 per wrong one, so 6 right reach Teal, 8 Purple, 10 Gold); a tier sent by a browser is ignored. A player's best round is the one with the highest stored *Tier*, then the highest *Score*: a round finished before 2026-11-03c (scored out of 750: Teal from 300, Purple from 550) keeps its tier, even when a later round under the new points scores more.
- **Reset a player** (staff, the desk's Advanced). The typed username is trimmed, one leading `@` dropped, and compared without regard to case (as Telegram does) with the *Username* of every *telegram id* row in the contacts sheet: only an exact match counts, else `nouser`. The match's player id (the HMAC of its Telegram ID) loses every *Tries* and *Badge claims* row, under the lock; the contacts row stays. The username is the one the player's latest *Start* in the bot came with (a changed or dropped one is rewritten), and only one row holds a given username: a newer verify with it takes it off an older row.
- **One finish per try**, received 8 s to 6 h after its start (the 6 h bounds delivery, not play: a paused or offline round still saves).
- **A contact is only taken for a player with an earned round** (Teal or better), one contacts row per player (badge and none modes).
- **At the desk a game tier counts only once the contact was given** (in Telegram mode, always). A check-in ticket (`K-` code typed) allows any open tier: staff read its colour.
- **Two phones can't both give.** Every write re-checks under one lock and flushes before releasing it. A lock not had within 6 s answers *busy* and the phone retries with the same id, so a save that went through but lost its reply is recognised, not refused.
- **Per-minute caps** (60 starts, 20 contacts, 2000 Telegram checks for all players together) bound sheet growth and polling from a flood.
- **Plain text only:** anything a visitor or staff types that starts with `=`, `+`, `-`, `@`, a tab or a return is stored so it can't run as a formula.

## Accepted risk

The browser reports the score. The server issues a try token at start, accepts one finish per token between 8 s and 6 h after the start, rejects scores above 1,000 (the best possible round: 10 right answers at 100 points) and derives the tier itself. A determined player with devtools can still post a forged score for their own player id within those rules (at most Gold, once per try).

Also accepted:

- **More Telegram accounts, more merch.** One Telegram account = 2 tries and 1 item; someone with several accounts (each needs its own phone number) gets more.
- **Shared verify links.** The link's one-off code works for 6 h for whoever holds it: a player who sends their link to a friend before tapping Start may end up as the friend's account (or share one with them: 2 tries and 1 item between them). The bot's *Back to the game* button carries the same code, so forwarding it is the same as sharing the link. Nobody gains an extra item from it.
- **Ticket screenshots.** The ticket QR works for whoever shows it. Staff look at the live clock; one item per player still holds, since the first scan turns the ticket red.
- **Anyone holding a player id** (a photographed ticket QR, or in badge mode a photo of someone's badge) can read its best score and collected/contact flags, and in badge or none mode burn its 2 tries and post a forged score for it. In Telegram mode a start also needs the signature, and the ticket QR carries it, so a photo of a ticket is enough there too. None of this yields merch for them.
- **None mode is honour only:** a private window makes a new phone, with 2 new tries and another item. Use it only when the booth lead accepts that.
- **Badge mode:** a typed made-up badge code can't be entered by players; the desk scans the real badge (typed desk claims are marked `typed`).
- **Resets.** Whoever holds the staff key can reset any player with a username, giving them 2 new tries and another item. The log names the staff member who did it (not the player).

The endpoint is public: the per-minute caps bound sheet growth, and a flood answers *busy* to everyone for that minute.

## For developers: the API

`POST` the `/exec` URL with a JSON body as `text/plain;charset=utf-8` (no CORS preflight). Every reply is JSON with `ok`. Action replies also carry `open`, `soldOut` and `mode` (`'telegram' | 'badge' | 'none'`, the switches); a thrown error replies `{ ok: false, error: <code> }` only. `badge` is always the player id (64 lowercase hex), whatever the mode.

| Action | Key | Request | Reply |
|---|---|---|---|
| `status` | – | `badge?` | `v, tiers, maxScore, perBadge, mode, tg, badge: { triesUsed, left, best, contact, collected } \| null` |
| `start` | – | `badge, token, app, kiosk, sig?` | `counted, tryNo \| reason ('collected' \| 'paused' \| 'limit'), perBadge, left, best, contact, collected`; in Telegram mode without a valid `sig`: `ok: false, error: 'unverified'` (no try spent) |
| `finish` | – | `token, score, relaxed, endedBy` | `score, tier, best, contact, collected, left, perBadge` |
| `contact` | – | `badge, contact, curator, id, event, kiosk` | `contact: true` (badge and none modes) |
| `tgcheck` | – | `nonce, back?, app?, agree?, watch?` | `verified: false`, or `verified: true, badge, sig` |
| `check` | staff | `badge, sig?` or `code` | `badge, used, last?, game, contact, triesUsed, earned` |
| `claim` | staff | `badge, tier, item, ticket, staff, id, how` | `ok` (a retried `id` already saved: `ok, again, tier, item` as saved), or `used + last`, `ticketUsed + last`, `error: 'paused' \| 'soldout'`, `error: 'notearned' + earned, contact` |
| `stats` | staff | – | `today: { teal, purple, gold }, v` |
| `setmode` | staff | `mode, staff` | `mode` (as written to *Verify with*) |
| `reset` | staff | `username, staff` | `tries, claims` (rows deleted), or `ok: false, error: 'nouser'` |

`perBadge` = the counted tries each player has for the whole event (2); `triesUsed` = how many it has started; `left` = what remains (`limit` once it is 0, on any day). `best` = `{ score, tier, app, at, day, code, tryNo }`; `stats.today` is today's handouts (stock pacing). `tg` = whether `TG_TOKEN` is set. `nonce` = 16–40 letters and digits. `back` = the game page the phone verifies from (`https://devcon.kleros.io/curate/`, the Netlify site's or a deploy preview's `/curate/`) and `app` = a deck id or `''`: remembered for the nonce until it is verified, for the bot's *Back to the game* button; an invalid one is ignored, never an error. `agree` = 1 when the player ticked the consent box (anything else: no tick on record). `watch` = 1 on the tap's own call: the script reads the bot by long poll (up to 30 s after the latest tap, 90 s at most) before it answers. `sig` = 32 lowercase hex, from `tgcheck`; `check` refuses a present but wrong one. `code` = a ticket's C- code (`C-XXXXXX`; any case, spaces, no dash). `username` = a Telegram username, with or without one leading `@`, any case: it must match a contacts row's *Username* exactly. Error codes (lowercase identifiers; clients switch on them, never on prose): `badrequest`, `wrongkey`, `server`, `busy`, `badbadge`, `badtoken`, `badscore`, `toohigh`, `used`, `early`, `late`, `badcontact`, `notry`, `paused`, `soldout`, `notearned`, `unverified`, `notelegram` (no `TG_TOKEN`), `nocode` (no try with that code), `badticket` (wrong signature), `nouser` (no Telegram player with that username). Treat `busy`, `server` and transport failures as *try again*. `node scripts/curate-check.js` runs this script against stubbed Sheets and a fake Telegram.

## Personal data

The badge list holds player ids, tries, scores, items and staff first names, and no contact details. The contacts sheet holds what visitors typed for the newsletter, with their consent, and the Telegram IDs of players who verified, with their Telegram username when they have one (no name; the username lets staff reset a player by name): with *Curator info* yes, they ticked the consent box, for Telegram messages on how to take part in real contests across Kleros apps; empty, they verified on a page from before the tick, which offered Kleros news only. `/stop` deletes an ID and its username. Nothing in it says anything about a player's game. Share neither sheet.
