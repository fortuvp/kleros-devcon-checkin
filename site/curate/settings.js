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
  tiers: [0, 350, 675, 920],                 // Everyone, Teal, Purple, Gold (v6: refitted by --fit for 2 tries a day)
  checkinNeededFrom: 1,                      // every tier above Everyone needs a confirmed check-in on this phone (anti-replay: the check-in dedupes by email/Telegram); 3 = Gold only
  countedPerDay: 2,                          // v6: 2 tries a day count for merch (title, Go banner, Results, ticket)
  kioskMaxTier: 1, kioskResetMs: 20000, kioskIdleMs: 60000,
  staffHoldMs: 2000, undoMs: 5000,
  soldOut: [],                               // e.g. ['gold'] for the rest of the day
  substitutes: { teal: null, purple: null, gold: null },   // { reward, short, img: [paths] }; short reads in a sentence
  ranks: ['Rookie spotter', 'Sharp eye', 'Eagle eye', 'Master curator'],   // by tier, when no check-in name
  // sheetApp: the /exec URL of the game owner's own sheet script (apps-script/curate-sheet/). It takes the
  // Earn for real sign-ups (earn.js) and the staff badge desk (/curate/desk/). Empty hides the sign-up form.
  // badgePattern: a regex the desk's normalised badge id must match (set it from /curate/desk/?test=1 on a real
  // badge before opening; empty accepts any 6+ letters and digits). badgeFormats: 2D codes the Android reader looks for.
  sheetApp: { endpoint: '', badgePattern: '', badgeFormats: ['qr_code', 'aztec', 'data_matrix', 'pdf417'] },
  earn: { monthly: '$5,000+' },   // the payout line on Results: keep it true
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
