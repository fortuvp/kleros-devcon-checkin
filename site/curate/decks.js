// Curate game content: three fictional apps that each need one clean list, and every entry. Data only:
// rules.js deals the round, game.js shows it. Facts (sights, cities, capitals, flags, web domains, tokens,
// tickers and websites) were checked by hand; re-check before merge. `node scripts/curate-check.js` validates
// this file (ids, fields, tells, lengths, photos and their credits, flags, logos, one odd part per fake).
(function () {
  // ---- Flags ----
  // [spec for CurateObjects._flag, words for the alt text and the fix line]. Kinds: v3 (hoist to fly), h3 (top
  // to bottom, optional ratio), h2, nordic (field, cross, optional inner), disc (field, disc, optional off:
  // fraction of the width, negative towards the hoist), cross (Swiss), h3wheel (India). Colours follow each
  // country’s official specification as #rrggbb; black is lifted to #1a1a1a so it still reads on the dark stage.
  var FLAGS = {
    it: [{ kind: 'v3', c: ['#009246', '#ffffff', '#ce2b37'] }, 'Green, white, red'],
    fr: [{ kind: 'v3', c: ['#0055a4', '#ffffff', '#ef4135'] }, 'Blue, white, red'],
    ie: [{ kind: 'v3', c: ['#169b62', '#ffffff', '#ff883e'] }, 'Green, white, orange'],
    be: [{ kind: 'v3', c: ['#1a1a1a', '#fdda24', '#ef3340'] }, 'Black, yellow, red'],
    ng: [{ kind: 'v3', c: ['#008751', '#ffffff', '#008751'] }, 'Green, white, green'],
    de: [{ kind: 'h3', c: ['#1a1a1a', '#dd0000', '#ffce00'] }, 'Black, red, gold'],
    at: [{ kind: 'h3', c: ['#c8102e', '#ffffff', '#c8102e'] }, 'Red, white, red'],
    hu: [{ kind: 'h3', c: ['#ce2939', '#ffffff', '#477050'] }, 'Red, white, green'],
    ee: [{ kind: 'h3', c: ['#0072ce', '#1a1a1a', '#ffffff'] }, 'Blue, black, white'],
    co: [{ kind: 'h3', c: ['#fcd116', '#003893', '#ce1126'], ratio: [2, 1, 1] }, 'Yellow, blue, red'],
    pl: [{ kind: 'h2', c: ['#ffffff', '#dc143c'] }, 'White over red'],
    mc: [{ kind: 'h2', c: ['#ce1126', '#ffffff'] }, 'Red over white'],
    se: [{ kind: 'nordic', c: ['#006aa7', '#fecc02'] }, 'Blue, yellow cross'],
    fi: [{ kind: 'nordic', c: ['#ffffff', '#002f6c'] }, 'White, blue cross'],
    dk: [{ kind: 'nordic', c: ['#c8102e', '#ffffff'] }, 'Red, white cross'],
    no: [{ kind: 'nordic', c: ['#ba0c2f', '#ffffff'], inner: '#00205b' }, 'Red, blue cross edged white'],
    is: [{ kind: 'nordic', c: ['#02529c', '#ffffff'], inner: '#dc1e35' }, 'Blue, red cross edged white'],
    jp: [{ kind: 'disc', c: ['#ffffff', '#bc002d'] }, 'White, red disc'],
    bd: [{ kind: 'disc', c: ['#006a4e', '#f42a41'], off: -0.05 }, 'Green, red disc'],
    ch: [{ kind: 'cross', c: ['#da291c', '#ffffff'] }, 'Red, white cross'],
    'in': [{ kind: 'h3wheel', c: ['#ff9933', '#ffffff', '#138808', '#000080'] }, 'Saffron, white, green, navy wheel']
  };

  // ---- Photos ----
  // Wikimedia Commons photos in /curate/img/ (credits.js holds author and licence for each). Key: the file name.
  // [words for the alt text and the fix line, true name, city, country, crop?]. City is the city, or “Near …”
  // when the sight stands outside one. crop: CSS object-position for a tall photo in the wide slot, so the
  // head, arms or torch stay in view (centred when left out).
  var PHOTOS = {
    'eiffel': ['Iron lattice tower', 'Eiffel Tower', 'Paris', 'France'],
    'colosseum': ['Oval arena of stone arches', 'Colosseum', 'Rome', 'Italy'],
    'taj-mahal': ['White marble dome, four minarets', 'Taj Mahal', 'Agra', 'India'],
    'opera-house': ['White shell-shaped roofs', 'Sydney Opera House', 'Sydney', 'Australia'],
    'great-wall': ['Stone wall winding over hills', 'Great Wall of China', 'Near Beijing', 'China'],
    'golden-gate': ['Red suspension bridge', 'Golden Gate Bridge', 'San Francisco', 'USA'],
    'machu-picchu': ['Stone ruins on a mountain ridge', 'Machu Picchu', 'Near Cusco', 'Peru'],
    'big-ben': ['Gothic clock tower', 'Big Ben', 'London', 'UK', '50% 25%'],
    'burj-khalifa': ['Very tall glass skyscraper', 'Burj Khalifa', 'Dubai', 'UAE'],
    'sagrada-familia': ['Basilica with tall spires', 'Sagrada Família', 'Barcelona', 'Spain'],
    'statue-liberty': ['Green statue with a torch', 'Statue of Liberty', 'New York', 'USA', '50% 0%'],
    'christ-redeemer': ['Statue, arms spread wide', 'Christ the Redeemer', 'Rio de Janeiro', 'Brazil', '50% 7%'],
    'gateway-of-india': ['Stone arch lit at dusk', 'Gateway of India', 'Mumbai', 'India'],
    'cst-mumbai': ['Gothic station with domes', 'Chhatrapati Shivaji Terminus', 'Mumbai', 'India'],
    'sea-link': ['Cable-stayed bridge over the sea', 'Bandra–Worli Sea Link', 'Mumbai', 'India'],
    'haji-ali': ['White shrine with a dome', 'Haji Ali Dargah', 'Mumbai', 'India'],
    'marine-drive': ['Curving seafront at night', 'Marine Drive', 'Mumbai', 'India'],
    'elephanta': ['Three-faced stone carving', 'Elephanta Caves', 'Near Mumbai', 'India']
  };
  function photo(key) {
    var o = { shape: 'photo', src: '/curate/img/' + key + '.jpg', alt: PHOTOS[key][0] };
    if (PHOTOS[key][4]) o.pos = PHOTOS[key][4];
    return o;
  }

  // ---- Logos ----
  // Painted flat logo coins (CurateObjects 'coin'), never downloaded: [spec, words for the alt text and the fix
  // line]. color is the coin face; color2, where given, is the glyph colour when it is not white. The words
  // describe what the painter draws for each mark.
  var LOGOS = {
    btc: [{ color: '#f7931a', mark: 'btc' }, 'Orange coin, white B'],
    eth: [{ color: '#627eea', mark: 'eth' }, 'Blue coin, white diamond'],
    usdt: [{ color: '#26a17b', mark: 'usdt' }, 'Green coin, white T'],
    usdc: [{ color: '#2775ca', mark: 'usdc' }, 'Blue coin, $ in a ring'],
    doge: [{ color: '#c2a633', mark: 'doge' }, 'Gold coin, white D'],
    sol: [{ color: '#1a1a1a', mark: 'sol' }, 'Black coin, three slanted bars'],
    ada: [{ color: '#0033ad', mark: 'ada' }, 'Navy coin, rings of white dots'],
    link: [{ color: '#2a5ada', mark: 'link' }, 'Blue coin, white hexagon'],
    uni: [{ color: '#ff007a', mark: 'uni' }, 'Pink coin, white U'],
    pol: [{ color: '#8247e5', mark: 'pol' }, 'Purple coin, two linked hexagons'],
    avax: [{ color: '#e84142', mark: 'avax' }, 'Red coin, white triangle'],
    shib: [{ color: '#ffa409', mark: 'shib' }, 'Amber coin, white dog face'],
    bnb: [{ color: '#1a1a1a', color2: '#f0b90b', mark: 'bnb' }, 'Black coin, gold squares'],
    pnk: [{ color: '#9013fe', mark: 'pnk' }, 'Violet coin, Kleros mark']
  };
  function logo(key) {
    var s = LOGOS[key][0], o = { shape: 'coin' }, k;
    for (k in s) if (s.hasOwnProperty(k)) o[k] = s[k];
    return o;
  }

  // ---- Builders ----
  // Rows keep the file small. Each row becomes a full item:
  // { id, list, twin, lvl, obj, f: { the list’s 4 fields }, bad, also, tell, fix, why }
  // `bad` is the one odd part (null for a good entry): the other three always agree with each other.
  // `tell` is 'card' when the card plus the policy show the flaw, 'know' when it takes knowing the fact.
  // `twin` keys (a string or a list) keep a round to one entry per photo, sight, country or token.
  // The picture part (objField) has no text row: its words are the alt text and the fix line.
  function item(list, r, f, obj, lvl, at) {
    var it = { id: r[0], list: list, twin: r[1] || null, lvl: lvl, obj: obj, f: f,
               bad: r[at + 1] || null, also: [], why: r[at] };
    if (it.bad) { it.tell = r[at + 2]; it.fix = r[at + 3]; }
    return it;
  }
  // Sight rows: [id, twin, lvl, shown photo, name, city, country, why, bad, tell, fix]
  function sights(rows) {
    return rows.map(function (r) {
      return item('sights', r, { photo: PHOTOS[r[3]][0], name: r[4], city: r[5], country: r[6] }, photo(r[3]), r[2], 7);
    });
  }
  // Country rows: [id, twin, lvl, drawn flag, country, capital, web domain, why, bad, tell, fix]
  function country(rows) {
    return rows.map(function (r) {
      var fl = FLAGS[r[3]];
      return item('countries', r, { flag: fl[1], country: r[4], capital: r[5], domain: r[6] },
        { shape: 'flag', flag: fl[0] }, r[2], 7);
    });
  }
  // Token rows: [id, twin, lvl, drawn logo, name, ticker, website, why, bad, tell, fix]
  function tokens(rows) {
    return rows.map(function (r) {
      return item('tokens', r, { logo: LOGOS[r[3]][1], name: r[4], ticker: r[5], site: r[6] }, logo(r[3]), r[2], 7);
    });
  }

  // ---- Sights (photo; 18 good, 14 fake) ----
  // Twins: the photo file, plus the claimed sight when a photo is named after another one.
  var SIGHTS = sights([
    ['s-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Paris', 'France', 'Paris’s iron tower. All four match.'],
    ['s-colosseum', 'colosseum', 1, 'colosseum', 'Colosseum', 'Rome', 'Italy', 'Rome’s ancient arena. All four match.'],
    ['s-taj', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Agra', 'India', 'The Taj Mahal stands in Agra. All four match.'],
    ['s-opera', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Sydney', 'Australia',
      'Sydney’s harbour landmark. All four match.'],
    ['s-wall', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Near Beijing', 'China',
      'This stretch, Jinshanling, lies north-east of Beijing.'],
    ['s-goldengate', 'golden-gate', 1, 'golden-gate', 'Golden Gate Bridge', 'San Francisco', 'USA',
      'San Francisco’s red bridge. All four match.'],
    ['s-machu', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Near Cusco', 'Peru',
      'The Inca citadel in the Andes, a day trip from Cusco.'],
    ['s-bigben', 'big-ben', 1, 'big-ben', 'Big Ben', 'London', 'UK', 'London’s clock tower. All four match.'],
    ['s-burj', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Dubai', 'UAE', 'The world’s tallest building, in Dubai.'],
    ['s-sagrada', 'sagrada-familia', 1, 'sagrada-familia', 'Sagrada Família', 'Barcelona', 'Spain',
      'Gaudí’s basilica in Barcelona.'],
    ['s-liberty', 'statue-liberty', 1, 'statue-liberty', 'Statue of Liberty', 'New York', 'USA',
      'New York’s harbour statue. All four match.'],
    ['s-christ', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'Rio de Janeiro', 'Brazil',
      'It overlooks Rio from Corcovado. All four match.'],
    ['s-gateway', 'gateway-of-india', 1, 'gateway-of-india', 'Gateway of India', 'Mumbai', 'India',
      'Mumbai’s 1924 waterfront arch.'],
    ['s-csmt', 'cst-mumbai', 2, 'cst-mumbai', 'Chhatrapati Shivaji Terminus', 'Mumbai', 'India',
      'Mumbai’s Victorian Gothic station, a UNESCO site.'],
    ['s-sealink', 'sea-link', 2, 'sea-link', 'Bandra–Worli Sea Link', 'Mumbai', 'India',
      'The cable-stayed bridge across Mahim Bay.'],
    ['s-hajiali', 'haji-ali', 2, 'haji-ali', 'Haji Ali Dargah', 'Mumbai', 'India', 'A shrine on an islet off Worli.'],
    ['s-marine', 'marine-drive', 2, 'marine-drive', 'Marine Drive', 'Mumbai', 'India',
      'Mumbai’s seafront, the Queen’s Necklace.'],
    ['s-elephanta', 'elephanta', 2, 'elephanta', 'Elephanta Caves', 'Near Mumbai', 'India',
      'Rock-cut caves on an island, a ferry ride from Mumbai.'],
    ['s-taj-bad', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Mumbai', 'India', 'The Taj Mahal is in Agra, not Mumbai.',
      'city', 'know', 'Agra'],
    ['s-burj-bad', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Abu Dhabi', 'UAE',
      'The Burj Khalifa is in Dubai, not Abu Dhabi.', 'city', 'know', 'Dubai'],
    ['s-christ-bad', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'São Paulo', 'Brazil',
      'It overlooks Rio de Janeiro, not São Paulo.', 'city', 'know', 'Rio de Janeiro'],
    ['s-colosseum-bad', 'colosseum', 1, 'colosseum', 'Colosseum', 'Milan', 'Italy', 'The Colosseum is in Rome, not Milan.',
      'city', 'know', 'Rome'],
    ['s-liberty-fr-bad', 'statue-liberty', 1, 'statue-liberty', 'Statue of Liberty', 'New York', 'France',
      'A gift from France, but it stands in New York, USA.', 'country', 'know', 'USA'],
    ['s-machu-bad', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Near Cusco', 'Bolivia',
      'Machu Picchu is in Peru, not Bolivia.', 'country', 'know', 'Peru'],
    ['s-gateway-bad', 'gateway-of-india', 2, 'gateway-of-india', 'Gateway of India', 'New Delhi', 'India',
      'New Delhi has India Gate. The Gateway of India is in Mumbai.', 'city', 'know', 'Mumbai'],
    ['s-wall-bad', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Near Beijing', 'Japan',
      'The clue is in the name: the Great Wall is in China.', 'country', 'card', 'China'],
    ['s-opera-bad', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Melbourne', 'Australia',
      'The clue is in the name: it’s in Sydney.', 'city', 'card', 'Sydney'],
    ['s-brooklyn-bad', 'golden-gate', 1, 'golden-gate', 'Brooklyn Bridge', 'San Francisco', 'USA',
      'A red bridge in San Francisco: that’s the Golden Gate.', 'name', 'card', 'Golden Gate Bridge'],
    ['s-bigben-bad', ['big-ben', 'eiffel'], 1, 'big-ben', 'Eiffel Tower', 'Paris', 'France',
      'Look at the photo: that’s Big Ben, not the Eiffel Tower.', 'photo', 'card', 'Iron lattice tower'],
    ['s-liberty-bad', ['statue-liberty', 'christ-redeemer'], 1, 'statue-liberty', 'Christ the Redeemer',
      'Rio de Janeiro', 'Brazil', 'Look at the photo: that’s the Statue of Liberty, not Christ the Redeemer.', 'photo',
      'card', 'Statue, arms spread wide'],
    ['s-sagrada-bad', ['sagrada-familia', 'taj-mahal'], 1, 'sagrada-familia', 'Taj Mahal', 'Barcelona', 'Spain',
      'Spires in Barcelona: that’s the Sagrada Família.', 'name', 'card', 'Sagrada Família'],
    ['s-sealink-bad', ['sea-link', 'golden-gate'], 2, 'sea-link', 'Golden Gate Bridge', 'Mumbai', 'India',
      'A cable-stayed bridge in Mumbai: that’s the Sea Link.', 'name', 'card', 'Bandra–Worli Sea Link']
  ]);

  // ---- Countries (flat flag; 20 good, 16 fake) ----
  // Web domains are country-code top-level domains. Left out on purpose: capitals in dispute or transition,
  // and politically sensitive entries. Twins: the country, plus the country whose flag a fake shows.
  var COUNTRIES = country([
    ['c-it', 'it', 1, 'it', 'Italy', 'Rome', '.it', 'Italy’s tricolour, Rome and .it. All four match.'],
    ['c-fr', 'fr', 1, 'fr', 'France', 'Paris', '.fr', 'France’s tricolour, Paris and .fr. All four match.'],
    ['c-ie', 'ie', 1, 'ie', 'Ireland', 'Dublin', '.ie', 'Ireland’s green, white and orange. All four match.'],
    ['c-be', 'be', 2, 'be', 'Belgium', 'Brussels', '.be', 'Belgium’s upright black, yellow, red. All four match.'],
    ['c-ng', 'ng', 2, 'ng', 'Nigeria', 'Abuja', '.ng', 'Abuja has been Nigeria’s capital since 1991.'],
    ['c-de', 'de', 1, 'de', 'Germany', 'Berlin', '.de', 'Germany’s .de stands for Deutschland. All four match.'],
    ['c-at', 'at', 2, 'at', 'Austria', 'Vienna', '.at', 'Austria’s red, white, red and .at. All four match.'],
    ['c-hu', 'hu', 2, 'hu', 'Hungary', 'Budapest', '.hu', 'Hungary’s red, white, green. All four match.'],
    ['c-ee', 'ee', 2, 'ee', 'Estonia', 'Tallinn', '.ee', 'Estonia’s blue, black, white. All four match.'],
    ['c-co', 'co', 2, 'co', 'Colombia', 'Bogotá', '.co', 'Colombia’s flag has a double-height yellow band.'],
    ['c-pl', 'pl', 1, 'pl', 'Poland', 'Warsaw', '.pl', 'Poland’s white over red. All four match.'],
    ['c-se', 'se', 1, 'se', 'Sweden', 'Stockholm', '.se', 'Sweden’s yellow cross on blue. All four match.'],
    ['c-fi', 'fi', 2, 'fi', 'Finland', 'Helsinki', '.fi', 'Finland’s blue cross on white. All four match.'],
    ['c-dk', 'dk', 2, 'dk', 'Denmark', 'Copenhagen', '.dk', 'Denmark’s white cross on red. All four match.'],
    ['c-no', 'no', 2, 'no', 'Norway', 'Oslo', '.no', 'Norway’s blue cross edged in white. All four match.'],
    ['c-is', 'is', 2, 'is', 'Iceland', 'Reykjavík', '.is', 'Iceland’s red cross edged in white. All four match.'],
    ['c-jp', 'jp', 1, 'jp', 'Japan', 'Tokyo', '.jp', 'Japan’s red disc on white. All four match.'],
    ['c-bd', 'bd', 2, 'bd', 'Bangladesh', 'Dhaka', '.bd', 'Bangladesh’s red disc on green. All four match.'],
    ['c-ch', 'ch', 1, 'ch', 'Switzerland', 'Bern', '.ch', '.ch is for Confoederatio Helvetica. All four match.'],
    ['c-in', 'in', 1, 'in', 'India', 'New Delhi', '.in', 'India’s tricolour, New Delhi and .in. All four match.'],
    ['c-ch-bad', 'ch', 1, 'ch', 'Switzerland', 'Zurich', '.ch', 'Zurich is the biggest city. The capital is Bern.',
      'capital', 'know', 'Bern'],
    ['c-ng-bad', 'ng', 2, 'ng', 'Nigeria', 'Lagos', '.ng', 'Lagos is the biggest city. The capital is Abuja.',
      'capital', 'know', 'Abuja'],
    ['c-jp-bad', 'jp', 1, 'jp', 'Japan', 'Kyoto', '.jp', 'Kyoto was the old capital. Today it’s Tokyo.',
      'capital', 'know', 'Tokyo'],
    ['c-co-bad', 'co', 2, 'co', 'Colombia', 'Medellín', '.co', 'Medellín is a big city, but the capital is Bogotá.',
      'capital', 'know', 'Bogotá'],
    ['c-pl-bad', 'pl', 2, 'pl', 'Poland', 'Kraków', '.pl', 'Kraków was the old royal capital. Today it’s Warsaw.',
      'capital', 'know', 'Warsaw'],
    ['c-at-dom-bad', 'at', 2, 'at', 'Austria', 'Vienna', '.au', '.au is Australia. Austria’s domain is .at.',
      'domain', 'know', '.at'],
    ['c-ch-dom-bad', 'ch', 2, 'ch', 'Switzerland', 'Bern', '.sw', 'Switzerland’s domain is .ch, from its Latin name.',
      'domain', 'know', '.ch'],
    ['c-de-dom-bad', 'de', 2, 'de', 'Germany', 'Berlin', '.ge', '.ge is Georgia. Germany’s is .de, for Deutschland.',
      'domain', 'know', '.de'],
    ['c-se-bad', ['se', 'fi'], 1, 'fi', 'Sweden', 'Stockholm', '.se', 'That’s Finland’s flag. Sweden’s cross is yellow on blue.',
      'flag', 'card', 'Blue, yellow cross'],
    ['c-ie-bad', ['ie', 'it'], 1, 'it', 'Ireland', 'Dublin', '.ie', 'That’s Italy’s flag. Ireland’s has orange, not red.',
      'flag', 'card', 'Green, white, orange'],
    ['c-pl-flag-bad', 'pl', 1, 'mc', 'Poland', 'Warsaw', '.pl', 'Upside down: Poland’s flag is white over red.',
      'flag', 'card', 'White over red'],
    ['c-in-flag-bad', ['in', 'ie'], 1, 'ie', 'India', 'New Delhi', '.in', 'That’s Ireland’s flag. India’s has a navy wheel.',
      'flag', 'card', 'Saffron, white, green, navy wheel'],
    ['c-hu-flag-bad', ['hu', 'it'], 2, 'it', 'Hungary', 'Budapest', '.hu',
      'That’s Italy’s flag. Hungary’s stripes lie flat: red, white, green.', 'flag', 'card', 'Red, white, green'],
    ['c-be-bad', ['be', 'de'], 2, 'de', 'Belgium', 'Brussels', '.be', 'That’s Germany’s flag. Belgium’s stripes stand upright.',
      'flag', 'card', 'Black, yellow, red'],
    ['c-jp-name-bad', 'jp', 1, 'jp', 'China', 'Tokyo', '.jp', 'Red disc on white, Tokyo and .jp: that’s Japan.',
      'country', 'card', 'Japan'],
    ['c-fr-name-bad', ['fr', 'it'], 1, 'fr', 'Italy', 'Paris', '.fr', 'Paris and .fr: that’s France, not Italy.',
      'country', 'card', 'France']
  ]);

  // ---- Tokens (painted logo; 14 good, 12 fake) ----
  // Famous, easy tokens only, each website checked on 29 Oct 2026 (Toncoin left out: it was renamed). Websites
  // are plain text, never links. No prices and no investment talk. Fakes are easy: a lookalike website, a
  // swapped ticker, another token’s logo, or a wrong name. Twins: the token, plus the one a fake borrows from.
  var TOKENS = tokens([
    ['t-btc', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin.org', 'Bitcoin’s orange B and bitcoin.org. All four match.'],
    ['t-eth', 'eth', 1, 'eth', 'Ethereum', 'ETH', 'ethereum.org', 'Ethereum’s diamond and ethereum.org. All four match.'],
    ['t-usdt', 'usdt', 1, 'usdt', 'Tether', 'USDT', 'tether.to', 'Tether’s website really is tether.to.'],
    ['t-usdc', 'usdc', 1, 'usdc', 'USD Coin', 'USDC', 'circle.com', 'USDC is issued by Circle, at circle.com.'],
    ['t-doge', 'doge', 1, 'doge', 'Dogecoin', 'DOGE', 'dogecoin.com', 'Dogecoin’s gold D and dogecoin.com. All four match.'],
    ['t-sol', 'sol', 1, 'sol', 'Solana', 'SOL', 'solana.com', 'Solana’s slanted bars and solana.com. All four match.'],
    ['t-ada', 'ada', 2, 'ada', 'Cardano', 'ADA', 'cardano.org', 'Cardano’s ticker is ADA. All four match.'],
    ['t-link', 'link', 2, 'link', 'Chainlink', 'LINK', 'chain.link', 'Chainlink’s website really is chain.link.'],
    ['t-uni', 'uni', 2, 'uni', 'Uniswap', 'UNI', 'uniswap.org', 'Uniswap’s pink logo and uniswap.org. All four match.'],
    ['t-pol', 'pol', 2, 'pol', 'Polygon', 'POL', 'polygon.technology', 'POL took over from MATIC in 2024. All four match.'],
    ['t-avax', 'avax', 2, 'avax', 'Avalanche', 'AVAX', 'avax.network', 'Avalanche’s red A and avax.network. All four match.'],
    ['t-shib', 'shib', 2, 'shib', 'Shiba Inu', 'SHIB', 'shib.io', 'Shiba Inu’s website is shib.io.'],
    ['t-bnb', 'bnb', 2, 'bnb', 'BNB', 'BNB', 'bnbchain.org', 'BNB powers BNB Chain, at bnbchain.org. All four match.'],
    ['t-pnk', 'pnk', 1, 'pnk', 'Kleros', 'PNK', 'kleros.io', 'PNK is what Kleros jurors stake. Yes, that’s us.'],
    ['t-eth-site-bad', 'eth', 1, 'eth', 'Ethereum', 'ETH', 'etherium.org', 'Check the spelling: Ethereum’s website is ethereum.org.',
      'site', 'card', 'ethereum.org'],
    ['t-btc-site-bad', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin-official.org', 'Not the real one: Bitcoin’s website is bitcoin.org.',
      'site', 'know', 'bitcoin.org'],
    ['t-sol-site-bad', 'sol', 1, 'sol', 'Solana', 'SOL', 'solana-airdrop.com', 'Not the real one: Solana’s website is solana.com.',
      'site', 'know', 'solana.com'],
    ['t-link-site-bad', 'link', 2, 'link', 'Chainlink', 'LINK', 'chainlink-claim.com',
      'Not the real one: Chainlink’s website is chain.link.', 'site', 'know', 'chain.link'],
    ['t-eth-etc-bad', 'eth', 1, 'eth', 'Ethereum', 'ETC', 'ethereum.org', 'ETC is Ethereum Classic. Ethereum’s ticker is ETH.',
      'ticker', 'know', 'ETH'],
    ['t-doge-dog-bad', 'doge', 1, 'doge', 'Dogecoin', 'DOG', 'dogecoin.com', 'One letter short: Dogecoin’s ticker is DOGE.',
      'ticker', 'know', 'DOGE'],
    ['t-avax-bad', 'avax', 2, 'avax', 'Avalanche', 'AVA', 'avax.network', 'Avalanche’s ticker is AVAX, not AVA.',
      'ticker', 'know', 'AVAX'],
    ['t-btc-logo-bad', ['btc', 'eth'], 1, 'eth', 'Bitcoin', 'BTC', 'bitcoin.org', 'That’s the Ethereum diamond. Bitcoin’s logo is an orange B.',
      'logo', 'card', 'Orange coin, white B'],
    ['t-usdt-logo-bad', ['usdt', 'usdc'], 1, 'usdc', 'Tether', 'USDT', 'tether.to', 'That’s the USDC logo. Tether’s is a green T.',
      'logo', 'card', 'Green coin, white T'],
    ['t-sol-name-bad', ['sol', 'ada'], 1, 'sol', 'Cardano', 'SOL', 'solana.com', 'SOL and solana.com: that’s Solana, not Cardano.',
      'name', 'card', 'Solana'],
    ['t-btc-name-bad', ['btc', 'doge'], 1, 'btc', 'Dogecoin', 'BTC', 'bitcoin.org', 'BTC and bitcoin.org: that’s Bitcoin, not Dogecoin.',
      'name', 'card', 'Bitcoin'],
    ['t-link-name-bad', ['link', 'pol'], 1, 'link', 'Polygon', 'LINK', 'chain.link', 'LINK and chain.link: that’s Chainlink, not Polygon.',
      'name', 'card', 'Chainlink']
  ]);

  // ---- Decks ----
  // One deck per app, in title-screen order. `client` is the app’s short name (HUD, Results, ticket); `pick` is
  // its title-screen card (app, need, optional sub, and its picture: img, flag, or coin plus coins, a trio).
  // Each deck has one list of 4 parts: the picture (objField) first, then three text rows. Practice is one fake
  // that never enters a round; `coach.fact` is the practice hint. Copy bands follow trust: ≥ 90, 70–89, < 70.
  // rewards.js appends the bounty sentence to each payoff.
  window.CURATE_DECKS = {
    sights: {
      id: 'sights', client: 'Travel guide app',
      pick: { app: 'Travel guide app', need: 'needs real sights on its map', img: '/curate/img/taj-mahal.jpg' },
      copy: {
        mission: 'Keep the travel guide’s sights real.',
        headlines: ['Clean list. Travellers are safe.', 'Mostly clean. A few fakes slipped in.',
                    'Leaky list. Travellers got sent to fake sights.'],
        quotes: ['“Travellers only found real sights today. Come back tomorrow?”',
                 '“A few fake sights got listed. We filed removal requests.”',
                 '“Travellers went looking for fake sights. We’re pausing the map until it’s clean.”'],
        quoteBy: 'Travel guide app (fictional)',
        payoffs: ['{client} kept {trust}% of travellers’ trust, so they keep using it and it keeps earning.',
                  '{client} kept {trust}% of travellers’ trust. Each fake that got listed cost it travellers.',
                  '{client} lost travellers’ trust (down to {trust}%): fakes reached them, and it stops earning until the list is clean.']
      },
      coach: { fact: 'The Eiffel Tower is in Paris.' },
      lists: {
        sights: { name: 'Sights', policy: 'Policy: photo, name, city and country must all match.',
                  fields: [['photo', 'Photo'], ['name', 'Name'], ['city', 'City'], ['country', 'Country']], objField: 'photo' }
      },
      split: { sights: [10, 4] },   // [entries, fakes]
      practice: sights([
        ['p-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Marseille', 'France', 'The Eiffel Tower is in Paris, not Marseille.',
          'city', 'know', 'Paris']
      ]),
      items: SIGHTS
    },
    countries: {
      id: 'countries', client: 'Atlas app',
      pick: { app: 'Atlas app for schools', need: 'needs the right flags and capitals', flag: FLAGS['in'][0] },
      copy: {
        mission: 'Keep the atlas’s flags and capitals right.',
        headlines: ['Clean list. Pupils learn the right facts.', 'Mostly clean. A few wrong facts slipped in.',
                    'Leaky list. Pupils learned wrong facts.'],
        quotes: ['“Pupils only saw true facts today. See you tomorrow?”',
                 '“A few wrong facts got listed. We filed removal requests.”',
                 '“Pupils copied wrong capitals into their notes. We’re pausing the atlas until it’s clean.”'],
        quoteBy: 'Atlas app (fictional)',
        payoffs: ['{client} kept {trust}% of schools’ trust, so they keep using it and it keeps earning.',
                  '{client} kept {trust}% of schools’ trust. Each wrong fact that got listed cost it classrooms.',
                  '{client} lost schools’ trust (down to {trust}%): wrong facts reached pupils, and it stops earning until the list is clean.']
      },
      coach: { fact: 'India’s capital is New Delhi.' },
      lists: {
        countries: { name: 'Countries', policy: 'Policy: flag, country, capital and domain must all match.',
                     fields: [['flag', 'Flag'], ['country', 'Country'], ['capital', 'Capital'], ['domain', 'Web domain']],
                     objField: 'flag' }
      },
      split: { countries: [10, 4] },
      practice: country([
        ['p-india', 'in', 1, 'in', 'India', 'Mumbai', '.in', 'India’s capital is New Delhi. Mumbai is its financial capital.',
          'capital', 'know', 'New Delhi']
      ]),
      items: COUNTRIES
    },
    tokens: {
      id: 'tokens', client: 'Crypto exchange app',
      pick: { app: 'Crypto exchange app', need: 'needs only real tokens in its listing', sub: 'Fake tokens trick buyers.',
              coin: LOGOS.btc[0], coins: [LOGOS.btc[0], LOGOS.eth[0], LOGOS.usdc[0]] },
      copy: {
        mission: 'Keep the exchange’s token list real.',
        headlines: ['Clean list. Buyers are safe.', 'Mostly clean. A few fake tokens slipped in.',
                    'Leaky list. Buyers got tricked by fakes.'],
        quotes: ['“Buyers only found real tokens today. Come back tomorrow?”',
                 '“A few fake tokens got listed. We filed removal requests.”',
                 '“Buyers got sent to lookalike websites. We’re pausing the listing until it’s clean.”'],
        quoteBy: 'Crypto exchange app (fictional)',
        payoffs: ['{client} kept {trust}% of buyers’ trust, so they keep using it and it keeps earning.',
                  '{client} kept {trust}% of buyers’ trust. Each fake token that got listed cost it buyers.',
                  '{client} lost buyers’ trust (down to {trust}%): fakes reached them, and it stops earning until the list is clean.']
      },
      coach: { fact: 'Bitcoin’s website is bitcoin.org.' },
      lists: {
        tokens: { name: 'Tokens', policy: 'Policy: logo, name, ticker and website must all match.',
                  fields: [['logo', 'Logo'], ['name', 'Name'], ['ticker', 'Ticker'], ['site', 'Website']], objField: 'logo' }
      },
      split: { tokens: [10, 4] },
      practice: tokens([
        ['p-btc', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin-giveaway.com', 'Giveaway sites are a trick. Bitcoin’s is bitcoin.org.',
          'site', 'know', 'bitcoin.org']
      ]),
      items: TOKENS
    }
  };
})();
