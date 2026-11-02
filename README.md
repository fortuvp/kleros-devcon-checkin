# Kleros booth check-in · Devcon VIII Mumbai

Visitors scan the booth QR, check in on their phone, confirm their Kleros blog subscription, and get a personalised "Picked for you" screen with their merch tier. More steps unlock better merch: Teal for checking in, Purple for joining the Kleros Telegram and following Kleros on X and LinkedIn, Gold for also getting the Kleros 101 quiz right. Staff hand over merch by the colour on the screen. Every check-in lands in a Google Sheet, matched to a Kleros use case with a priority and a suggested next step.

- **Site:** static HTML/JS in `site/`, no build step. Goes live at **https://devcon.kleros.io** (same URL every Devcon; the printed QR codes point there).
- **Game:** **https://devcon.kleros.io/curate/** (`site/curate/`) is a 60-second Kleros Curate game and a second way up the same merch ladder: pick an app and help it keep its list clean. Static like the rest and no change to the check-in backend; the only thing it sends is the optional *Earn for real* sign-up, to a separate sheet (below). See [Curate game (/curate)](#curate-game-curate).
- **Backend:** Google Apps Script web app in `apps-script/`, writing to a Google Sheet in the weiwei@kleros.io Drive.
- **Preview:** https://kleros-devcon.pages.dev (temporary copy on Wei Wei's Cloudflare account, for review only).

## Start here (devs)

Short version: [`docs/DEPLOY.md`](docs/DEPLOY.md). `bash scripts/package.sh` builds `dist/kleros-devcon-deploy.zip` (site folder for Netlify, the backend as one file, the deploy guide) for handing over without the repo.

1. **Deploy the site** on Kleros's Netlify, like ai.kleros.io. `netlify.toml` publishes `site/` as is; connect this repo, or drag `site/` into *Deploy manually*.
2. **Domain:** add `devcon.kleros.io` to the Netlify site, and a CNAME `devcon` → `<site-name>.netlify.app` in Cloudflare (kleros.io's DNS lives there).
3. **Blog gate webhooks:** run `ghostWebhookSetup`, then a Ghost admin adds two webhooks pointing at the URL it logs (see [Blog confirmation gate](#blog-confirmation-gate)). No Ghost API key is needed. **Until then nobody can finish checking in.**
4. **Telegram bot:** add the @KlerosDevconBot token and run `telegramSetup` (see [Merch tiers and the Telegram bot](#merch-tiers-and-the-telegram-bot)). **Until then nobody can reach Purple or Gold.**

## Repo layout

| Path | What it is |
|---|---|
| `site/index.html` | Visitor page: merch tier ladder and form → "Confirm your email" → final screen (tier ticket, level-up steps, Kleros 101, "Picked for you") |
| `site/connect.html` | "Connect with the Kleros team": the hot-lead form (button at the bottom of the check-in page and of the ticket), saved to the *Hot leads* tab |
| `site/admin.html` | Team dashboard: stats, lead list, optional merch desk, CSV export (`/admin`, needs the dashboard key) |
| `site/matching.js` | Use-case matching rules, shared by the page, the dashboard and the backend |
| `site/config.js` | Backend URL, edition/city, privacy contact, blog URL, merch tiers, Telegram bot and follow links, Community Hubs card |
| `site/quiz.js` | The three Kleros 101 questions, with why each answer is right or wrong |
| `site/assets/merch/` | Merch thumbnails for the tiers (from the Web3Merch mock-ups) |
| `site/curate/index.html` | Curate game page (`/curate/`), a standalone page with its own look: markup, styles and templates; loads `/config.js` and the scripts below |
| `site/curate/settings.js` | Every game knob: clock, points, tier thresholds, tries per day, the check-in rule, sold-out tiers and substitutes ([stock runbook](#curate-game-curate)) |
| `site/curate/decks.js` | The entries: one deck per app (Sightseeing, Countries, Tokens), each with its picker card, practice card, mission and report copy |
| `site/curate/rules.js` | Pure game rules: deck order, judging (including the part picked after *Wrong*), points, tiers (also run by `scripts/curate-check.js`) |
| `site/curate/objects.js` | The card pictures (real photos, flat flags including the four- and five-stripe kinds `h4`/`h5`, flat painted token logos) and the 2D Results medal; loads `gl.js` |
| `site/curate/gl.js` | Optional in-house WebGL renderer for the spinning 3D Results medal (no library), loaded after first paint; never fetched with `?lite=1`, Save-Data, low-memory phones or no WebGL |
| `site/curate/credits.js` | Photo credits (author, licence, Commons page) for every file in `site/curate/img/`, listed in *How it works* |
| `site/curate/img/` | The Sightseeing photos (Wikimedia Commons, free licences, 640 px JPEGs) |
| `site/curate/rewards.js` | Merch ladder, Results, ticket, staff stamp and the daily tries; the only game code that reads the check-in or writes storage |
| `site/curate/game.js` | Game engine: title screen, practice, round, swipes, pick mode, the full-screen ✓/✗ flash after each decision, buttons and keys, pause, *More time* |
| `site/_headers`, `site/robots.txt` | No-cache for `config.js`/`matching.js`/`quiz.js` and the `site/curate/` scripts, dashboard kept out of search engines |
| `apps-script/Code.gs` | Backend: check-ins, Sheet tabs and views, research-agent API, blog gate, merch tiers, Telegram bot |
| `apps-script/Matching.gs` | Copy of `site/matching.js` for the backend (kept in sync by the bundle script) |
| `scripts/apps-script-bundle.sh` | Prints the backend as the single file that lives in the Apps Script editor |
| `scripts/package.sh` | Builds `dist/kleros-devcon-deploy.zip`: Netlify-ready site, backend file, deploy guide |
| `scripts/curate-check.js` | Checks the game's decks and rules and lints `site/curate/*.js` for ES5 (Node, no dependencies); `--sim` reruns the tier calibration, `--fit` suggests thresholds |
| `docs/DEPLOY.md` | Step-by-step deploy: Netlify, domain, backend, keys |
| `qr/` | Booth QR generator (`make_qr.py`) and the print-ready codes: `devcon-kleros-qr-*` for the check-in, `curate-kleros-qr-*` for the game (see [Booth QR codes](#booth-qr-codes)) |
| `docs/RESEARCH_AGENT.md` | Playbook for the agents that research leads |
| `docs/telegram-bot-avatar.png` | @KlerosDevconBot's profile picture (the gold Kleros Juror seal from the tattoo sheet) |

Run locally: `python3 -m http.server -d site 8000`. Note `config.js` points at the **live** backend; set `endpoint: ''` for demo mode (check-ins stay on the device, no emails sent). The game is at http://localhost:8000/curate/: it loads the same `config.js` (for the merch names and pictures) but never posts to the backend.

## How a check-in works

1. **Form.** Name, company, role, job level, **email** (required), optional Telegram/LinkedIn/X, interests (four focus cards, "Others" with free text, extra chips), optional free text, and an optional "Subscribe me to the Kleros blog" box. (No "Book a call": people who want a follow-up use the Connect page, below.)
2. **Saved.** The check-in is queued on the phone and posted to the backend; it leaves the queue only when the backend confirms the save (retries are safe, the backend dedupes on a client id). `keepalive` lets it finish if the visitor closes the page.
3. **Blog sign-up (only if they ticked the box).** The page asks Ghost (blog.kleros.io) to send its own "Complete your sign up" email. Ghost only creates the subscriber once they tap *Confirm signup*. Visitors who leave the box unticked skip steps 3–4 and go straight to the final screen.
4. **Confirm your email.** The page polls the backend every 4 s (immediately when the visitor returns from their mail app). Ghost's webhook marks **Newsletter = Confirmed** in the Sheet (*Yes* = ticked, not confirmed yet; *No* = box left unticked). With the wait off, the screen still stays up 15 s before moving on.
5. **Final screen.** Only then: a ticket in their tier's colour (reward, name, code and a ticking clock, so a screenshot is easy to spot), the level-up steps, Kleros 101, a **Play Curate** card that opens the game at `/curate/` (hidden on a `?kiosk=1` tablet), then "Picked for you": their best-fit Kleros area (with why, and their own words quoted back), another area they picked, a tip for their role, the other headline areas, the Community Hubs card and links. All links go to docs.kleros.io, ai.kleros.io or the Kleros Telegram (Booth Guidelines: no token pages).
6. **Level up.** Join the Kleros Telegram (checked by @KlerosDevconBot), tap Follow on X and LinkedIn (counted on tap) → Purple. Plus all three Kleros 101 questions right → Gold. A wrong answer is crossed out with the reason, and they pick again.
7. **One check-in per person.** Reopening the page on the same phone shows the same screen, tier and progress. A second check-in with an email (or Telegram account) that already reached the final screen shows **Already claimed** instead of a tier. "Check in someone else" only exists on a staff tablet opened with `?kiosk=1` (Teal only: the tablet resets after a few seconds).

Staff just look at the colour; nothing to scan. The dashboard's merch desk is optional; it re-checks the confirmation with Ghost and refuses "Already claimed" check-ins.

## Backend (Apps Script)

Live project: **Kleros Devcon 2026 · Booth Leads Backend** (standalone, owned by weiwei@kleros.io), deployed as a web app (*Execute as: Me*, *Access: Anyone*). Its `/exec` URL is in `site/config.js`. The Sheet is **Kleros Devcon 2026 · Booth Leads Database**, in Drive › Devcon 2026 -Master Reference › Kleros Booth Check-in · Devcon 2026.

| Request | What it does |
|---|---|
| `POST {check-in}` | Saves a check-in (no key; malformed requests are rejected) |
| `POST {action:'verify', id[, steps, tg]}` | Polled by the page: blog subscription confirmed? Then the merch tier, Telegram state and "Already claimed". Also records the page's steps (`{x, linkedin, quiz, wrong}`); `tg: true` makes it read the bot's new messages |
| `POST {action:'enrich', key, ticket, agent, fields}` | Research agents write the Background research columns, logged in *Agent log* |
| `GET ?key=K` | All leads (dashboard) |
| `GET ?key=K&action=merch&id=ID&value=true` | Record merch given (only for confirmed subscribers) |
| `GET ?key=K&action=queue[&limit=N]` | Leads waiting for research |

Guards use `require_(condition, error)`; `respond_` turns a failed one into `{ ok: false, error }`.

**Script properties:** `ADMIN_KEY` (dashboard/agent key; Sheet menu *Kleros › Show dashboard / agent key*), `SHEET_ID`, `GHOST_WEBHOOK_SECRET` (made by `ghostWebhookSetup`), `TELEGRAM_BOT_TOKEN`, optional `TELEGRAM_GROUP` (default `@kleros`) and `SITE_URL` (default `https://devcon.kleros.io`). `TELEGRAM_OFFSET` is managed by the code.

**Changing the backend:** edit `apps-script/Code.gs` (and `site/matching.js` for matching), then

```bash
bash scripts/apps-script-bundle.sh | pbcopy
```

paste over everything in the editor, save, then *Deploy › Manage deployments › ✏️ › Version: New version › Deploy* (same URL). Menu actions use the saved code straight away; the web app only changes on a new version. Current live version: **18** (blog gate via Ghost webhooks with an on/off switch and a webhook call log; merch tier columns already added with `addMerchTierColumns`).

**From scratch:** create a standalone project at script.google.com while signed in as the Kleros account, paste the bundle, set `FOLDER_ID` in `Code.gs`, run `setup` (it creates and names the Sheet in that folder), approve permissions, deploy as a web app as above, and put the `/exec` URL in `site/config.js`.

### Blog confirmation gate

The page signs visitors up through Ghost's public members API, and Ghost emails them a link. Ghost creates a member only after they tap it, so "Ghost added this member" means "confirmed". Ghost tells the backend through webhooks; the backend holds no Ghost key and never calls Ghost.

1. Apps Script editor: run `ghostWebhookSetup`. It saves `GHOST_WEBHOOK_SECRET` and logs the target URL (the web app URL plus `?hook=ghost&secret=…`). Send that URL to the Ghost admin privately: it contains the secret.
2. Ghost admin › Settings › Integrations › **Add custom integration** ("Devcon booth") › **Add webhook**, twice, both with that target URL:
   - `Member added`: a new subscriber tapped *Confirm signup*.
   - `Member edited`: an existing subscriber gets a sign-in email instead; opening the blog from it updates their "last seen", which Ghost reports as an edit (at most once a day per member).
3. Check in on a phone with a fresh email, tap the link in the blog email, and the final screen appears within seconds.

Why a secret in the URL: Apps Script can't read Ghost's `X-Ghost-Signature` header. The backend keeps an email only when it matches a check-in (as *Newsletter = Confirmed*); any other member's email sits in the script cache for 6 hours and is never stored. Ghost may show the deliveries as failed, because Apps Script answers POSTs with a redirect; the backend still gets them. **Not confirming?** Run `ghostWebhookStatus` in the editor: it logs the last 10 webhook calls (parameter names and lengths, no secrets or emails). `params: ["hook"]` with `givenLength: 0` means the Target URL in Ghost lost its `&secret=…` part.

**Switch (live setting: OFF for Devcon, decided 27 Oct: the blog box is optional, so the booth never waits).** Run `blogGateOff` in the editor and the booth stops waiting: visitors reach the final screen and merch right after checking in, and the blog card asks them to tap the link in Ghost's email. Only this site's waiting step changes. Ghost still emails them and subscribes them only once they tap the link (Kleros's double opt-in is untouched), and a webhook confirmation still sets *Newsletter* to `Confirmed`. `blogGateOn` restores the wait. `ghostWebhookStatus` shows which way it is set.

Strict on purpose: until `ghostWebhookSetup` has run, visitors wait on "Confirm your email" and see "Confirmation check is offline. Please ask the Kleros team." Nobody is waved through. An existing subscriber who already opened the blog that day gets no new event; set their row's *Newsletter* to `Confirmed` in the Sheet to let them through.

### Connect with the Kleros team (hot leads)

A quiet button at the bottom of the check-in page and of the ticket opens `connect.html` (also at `/connect`). It is for people who want a real follow-up, not merch: name, company, email, what they want to talk about (using Kleros in their product, a pilot, partnership, speaking/research/media, other), what they are building, timing, how to reach them, and who they talked to at the booth. It is pre-filled when they checked in on the same phone, and offline-safe like the check-in.

The backend (`POST {action:'connect', rid, …}`) adds one row to the **Hot leads** tab (deduped on `rid`), with empty *Follow-up owner*, *Status* (starts as New) and *Team notes* for the team. If the same email checked in, that Leads row gets *Wants call = Yes* and fresh matching, so it shows as Hot everywhere and the Dashboard counts it.

### Merch tiers and the Telegram bot

| Tier | Needs | Checked how | Merch (stock) |
|---|---|---|---|
| Everyone | nothing | | Stickers, metallic tattoos (50 A5 sheets) |
| Teal | Check-in (if they ticked the blog box while the wait is on: a confirmed email) | Ghost webhooks (above) | Flip-flops (200) |
| Purple | + joined the Kleros Telegram group, tapped Follow on X and on LinkedIn | Telegram: @KlerosDevconBot. X and LinkedIn: counted on tap (checking needs paid APIs) | Copper bottle (100) or gamcha (100) |
| Gold | + all three Kleros 101 questions right | On the page (a wrong pick explains why; they pick again until right) | Kurta (100) |

One item per person, from their tier. PoH charms (50) and PoH tees (50) are left out for now; the 28 named kurtas are the team's. Rewards and pictures live in `site/config.js` (`merch`), the questions in `site/quiz.js`.

Purple and Gold are easy to reach (the quiz can't be failed), so most visitors will aim for them. Split the stock per day (about 25 kurtas and 50 Purple items a day over the four days) and give the tier below when today's runs out.

**One item per person, across both routes.** The check-in and the [Curate game](#curate-game-curate) climb the same ladder and share the same stock. A visitor gets one item, from the higher of their two tiers: the game's ticket already shows the higher one, and a Gold game ticket always carries the check-in's K- code. PoH tees and charms can stand in for a tier that runs out: `substitutes` in `site/curate/settings.js` swaps that tier's reward text and pictures in the game (see the stock runbook below).

**Telegram check.** The page links to `t.me/KlerosDevconBot?start=<client id>`. The visitor taps Start; the backend reads the bot's messages (`getUpdates`) whenever a waiting page polls and every minute from a trigger, asks Telegram whether that account is in the group (`getChatMember`), saves the result and replies in the chat (with a "Join the Kleros group" button if they aren't in yet). One Telegram account unlocks one check-in.

Setup, once:

1. **Token.** In Telegram, @BotFather › `/mybots` › KlerosDevconBot › *API Token*. Apps Script › Project settings › Script properties: `TELEGRAM_BOT_TOKEN` = the token. Never paste it anywhere else.
2. **Group.** The bot is already in t.me/kleros as a member (added 26 Oct 2026). Telegram only guarantees member lookups to admins.
3. Run `telegramSetup` in the editor: it checks the token, tests a member lookup, and installs the every-minute trigger. If it logs "Member lookups: NOT working", a group admin who can add admins makes @KlerosDevconBot an administrator with no permissions. As an admin the bot also receives the group's messages; the backend skips them and stores nothing. After Devcon, run `telegramStop`.

Bot profile (name, description, picture `docs/telegram-bot-avatar.png`) is set in @BotFather.

**Already claimed.** The first check-in of an email to reach the final screen gets the merch (Sheet: *Claim = Claimed*). A later check-in with the same email, from another phone or browser, gets *Already claimed* and no tier; so does a check-in whose Telegram account already unlocked another one. Reopening the page on the same phone is the same check-in, so a visitor who confirms now and comes back for merch later keeps their tier.

### Curate game (/curate)

https://devcon.kleros.io/curate/ teaches Kleros Curate by doing it, and is a second way up the merch ladder. Visitors reach it from the **Play Curate** card on their final screen or from its own QR poster. It is plain static files in `site/curate/`, sharing `/config.js` (merch names and pictures) and `/assets/` with the check-in.

**Its own page.** `/curate/` is a standalone game, not the check-in with a game on top: no check-in header, gold frame, starfield, icosahedrons or tagline. The full-height title screen (Kleros colours) keeps its words short: *These apps need clean lists.*, *Help one. Spot what’s wrong. Win merch.*, the hint row *← Wrong* · *Correct →*, and **Pick an app** above three big cards. Each card has a picture (a photo, a flag, painted token logos), the app's name, one line on what it needs and *10 entries · 60 s*. Tapping a card starts that app's round straight away; there is no separate start button. Under the cards sit the prize strip (the four merch tiers as chips) and *2 tries a day count for merch.*; the footer holds *How it works* (a sheet ending with the photo credits), *Booth check-in* and the *More time: Off/On* toggle; the fine print is one line, *A game. No sign-up. Photos: Wikimedia Commons.* The play, Results and ticket screens use the same frame.

**How to play.** Three apps (all fictional) show lists to their users, and fakers try to sneak fakes in. Each card on the title screen is one app with one list, in the spirit of the old Curate game. The player says whether each entry is **Wrong** or **Correct**. Every entry has **4 parts**: the picture and three lines. Curate's own words (challenge, deposit, jurors and the like) appear only in *How it works*, never on the play screen.

| App (card) | Its need | Each entry | Picture |
|---|---|---|---|
| Travel guide app (Sightseeing) | needs real sights on its map | Photo, name, city, country | A real photo from Wikimedia Commons: 39 photos, 24 world landmarks, 6 Mumbai sights and 9 more from across India (the Golden Temple, Hawa Mahal, Qutub Minar, India Gate and others) |
| Atlas app for schools (Countries) | needs the right flags and capitals | Flag, country, capital, web domain (`.it`, `.jp`, `.ch`) | The real flag, flat |
| Crypto exchange app (Tokens) | needs only real tokens in its listing | Logo, name, ticker, website | A flat logo coin painted in the token's brand colour (no downloaded logos); the title card shows Bitcoin, Ethereum and USDC |

v6 roughly doubles the lists: 39 real and 33 fake sights, 42 real and 26 fake countries, 24 real and 19 fake tokens (`node scripts/curate-check.js` prints the current counts under *Content*). The tokens are easy, famous ones (Bitcoin, Ethereum, Tether, USDC, Dogecoin, Solana, XRP, Litecoin, Stellar, Polkadot, Arbitrum, Optimism, Gnosis, NEAR and the like, plus Kleros PNK), with no prices and no investment talk; every official website was re-checked, and websites are plain text, never links. In a fake, exactly one of the four parts is wrong: the Taj Mahal in the wrong city, Austria with the web domain `.au` (it is `.at`), Ethereum listed as `ETC` (that is Ethereum Classic), a lookalike website such as `etherium.org`, or a picture of another sight or token under this name. Each fake carries its fix and a why of 48 characters or fewer, which is the line the red flash shows. Before the round, the app's mission shows for a moment, then the Go banner names the try: *Try 1 of 2 · Go!*, *Try 2 of 2 · Go!*, or *Just for fun · Go!* once both are used.

- One **round** is 60 s and 10 entries, 4 of them fake. The cards are from the app you picked. There is no per-entry countdown: an entry waits until you decide it. When the clock runs out the round ends, and the card on screen is not counted either way.
- Swipe right (or *✓ Correct*) when the entry is right.
- Swipe left (or *✗ Wrong*) when something in it is wrong. The card springs back to the centre in **pick mode**: *What’s wrong? Tap it.* (*What’s wrong? Press 1–4.* from the keyboard), with its 4 parts outlined and numbered 1–4. Tap the wrong part to decide; *Cancel* (or Esc) goes back without deciding. Swiping is off while picking. Outside pick mode, tapping a part does nothing.
- **The flash.** Every decision gets a full-screen answer, like in a game, instead of the old stamps, verdict words, juror dots and toasts. Green with a big ✓ **CORRECT** and the points: *+25* for a real entry marked Correct, or *+125* for a fake marked Wrong with the wrong part tapped, with a small line naming it (*You spotted the city*). A softer green ✓ **CORRECT** with *+75* when the fake was caught but another part was tapped, and one line with the answer (*The wrong part was the city: Agra.*). Red with a big ✗ **WRONG**, *−75* and one short reason when a fake was marked Correct or a real entry Wrong (*The Taj Mahal is in Agra.*, *This one was real.*). A streak bonus (*+50 streak*) and a tier unlock (*Teal unlocked*) show inside the same flash. The bad flash stays up longer than the good one; a tap or any key skips it, and **the round clock is paused while it shows**. Reduced motion drops the scale-in and keeps the colour and the words.
- **A calm play screen.** During a round the screen shows only the time ring, the score, the progress (*3/10*), the pause button, the card and the two buttons. The card is the picture and its three lines, nothing else (no status chip, no footer). The streak pips, the merch meter, Trust, the client row and the policy line are gone from play; the policy line is the practice card's hint, and Trust appears only on Results.
- The very first round on a phone (whichever app) starts with one untimed practice card, a fake, with a coach: *Something here is wrong. Tap ✗ Wrong.*, then *Now tap the wrong part.*, then *Nice. That’s how it works.* After 4 s idle the policy line shows as a hint and the wrong part pulses. It can be skipped. *More time* (the old relaxed timing) simply gives more time (90 s).
- Keyboard: ← or A is Wrong, → or D is Correct, then 1–4 picks the part; Esc cancels a pick (or pauses), P pauses.

| Outcome | Points |
|---|---|
| Fake marked Wrong | +75, plus 50 when you tapped the wrong part |
| Real entry marked Correct | +25 |
| Real entry marked Wrong | −75 (Trust −5) |
| Fake marked Correct | −75 (Trust −15) |
| Every 5 right in a row | +50 |
| All 10 decided early with 2 mistakes or fewer and at least 1 wrong part spotted | +5 per second left (with *More time*, counted as if the round were 60 s) |

Trust (the app's users' trust in its list) only drives the Results headline and its company line; it never ends a round. The final score is never below 0.

**Results.** A 3D medal in the earned tier's colour (Everyone lilac, Teal, Purple, Gold) spins slowly at the top of Results: a lit metal coin with a reeded rim and the Kleros mark. It is a flat 2D medal with `?lite=1` or without WebGL, and holds still with reduced motion. Below it, short lines only: the score, a headline by how much Trust the list kept (*Great job*, *Not bad* or *Too many fakes got in*), *8 of 10 right*, one company line (*Clean list: the app keeps earning.* or *Fakes got in: the app lost users.*), the tier line and the tries line (*Try 1 of 2 · 1 try left today* or *Both tries used today*). Then *Show my merch ticket*, *Play again* (*Play for fun* once both tries are used) and *Try another app*, which goes back to the title screen. Mistakes fold into *What you missed (n)*. The quote, payoff paragraph, stats grid and fine print are gone.

**Photos and credits.** The Sightseeing photos are in `site/curate/img/`: Wikimedia Commons files under CC0, public domain, CC BY or CC BY-SA, resized to 640 px wide and 60 KB or less (about 2.1 MB in all; ordinary cacheable files, unlike the no-cache scripts). `site/curate/credits.js` holds each file's subject, author, licence and Commons page, and *How it works* lists them under *Photo credits* with links to the licence and the source. Only files with a credits entry may be used; `scripts/curate-check.js` fails otherwise. To swap a photo, take a freely licensed Commons file, resize it with `sips --resampleWidth 640` to 60 KB or less, add its credits entry from the Commons API (author, licence short name, licence URL, file page) and point the deck item at `/curate/img/<file>`.

**Score → tier.** Names, rewards and pictures come from `config.js` `merch` by position (`free`, then `tiers[0..2]`); thresholds and rules live in `site/curate/settings.js`.

| Tier | Game route | Check-in route (unchanged) | Merch (today's `config.js`) |
|---|---|---|---|
| Everyone | Finish a round | Visit the booth | Stickers and metallic tattoos |
| Teal | `tiers[1]` points (350) | Check in | Kleros flip-flops |
| Purple | `tiers[2]` points (675) | + Telegram, X and LinkedIn | Copper bottle or gamcha |
| Gold | `tiers[3]` points (920) **and** a confirmed check-in on this phone | + Kleros 101 | Kleros kurta |

The thresholds (`tiers` in `site/curate/settings.js`, the only place they are set: the ladder and copy read them from there) come from a simulation of player profiles on the 10-entry, 60-second round with pick mode (about 27% Everyone, 36% Teal, 30% Purple and 7% Gold scores; real Gold is lower because of the check-in rule). Every simulated *Wrong* includes a pick: a player who rightly marks a fake Wrong taps the wrong part with a per-profile probability (from 95% for an expert to 50% for a novice), otherwise another one, and the pick adds about 0.8 s. The sim models the daily tries too: at most 2 counted tries per player, with 60% playing one and 40% playing two. Marking everything Correct, everything Wrong or doing nothing never reaches Teal, and a flawless quick round reaches Gold most of the time. Random fast swiping (a coin flip and a random part, right only 1 time in 4) sometimes reaches Teal; `--sim` prints how often, but does not fail on it. To keep blind swiping down, a caught fake is worth more when the wrong part is spotted (+75, or +125 with it), and the time bonus also needs at least one wrong part spotted (`points.bonusMinEvidence`). `node scripts/curate-check.js --fit` prints thresholds fitted to those shares, and `--sim` checks them. *More time* only adds time (90 s instead of 60): its time bonus counts the seconds left as if the round were 60 s long, so it scores exactly like a standard round and is never an easier road to Gold.

**2 tries a day.** Each phone gets **2 counted tries per day** (`countedPerDay`), and the game says so in four places: the title (*2 tries a day count for merch.*), the Go banner (*Try 1 of 2 · Go!*, *Try 2 of 2 · Go!*), Results (*Try 1 of 2 · 1 try left today* or *Both tries used today*) and the back of the ticket (*Try 1 of 2*). A try counts as soon as its clock starts (quitting doesn't refund it), and the ticket shows today's best counted try. After both, rounds are *Just for fun · Go!* and Results offers *Play for fun*. **Open question (anti-gaming):** the tries limit lives in the browser's storage, so a private tab or cleared site data starts afresh. Gold is unaffected (it needs a check-in, and the desk dedupes its K- code). If repeat play for Teal or Purple becomes a problem at the booth, the existing lever is `checkinNeededFrom: 1`, which ties every game tier above Everyone to a check-in on the same phone; it has not been switched on.

**Merch needs a check-in.** Any game prize above stickers needs a confirmed check-in on the same phone (`checkinNeededFrom: 1`), read from the check-in's own storage with the same confirmation rule as the check-in page. Why: the tries limit lives in the browser, so a private tab resets it; tying merch to the check-in means replays win nothing extra, because the check-in backend refuses a second claim for the same email or Telegram account (*Already claimed*) and staff tick *Merch given* on the desk. Until the visitor checks in, the ticket shows stickers plus a strip (*Teal score. Check in (1 min) on this phone to claim Kleros flip-flops.*) linking to `/`; coming back to `/curate/` after checking in upgrades it, and every merch ticket carries a K- code the desk can dedupe. A booth tablet (`?kiosk=1`) never has a check-in, so tablet rounds get stickers. Remaining gap: a different made-up email each time, while the blog-confirmation wait is off. `checkinNeededFrom: 3` goes back to Gold-only.

**Earn for real.** Results show a one-field sign-up (*Get paid to keep lists clean. Kleros pays curators $5,000+ every month.*): a Telegram handle or an email. **Merch desk (staff only).** `/curate/desk/` gives one merch item per Devcon badge, whatever email or phone the visitor used: staff scan the badge, red means it already got an item, green means tap what you hand over. Both go to a Google Sheet the game owner runs, through the small standalone web app in [`apps-script/curate-sheet/`](apps-script/curate-sheet/README.md) (5-minute setup, separate from the check-in backend, with the staff card). Until `sheetApp.endpoint` in `settings.js` is set, the sign-up form stays hidden (`/curate/?earnpreview=1` shows it) and the desk says the sheet isn't set up.

**The ticket** looks like the check-in ticket: tier colour, sheen, pulsing live dot, ticking clock and today's date. Tapping it turns it over (the try, stats and codes on the back, for example *Try 2 of 2 · Played 14:32 · Travel guide app*); the front's hint is just *Show this at the booth.* The code is the check-in's **K-** code when the visitor checked in on this phone, otherwise a game **C-** code. The ticket shows the higher of the game and check-in tiers. When the check-in tier is at least the game tier, the game ticket says *Your merch comes with your check-in ticket* and has no code to stamp. A check-in marked *Already claimed* shows *Merch goes with your first check-in* instead of a tier.

**Staff card** (also printed and laminated for the booth):

1. Check that the clock ticks and the date is today. Ask them to tap the ticket: it turns over. A frozen clock means a screenshot, so no merch.
2. Read the colour **and** the tier name. One item per person.
3. **Scan their Devcon badge** on the badge desk (devcon.kleros.io/curate/desk/, staff key needed): only the code on their lanyard badge, never a phone screen, a photo or the back of the badge. Red *Already got merch* means no item (stickers are fine). Green *New badge*: optionally type the ticket code, then tap the item you hand over, and hand it over only once the screen says *Give: …*. This is the one-item-per-badge guard, for check-in and game merch alike.
4. If the code starts with **K-**, also tick *Merch given* on the check-in merch desk (devcon.kleros.io/admin) if you use it, and hold the game ticket's code for 2 s and tap *Mark collected*, so the phone shows it too.

Everyone (stickers and tattoos): just hand them over; there is nothing to stamp.

Mark collected greys the ticket out on that phone for the rest of Devcon (Undo for 5 s). Keyboard users get a *Mark as collected* button on the back of the ticket.

**Stock runbook.** The game shares the check-in's stock. The levers are in `site/curate/settings.js`:

| Situation | Change |
|---|---|
| More than half of today's ~25 kurtas gone by 14:00 | Raise `tiers[3]` by 100 |
| Kurtas out for the day | `soldOut: ['gold']`, or `substitutes.gold` = PoH tee |
| Flip-flops or bottles running low | Raise `tiers[1]`/`tiers[2]` by 100 |
| Next morning | Revert |

Edit `site/curate/settings.js` and deploy. The `no-cache` header (`site/_headers`) means phones pick the change up on their next load. A sold-out tier drops game scores to the next open tier, and the ticket says so (*Kleros kurta: gone for today. Your Gold score gets a copper bottle or gamcha.*). A substitute is `{ reward, short, img: [...] }`, where `short` is how it reads mid-sentence, for example `substitutes.gold = { reward: 'PoH tee', short: 'a PoH tee', img: ['assets/merch/tee.jpg'] }`. Raised thresholds apply to new rounds; tickets already earned today keep their tier (`soldOut` still applies at once). These levers change the game only, not the check-in tiers.

**Storage: `kleros_devcon_curate`.** Everything the game itself keeps is in this one `localStorage` key on the phone (the *Earn for real* queue has its own key, `kleros_devcon_curate_earn`, and the staff desk keeps its key and name in `kleros_curate_desk`): the *More time* setting, practice done, the entries seen last round, today's tries and best run (with the tier it earned), the last 12 runs, and Collected. On a new day the tries and best run reset; Collected stays. The game reads the check-in's `kleros_devcon_self` and never writes it. When storage is blocked the game still works, and the ticket says it won't be kept. A private tab, cleared site data or a second phone starts the tries and Collected afresh (see the open question under *2 tries a day*); Gold stays safe because the desk dedupes its K- code.

**Kiosk mode.** `/curate/?kiosk=1` on a booth tablet, the same flag as the check-in: the practice card every time (skippable), no storage read or write at all, tier capped at Teal (`kioskMaxTier`), no staff stamp and no link back to the check-in, and *Next curator* resets the game 20 s after the ticket opens (or after 60 s idle on the report). The check-in's kiosk tablet hides the Play Curate card, because it resets after 12 s.

**No change to the check-in backend.** No Apps Script change, no new tab in the Booth Leads Database and no request to its backend: game scores are not in that Sheet or the dashboard. The only outside requests are the Google Fonts the check-in already uses, and the *Earn for real* sign-ups and staff-desk claims, which go to the game owner's own sheet script (`apps-script/curate-sheet/`). `?lite=1` forces the flat 2D Results medal (no WebGL), which is also the automatic fallback. The photos are served from `site/curate/img/` on the same domain; the only links to other sites are the Kleros docs link and the photo credits.

**Checks.** Run `node scripts/curate-check.js` after editing `decks.js`, `rules.js` or `settings.js`. It validates the three decks (unique ids, 4 parts per entry with the picture first, every fake has exactly one odd part, its fix and a why of 48 characters or fewer for the red flash, no links or markup, a practice card, flags of a known kind (including `h4` and `h5`), painted logo specs with an allowed mark, every photo file exists in `site/curate/img/` and has a credits entry), checks the copy for banned job words, for web3 words (allowed only in the Tokens deck's own data and the crypto card) and for Curate jargon on the play screen (challenge, verify, listed, jurors, bounty, deposit, stake, pending, submitted and the like, scanned in `game.js` toast and flash strings), builds 2,000 rounds of each deck to check the deck order rules (fakes per round, each photo once, easy start), reports file sizes (photos are left out of the eager budget and reported as a total; `credits.js` has a larger budget now that it lists twice the photos), and lints `site/curate/*.js` for ES5. `node scripts/curate-check.js --sim` also reruns the tier calibration (with the 2 daily tries) and prints the tier shares and random swiping's Teal share; it fails if lazy play ever reaches Teal or the shares drift more than 4 points from the ones above.

## The Sheet

`setup` builds: **Read me**, **Leads** (one row per person, 7 colour-coded column groups, pre-sized for 10,000 rows; the last group, *Merch tier*, holds tier, claim, Telegram check and steps), **Priority queue**, **By pipeline**, **By level**, **Flags**, **Research queue**, **Dashboard**, **Agent log**. The stacked views show each section's best 100 with a full count. A **Kleros** menu re-runs matching, rebuilds views, shows the key, and loads or deletes the three fictional `EX-` example rows (delete them before Devcon).

Visitor text is written as plain text (anything starting with `=`, `+`, `-`, `@` can't run as a formula; the CSV export is protected the same way). Times are in Asia/Kolkata. The same email checking in twice is flagged **Returning visitor**.

## Matching

`site/matching.js`: 11 Kleros tracks with keywords, products and owners. `focus: true` marks this year's pipelines (AI agents, prediction markets, enterprise, DeFi curation): big cards on the form, dashboard tiles, and the only tracks that can be **Hot**. Level comes from job level (counted double) plus role: Decision-maker / Influencer / Practitioner / Community. Interest labels match regardless of case. Avoid everyday words as keywords ("chain" matches "blockchain").

After changing it: redeploy the site and the backend, then Sheet menu *Kleros › Re-run use-case matching*.

## What updates by itself

| Change | Shows up how |
|---|---|
| Check-ins, Sheet edits, team notes, research | Instantly; the dashboard re-reads every minute |
| `site/` | On the next Netlify deploy (a push, once the repo is connected) |
| `site/curate/settings.js` (stock levers) | On the next deploy; phones pick it up on their next load (`no-cache`) |
| `apps-script/` | Only after pasting the bundle and deploying a new version |

## New Devcon year

1. `site/config.js`: `edition`, `city`, `event`, Community Hubs.
2. `site/matching.js`: move `focus: true` to that year's pipelines; adjust keywords.
3. `site/curate/decks.js`: the game's content is per edition. Swap the six Mumbai sights (and, if the host country changes, the other India sights) for the new host's (photos in `site/curate/img/` with their `credits.js` entries, see *Photos and credits*), re-check every sight, country and token entry (cities, capitals, web domains and official token websites change rarely, but check), then run `node scripts/curate-check.js --sim`.
4. A fresh Sheet (new Apps Script project, "From scratch") or keep one and filter on **Event**.
5. Redeploy. The QR codes stay the same.

## Booth QR codes

`python3 qr/make_qr.py` regenerates the booth poster (6×8 in, plus an A4 PNG and print-ready PDF), square sticker and plain PNG/SVG for https://devcon.kleros.io, and checks each one scans (OpenCV and ZXing; needs `qrcode[pil]`, `opencv-python-headless`, `zxing-cpp`). Keep the finder-eye corners small (`EYE_R`) so every scanner finds the code.

The Curate game has its own poster set, written beside the check-in one without touching it (keep the trailing slash in the address):

```bash
python3 qr/make_qr.py https://devcon.kleros.io/curate/ --name=curate-kleros-qr --headline="Play Kleros Curate" --perk="Help an app clean its list in 60 s, win merch"
```

It writes `curate-kleros-qr-poster.png`, `curate-kleros-qr-poster-a4.png` and `.pdf`, `curate-kleros-qr-square.png`, `curate-kleros-qr-plain.png` and `curate-kleros-qr-plain.svg` (QR version 4 at ECC H), and runs the same scan check. `--name=` sets the file prefix (lower-case letters, digits and `-`), `--headline=` and `--perk=` the two top lines. Without these flags the script writes the check-in set exactly as before. The game posters are in `qr/` (made on 29 Oct with Pillow 11.3, OpenCV 5.0 and zxing-cpp 2.2; zxing-cpp 2.2 is the newest with a ready-made wheel for macOS Python 3.9). ZXing reads every one at every size, but the URL is longer than the check-in's, so the denser code makes OpenCV, the pickier decoder, miss some sizes: the script reports `NO SCAN` for the A4 poster at OpenCV 2/4. Test-scan the A4 print with a few iOS and Android phones before printing a batch. Never regenerate the check-in posters just for this.

## Privacy

The page carries its own privacy notice (controller: Cooperative Kleros; purposes include public-profile research; deletion on request). The blog box is never pre-ticked.

The Curate game stores only on the phone. Scores, tries and the ticket stay in the browser's `kleros_devcon_curate` key and are never sent anywhere; there is no form, no sign-up and no analytics. It reads the check-in saved on the same phone (name, K- code, tier) to show it on the ticket, and never changes it. Its one-line fine print says *A game. No sign-up. Photos: Wikimedia Commons.*
