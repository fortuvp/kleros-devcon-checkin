# Deploying the Kleros Devcon check-in

Two parts: the **site** (static files, goes on Netlify) and the **backend** (Google Apps Script, already live). The site works as soon as it's up: `site/config.js` already points at the live backend.

## 1. Site on Netlify

Pick one:

- **From GitHub (recommended, redeploys on every push).** Netlify › *Add new site* › *Import an existing project* › GitHub › `weiwei-ooi/kleros-devcon-checkin`. Leave the build command empty; the publish directory is `site` (set by `netlify.toml`).
- **Drag and drop.** Netlify › *Add new site* › *Deploy manually*, then drop the `site` folder from this package. To update later: the site's *Deploys* tab › drop the folder again.

The Curate game (`/curate`) is part of `site/` (`site/curate/`, including its photos in `site/curate/img/` and their credits in `site/curate/credits.js`): nothing extra to deploy or configure. Game knobs, including the 2 counted tries a day (`countedPerDay`) and the tier thresholds, are in `site/curate/settings.js`.

Then the domain:

1. Netlify › the site › *Domain management* › *Add a domain* › `devcon.kleros.io`.
2. Cloudflare (kleros.io's DNS) › DNS › add `CNAME devcon → <site-name>.netlify.app`, **DNS only** (grey cloud) to start with, so Netlify can issue the HTTPS certificate.
3. Back in Netlify, wait for the certificate (a few minutes), then open https://devcon.kleros.io.

Note: the live record is not DNS only today. https://devcon.kleros.io answers with `server: cloudflare` (and Cloudflare's `cf-ray` header), so Cloudflare proxies in front of Netlify and can cache. That is why `site/_headers` serves the versionless scripts (`config.js`, `matching.js`, `quiz.js`, `curate/*.js`, including `curate/credits.js`) with `no-cache`. The game's photos (`curate/img/*.jpg`) keep the default caching. After a deploy, test on the real domain.

The printed booth QR codes point to devcon.kleros.io, so this must be live before Devcon (3 Nov). The team dashboard is at https://devcon.kleros.io/admin.html (needs the dashboard key); the Curate game is at https://devcon.kleros.io/curate/.

## 2. Backend (Google Apps Script)

Already deployed (web app version 18), owned by weiwei@kleros.io. Nothing to do unless the code changes. To change it: paste `backend/Code.gs` from this package (or `bash scripts/apps-script-bundle.sh | pbcopy` from the repo) over everything in the editor, save, then *Deploy › Manage deployments › ✏️ › New version › Deploy*. The URL stays the same.

No backend change for the game: `/curate` never calls the backend, so adding it needs no new version.

## 3. Keys (Apps Script › Project settings › Script properties)

| Property | What | Then run |
|---|---|---|
| `GHOST_WEBHOOK_SECRET` | Made by the code: run `ghostWebhookSetup`, which logs the webhook target URL | Ghost admin › Settings › Integrations › custom integration "Devcon booth" › add webhooks *Member added* and *Member edited*, both with that URL |
| `TELEGRAM_BOT_TOKEN` | @KlerosDevconBot's token from @BotFather | `telegramSetup` |

No Ghost API key is needed: Ghost calls the backend, never the other way round. The booth doesn't wait for the email confirmation and stays that way for Devcon (`blogGateOff`; the blog box is optional); Ghost's own double opt-in is unchanged either way. The webhooks then only mark *Newsletter* `Confirmed` in the sheet, so the booth works without them. If the wait is ever turned back on (`blogGateOn`), visitors who tick the box need the webhooks to get past "Confirm your email". Without the bot token nobody reaches Purple or Gold. The webhook URL and the token are secrets: share them only in private messages.

## 4. Check

On a phone: open the site, check in with a real email, confirm the Kleros blog email, and see the final screen. The row appears in the Sheet (*Kleros Devcon 2026 · Booth Leads Database › Leads*).

Then the game, on the same phone:

1. On the check-in's final screen, tap **Play Curate** (*Help an app keep its list clean. Better score, better merch.*): https://devcon.kleros.io/curate/ opens as its own page, the Curate title screen with no check-in header: *These apps need clean lists.*, the hint row *← Wrong* · *Correct →*, *Pick an app* and three cards, each with a picture (a real photo, a flag, painted token logos): Travel guide app, Atlas app for schools, Crypto exchange app. Under them: the prize strip and *2 tries a day count for merch.*
2. Tap a card. After one practice card the first time on this phone, the Go banner says *Try 1 of 2 · Go!*. Play the round to the end: 10 entries in 60 s with no per-entry countdown. During play the screen shows only the time ring, score, progress (*1/10*), pause, the card (picture and three lines) and the *✗ Wrong* / *✓ Correct* buttons. Mark a card Wrong: it springs back and asks *What’s wrong? Tap it.*; tapping a part decides it, and *Cancel* goes back. After every decision a full-screen flash answers: green ✓ **CORRECT** with the points, or red ✗ **WRONG** with *−75* and one short reason; the clock does not run while it shows, and a tap skips it. On Sightseeing, the photos load; on the Crypto exchange app, the logos are painted coins and the websites are plain text.
3. See the Results: the spinning medal in your tier's colour, the score, *n of 10 right*, one company line and *Try 1 of 2 · 1 try left today*. Open the ticket: the clock ticks, the date is today, and tapping the ticket turns it over (*Try 1 of 2* on the back). Play a second try (*Try 2 of 2 · Go!*, then *Both tries used today*) and a third (*Just for fun · Go!*, *Play for fun*).
4. Open *How it works*: the *Photo credits* list shows every photo's author and licence, with working links.
5. Check the back-link under the ticket (*Back to your check-in ticket →*): it opens the check-in page.
6. Confirm the check-in is unaffected: the same ticket, tier and code as before the game, and no new row in the Sheet.

More detail: `README.md`.
