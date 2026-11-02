// Curate game content: three fictional apps that each need one list fixed, and every entry. Data only:
// rules.js deals the round, game.js shows it. Facts (sights, cities, capitals, flags, web domains, tokens,
// tickers and websites) were checked by hand, the v6 additions on 30 Oct 2026; re-check before merge. Every
// why is one short line (≤ 48 characters): it shows in the red flash when a fake gets marked Correct. `node scripts/curate-check.js` validates
// this file (ids, fields, tells, lengths, photos and their credits, flags, logos, one odd part per fake).
(function () {
  // ---- Flags ----
  // [spec for CurateObjects._flag, words for the alt text and the fix line]. Kinds: v3 (hoist to fly), h3 (top
  // to bottom, optional ratio), h2, nordic (field, cross, optional inner), disc (field, disc, optional off:
  // fraction of the width, negative towards the hoist), cross (Swiss), h3wheel (India), h4 (four equal stripes,
  // Mauritius) and h5 (five stripes, the middle one twice as tall: Thailand, Costa Rica; or a ratio: The Gambia,
  // Botswana, whose thin white bands separate the colours). Colours follow each
  // country’s official specification as #rrggbb; black is lifted to #1a1a1a so it still reads on the dark stage.
  // Chad and Romania look alike, so their entries share a twin key and never meet in one round.
  var FLAGS = {
    it: [{ kind: 'v3', c: ['#009246', '#ffffff', '#ce2b37'] }, 'Green, white, red'],
    fr: [{ kind: 'v3', c: ['#0055a4', '#ffffff', '#ef4135'] }, 'Blue, white, red'],
    ie: [{ kind: 'v3', c: ['#169b62', '#ffffff', '#ff883e'] }, 'Green, white, orange'],
    be: [{ kind: 'v3', c: ['#1a1a1a', '#fdda24', '#ef3340'] }, 'Black, yellow, red'],
    ng: [{ kind: 'v3', c: ['#008751', '#ffffff', '#008751'] }, 'Green, white, green'],
    ro: [{ kind: 'v3', c: ['#002b7f', '#fcd116', '#ce1126'] }, 'Blue, yellow, red'],
    td: [{ kind: 'v3', c: ['#002664', '#fecb00', '#c60c30'] }, 'Dark blue, yellow, red'],
    ml: [{ kind: 'v3', c: ['#14b53a', '#fcd116', '#ce1126'] }, 'Green, yellow, red'],
    gn: [{ kind: 'v3', c: ['#ce1126', '#fcd116', '#009460'] }, 'Red, yellow, green'],
    pe: [{ kind: 'v3', c: ['#d91023', '#ffffff', '#d91023'] }, 'Upright red, white, red'],
    ci: [{ kind: 'v3', c: ['#f77f00', '#ffffff', '#009e60'] }, 'Orange, white, green'],
    de: [{ kind: 'h3', c: ['#1a1a1a', '#dd0000', '#ffce00'] }, 'Black, red, gold'],
    at: [{ kind: 'h3', c: ['#c8102e', '#ffffff', '#c8102e'] }, 'Red, white, red'],
    hu: [{ kind: 'h3', c: ['#ce2939', '#ffffff', '#477050'] }, 'Red, white, green'],
    ee: [{ kind: 'h3', c: ['#0072ce', '#1a1a1a', '#ffffff'] }, 'Blue, black, white'],
    co: [{ kind: 'h3', c: ['#fcd116', '#003893', '#ce1126'], ratio: [2, 1, 1] }, 'Yellow, blue, red'],
    nl: [{ kind: 'h3', c: ['#ae1c28', '#ffffff', '#21468b'] }, 'Red, white, blue'],
    lu: [{ kind: 'h3', c: ['#ed2939', '#ffffff', '#00a1de'] }, 'Red, white, light blue'],
    bg: [{ kind: 'h3', c: ['#ffffff', '#00966e', '#d62612'] }, 'White, green, red'],
    lt: [{ kind: 'h3', c: ['#fdb913', '#006a44', '#c1272d'] }, 'Yellow, green, red'],
    lv: [{ kind: 'h3', c: ['#9e3039', '#ffffff', '#9e3039'], ratio: [2, 1, 2] }, 'Dark red, thin white band'],
    ga: [{ kind: 'h3', c: ['#009e60', '#fcd116', '#3a75c4'] }, 'Green, yellow, blue'],
    sl: [{ kind: 'h3', c: ['#1eb53a', '#ffffff', '#0072c6'] }, 'Green, white, blue'],
    am: [{ kind: 'h3', c: ['#d90012', '#0033a0', '#f2a800'] }, 'Red, blue, orange'],
    pl: [{ kind: 'h2', c: ['#ffffff', '#dc143c'] }, 'White over red'],
    mc: [{ kind: 'h2', c: ['#ce1126', '#ffffff'] }, 'Red over white'],
    ua: [{ kind: 'h2', c: ['#0057b7', '#ffd700'] }, 'Blue over yellow'],
    mu: [{ kind: 'h4', c: ['#ea2839', '#1a206d', '#ffd500', '#00a551'] }, 'Red, blue, yellow, green'],
    th: [{ kind: 'h5', c: ['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'] }, 'Red, white, wide blue, white, red'],
    cr: [{ kind: 'h5', c: ['#002b7f', '#ffffff', '#ce1126', '#ffffff', '#002b7f'] }, 'Blue, white, wide red, white, blue'],
    gm: [{ kind: 'h5', c: ['#ce1126', '#ffffff', '#0c1c8c', '#ffffff', '#3a7728'], ratio: [6, 1, 4, 1, 6] }, 'Red, blue, green, edged white'],
    bw: [{ kind: 'h5', c: ['#75aadb', '#ffffff', '#1a1a1a', '#ffffff', '#75aadb'], ratio: [9, 1, 4, 1, 9] }, 'Light blue, black band edged white'],
    se: [{ kind: 'nordic', c: ['#006aa7', '#fecc02'] }, 'Blue, yellow cross'],
    fi: [{ kind: 'nordic', c: ['#ffffff', '#002f6c'] }, 'White, blue cross'],
    dk: [{ kind: 'nordic', c: ['#c8102e', '#ffffff'] }, 'Red, white cross'],
    no: [{ kind: 'nordic', c: ['#ba0c2f', '#ffffff'], inner: '#00205b' }, 'Red, blue cross edged white'],
    is: [{ kind: 'nordic', c: ['#02529c', '#ffffff'], inner: '#dc1e35' }, 'Blue, red cross edged white'],
    jp: [{ kind: 'disc', c: ['#ffffff', '#bc002d'] }, 'White, red disc'],
    bd: [{ kind: 'disc', c: ['#006a4e', '#f42a41'], off: -0.05 }, 'Green, red disc'],
    pw: [{ kind: 'disc', c: ['#4aadd6', '#ffde00'], off: -0.06 }, 'Light blue, yellow disc'],
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
    'cst-mumbai': ['Gothic station with domes', 'CSMT', 'Mumbai', 'India'],
    'sea-link': ['Cable-stayed bridge over the sea', 'Bandra–Worli Sea Link', 'Mumbai', 'India'],
    'haji-ali': ['White shrine with a dome', 'Haji Ali Dargah', 'Mumbai', 'India'],
    'marine-drive': ['Curving seafront at night', 'Marine Drive', 'Mumbai', 'India'],
    'elephanta': ['Three-faced stone carving', 'Elephanta Caves', 'Near Mumbai', 'India'],
    'petra': ['Temple carved in pink rock', 'Petra', 'Near Wadi Musa', 'Jordan'],
    'angkor-wat': ['Temple towers mirrored in a pond', 'Angkor Wat', 'Near Siem Reap', 'Cambodia'],
    'stonehenge': ['Ring of standing stones', 'Stonehenge', 'Near Salisbury', 'UK'],
    'parthenon': ['Columned temple on a rocky hill', 'Parthenon', 'Athens', 'Greece'],
    'pyramids-giza': ['Three pyramids in the desert', 'Pyramids of Giza', 'Giza', 'Egypt'],
    'leaning-tower-pisa': ['White tower that leans', 'Leaning Tower of Pisa', 'Pisa', 'Italy', '50% 8%'],
    'mount-fuji': ['Snow-capped volcano', 'Mount Fuji', 'Near Tokyo', 'Japan'],
    'neuschwanstein': ['White castle above a forest', 'Neuschwanstein Castle', 'Near Füssen', 'Germany'],
    'tower-bridge': ['Bridge with two stone towers', 'Tower Bridge', 'London', 'UK'],
    'brandenburg-gate': ['Columned gate, chariot on top', 'Brandenburg Gate', 'Berlin', 'Germany'],
    'chichen-itza': ['Stepped stone pyramid', 'Chichén Itzá', 'Near Valladolid', 'Mexico'],
    'moai': ['Row of giant stone heads', 'Moai', 'Near Hanga Roa', 'Chile'],
    'golden-temple': ['Gold temple on a pool', 'Golden Temple', 'Amritsar', 'India'],
    'hawa-mahal': ['Pink palace, many small windows', 'Hawa Mahal', 'Jaipur', 'India'],
    'qutub-minar': ['Tall fluted red stone tower', 'Qutub Minar', 'Delhi', 'India'],
    'mysore-palace': ['Palace with red-capped domes', 'Mysore Palace', 'Mysore', 'India'],
    'victoria-memorial': ['White marble hall, big dome', 'Victoria Memorial', 'Kolkata', 'India'],
    'charminar': ['Four arches, four minarets', 'Charminar', 'Hyderabad', 'India'],
    'lotus-temple': ['White petal-shaped temple', 'Lotus Temple', 'Delhi', 'India'],
    'meenakshi-temple': ['Tower covered in carved figures', 'Meenakshi Temple', 'Madurai', 'India'],
    'india-gate': ['Sandstone war memorial arch', 'India Gate', 'New Delhi', 'India']
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
    pnk: [{ color: '#9013fe', mark: 'pnk' }, 'Violet coin, Kleros mark'],
    xrp: [{ color: '#23292f', mark: 'xrp' }, 'Charcoal coin, white X'],
    ltc: [{ color: '#345d9d', mark: 'ltc' }, 'Blue coin, white L with a bar'],
    xlm: [{ color: '#1a1a1a', mark: 'xlm' }, 'Black coin, ring with two lines'],
    dot: [{ color: '#e6007a', mark: 'dot' }, 'Pink coin, ring of white dots'],
    xmr: [{ color: '#ff6600', mark: 'xmr' }, 'Orange coin, white M'],
    aave: [{ color: '#b6509e', mark: 'aave' }, 'Purple-teal coin, white A'],
    arb: [{ color: '#213147', mark: 'arb' }, 'Navy coin, A in a hexagon'],
    op: [{ color: '#ff0420', mark: 'op' }, 'Red coin, white OP'],
    gno: [{ color: '#133629', color2: '#f0ebde', mark: 'gno' }, 'Dark green coin, cream G'],
    near: [{ color: '#1a1a1a', mark: 'near' }, 'Black coin, white N']
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

  // ---- Sights (photo; 39 good, 33 fake) ----
  // Twins: the photo file, plus the claimed sight when a photo is named after another one.
  var SIGHTS = sights([
    ['s-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Paris', 'France', 'Paris’s iron tower. All four match.'],
    ['s-colosseum', 'colosseum', 1, 'colosseum', 'Colosseum', 'Rome', 'Italy', 'Rome’s ancient arena. All four match.'],
    ['s-taj', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Agra', 'India', 'The Taj Mahal is in Agra. All four match.'],
    ['s-opera', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Sydney', 'Australia',
      'Sydney’s harbour landmark. All four match.'],
    ['s-wall', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Near Beijing', 'China',
      'This stretch lies north-east of Beijing.'],
    ['s-goldengate', 'golden-gate', 1, 'golden-gate', 'Golden Gate Bridge', 'San Francisco', 'USA',
      'San Francisco’s red bridge. All four match.'],
    ['s-machu', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Near Cusco', 'Peru',
      'The Inca citadel, a day trip from Cusco.'],
    ['s-bigben', 'big-ben', 1, 'big-ben', 'Big Ben', 'London', 'UK', 'London’s clock tower. All four match.'],
    ['s-burj', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Dubai', 'UAE', 'The world’s tallest building, in Dubai.'],
    ['s-sagrada', 'sagrada-familia', 1, 'sagrada-familia', 'Sagrada Família', 'Barcelona', 'Spain',
      'Gaudí’s basilica in Barcelona.'],
    ['s-liberty', 'statue-liberty', 1, 'statue-liberty', 'Statue of Liberty', 'New York', 'USA',
      'New York’s harbour statue. All four match.'],
    ['s-christ', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'Rio de Janeiro', 'Brazil',
      'It overlooks Rio. All four match.'],
    ['s-gateway', 'gateway-of-india', 1, 'gateway-of-india', 'Gateway of India', 'Mumbai', 'India',
      'Mumbai’s 1924 waterfront arch.'],
    ['s-csmt', 'cst-mumbai', 2, 'cst-mumbai', 'CSMT', 'Mumbai', 'India',
      'Chhatrapati Shivaji Maharaj Terminus, Mumbai.'],
    ['s-sealink', 'sea-link', 2, 'sea-link', 'Bandra–Worli Sea Link', 'Mumbai', 'India', 'The bridge across Mahim Bay.'],
    ['s-hajiali', 'haji-ali', 2, 'haji-ali', 'Haji Ali Dargah', 'Mumbai', 'India', 'A shrine on an islet off Worli.'],
    ['s-marine', 'marine-drive', 2, 'marine-drive', 'Marine Drive', 'Mumbai', 'India',
      'Mumbai’s seafront, the Queen’s Necklace.'],
    ['s-elephanta', 'elephanta', 2, 'elephanta', 'Elephanta Caves', 'Near Mumbai', 'India',
      'Island caves, a ferry ride from Mumbai.'],
    ['s-petra', 'petra', 2, 'petra', 'Petra', 'Near Wadi Musa', 'Jordan', 'Petra’s Treasury, beside Wadi Musa.'],
    ['s-angkor', 'angkor-wat', 2, 'angkor-wat', 'Angkor Wat', 'Near Siem Reap', 'Cambodia',
      'Cambodia’s great temple, by Siem Reap.'],
    ['s-stonehenge', 'stonehenge', 1, 'stonehenge', 'Stonehenge', 'Near Salisbury', 'UK',
      'England’s stone circle, near Salisbury.'],
    ['s-parthenon', 'parthenon', 1, 'parthenon', 'Parthenon', 'Athens', 'Greece', 'The temple on the Acropolis of Athens.'],
    ['s-pyramids', 'pyramids-giza', 1, 'pyramids-giza', 'Pyramids of Giza', 'Giza', 'Egypt',
      'Egypt’s pyramids, at Giza. All four match.'],
    ['s-pisa', 'leaning-tower-pisa', 1, 'leaning-tower-pisa', 'Leaning Tower of Pisa', 'Pisa', 'Italy',
      'Pisa’s famous leaning bell tower.'],
    ['s-fuji', 'mount-fuji', 1, 'mount-fuji', 'Mount Fuji', 'Near Tokyo', 'Japan', 'Japan’s highest mountain. All four match.'],
    ['s-neuschwanstein', 'neuschwanstein', 2, 'neuschwanstein', 'Neuschwanstein Castle', 'Near Füssen', 'Germany',
      'Bavaria’s fairy-tale castle, by Füssen.'],
    ['s-towerbridge', 'tower-bridge', 1, 'tower-bridge', 'Tower Bridge', 'London', 'UK',
      'Tower Bridge crosses the Thames in London.'],
    ['s-brandenburg', 'brandenburg-gate', 1, 'brandenburg-gate', 'Brandenburg Gate', 'Berlin', 'Germany',
      'Berlin’s famous gate. All four match.'],
    ['s-chichen', 'chichen-itza', 2, 'chichen-itza', 'Chichén Itzá', 'Near Valladolid', 'Mexico',
      'The Maya pyramid of El Castillo, Mexico.'],
    ['s-moai', 'moai', 2, 'moai', 'Moai', 'Near Hanga Roa', 'Chile', 'The moai stand on Easter Island, in Chile.'],
    ['s-golden', 'golden-temple', 1, 'golden-temple', 'Golden Temple', 'Amritsar', 'India', 'The Sikh holy shrine in Amritsar.'],
    ['s-hawa', 'hawa-mahal', 2, 'hawa-mahal', 'Hawa Mahal', 'Jaipur', 'India', 'Jaipur’s Palace of Winds.'],
    ['s-qutub', 'qutub-minar', 2, 'qutub-minar', 'Qutub Minar', 'Delhi', 'India', 'Delhi’s tall minaret. All four match.'],
    ['s-mysore', 'mysore-palace', 2, 'mysore-palace', 'Mysore Palace', 'Mysore', 'India',
      'Mysore’s royal palace. All four match.'],
    ['s-victoria', 'victoria-memorial', 2, 'victoria-memorial', 'Victoria Memorial', 'Kolkata', 'India',
      'Kolkata’s marble memorial hall.'],
    ['s-charminar', 'charminar', 2, 'charminar', 'Charminar', 'Hyderabad', 'India', 'Hyderabad’s four-minaret landmark.'],
    ['s-lotus', 'lotus-temple', 2, 'lotus-temple', 'Lotus Temple', 'Delhi', 'India', 'Delhi’s lotus-shaped Bahá’í temple.'],
    ['s-meenakshi', 'meenakshi-temple', 2, 'meenakshi-temple', 'Meenakshi Temple', 'Madurai', 'India',
      'A temple tower in Madurai. All four match.'],
    ['s-indiagate', 'india-gate', 1, 'india-gate', 'India Gate', 'New Delhi', 'India',
      'New Delhi’s war memorial. All four match.'],
    // Fakes that need knowing the fact
    ['s-taj-bad', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Mumbai', 'India', 'The Taj Mahal is in Agra, not Mumbai.',
      'city', 'know', 'Agra'],
    ['s-burj-bad', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Abu Dhabi', 'UAE', 'The Burj Khalifa is in Dubai.',
      'city', 'know', 'Dubai'],
    ['s-christ-bad', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'São Paulo', 'Brazil',
      'It overlooks Rio de Janeiro, not São Paulo.', 'city', 'know', 'Rio de Janeiro'],
    ['s-colosseum-bad', 'colosseum', 1, 'colosseum', 'Colosseum', 'Milan', 'Italy', 'The Colosseum is in Rome, not Milan.',
      'city', 'know', 'Rome'],
    ['s-liberty-fr-bad', 'statue-liberty', 1, 'statue-liberty', 'Statue of Liberty', 'New York', 'France',
      'A gift from France, but it stands in the USA.', 'country', 'know', 'USA'],
    ['s-machu-bad', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Near Cusco', 'Bolivia',
      'Machu Picchu is in Peru, not Bolivia.', 'country', 'know', 'Peru'],
    ['s-gateway-bad', 'gateway-of-india', 2, 'gateway-of-india', 'Gateway of India', 'New Delhi', 'India',
      'The Gateway of India is in Mumbai.', 'city', 'know', 'Mumbai'],
    ['s-towerbridge-bad', 'tower-bridge', 1, 'tower-bridge', 'Tower Bridge', 'Paris', 'UK',
      'Tower Bridge is in London, not Paris.', 'city', 'know', 'London'],
    ['s-fuji-bad', 'mount-fuji', 1, 'mount-fuji', 'Mount Fuji', 'Near Tokyo', 'China', 'Mount Fuji is in Japan.',
      'country', 'know', 'Japan'],
    ['s-pyramids-bad', 'pyramids-giza', 1, 'pyramids-giza', 'Pyramids of Giza', 'Giza', 'Mexico',
      'The Pyramids of Giza are in Egypt.', 'country', 'know', 'Egypt'],
    ['s-golden-bad', 'golden-temple', 2, 'golden-temple', 'Golden Temple', 'Jaipur', 'India',
      'The Golden Temple is in Amritsar.', 'city', 'know', 'Amritsar'],
    ['s-hawa-bad', 'hawa-mahal', 2, 'hawa-mahal', 'Hawa Mahal', 'Agra', 'India', 'Hawa Mahal is in Jaipur, the Pink City.',
      'city', 'know', 'Jaipur'],
    ['s-charminar-bad', 'charminar', 2, 'charminar', 'Charminar', 'Chennai', 'India', 'Charminar is in Hyderabad.',
      'city', 'know', 'Hyderabad'],
    ['s-victoria-bad', 'victoria-memorial', 2, 'victoria-memorial', 'Victoria Memorial', 'Mumbai', 'India',
      'The Victoria Memorial is in Kolkata.', 'city', 'know', 'Kolkata'],
    ['s-angkor-bad', 'angkor-wat', 2, 'angkor-wat', 'Angkor Wat', 'Phnom Penh', 'Cambodia',
      'Angkor Wat is by Siem Reap, not Phnom Penh.', 'city', 'know', 'Near Siem Reap'],
    ['s-moai-bad', 'moai', 2, 'moai', 'Moai', 'Near Hanga Roa', 'Peru', 'Easter Island is part of Chile, not Peru.',
      'country', 'know', 'Chile'],
    // Fakes the card gives away: the name, or the photo
    ['s-wall-bad', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Near Beijing', 'Japan',
      'The clue is in the name: it’s in China.', 'country', 'card', 'China'],
    ['s-opera-bad', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Melbourne', 'Australia',
      'The clue is in the name: it’s in Sydney.', 'city', 'card', 'Sydney'],
    ['s-pisa-bad', 'leaning-tower-pisa', 1, 'leaning-tower-pisa', 'Leaning Tower of Pisa', 'Rome', 'Italy',
      'The clue is in the name: it’s in Pisa.', 'city', 'card', 'Pisa'],
    ['s-brooklyn-bad', 'golden-gate', 1, 'golden-gate', 'Brooklyn Bridge', 'San Francisco', 'USA',
      'That red bridge is San Francisco’s Golden Gate.', 'name', 'card', 'Golden Gate Bridge'],
    ['s-bigben-bad', ['big-ben', 'eiffel'], 1, 'big-ben', 'Eiffel Tower', 'Paris', 'France',
      'That photo is Big Ben, not the Eiffel Tower.', 'photo', 'card', 'Iron lattice tower'],
    ['s-liberty-bad', ['statue-liberty', 'christ-redeemer'], 1, 'statue-liberty', 'Christ the Redeemer',
      'Rio de Janeiro', 'Brazil', 'That photo is the Statue of Liberty.', 'photo', 'card', 'Statue, arms spread wide'],
    ['s-stonehenge-bad', ['pyramids-giza', 'stonehenge'], 1, 'pyramids-giza', 'Stonehenge', 'Near Salisbury', 'UK',
      'Those are pyramids, not Stonehenge.', 'photo', 'card', 'Ring of standing stones'],
    ['s-fuji-photo-bad', ['mount-fuji', 'taj-mahal'], 1, 'mount-fuji', 'Taj Mahal', 'Agra', 'India',
      'That photo is Mount Fuji, not the Taj Mahal.', 'photo', 'card', 'White marble dome, four minarets'],
    ['s-hawa-photo-bad', ['hawa-mahal', 'taj-mahal'], 1, 'hawa-mahal', 'Taj Mahal', 'Agra', 'India',
      'That pink palace is Hawa Mahal, not the Taj.', 'photo', 'card', 'White marble dome, four minarets'],
    ['s-tower-photo-bad', ['tower-bridge', 'golden-gate'], 1, 'tower-bridge', 'Golden Gate Bridge', 'San Francisco', 'USA',
      'That photo is London’s Tower Bridge.', 'photo', 'card', 'Red suspension bridge'],
    ['s-sagrada-bad', ['sagrada-familia', 'taj-mahal'], 1, 'sagrada-familia', 'Taj Mahal', 'Barcelona', 'Spain',
      'Spires in Barcelona: the Sagrada Família.', 'name', 'card', 'Sagrada Família'],
    ['s-brandenburg-bad', ['brandenburg-gate', 'gateway-of-india'], 1, 'brandenburg-gate', 'Gateway of India', 'Berlin',
      'Germany', 'A gate in Berlin: the Brandenburg Gate.', 'name', 'card', 'Brandenburg Gate'],
    ['s-sealink-bad', ['sea-link', 'golden-gate'], 2, 'sea-link', 'Golden Gate Bridge', 'Mumbai', 'India',
      'A bridge in Mumbai: that’s the Sea Link.', 'name', 'card', 'Bandra–Worli Sea Link'],
    ['s-chichen-bad', ['chichen-itza', 'pyramids-giza'], 2, 'chichen-itza', 'Pyramids of Giza', 'Giza', 'Egypt',
      'That stepped pyramid is Chichén Itzá, Mexico.', 'photo', 'card', 'Three pyramids in the desert'],
    ['s-meenakshi-bad', ['meenakshi-temple', 'golden-temple'], 2, 'meenakshi-temple', 'Golden Temple', 'Madurai', 'India',
      'That carved tower is the Meenakshi Temple.', 'name', 'card', 'Meenakshi Temple'],
    ['s-qutub-bad', ['qutub-minar', 'leaning-tower-pisa'], 2, 'qutub-minar', 'Leaning Tower of Pisa', 'Delhi', 'India',
      'A red stone tower in Delhi: Qutub Minar.', 'name', 'card', 'Qutub Minar'],
    ['s-lotus-bad', ['lotus-temple', 'opera-house'], 2, 'lotus-temple', 'Sydney Opera House', 'Delhi', 'India',
      'White petals in Delhi: the Lotus Temple.', 'name', 'card', 'Lotus Temple']
  ]);

  // ---- Countries (flat flag; 42 good, 26 fake) ----
  // Web domains are country-code top-level domains. Left out on purpose: capitals in dispute or transition
  // (Bolivia, Indonesia), politically sensitive entries, and flags the painter cannot draw plainly (emblems,
  // stars, crests). Twins: the country, plus the country whose flag a fake shows.
  var COUNTRIES = country([
    ['c-it', 'it', 1, 'it', 'Italy', 'Rome', '.it', 'Italy’s tricolour, Rome and .it.'],
    ['c-fr', 'fr', 1, 'fr', 'France', 'Paris', '.fr', 'France’s tricolour, Paris and .fr.'],
    ['c-ie', 'ie', 1, 'ie', 'Ireland', 'Dublin', '.ie', 'Ireland: green, white, orange. All four match.'],
    ['c-be', 'be', 2, 'be', 'Belgium', 'Brussels', '.be', 'Belgium’s upright black, yellow, red.'],
    ['c-ng', 'ng', 2, 'ng', 'Nigeria', 'Abuja', '.ng', 'Abuja has been Nigeria’s capital since 1991.'],
    ['c-ro', 'ro', 2, 'ro', 'Romania', 'Bucharest', '.ro', 'Romania: blue, yellow, red. All four match.'],
    ['c-td', ['td', 'ro'], 2, 'td', 'Chad', 'N’Djamena', '.td', 'Chad’s flag is nearly Romania’s. All four match.'],
    ['c-ml', 'ml', 2, 'ml', 'Mali', 'Bamako', '.ml', 'Mali’s green, yellow, red. All four match.'],
    ['c-gn', 'gn', 2, 'gn', 'Guinea', 'Conakry', '.gn', 'Guinea’s red, yellow, green. All four match.'],
    ['c-pe', 'pe', 2, 'pe', 'Peru', 'Lima', '.pe', 'Peru’s red, white, red and Lima.'],
    ['c-ci', 'ci', 2, 'ci', 'Côte d’Ivoire', 'Yamoussoukro', '.ci', 'Côte d’Ivoire’s capital is Yamoussoukro.'],
    ['c-de', 'de', 1, 'de', 'Germany', 'Berlin', '.de', '.de stands for Deutschland. All four match.'],
    ['c-at', 'at', 2, 'at', 'Austria', 'Vienna', '.at', 'Austria’s red, white, red and .at.'],
    ['c-hu', 'hu', 2, 'hu', 'Hungary', 'Budapest', '.hu', 'Hungary’s red, white, green. All four match.'],
    ['c-ee', 'ee', 2, 'ee', 'Estonia', 'Tallinn', '.ee', 'Estonia’s blue, black, white. All four match.'],
    ['c-co', 'co', 2, 'co', 'Colombia', 'Bogotá', '.co', 'Colombia’s flag has a double yellow band.'],
    ['c-nl', 'nl', 1, 'nl', 'Netherlands', 'Amsterdam', '.nl', 'Amsterdam is the Dutch capital.'],
    ['c-lu', 'lu', 2, 'lu', 'Luxembourg', 'Luxembourg', '.lu', 'Lighter blue than Dutch. Capital: Luxembourg.'],
    ['c-bg', 'bg', 2, 'bg', 'Bulgaria', 'Sofia', '.bg', 'Bulgaria’s white, green, red and Sofia.'],
    ['c-lt', 'lt', 2, 'lt', 'Lithuania', 'Vilnius', '.lt', 'Lithuania’s yellow, green, red and Vilnius.'],
    ['c-lv', 'lv', 2, 'lv', 'Latvia', 'Riga', '.lv', 'Latvia’s dark red flag and Riga.'],
    ['c-ga', 'ga', 2, 'ga', 'Gabon', 'Libreville', '.ga', 'Gabon’s green, yellow, blue and Libreville.'],
    ['c-sl', 'sl', 2, 'sl', 'Sierra Leone', 'Freetown', '.sl', 'Sierra Leone’s capital is Freetown.'],
    ['c-am', 'am', 2, 'am', 'Armenia', 'Yerevan', '.am', 'Armenia’s red, blue, orange and Yerevan.'],
    ['c-pl', 'pl', 1, 'pl', 'Poland', 'Warsaw', '.pl', 'Poland’s white over red. All four match.'],
    ['c-mc', 'mc', 2, 'mc', 'Monaco', 'Monaco', '.mc', 'Monaco’s capital is Monaco. All four match.'],
    ['c-ua', 'ua', 2, 'ua', 'Ukraine', 'Kyiv', '.ua', 'Ukraine’s blue over yellow and Kyiv.'],
    ['c-se', 'se', 1, 'se', 'Sweden', 'Stockholm', '.se', 'Sweden’s yellow cross on blue.'],
    ['c-fi', 'fi', 2, 'fi', 'Finland', 'Helsinki', '.fi', 'Finland’s blue cross on white.'],
    ['c-dk', 'dk', 2, 'dk', 'Denmark', 'Copenhagen', '.dk', 'Denmark’s white cross on red.'],
    ['c-no', 'no', 2, 'no', 'Norway', 'Oslo', '.no', 'Norway’s blue cross edged in white.'],
    ['c-is', 'is', 2, 'is', 'Iceland', 'Reykjavík', '.is', 'Iceland’s red cross edged in white.'],
    ['c-jp', 'jp', 1, 'jp', 'Japan', 'Tokyo', '.jp', 'Japan’s red disc on white.'],
    ['c-bd', 'bd', 2, 'bd', 'Bangladesh', 'Dhaka', '.bd', 'Bangladesh’s red disc on green.'],
    ['c-pw', 'pw', 2, 'pw', 'Palau', 'Ngerulmud', '.pw', 'Palau’s capital is Ngerulmud. All four match.'],
    ['c-ch', 'ch', 1, 'ch', 'Switzerland', 'Bern', '.ch', '.ch is for Confoederatio Helvetica.'],
    ['c-in', 'in', 1, 'in', 'India', 'New Delhi', '.in', 'India’s tricolour, New Delhi and .in.'],
    ['c-mu', 'mu', 2, 'mu', 'Mauritius', 'Port Louis', '.mu', 'Mauritius’s four stripes and Port Louis.'],
    ['c-gm', 'gm', 2, 'gm', 'The Gambia', 'Banjul', '.gm', 'The Gambia’s capital is Banjul.'],
    ['c-bw', 'bw', 2, 'bw', 'Botswana', 'Gaborone', '.bw', 'Botswana’s capital is Gaborone.'],
    ['c-th', 'th', 1, 'th', 'Thailand', 'Bangkok', '.th', 'Thailand’s red, white, blue and Bangkok.'],
    ['c-cr', 'cr', 2, 'cr', 'Costa Rica', 'San José', '.cr', 'Costa Rica’s capital is San José.'],
    // Fakes that need knowing the fact
    ['c-ch-bad', 'ch', 1, 'ch', 'Switzerland', 'Zurich', '.ch', 'Zurich is the biggest city. Bern is the capital.',
      'capital', 'know', 'Bern'],
    ['c-ng-bad', 'ng', 2, 'ng', 'Nigeria', 'Lagos', '.ng', 'Lagos is the biggest city. Abuja is the capital.',
      'capital', 'know', 'Abuja'],
    ['c-jp-bad', 'jp', 1, 'jp', 'Japan', 'Kyoto', '.jp', 'Kyoto was the old capital. Today it’s Tokyo.',
      'capital', 'know', 'Tokyo'],
    ['c-co-bad', 'co', 2, 'co', 'Colombia', 'Medellín', '.co', 'Colombia’s capital is Bogotá, not Medellín.',
      'capital', 'know', 'Bogotá'],
    ['c-pl-bad', 'pl', 2, 'pl', 'Poland', 'Kraków', '.pl', 'Kraków was the old capital. Today it’s Warsaw.',
      'capital', 'know', 'Warsaw'],
    ['c-nl-bad', 'nl', 2, 'nl', 'Netherlands', 'The Hague', '.nl', 'The Hague is the seat. Amsterdam is the capital.',
      'capital', 'know', 'Amsterdam'],
    ['c-lt-bad', ['lt', 'lv'], 2, 'lt', 'Lithuania', 'Riga', '.lt', 'Vilnius is the capital. Riga is in Latvia.',
      'capital', 'know', 'Vilnius'],
    ['c-pe-bad', 'pe', 2, 'pe', 'Peru', 'Cusco', '.pe', 'Cusco was the Inca capital. Today it’s Lima.',
      'capital', 'know', 'Lima'],
    ['c-cr-bad', 'cr', 2, 'cr', 'Costa Rica', 'San Juan', '.cr', 'Costa Rica’s capital is San José.',
      'capital', 'know', 'San José'],
    ['c-at-dom-bad', 'at', 2, 'at', 'Austria', 'Vienna', '.au', '.au is Australia. Austria’s domain is .at.',
      'domain', 'know', '.at'],
    ['c-ch-dom-bad', 'ch', 2, 'ch', 'Switzerland', 'Bern', '.sw', 'Switzerland’s domain is .ch, from Latin.',
      'domain', 'know', '.ch'],
    ['c-de-dom-bad', 'de', 2, 'de', 'Germany', 'Berlin', '.ge', '.ge is Georgia. Germany’s is .de.',
      'domain', 'know', '.de'],
    ['c-th-dom-bad', 'th', 2, 'th', 'Thailand', 'Bangkok', '.tl', '.tl is Timor-Leste. Thailand’s is .th.',
      'domain', 'know', '.th'],
    // Fakes the card gives away: another country’s flag, or a name the other three contradict
    ['c-se-bad', ['se', 'fi'], 1, 'fi', 'Sweden', 'Stockholm', '.se', 'Finland’s flag. Sweden’s is yellow on blue.',
      'flag', 'card', 'Blue, yellow cross'],
    ['c-ie-bad', ['ie', 'it'], 1, 'it', 'Ireland', 'Dublin', '.ie', 'Italy’s flag. Ireland’s has orange, not red.',
      'flag', 'card', 'Green, white, orange'],
    ['c-pl-flag-bad', ['pl', 'mc'], 1, 'mc', 'Poland', 'Warsaw', '.pl', 'Upside down: Poland’s is white over red.',
      'flag', 'card', 'White over red'],
    ['c-in-flag-bad', ['in', 'ie'], 1, 'ie', 'India', 'New Delhi', '.in', 'Ireland’s flag. India’s has a navy wheel.',
      'flag', 'card', 'Saffron, white, green, navy wheel'],
    ['c-hu-flag-bad', ['hu', 'it'], 2, 'it', 'Hungary', 'Budapest', '.hu', 'Italy’s flag. Hungary’s stripes lie flat.',
      'flag', 'card', 'Red, white, green'],
    ['c-be-bad', ['be', 'de'], 2, 'de', 'Belgium', 'Brussels', '.be', 'Germany’s flag. Belgium’s stripes stand upright.',
      'flag', 'card', 'Black, yellow, red'],
    ['c-ro-flag-bad', ['ro', 'it'], 2, 'it', 'Romania', 'Bucharest', '.ro', 'Italy’s flag. Romania’s is blue, yellow, red.',
      'flag', 'card', 'Blue, yellow, red'],
    ['c-th-flag-bad', ['th', 'cr'], 2, 'cr', 'Thailand', 'Bangkok', '.th', 'Costa Rica’s flag. Thailand’s has red outside.',
      'flag', 'card', 'Red, white, wide blue, white, red'],
    ['c-ie-ci-bad', ['ie', 'ci'], 2, 'ci', 'Ireland', 'Dublin', '.ie', 'Côte d’Ivoire’s flag. Ireland’s starts green.',
      'flag', 'card', 'Green, white, orange'],
    ['c-jp-name-bad', 'jp', 1, 'jp', 'China', 'Tokyo', '.jp', 'Red disc, Tokyo and .jp: that’s Japan.',
      'country', 'card', 'Japan'],
    ['c-fr-name-bad', ['fr', 'it'], 1, 'fr', 'Italy', 'Paris', '.fr', 'Paris and .fr: that’s France, not Italy.',
      'country', 'card', 'France'],
    ['c-th-name-bad', 'th', 1, 'th', 'Vietnam', 'Bangkok', '.th', 'Bangkok and .th: that’s Thailand.',
      'country', 'card', 'Thailand'],
    ['c-mu-name-bad', 'mu', 2, 'mu', 'Madagascar', 'Port Louis', '.mu', 'Port Louis and .mu: that’s Mauritius.',
      'country', 'card', 'Mauritius']
  ]);

  // ---- Tokens (painted logo; 24 good, 19 fake) ----
  // Famous, easy tokens only, each website opened again on 30 Oct 2026 and matched to its CoinGecko listing (XRP:
  // xrpl.org, the XRP Ledger’s own site; Toncoin left out: it was renamed). Websites are plain text, never links.
  // No prices and no investment talk. Fakes are easy: a lookalike website, a swapped ticker, another token’s
  // logo, or a wrong name. Twins: the token, plus the one a fake borrows from.
  var TOKENS = tokens([
    ['t-btc', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin.org', 'Bitcoin’s orange B and bitcoin.org.'],
    ['t-eth', 'eth', 1, 'eth', 'Ethereum', 'ETH', 'ethereum.org', 'Ethereum’s diamond and ethereum.org.'],
    ['t-usdt', 'usdt', 1, 'usdt', 'Tether', 'USDT', 'tether.to', 'Tether’s website really is tether.to.'],
    ['t-usdc', 'usdc', 1, 'usdc', 'USD Coin', 'USDC', 'circle.com', 'USDC is issued by Circle, at circle.com.'],
    ['t-doge', 'doge', 1, 'doge', 'Dogecoin', 'DOGE', 'dogecoin.com', 'Dogecoin’s gold D and dogecoin.com.'],
    ['t-sol', 'sol', 1, 'sol', 'Solana', 'SOL', 'solana.com', 'Solana’s slanted bars and solana.com.'],
    ['t-ada', 'ada', 2, 'ada', 'Cardano', 'ADA', 'cardano.org', 'Cardano’s ticker is ADA. All four match.'],
    ['t-link', 'link', 2, 'link', 'Chainlink', 'LINK', 'chain.link', 'Chainlink’s website really is chain.link.'],
    ['t-uni', 'uni', 2, 'uni', 'Uniswap', 'UNI', 'uniswap.org', 'Uniswap’s pink logo and uniswap.org.'],
    ['t-pol', 'pol', 2, 'pol', 'Polygon', 'POL', 'polygon.technology', 'POL took over from MATIC in 2024.'],
    ['t-avax', 'avax', 2, 'avax', 'Avalanche', 'AVAX', 'avax.network', 'Avalanche’s red A and avax.network.'],
    ['t-shib', 'shib', 2, 'shib', 'Shiba Inu', 'SHIB', 'shib.io', 'Shiba Inu’s website is shib.io.'],
    ['t-bnb', 'bnb', 2, 'bnb', 'BNB', 'BNB', 'bnbchain.org', 'BNB powers BNB Chain, at bnbchain.org.'],
    ['t-pnk', 'pnk', 1, 'pnk', 'Kleros', 'PNK', 'kleros.io', 'Kleros’s own token. Yes, that’s us.'],
    ['t-xrp', 'xrp', 2, 'xrp', 'XRP', 'XRP', 'xrpl.org', 'XRP runs on the XRP Ledger, at xrpl.org.'],
    ['t-ltc', 'ltc', 2, 'ltc', 'Litecoin', 'LTC', 'litecoin.org', 'Litecoin’s L and litecoin.org.'],
    ['t-xlm', 'xlm', 2, 'xlm', 'Stellar', 'XLM', 'stellar.org', 'Stellar’s ticker is XLM. All four match.'],
    ['t-dot', 'dot', 2, 'dot', 'Polkadot', 'DOT', 'polkadot.com', 'Polkadot’s pink dots and polkadot.com.'],
    ['t-xmr', 'xmr', 2, 'xmr', 'Monero', 'XMR', 'getmonero.org', 'Monero’s orange M and getmonero.org.'],
    ['t-aave', 'aave', 2, 'aave', 'Aave', 'AAVE', 'aave.com', 'Aave’s website is aave.com. All four match.'],
    ['t-arb', 'arb', 2, 'arb', 'Arbitrum', 'ARB', 'arbitrum.io', 'Arbitrum’s ticker is ARB. All four match.'],
    ['t-op', 'op', 2, 'op', 'Optimism', 'OP', 'optimism.io', 'Optimism’s ticker really is OP.'],
    ['t-gno', 'gno', 2, 'gno', 'Gnosis', 'GNO', 'gnosis.io', 'Gnosis’s ticker is GNO. All four match.'],
    ['t-near', 'near', 2, 'near', 'NEAR Protocol', 'NEAR', 'near.org', 'NEAR Protocol lives at near.org.'],
    // Fakes that need knowing the fact
    ['t-btc-site-bad', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin-official.org', 'Not the real one: Bitcoin’s is bitcoin.org.',
      'site', 'know', 'bitcoin.org'],
    ['t-sol-site-bad', 'sol', 1, 'sol', 'Solana', 'SOL', 'solana-airdrop.com', 'Not the real one: Solana’s is solana.com.',
      'site', 'know', 'solana.com'],
    ['t-link-site-bad', 'link', 2, 'link', 'Chainlink', 'LINK', 'chainlink-claim.com',
      'Not the real one: Chainlink’s is chain.link.', 'site', 'know', 'chain.link'],
    ['t-dot-site-bad', 'dot', 2, 'dot', 'Polkadot', 'DOT', 'polkadot-gift.com', 'Not the real one: Polkadot’s is polkadot.com.',
      'site', 'know', 'polkadot.com'],
    ['t-aave-site-bad', 'aave', 2, 'aave', 'Aave', 'AAVE', 'aave-rewards.com', 'Not the real one: Aave’s is aave.com.',
      'site', 'know', 'aave.com'],
    ['t-eth-etc-bad', 'eth', 1, 'eth', 'Ethereum', 'ETC', 'ethereum.org', 'ETC is Ethereum Classic. Ethereum’s is ETH.',
      'ticker', 'know', 'ETH'],
    ['t-doge-dog-bad', 'doge', 1, 'doge', 'Dogecoin', 'DOG', 'dogecoin.com', 'One letter short: Dogecoin’s is DOGE.',
      'ticker', 'know', 'DOGE'],
    ['t-avax-bad', 'avax', 2, 'avax', 'Avalanche', 'AVA', 'avax.network', 'Avalanche’s ticker is AVAX, not AVA.',
      'ticker', 'know', 'AVAX'],
    ['t-arb-op-bad', ['arb', 'op'], 2, 'arb', 'Arbitrum', 'OP', 'arbitrum.io', 'OP is Optimism’s ticker. Arbitrum’s is ARB.',
      'ticker', 'know', 'ARB'],
    // Fakes the card gives away: a misspelt website, another token’s logo, or a name the other three contradict
    ['t-eth-site-bad', 'eth', 1, 'eth', 'Ethereum', 'ETH', 'etherium.org', 'Check the spelling: it’s ethereum.org.',
      'site', 'card', 'ethereum.org'],
    ['t-btc-logo-bad', ['btc', 'eth'], 1, 'eth', 'Bitcoin', 'BTC', 'bitcoin.org', 'That’s Ethereum’s diamond. Bitcoin’s is a B.',
      'logo', 'card', 'Orange coin, white B'],
    ['t-usdt-logo-bad', ['usdt', 'usdc'], 1, 'usdc', 'Tether', 'USDT', 'tether.to', 'That’s the USDC logo. Tether’s is a green T.',
      'logo', 'card', 'Green coin, white T'],
    ['t-ltc-logo-bad', ['ltc', 'btc'], 2, 'btc', 'Litecoin', 'LTC', 'litecoin.org', 'That’s Bitcoin’s B. Litecoin’s is a blue L.',
      'logo', 'card', 'Blue coin, white L with a bar'],
    ['t-xmr-logo-bad', ['xmr', 'doge'], 2, 'doge', 'Monero', 'XMR', 'getmonero.org',
      'That’s the Dogecoin D. Monero’s is an orange M.', 'logo', 'card', 'Orange coin, white M'],
    ['t-sol-name-bad', ['sol', 'ada'], 1, 'sol', 'Cardano', 'SOL', 'solana.com', 'SOL and solana.com: that’s Solana.',
      'name', 'card', 'Solana'],
    ['t-btc-name-bad', ['btc', 'doge'], 1, 'btc', 'Dogecoin', 'BTC', 'bitcoin.org', 'BTC and bitcoin.org: that’s Bitcoin.',
      'name', 'card', 'Bitcoin'],
    ['t-link-name-bad', ['link', 'pol'], 1, 'link', 'Polygon', 'LINK', 'chain.link', 'LINK and chain.link: that’s Chainlink.',
      'name', 'card', 'Chainlink'],
    ['t-xrp-name-bad', ['xrp', 'xlm'], 2, 'xrp', 'Stellar', 'XRP', 'xrpl.org', 'XRP and xrpl.org: that’s XRP, not Stellar.',
      'name', 'card', 'XRP'],
    ['t-near-name-bad', ['near', 'xmr'], 2, 'near', 'Monero', 'NEAR', 'near.org', 'NEAR and near.org: that’s NEAR Protocol.',
      'name', 'card', 'NEAR Protocol']
  ]);

  // ---- Decks ----
  // One deck per app, in title-screen order. `client` is the app’s short name (Results, ticket); `pick` is its
  // title-screen card (app, one need line, and its picture: img, flag, or coin plus coins, a trio). Each deck
  // has one list of 4 parts: the picture (objField) first, then three text rows. The policy is the intro’s
  // rule line. `intro.good` is the intro’s correct example (never dealt in a round); `practice[0]` is its wrong
  // example, the same entry with one part wrong (a twin, so it never enters a round either). Results copy
  // (v6 §6): `headlines` by trust (≥ 90, 70–89, < 70). `mission` shows for a moment before the Go banner.
  var HEADLINES = ['Great job', 'Not bad', 'Too many fakes got in'];
  window.CURATE_DECKS = {
    sights: {
      id: 'sights', client: 'Travel guide app',
      pick: { app: 'Travel guide app', need: 'needs real sights', img: '/curate/img/taj-mahal.jpg' },
      copy: {
        mission: 'Keep the sights real.',
        headlines: HEADLINES
      },
      coach: { fact: 'The Eiffel Tower is in Paris.' },
      lists: {
        sights: { name: 'Sights', policy: 'Photo, name, city and country must all match.',
                  fields: [['photo', 'Photo'], ['name', 'Name'], ['city', 'City'], ['country', 'Country']], objField: 'photo' }
      },
      intro: { good: 's-eiffel' },   // the intro’s correct example; practice[0] is its wrong one
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
        mission: 'Keep the atlas right.',
        headlines: HEADLINES
      },
      coach: { fact: 'India’s capital is New Delhi.' },
      lists: {
        countries: { name: 'Countries', policy: 'Flag, country, capital and domain must all match.',
                     fields: [['flag', 'Flag'], ['country', 'Country'], ['capital', 'Capital'], ['domain', 'Web domain']],
                     objField: 'flag' }
      },
      intro: { good: 'c-in' },
      split: { countries: [10, 4] },
      practice: country([
        ['p-india', 'in', 1, 'in', 'India', 'Mumbai', '.in', 'Mumbai is big, but New Delhi is the capital.',
          'capital', 'know', 'New Delhi']
      ]),
      items: COUNTRIES
    },
    tokens: {
      id: 'tokens', client: 'Crypto exchange app',
      pick: { app: 'Crypto exchange app', need: 'needs only real tokens',
              coin: LOGOS.btc[0], coins: [LOGOS.btc[0], LOGOS.eth[0], LOGOS.usdc[0]] },
      copy: {
        mission: 'Keep the token list real.',
        headlines: HEADLINES
      },
      coach: { fact: 'Bitcoin’s website is bitcoin.org.' },
      lists: {
        tokens: { name: 'Tokens', policy: 'Logo, name, ticker and website must all match.',
                  fields: [['logo', 'Logo'], ['name', 'Name'], ['ticker', 'Ticker'], ['site', 'Website']], objField: 'logo' }
      },
      intro: { good: 't-btc' },
      split: { tokens: [10, 4] },
      practice: tokens([
        ['p-btc', 'btc', 1, 'btc', 'Bitcoin', 'BTC', 'bitcoin-giveaway.com', 'Giveaway sites are a trick. It’s bitcoin.org.',
          'site', 'know', 'bitcoin.org']
      ]),
      items: TOKENS
    }
  };
})();
