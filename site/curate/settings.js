// Curate game knobs. config.js keeps merch names and pictures; this file decides who gets what.
// Edit, deploy, and phones pick the change up on their next load (no-cache). Stock runbook: README.
// After changing points, seconds or tiers, run `node scripts/curate-check.js --sim` to see the new tier shares.
window.CURATE_SETTINGS = {
  v: 1,
  seconds: 90, entries: 10, fakes: 5,       // 2 Nov: one calm 90 s round for everyone. 3 Nov c: 5 fakes, so all Correct = 5 right
  windows: [],                               // v5: no per-card countdown and no auto-listing
  points: { catch: 100, evidence: 0, letThrough: 100, wrongChallenge: 10, leak: 10,
            streakEvery: 5, streakBonus: 0, effort: 10 },
  // 3 Nov: 100 points per right answer, 10 per wrong one, 0 undecided. No evidence or streak bonus: the part picked
  // only teaches (streakEvery stays: nothing divides by zero). effort: the floor per entry decided.
  trust: { leak: -15, wrongChallenge: -5 },
  tiers: [0, 600, 800, 1000],                // Everyone, Teal, Purple, Gold (3 Nov: Teal = 6 right, Purple = 8, Gold = 10 of 10, whatever the wrong ones add; Code.gs TIERS matches: curate-check.js fails if not)
  checkinNeededFrom: 1,                      // v6 mode only (no server): every tier above Everyone needs a confirmed check-in on this phone (anti-replay: the check-in dedupes by email/Telegram); 3 = Gold only
  countedTries: 2,                           // counted tries for the whole event: per player id (Telegram, badge or phone) with the server, per phone in v6 mode; no daily reset (Code.gs TRIES_PER_BADGE matches)
  kioskMaxTier: 1,                           // v6 mode only: a booth tablet caps at this tier (badge mode: the badge is the identity, no cap)
  kioskResetMs: 20000, kioskIdleMs: 60000,
  staffHoldMs: 2000, undoMs: 5000,           // v6 mode only
  soldOut: [],                               // e.g. ['gold']; static fallback; in badge mode the Switches tab adds to it
  substitutes: { teal: null, purple: null, gold: null },   // { reward, short, img: [paths] }; short reads in a sentence
  ranks: ['Rookie spotter', 'Sharp eye', 'Eagle eye', 'Master curator'],   // by tier, when no check-in name
  // server: the one sheet script behind the tries, contacts and the staff desk (apps-script/staff-desk/).
  // endpoint: its /exec URL. Empty: v6 mode (tries and tickets on this phone) and the desk says Not connected yet.
  // timeoutMs: writes (above the script's 6 s lock wait plus a cold start); statusTimeoutMs: status reads;
  // statusMs: how often the title asks again for the switches and the badge's tries.
  server: { endpoint: 'https://script.google.com/macros/s/AKfycbx6kHB55iLyIvlmef-lyZ-H0tAnhF5pHZfJmh2JkUo67TMlBi_x0ScTtOuDS6_e2ChuDA/exec', timeoutMs: 20000, statusTimeoutMs: 8000, statusMs: 30000 },
  // verify: how players prove who they are (3 Nov): telegram | badge | none. Used until the server answers: the
  // sheet's Switches tab (Verify with) always wins. telegram: the bot behind the Verify with Telegram link
  // (t.me/<bot>?start=<nonce>); pollMs: how often the phone asks if the bot saw it; waitMs: when it stops asking.
  verify: 'telegram',
  telegram: { bot: 'KlerosBoothBot', pollMs: 2500, waitMs: 300000 },
  // badge: a Devcon badge is the player's id in badge mode (badge.js). pattern: a regex the normalised id must
  // match (set it from /staff/?test=1 on real badges; empty: 8+ characters with a letter and a digit).
  // typed: false: only scans count, players never type a code (3 Nov). formats: 2D codes the Android reader looks for.
  badge: { pattern: '', typed: false, formats: ['qr_code', 'aztec', 'data_matrix', 'pdf417'] },
  // contact: the step that unlocks a ticket above stickers (earn.js). monthly: the curator payout line
  // (approved). privacyEmail: where to ask for deletion (shown in the game's privacy notice).
  contact: { monthly: '$5,000+', privacyEmail: 'fortunato@kleros.io' },
  // Used only when config.js has no merch block with 3 tiers. An exact copy of config.js merch today.
  fallbackMerch: {
    free: { reward: 'Stickers and metallic tattoos', how: 'Free for everyone at the booth',
            img: ['assets/merch/stickers.jpg', 'assets/merch/tattoo.jpg'] },
    tiers: [
      { name: 'Teal', reward: 'Kleros flip-flops', short: 'Kleros flip-flops', img: ['assets/merch/flipflops.jpg'] },
      { name: 'Purple', reward: 'Copper bottle or gamcha', short: 'a copper bottle or gamcha',
        img: ['assets/merch/bottle.jpg', 'assets/merch/gamcha.jpg'] },
      { name: 'Gold', reward: 'Kleros kurta', short: 'a Kleros kurta', img: ['assets/merch/kurta.jpg'] }
    ],
    note: 'One item per person, while stocks last'
  }
};
