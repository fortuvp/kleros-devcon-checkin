// Curate game content: the two fictional clients, their lists and every entry. Data only: rules.js deals the
// shift, game.js shows it. Real project names appear only as entry text. Domains are plain text, never links.
// Re-check every domain and ticker before merge, and again the week before the event.
// `node scripts/curate-check.js` validates this file (ids, fields, tells, lengths, shapes and marks).
(function () {
  // ---- Lists ----
  var WALLET = {
    sites: { name: 'Websites', policy: 'Policy: the app’s official website only. No lookalikes.',
             fields: [['app', 'App'], ['site', 'Website'], ['does', 'What it does']] },
    tokens: { name: 'Tokens', policy: 'Policy: coin, name and ticker must be the same token. No ads.',
              fields: [['coin', 'Coin'], ['name', 'Name'], ['ticker', 'Ticker']], objField: 'coin' },
    labels: { name: 'Contract labels', policy: 'Policy: label, project and website must match. No ads.',
              fields: [['label', 'Label'], ['project', 'Project'], ['site', 'Website']] }
  };
  var MUMBAI = {
    city: { name: 'City list', policy: 'Policy: real Mumbai sights only. City and type must be true.',
            fields: [['place', 'Place'], ['city', 'City'], ['type', 'Type']] }
  };

  // ---- Builders ----
  // Rows keep the file small. Each row becomes a full item:
  // { id, list, twin, lvl, obj: { shape, color, mark }, f: { the list’s 3 fields }, bad, also, tell, fix, why }
  // `bad` is the faulty field (null for a good entry); `also` lists other fields accepted as sharp evidence.
  // `tell` is 'card' when the card plus the policy show the flaw, 'know' when it takes knowing the fact.
  function item(list, fields, r, obj, lvl, at) {
    var f = {}, it, i;
    for (i = 0; i < 3; i++) f[fields[i][0]] = r[at + i];
    it = { id: r[0], list: list, twin: r[1] || null, lvl: lvl, obj: obj, f: f,
           bad: r[at + 4] || null, also: r[at + 7] || [], why: r[at + 3] };
    if (it.bad) { it.tell = r[at + 5]; it.fix = r[at + 6]; }
    return it;
  }
  // Wallet rows: [id, twin, colour, mark, field 1, field 2, field 3, why, bad, tell, fix, also]
  function wallet(list, shape, lvl, rows) {
    return rows.map(function (r) {
      return item(list, WALLET[list].fields, r, { shape: shape, color: r[2], mark: r[3] }, lvl, 4);
    });
  }
  // City rows: [id, twin, shape, colour, lvl, place, city, type, why, bad, tell, fix]
  // The landmark always has the place’s true shape, so a wrong type can be seen on the card.
  function city(rows) {
    return rows.map(function (r) {
      return item('city', MUMBAI.city.fields, r, { shape: r[2], color: r[3] }, r[4], 5);
    });
  }

  // ---- Wallet · Websites (shield; 9 good, 7 fake) ----
  var SITES = wallet('sites', 'shield', 1, [
    ['site-opensea', 'opensea-s', '#2081e2', 'O', 'OpenSea', 'opensea.io', 'NFT marketplace', 'OpenSea’s real site.'],
    ['site-uniswap', 'uniswap-s', '#ff3fa4', 'U', 'Uniswap', 'app.uniswap.org', 'Token swaps', 'The real Uniswap app.'],
    ['site-aave', 'aave-s', '#9a7bff', 'A', 'Aave', 'app.aave.com', 'Lending', 'The real Aave app.'],
    ['site-ens', null, '#5298ff', 'E', 'ENS', 'app.ens.domains', '.eth names', 'The real ENS app.'],
    ['site-kleros', 'kleros-s', '#9013fe', 'kleros', 'Kleros', 'kleros.io', 'Dispute resolution', 'Kleros’ real site.'],
    ['site-devcon', 'devcon-s', '#f5a524', 'D', 'Devcon', 'devcon.org', 'Ethereum conference',
      'Devcon’s real site. You’re here.'],
    ['site-etherscan', 'etherscan-s', '#5b8def', 'E', 'Etherscan', 'etherscan.io', 'Block explorer',
      'Etherscan’s real site.'],
    ['site-metamask', 'metamask-s', '#f6851b', 'M', 'MetaMask', 'metamask.io', 'Wallet', 'MetaMask’s real site.'],
    ['site-safe', null, '#2fd47a', 'S', 'Safe', 'app.safe.global', 'Multisig wallet', 'The real Safe app.'],
    ['site-opensea-bad', 'opensea-s', '#2081e2', 'O', 'OpenSea', '0pensea.io', 'NFT marketplace',
      'That’s a zero, not an O. OpenSea is opensea.io.', 'site', 'card', 'opensea.io'],
    ['site-uniswap-bad', 'uniswap-s', '#ff3fa4', 'U', 'Uniswap', 'uniswap.org.claim-now.xyz', 'Token swaps',
      'Read the end: this site is claim-now.xyz, not Uniswap.', 'site', 'card', 'app.uniswap.org'],
    ['site-aave-bad', 'aave-s', '#9a7bff', 'A', 'Aave', 'aave-app.co', 'Lending',
      'Not Aave’s domain. The Aave app is app.aave.com.', 'site', 'know', 'app.aave.com'],
    ['site-devcon-bad', 'devcon-s', '#f5a524', 'D', 'Devcon', 'devcon-tickets.xyz', 'Ethereum conference',
      'Devcon is devcon.org. Fake ticket sites are a classic scam.', 'site', 'card', 'devcon.org'],
    ['site-metamask-bad', 'metamask-s', '#f6851b', 'M', 'MetaMask', 'metamask-support.help', 'Wallet',
      'MetaMask is metamask.io. Fake support sites steal seed phrases.', 'site', 'know', 'metamask.io'],
    ['site-kleros-bad', 'kleros-s', '#9013fe', 'kleros', 'Kleros', 'klerros.io', 'Dispute resolution',
      'One r too many. Kleros is kleros.io.', 'site', 'card', 'kleros.io'],
    ['site-etherscan-bad', 'etherscan-s', '#5b8def', 'E', 'Etherscan', 'etherscan.io', 'Crypto wallet',
      'Etherscan is a block explorer, not a wallet.', 'does', 'know', 'Block explorer']
  ]);

  // ---- Wallet · Tokens (coin; the coin is the `coin` field and can be tapped; 11 good, 6 fake) ----
  // The Coin row describes the coin in words, so it reads on any phone and to screen readers.
  var TOKENS = wallet('tokens', 'coin', 2, [
    ['tok-uni', 'uni', '#ff3fa4', 'U', 'Pink, letter U', 'Uniswap', 'UNI', 'Coin, name and ticker all match Uniswap.'],
    ['tok-link', 'link', '#2a5ada', 'hex', 'Blue, hexagon', 'Chainlink', 'LINK',
      'Chainlink’s ticker is LINK. All three match.'],
    ['tok-usdc', 'usdc', '#2775ca', 'dollar', 'Blue, dollar sign', 'USD Coin', 'USDC', 'USD Coin is USDC. All three match.'],
    ['tok-dai', null, '#f5ac37', 'diamond', 'Amber, diamond', 'Dai', 'DAI', 'Dai is DAI. All three match.'],
    ['tok-weth', 'weth', '#8c93a8', 'eth', 'Silver, Ether sign Ξ', 'Wrapped Ether', 'WETH',
      'WETH wraps Ether, hence the Ξ coin.'],
    ['tok-pnk', null, '#9013fe', 'kleros', 'Purple, Kleros mark', 'Kleros', 'PNK',
      'Kleros’ token is PNK, after the pinakion, a juror’s ticket.'],
    ['tok-gno', null, '#1fb58f', 'G', 'Green, letter G', 'Gnosis', 'GNO', 'Gnosis is GNO. All three match.'],
    ['tok-ldo', null, '#5ab0ff', 'L', 'Sky blue, letter L', 'Lido DAO', 'LDO', 'Lido DAO is LDO. All three match.'],
    ['tok-aave', null, '#9a7bff', 'A', 'Lilac, letter A', 'Aave', 'AAVE', 'Aave’s ticker is AAVE. All three match.'],
    ['tok-ens', null, '#5298ff', 'E', 'Blue, letter E', 'ENS', 'ENS', 'ENS is ENS. All three match.'],
    ['tok-arb', 'arb', '#28a0f0', 'A', 'Azure, letter A', 'Arbitrum', 'ARB', 'Arbitrum is ARB. All three match.'],
    ['tok-usdt-bad', 'usdc', '#2775ca', 'dollar', 'Blue, dollar sign', 'USD Coin', 'USDT',
      'USD Coin is USDC. USDT is Tether’s ticker.', 'ticker', 'know', 'USDC'],
    ['tok-arb-bad', 'arb', '#28a0f0', 'A', 'Azure, letter A', 'Arbitrum', 'OP',
      'Arbitrum is ARB. OP is Optimism’s ticker.', 'ticker', 'know', 'ARB'],
    ['tok-weth-bad', 'weth', '#f7931a', 'btc', 'Orange, Bitcoin sign', 'Wrapped Ether', 'WETH',
      'A Bitcoin coin on an Ether entry. WETH’s coin carries Ξ.', 'coin', 'card', 'Silver, Ether sign Ξ'],
    ['tok-bal-bad', null, '#4a4a6a', 'B', 'Slate, letter B', 'Balancer', 'CRV',
      'Balancer is BAL. CRV is Curve’s ticker.', 'ticker', 'know', 'BAL'],
    ['tok-spam-bad', 'uni', '#ff3fa4', 'U', 'Pink, letter U', 'Claim UNI at uni-bonus.xyz', 'UNI',
      'A token name that advertises a website is a spam trick.', 'name', 'card', 'Uniswap'],
    ['tok-link-bad', 'link', '#ff3fa4', 'U', 'Pink, letter U', 'Chainlink', 'LINK',
      'That’s a pink U coin. Chainlink’s coin is the blue hexagon.', 'coin', 'card', 'Blue, hexagon']
  ]);

  // ---- Wallet · Contract labels (contract block with a hanging tag; 8 good, 6 fake) ----
  // The tag’s colour and mark are the label’s project.
  var LABELS = wallet('labels', 'tag', 3, [
    ['lab-router', 'router', '#ff3fa4', 'U', 'Uniswap V3: Router', 'Uniswap', 'uniswap.org',
      'Label, project and website all agree.'],
    ['lab-pool', 'pool', '#9a7bff', 'A', 'Aave V3: Pool', 'Aave', 'aave.com', 'Label, project and website all agree.'],
    ['lab-court', null, '#9013fe', 'kleros', 'Kleros: Court', 'Kleros', 'kleros.io',
      'The court that rules on Curate challenges.'],
    ['lab-ens', 'ens-l', '#5298ff', 'E', 'ENS: Registry', 'ENS', 'ens.domains', 'ENS lives at ens.domains. All three agree.'],
    ['lab-steth', 'steth', '#5ab0ff', 'L', 'Lido: stETH Token', 'Lido', 'lido.fi', 'Lido’s site is lido.fi. All three agree.'],
    ['lab-safe', null, '#2fd47a', 'S', 'Safe: Proxy Factory', 'Safe', 'safe.global', 'Label, project and website all agree.'],
    ['lab-seaport', 'seaport', '#2081e2', 'O', 'OpenSea: Seaport', 'OpenSea', 'opensea.io',
      'Seaport is OpenSea’s marketplace contract.'],
    ['lab-feed', null, '#2a5ada', 'hex', 'Chainlink: ETH/USD Feed', 'Chainlink', 'chain.link',
      'Chainlink’s site is chain.link. All three agree.'],
    ['lab-router-bad', 'router', '#ff3fa4', 'U', 'Uniswap V3: Router', 'Uniswap', 'uniswap-rewards.app',
      'That’s not Uniswap’s site. “Rewards” domains are a phishing classic.', 'site', 'card', 'uniswap.org'],
    ['lab-pool-bad', 'pool', '#9a7bff', 'A', 'Aave V3: Pool', 'Compound', 'aave.com',
      'Label and website say Aave. The project says Compound.', 'project', 'card', 'Aave'],
    ['lab-ad-bad', null, '#ff5a78', 'bang', 'FREE ETH: Claim now', 'Unknown', 'claim-eth.gift',
      'A label says what a contract is. Ads and promises aren’t labels.', 'label', 'card', 'A plain contract name',
      ['site']],
    ['lab-ens-bad', 'ens-l', '#5298ff', 'E', 'ENS: Registry', 'ENS', 'ens-domains.net',
      'ENS lives at ens.domains, not ens-domains.net.', 'site', 'know', 'ens.domains'],
    ['lab-steth-bad', 'steth', '#5ab0ff', 'L', 'Lido: stETH Token', 'Lido', 'lido-staking.org',
      'Lido’s site is lido.fi.', 'site', 'know', 'lido.fi'],
    ['lab-seaport-bad', 'seaport', '#2081e2', 'O', 'OpenSea: Seaport', 'Blur', 'opensea.io',
      'Label and website say OpenSea. Seaport isn’t Blur’s.', 'project', 'card', 'OpenSea']
  ]);

  // ---- Mumbai · City list (landmark miniature; 18 good, 15 fake) ----
  // Left out on purpose: Taj Mahal (the Taj Mahal Palace hotel is in Mumbai), Elephanta (Raigad district).
  var CITY = city([
    ['m-gateway', 'gateway', 'arch', '#e8c79a', 1, 'Gateway of India', 'Mumbai', 'Monument',
      'Mumbai’s 1924 waterfront arch.'],
    ['m-csmt', null, 'station', '#d9b48a', 1, 'Chhatrapati Shivaji Maharaj Terminus', 'Mumbai', 'Railway station',
      'Mumbai’s Victorian Gothic station, a UNESCO site.'],
    ['m-sealink', 'sealink', 'bridge', '#9fb4d8', 1, 'Bandra–Worli Sea Link', 'Mumbai', 'Bridge',
      'The cable-stayed bridge across Mahim Bay.'],
    ['m-marine', 'marine', 'wave', '#5ec8e5', 1, 'Marine Drive', 'Mumbai', 'Seafront',
      'Mumbai’s curving seafront, the Queen’s Necklace.'],
    ['m-juhu', 'juhu', 'wave', '#6fd0d8', 1, 'Juhu Beach', 'Mumbai', 'Beach', 'Mumbai’s best-known beach.'],
    ['m-jio', 'jio', 'block', '#8fd3ff', 1, 'Jio World Centre', 'Mumbai', 'Convention centre',
      'Devcon VIII’s venue. You’re standing in it.'],
    ['m-hajiali', null, 'dome', '#f1ecff', 2, 'Haji Ali Dargah', 'Mumbai', 'Shrine', 'A shrine on an islet off Worli.'],
    ['m-siddhi', 'siddhi', 'temple', '#e7b94c', 2, 'Siddhivinayak Temple', 'Mumbai', 'Temple',
      'A famous Ganesh temple in Prabhadevi.'],
    ['m-csmvs', null, 'dome', '#d9b48a', 2, 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', 'Mumbai', 'Museum',
      'Mumbai’s main museum, once the Prince of Wales Museum.'],
    ['m-sgnp', null, 'park', '#4fbf7f', 2, 'Sanjay Gandhi National Park', 'Mumbai', 'National park',
      'A national park inside the city, in Borivali.'],
    ['m-manibhavan', null, 'house', '#c86b4a', 2, 'Mani Bhavan', 'Mumbai', 'Museum', 'Gandhi’s Mumbai home, now a museum.'],
    ['m-chowpatty', null, 'wave', '#5ec8e5', 2, 'Girgaon Chowpatty', 'Mumbai', 'Beach',
      'The beach at the end of Marine Drive.'],
    ['m-kalaghoda', null, 'house', '#c9b8a6', 2, 'Kala Ghoda', 'Mumbai', 'Arts district',
      'Mumbai’s arts district, home of a yearly festival.'],
    ['m-pagoda', null, 'dome', '#e7b94c', 2, 'Global Vipassana Pagoda', 'Mumbai', 'Pagoda', 'The golden pagoda at Gorai.'],
    ['m-crawford', null, 'station', '#d9b48a', 2, 'Crawford Market', 'Mumbai', 'Market',
      'Mumbai’s historic market, near CSMT.'],
    ['m-mountmary', null, 'tower', '#f1ecff', 2, 'Mount Mary Basilica', 'Mumbai', 'Church',
      'The hilltop basilica in Bandra.'],
    ['m-dhobi', null, 'block', '#c9b8a6', 2, 'Dhobi Ghat', 'Mumbai', 'Open-air laundry',
      'Mumbai’s famous open-air laundry at Mahalaxmi.'],
    ['m-rajabai', null, 'tower', '#d9b48a', 2, 'Rajabai Clock Tower', 'Mumbai', 'Clock tower',
      'The clock tower on the University of Mumbai campus.'],
    ['m-charminar-bad', null, 'minarets', '#e8c79a', 1, 'Charminar', 'Hyderabad', 'Monument',
      'True, but this list is Mumbai only. Charminar is in Hyderabad.', 'city', 'card', 'Mumbai only'],
    ['m-howrah-bad', null, 'bridge', '#9fb4d8', 1, 'Howrah Bridge', 'Kolkata', 'Bridge',
      'True, but this list is Mumbai only. It’s in Kolkata.', 'city', 'card', 'Mumbai only'],
    ['m-golden-bad', null, 'dome', '#e7b94c', 1, 'Golden Temple', 'Amritsar', 'Temple',
      'True, but this list is Mumbai only. It’s in Amritsar.', 'city', 'card', 'Mumbai only'],
    ['m-victoria-bad', null, 'dome', '#f1ecff', 1, 'Victoria Memorial', 'Kolkata', 'Museum',
      'True, but this list is Mumbai only. It’s in Kolkata.', 'city', 'card', 'Mumbai only'],
    ['m-redfort-bad', null, 'palace', '#c86b4a', 1, 'Red Fort', 'Delhi', 'Fort',
      'True, but this list is Mumbai only. The Red Fort is in Delhi.', 'city', 'card', 'Mumbai only'],
    ['m-hawa-bad', null, 'palace', '#f08a8a', 2, 'Hawa Mahal', 'Mumbai', 'Palace',
      'Hawa Mahal is in Jaipur, not Mumbai.', 'city', 'know', 'Jaipur'],
    ['m-mysore-bad', null, 'palace', '#e8c79a', 2, 'Mysore Palace', 'Mumbai', 'Palace',
      'Mysore Palace is in Mysuru, not Mumbai.', 'city', 'know', 'Mysuru'],
    ['m-qutub-bad', null, 'tower', '#c86b4a', 2, 'Qutub Minar', 'Mumbai', 'Tower',
      'Qutub Minar is in Delhi, not Mumbai.', 'city', 'know', 'Delhi'],
    ['m-meenakshi-bad', null, 'temple', '#f08a8a', 2, 'Meenakshi Temple', 'Mumbai', 'Temple',
      'Meenakshi Temple is in Madurai, not Mumbai.', 'city', 'know', 'Madurai'],
    ['m-gateway-bad', 'gateway', 'arch', '#e8c79a', 1, 'Gateway of India', 'Mumbai', 'Bridge',
      'It’s an arch monument, not a bridge. Look at it.', 'type', 'card', 'Monument'],
    ['m-juhu-bad', 'juhu', 'wave', '#6fd0d8', 1, 'Juhu Beach', 'Mumbai', 'Railway station',
      'Juhu is a beach, not a railway station.', 'type', 'card', 'Beach'],
    ['m-siddhi-bad', 'siddhi', 'temple', '#e7b94c', 1, 'Siddhivinayak Temple', 'Mumbai', 'Beach',
      'Siddhivinayak is a temple, not a beach.', 'type', 'card', 'Temple'],
    ['m-sealink-bad', 'sealink', 'bridge', '#9fb4d8', 1, 'Bandra–Worli Sea Link', 'Mumbai', 'Temple',
      'The Sea Link is a bridge, not a temple.', 'type', 'card', 'Bridge'],
    ['m-marine-bad', 'marine', 'wave', '#5ec8e5', 1, 'Marine Drive', 'Mumbai', 'Fort',
      'Marine Drive is a seafront promenade, not a fort.', 'type', 'card', 'Seafront'],
    ['m-jio-bad', 'jio', 'block', '#8fd3ff', 2, 'Jio World Centre', 'Mumbai', 'Cricket stadium',
      'It’s a convention centre. Devcon VIII is inside it.', 'type', 'know', 'Convention centre']
  ]);

  // ---- Decks ----
  // Practice cards live apart and never enter a shift: the first breaks the policy, the second is good.
  window.CURATE_DECKS = {
    wallet: {
      id: 'wallet', client: 'Wallet app',
      copy: {
        story1: 'A wallet app shows this list to its users. Fakes keep slipping in.',
        payoff: 'Clean list: safe users, and the app keeps earning.',
        switchTo: 'Not into crypto? Play the Mumbai city list',
        repSwitch: 'Switch to the Mumbai city list',
        quotes: ['“Our users only saw real entries today. Same time tomorrow?”',
                 '“A few fakes got through. We filed removal requests to take them down.”',
                 '“Users swapped into fakes. We’re pausing the list until it’s clean.”'],   // trust ≥ 90, 70–89, < 70
        quoteBy: 'Wallet app (fictional client)'
      },
      hero: [{ shape: 'tag', color: '#27cdfe', mark: 'hex' }, { shape: 'coin', color: '#9013fe', mark: 'kleros' },
             { shape: 'shield', color: '#65dc7f', mark: 'S' }],
      lists: WALLET,
      easy: 'sites', late: 'labels',
      split: { sites: [7, 3], tokens: [7, 3], labels: [6, 2] },   // [entries, fakes]
      practice: wallet('tokens', 'coin', 2, [
        ['prac-klr', null, '#9013fe', 'kleros', 'Purple, Kleros mark', 'Kleros', 'KLR',
          'Kleros’ token is PNK, not KLR.', 'ticker', 'know', 'PNK']
      ]).concat(wallet('sites', 'shield', 1, [
        ['prac-devcon', null, '#f5a524', 'D', 'Devcon', 'devcon.org', 'Ethereum conference',
          'Every line checks out: devcon.org is Devcon’s site.']
      ])),
      items: SITES.concat(TOKENS, LABELS)
    },
    mumbai: {
      id: 'mumbai', client: 'City guide app',
      copy: {
        story1: 'A city guide app shows this list to visitors. Wrong sights keep slipping in.',
        payoff: 'Clean list: happy visitors, and the guide keeps earning.',
        switchTo: 'Play the wallet lists instead',
        repSwitch: 'Switch to the wallet lists',
        quotes: ['“Visitors found every sight. Same time tomorrow?”',
                 '“A couple of wrong sights slipped in. We filed removal requests.”',
                 '“Visitors went to the wrong places. We’re pausing the list.”'],
        quoteBy: 'City guide app (fictional client)'
      },
      hero: [{ shape: 'arch', color: '#e8c79a' }, { shape: 'bridge', color: '#9fb4d8' }, { shape: 'dome', color: '#f1ecff' }],
      lists: MUMBAI,
      easy: null, late: null,   // easy pool: lvl 1 entries
      split: { city: [20, 8] },
      practice: city([
        ['prac-indiagate', null, 'arch', '#e8c79a', 1, 'India Gate', 'Mumbai', 'Monument',
          'India Gate is in New Delhi. Mumbai has the Gateway of India.', 'city', 'know', 'New Delhi'],
        ['prac-gateway', null, 'arch', '#e8c79a', 1, 'Gateway of India', 'Mumbai', 'Monument',
          'Mumbai’s 1924 waterfront arch.']
      ]),
      items: CITY
    }
  };
})();
