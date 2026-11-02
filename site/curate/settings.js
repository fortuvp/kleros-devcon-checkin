// Curate game knobs. config.js keeps merch names and pictures; this file decides who gets what.
// Edit, deploy, and phones pick the change up on their next load (no-cache). Stock runbook: README.
// After changing points, seconds or tiers, run `node scripts/curate-check.js --sim` to see the new tier shares.
window.CURATE_SETTINGS = {
  v: 1,
  seconds: 60, relaxedSeconds: 90, entries: 10, fakes: 4,   // v5: one calm 60 s round, relaxed only adds time
  windows: [],                               // v5: no per-card countdown and no auto-listing
  points: { catch: 75, evidence: 50, letThrough: 25, wrongChallenge: -75, leak: -75,
            streakEvery: 5, streakBonus: 50, perSecondLeft: 5, bonusMaxMistakes: 2, bonusMinEvidence: 1 },
  // Relaxed only adds time: its time bonus counts seconds left as if the round were `seconds` long, so it is never an easier road to Gold.
  // evidence: the fake part picked in pick mode. bonusMinEvidence: the time bonus also needs this many
  // fakes spotted (blind swiping rarely earns it)
  trust: { leak: -15, wrongChallenge: -5 },
  tiers: [0, 350, 675, 920],                 // Everyone, Teal, Purple, Gold (v6: refitted by --fit for 2 tries a day; Code.gs TIERS matches: curate-check.js fails if not)
  checkinNeededFrom: 1,                      // v6 mode only (no server): every tier above Everyone needs a confirmed check-in on this phone (anti-replay: the check-in dedupes by email/Telegram); 3 = Gold only
  countedPerDay: 2,                          // counted tries a day: per phone in v6 mode, per badge in badge mode (Code.gs PER_DAY matches)
  kioskMaxTier: 1,                           // v6 mode only: a booth tablet caps at this tier (badge mode: the badge is the identity, no cap)
  kioskResetMs: 20000, kioskIdleMs: 60000,
  staffHoldMs: 2000, undoMs: 5000,           // v6 mode only
  soldOut: [],                               // e.g. ['gold']; static fallback; in badge mode the Switches tab adds to it
  substitutes: { teal: null, purple: null, gold: null },   // { reward, short, img: [paths] }; short reads in a sentence
  ranks: ['Rookie spotter', 'Sharp eye', 'Eagle eye', 'Master curator'],   // by tier, when no check-in name
  // server: the one sheet script behind badge tries, contacts and the staff desk (apps-script/staff-desk/).
  // endpoint: its /exec URL. Empty: v6 mode (tries and tickets on this phone) and the desk says Not connected yet.
  // timeoutMs: writes (above the script's 6 s lock wait plus a cold start); statusTimeoutMs: status reads;
  // statusMs: how often the title asks again for the switches and the badge's tries.
  server: { endpoint: '', timeoutMs: 20000, statusTimeoutMs: 8000, statusMs: 30000 },
  // badge: a Devcon badge is the player's id in badge mode (badge.js). pattern: a regex the normalised id must
  // match (set it from /staff/?test=1 on real badges; empty: 8+ characters with a letter and a digit).
  // typed: false when /staff/?test=1 shows the printed code isn't the QR's id (then only scans count).
  // formats: 2D codes the Android reader looks for.
  badge: { pattern: '', typed: true, formats: ['qr_code', 'aztec', 'data_matrix', 'pdf417'] },
  // contact: the step that unlocks a ticket above stickers (earn.js). monthly: the curator payout line
  // (approved). privacyEmail: where to ask for deletion (shown in the game's privacy notice).
  contact: { monthly: '$5,000+', privacyEmail: 'fortunato@kleros.io' },
  // lastDay: the last booth day (IST); after it the game stops promising new tries tomorrow.
  lastDay: '2026-11-06',
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
