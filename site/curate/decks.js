// Curate game content: three fictional apps that each need one clean list, and every entry. Data only:
// rules.js deals the round, game.js shows it. Facts (sights, capitals, flags, songs, years) were checked by
// hand; re-check before merge. `node scripts/curate-check.js` validates this file (ids, fields, tells, lengths,
// photos and their credits, flags, sleeves, one odd field per fake).
(function () {
  // ---- Flags ----
  // [spec for CurateObjects._flag, words for the Flag row]. The words read on any phone and to screen readers.
  // Kinds: v3 (hoist to fly), h3 (top to bottom, optional ratio), h2, nordic (field, cross, optional inner),
  // disc (field, disc, optional off: fraction of the width, negative towards the hoist), cross (Swiss),
  // h3wheel (India). Colours follow each country’s official specification as #rrggbb; black is lifted to
  // #1a1a1a so it still reads against the dark stage.
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
  // [words for the Photo row and the alt text, true name, true location, crop?]. Locations read "City, Country",
  // or a region where the sight stands outside any city. crop: CSS object-position for a tall photo in the wide
  // slot, so the head, arms or torch stay in view (centred when left out).
  var PHOTOS = {
    'eiffel': ['Iron lattice tower', 'Eiffel Tower', 'Paris, France'],
    'colosseum': ['Oval arena of stone arches', 'Colosseum', 'Rome, Italy'],
    'taj-mahal': ['White marble dome, four minarets', 'Taj Mahal', 'Agra, India'],
    'opera-house': ['White shell-shaped roofs', 'Sydney Opera House', 'Sydney, Australia'],
    'great-wall': ['Stone wall winding over hills', 'Great Wall of China', 'Northern China'],
    'golden-gate': ['Red suspension bridge', 'Golden Gate Bridge', 'San Francisco, USA'],
    'machu-picchu': ['Stone ruins on a mountain ridge', 'Machu Picchu', 'Andes, Peru'],
    'big-ben': ['Gothic clock tower', 'Big Ben', 'London, UK', '50% 25%'],
    'burj-khalifa': ['Very tall glass skyscraper', 'Burj Khalifa', 'Dubai, UAE'],
    'sagrada-familia': ['Basilica with tall spires', 'Sagrada Família', 'Barcelona, Spain'],
    'statue-liberty': ['Green statue with a torch', 'Statue of Liberty', 'New York, USA', '50% 0%'],
    'christ-redeemer': ['Statue, arms spread wide', 'Christ the Redeemer', 'Rio de Janeiro, Brazil', '50% 7%'],
    'gateway-of-india': ['Stone arch lit at dusk', 'Gateway of India', 'Mumbai, India'],
    'cst-mumbai': ['Gothic station with domes', 'Chhatrapati Shivaji Maharaj Terminus', 'Mumbai, India'],
    'sea-link': ['Cable-stayed bridge over the sea', 'Bandra–Worli Sea Link', 'Mumbai, India'],
    'haji-ali': ['White shrine with a dome', 'Haji Ali Dargah', 'Mumbai, India'],
    'marine-drive': ['Curving seafront at night', 'Marine Drive', 'Mumbai, India'],
    'elephanta': ['Three-faced stone carving', 'Elephanta Caves', 'Mumbai Harbour, India']
  };
  function photo(key) {
    var o = { shape: 'photo', src: '/curate/img/' + key + '.jpg', alt: PHOTOS[key][0] };
    if (PHOTOS[key][3]) o.pos = PHOTOS[key][3];
    return o;
  }

  // ---- Sleeves ----
  // A painted record sleeve per song (album art is copyrighted): two colours and the song’s initials.
  var SLEEVES = [['#ff5f6d', '#ffc371'], ['#4d00b4', '#27cdfe'], ['#11998e', '#38ef7d'], ['#f7971e', '#ffd200'],
    ['#8e2de2', '#ff6fd8'], ['#1d2b64', '#78a4ff'], ['#c31432', '#ff9a8b'], ['#0f9b8e', '#c6ffdd']];
  function sleeve(song, n) {
    var w = song.replace(/[^A-Za-z ]/g, '').split(' '), c = SLEEVES[n % SLEEVES.length];
    return { shape: 'sleeve', color: c[0], color2: c[1], mark: (w[0].charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase() };
  }

  // ---- Builders ----
  // Rows keep the file small. Each row becomes a full item:
  // { id, list, twin, lvl, obj, f: { the list’s 3 fields }, bad, also, tell, fix, why }
  // `bad` is the one odd field (null for a good entry): the other two always agree with each other.
  // `tell` is 'card' when the card plus the policy show the flaw, 'know' when it takes knowing the fact.
  // `twin` keys (a string or a list) keep a round to one entry per photo, name, country or song.
  function item(list, r, f, obj, lvl, at) {
    var it = { id: r[0], list: list, twin: r[1] || null, lvl: lvl, obj: obj, f: f,
               bad: r[at + 1] || null, also: [], why: r[at] };
    if (it.bad) { it.tell = r[at + 2]; it.fix = r[at + 3]; }
    return it;
  }
  // Sight rows: [id, twin, lvl, shown photo, name, location, why, bad, tell, fix]
  // The Photo row always describes the photo that is shown, so a wrong photo shows on the card.
  function sights(rows) {
    return rows.map(function (r) {
      return item('sights', r, { photo: PHOTOS[r[3]][0], name: r[4], where: r[5] }, photo(r[3]), r[2], 6);
    });
  }
  // Country rows: [id, twin, lvl, drawn flag, country, capital, why, bad, tell, fix]
  // The Flag row always describes the flag that is drawn, so a wrong flag shows on the card.
  function country(rows) {
    return rows.map(function (r) {
      var fl = FLAGS[r[3]];
      return item('countries', r, { flag: fl[1], country: r[4], capital: r[5] }, { shape: 'flag', flag: fl[0] }, r[2], 6);
    });
  }
  // Song rows: [id, twin, lvl, song, artist, year, why, bad, tell, fix]. The twin is the song, so a fake and
  // its real entry share one sleeve.
  var SONG_N = {};
  function songs(rows) {
    return rows.map(function (r) {
      if (SONG_N[r[1]] === undefined) SONG_N[r[1]] = Object.keys(SONG_N).length;
      return item('songs', r, { song: r[3], artist: r[4], year: r[5] }, sleeve(r[3], SONG_N[r[1]]), r[2], 6);
    });
  }

  // ---- Sights (photo; the photo is the `photo` field and can be tapped; 18 good, 13 fake) ----
  // Twins: the photo file, plus the claimed sight when a photo is named after another one.
  var SIGHTS = sights([
    ['s-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Paris, France', 'Photo, name and location all match.'],
    ['s-colosseum', 'colosseum', 1, 'colosseum', 'Colosseum', 'Rome, Italy', 'Rome’s ancient arena. All three match.'],
    ['s-taj', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Agra, India', 'The Taj Mahal stands in Agra. All three match.'],
    ['s-opera', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Sydney, Australia', 'Photo, name and location all match.'],
    ['s-wall', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Northern China',
      'It winds across the hills of northern China.'],
    ['s-goldengate', 'golden-gate', 1, 'golden-gate', 'Golden Gate Bridge', 'San Francisco, USA',
      'Photo, name and location all match.'],
    ['s-machu', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Andes, Peru', 'The Inca citadel high in Peru’s Andes.'],
    ['s-bigben', 'big-ben', 1, 'big-ben', 'Big Ben', 'London, UK', 'Photo, name and location all match.'],
    ['s-burj', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Dubai, UAE', 'The world’s tallest building, in Dubai.'],
    ['s-sagrada', 'sagrada-familia', 1, 'sagrada-familia', 'Sagrada Família', 'Barcelona, Spain', 'Gaudí’s basilica in Barcelona.'],
    ['s-liberty', 'statue-liberty', 1, 'statue-liberty', 'Statue of Liberty', 'New York, USA', 'Photo, name and location all match.'],
    ['s-christ', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'Rio de Janeiro, Brazil',
      'It overlooks Rio from Corcovado. All three match.'],
    ['s-gateway', 'gateway-of-india', 1, 'gateway-of-india', 'Gateway of India', 'Mumbai, India', 'Mumbai’s 1924 waterfront arch.'],
    ['s-csmt', 'cst-mumbai', 2, 'cst-mumbai', 'Chhatrapati Shivaji Maharaj Terminus', 'Mumbai, India',
      'Mumbai’s Victorian Gothic station, a UNESCO site.'],
    ['s-sealink', 'sea-link', 2, 'sea-link', 'Bandra–Worli Sea Link', 'Mumbai, India', 'The cable-stayed bridge across Mahim Bay.'],
    ['s-hajiali', 'haji-ali', 2, 'haji-ali', 'Haji Ali Dargah', 'Mumbai, India', 'A shrine on an islet off Worli.'],
    ['s-marine', 'marine-drive', 2, 'marine-drive', 'Marine Drive', 'Mumbai, India', 'Mumbai’s seafront, the Queen’s Necklace.'],
    ['s-elephanta', 'elephanta', 2, 'elephanta', 'Elephanta Caves', 'Mumbai Harbour, India',
      'Rock-cut caves on an island, a ferry ride from Mumbai.'],
    ['s-taj-bad', 'taj-mahal', 1, 'taj-mahal', 'Taj Mahal', 'Mumbai, India', 'The Taj Mahal is in Agra, not Mumbai.',
      'where', 'know', 'Agra, India'],
    ['s-burj-bad', 'burj-khalifa', 1, 'burj-khalifa', 'Burj Khalifa', 'Abu Dhabi, UAE',
      'The Burj Khalifa is in Dubai, not Abu Dhabi.', 'where', 'know', 'Dubai, UAE'],
    ['s-christ-bad', 'christ-redeemer', 1, 'christ-redeemer', 'Christ the Redeemer', 'Lisbon, Portugal',
      'Lisbon has a cousin, Cristo Rei. The original is in Rio.', 'where', 'know', 'Rio de Janeiro, Brazil'],
    ['s-colosseum-bad', 'colosseum', 1, 'colosseum', 'Colosseum', 'Athens, Greece', 'The Colosseum is in Rome, not Athens.',
      'where', 'know', 'Rome, Italy'],
    ['s-machu-bad', 'machu-picchu', 2, 'machu-picchu', 'Machu Picchu', 'Andes, Bolivia',
      'Machu Picchu is in Peru, not Bolivia.', 'where', 'know', 'Andes, Peru'],
    ['s-gateway-bad', 'gateway-of-india', 2, 'gateway-of-india', 'Gateway of India', 'New Delhi, India',
      'New Delhi has India Gate. The Gateway of India is in Mumbai.', 'where', 'know', 'Mumbai, India'],
    ['s-wall-bad', 'great-wall', 1, 'great-wall', 'Great Wall of China', 'Kyoto, Japan',
      'The clue is in the name: the Great Wall is in China.', 'where', 'card', 'Northern China'],
    ['s-opera-bad', 'opera-house', 1, 'opera-house', 'Sydney Opera House', 'Melbourne, Australia',
      'The clue is in the name: it’s in Sydney.', 'where', 'card', 'Sydney, Australia'],
    ['s-brooklyn-bad', 'golden-gate', 1, 'golden-gate', 'Brooklyn Bridge', 'San Francisco, USA',
      'A red bridge in San Francisco: that’s the Golden Gate.', 'name', 'card', 'Golden Gate Bridge'],
    ['s-bigben-bad', ['big-ben', 'eiffel'], 1, 'big-ben', 'Eiffel Tower', 'Paris, France',
      'Look at the photo: that’s Big Ben, not the Eiffel Tower.', 'photo', 'card', 'Iron lattice tower'],
    ['s-liberty-bad', ['statue-liberty', 'christ-redeemer'], 1, 'statue-liberty', 'Christ the Redeemer',
      'Rio de Janeiro, Brazil', 'Look at the photo: that’s the Statue of Liberty, not Christ the Redeemer.', 'photo', 'card',
      'Statue, arms spread wide'],
    ['s-sagrada-bad', ['sagrada-familia', 'taj-mahal'], 1, 'sagrada-familia', 'Taj Mahal', 'Barcelona, Spain',
      'Spires in Barcelona: that’s the Sagrada Família.', 'name', 'card', 'Sagrada Família'],
    ['s-sealink-bad', ['sea-link', 'golden-gate'], 2, 'sea-link', 'Golden Gate Bridge', 'Mumbai, India',
      'A cable-stayed bridge in Mumbai: that’s the Sea Link.', 'name', 'card', 'Bandra–Worli Sea Link']
  ]);


  // ---- Countries (flat flag; the flag is the `flag` field and can be tapped; 20 good, 10 fake) ----
  // Left out on purpose: capitals in dispute or transition, and politically sensitive entries.
  var COUNTRIES = country([
    ['c-it', null, 1, 'it', 'Italy', 'Rome', 'Italy’s tricolour and capital. All three match.'],
    ['c-fr', null, 1, 'fr', 'France', 'Paris', 'France’s tricolour and capital. All three match.'],
    ['c-ie', 'ie', 1, 'ie', 'Ireland', 'Dublin', 'Ireland’s green, white and orange. All three match.'],
    ['c-be', 'be', 2, 'be', 'Belgium', 'Brussels', 'Belgium’s upright black, yellow, red. All three match.'],
    ['c-ng', 'ng', 2, 'ng', 'Nigeria', 'Abuja', 'Abuja has been Nigeria’s capital since 1991.'],
    ['c-de', null, 1, 'de', 'Germany', 'Berlin', 'Germany’s black, red and gold. All three match.'],
    ['c-at', null, 2, 'at', 'Austria', 'Vienna', 'Austria’s red, white, red. All three match.'],
    ['c-hu', null, 2, 'hu', 'Hungary', 'Budapest', 'Hungary’s red, white, green. All three match.'],
    ['c-ee', null, 2, 'ee', 'Estonia', 'Tallinn', 'Estonia’s blue, black, white. All three match.'],
    ['c-co', 'co', 2, 'co', 'Colombia', 'Bogotá', 'Colombia’s flag has a double-height yellow band.'],
    ['c-pl', 'pl', 1, 'pl', 'Poland', 'Warsaw', 'Poland’s white over red. All three match.'],
    ['c-se', 'se', 1, 'se', 'Sweden', 'Stockholm', 'Sweden’s yellow cross on blue. All three match.'],
    ['c-fi', null, 2, 'fi', 'Finland', 'Helsinki', 'Finland’s blue cross on white. All three match.'],
    ['c-dk', null, 2, 'dk', 'Denmark', 'Copenhagen', 'Denmark’s white cross on red. All three match.'],
    ['c-no', null, 2, 'no', 'Norway', 'Oslo', 'Norway’s blue cross edged in white. All three match.'],
    ['c-is', null, 2, 'is', 'Iceland', 'Reykjavík', 'Iceland’s red cross edged in white. All three match.'],
    ['c-jp', 'jp', 1, 'jp', 'Japan', 'Tokyo', 'Japan’s red disc on white. All three match.'],
    ['c-bd', null, 2, 'bd', 'Bangladesh', 'Dhaka', 'Bangladesh’s red disc on green. All three match.'],
    ['c-ch', 'ch', 1, 'ch', 'Switzerland', 'Bern', 'Bern is Switzerland’s federal city. All three match.'],
    ['c-in', 'in', 1, 'in', 'India', 'New Delhi', 'India’s tricolour and capital. All three match.'],
    ['c-ch-bad', 'ch', 1, 'ch', 'Switzerland', 'Zurich', 'Zurich is the biggest city. The capital is Bern.',
      'capital', 'know', 'Bern'],
    ['c-ng-bad', 'ng', 2, 'ng', 'Nigeria', 'Lagos', 'Lagos is the biggest city. The capital is Abuja.',
      'capital', 'know', 'Abuja'],
    ['c-jp-bad', 'jp', 1, 'jp', 'Japan', 'Kyoto', 'Kyoto was the old capital. Today it’s Tokyo.',
      'capital', 'know', 'Tokyo'],
    ['c-co-bad', 'co', 2, 'co', 'Colombia', 'Medellín', 'Medellín is a big city, but the capital is Bogotá.',
      'capital', 'know', 'Bogotá'],
    ['c-pl-bad', 'pl', 2, 'pl', 'Poland', 'Kraków', 'Kraków was the old royal capital. Today it’s Warsaw.',
      'capital', 'know', 'Warsaw'],
    ['c-se-bad', 'se', 1, 'fi', 'Sweden', 'Stockholm', 'That’s Finland’s flag. Sweden’s cross is yellow on blue.',
      'flag', 'card', 'Blue, yellow cross'],
    ['c-ie-bad', 'ie', 1, 'it', 'Ireland', 'Dublin', 'That’s Italy’s flag. Ireland’s has orange, not red.',
      'flag', 'card', 'Green, white, orange'],
    ['c-pl-flag-bad', 'pl', 1, 'mc', 'Poland', 'Warsaw', 'Upside down: Poland’s flag is white over red.',
      'flag', 'card', 'White over red'],
    ['c-jp-name-bad', 'jp', 1, 'jp', 'China', 'Tokyo', 'Red disc on white, capital Tokyo: that’s Japan.',
      'country', 'card', 'Japan'],
    ['c-be-bad', 'be', 2, 'de', 'Belgium', 'Brussels', 'That’s Germany’s flag. Belgium’s stripes stand upright.',
      'flag', 'card', 'Black, yellow, red']
  ]);


  // ---- Songs (painted sleeve, no tappable object; 20 good, 12 fake) ----
  // Songs a Devcon crowd knows, with one clear lead artist and the year the song first came out. Left out on
  // purpose: songs with disputed or shared credits (covers, “featuring” hits, film songs credited to the singer).
  // A fake is a fake upload under the wrong artist, or a year more than 5 years off.
  var SONGS = songs([
    ['m-heyjude', 'hey-jude', 1, 'Hey Jude', 'The Beatles', '1968', 'The Beatles, 1968. All three match.'],
    ['m-wonderwall', 'wonderwall', 1, 'Wonderwall', 'Oasis', '1995', 'Oasis, 1995. All three match.'],
    ['m-bohemian', 'bohemian', 1, 'Bohemian Rhapsody', 'Queen', '1975', 'Queen, 1975. All three match.'],
    ['m-imagine', 'imagine', 1, 'Imagine', 'John Lennon', '1971', 'John Lennon’s solo classic, 1971.'],
    ['m-prayer', 'prayer', 1, 'Like a Prayer', 'Madonna', '1989', 'Madonna, 1989. All three match.'],
    ['m-spirit', 'spirit', 2, 'Smells Like Teen Spirit', 'Nirvana', '1991', 'Nirvana, 1991. All three match.'],
    ['m-dancing', 'dancing', 1, 'Dancing Queen', 'ABBA', '1976', 'ABBA, 1976. All three match.'],
    ['m-rolling', 'rolling', 2, 'Rolling in the Deep', 'Adele', '2010', 'Adele, 2010. All three match.'],
    ['m-shape', 'shape', 1, 'Shape of You', 'Ed Sheeran', '2017', 'Ed Sheeran, 2017. All three match.'],
    ['m-badguy', 'badguy', 2, 'Bad Guy', 'Billie Eilish', '2019', 'Billie Eilish, 2019. All three match.'],
    ['m-jaiho', 'jaiho', 1, 'Jai Ho', 'A. R. Rahman', '2008', 'A. R. Rahman’s song from Slumdog Millionaire, 2008.'],
    ['m-tunak', 'tunak', 2, 'Tunak Tunak Tun', 'Daler Mehndi', '1998', 'Daler Mehndi, 1998. All three match.'],
    ['m-gangnam', 'gangnam', 1, 'Gangnam Style', 'PSY', '2012', 'PSY, 2012. All three match.'],
    ['m-blinding', 'blinding', 2, 'Blinding Lights', 'The Weeknd', '2019', 'The Weeknd, 2019. All three match.'],
    ['m-purple', 'purple', 2, 'Purple Rain', 'Prince', '1984', 'Prince, 1984. All three match.'],
    ['m-viva', 'viva', 2, 'Viva la Vida', 'Coldplay', '2008', 'Coldplay, 2008. All three match.'],
    ['m-dynamite', 'dynamite', 1, 'Dynamite', 'BTS', '2020', 'BTS, 2020. All three match.'],
    ['m-stayin', 'stayin', 2, 'Stayin’ Alive', 'Bee Gees', '1977', 'Bee Gees, 1977. All three match.'],
    ['m-thriller', 'thriller', 1, 'Thriller', 'Michael Jackson', '1982', 'Michael Jackson, 1982. All three match.'],
    ['m-africa', 'africa', 2, 'Africa', 'Toto', '1982', 'Toto, 1982. All three match.'],
    ['m-heyjude-bad', 'hey-jude', 1, 'Hey Jude', 'The Rolling Stones', '1968', 'Hey Jude is a Beatles song, from 1968.',
      'artist', 'know', 'The Beatles'],
    ['m-wonderwall-bad', 'wonderwall', 1, 'Wonderwall', 'Blur', '1995', 'Blur were Oasis’s big rivals. Wonderwall is Oasis.',
      'artist', 'know', 'Oasis'],
    ['m-imagine-bad', 'imagine', 1, 'Imagine', 'Paul McCartney', '1971', 'Imagine is John Lennon’s solo song, from 1971.',
      'artist', 'know', 'John Lennon'],
    ['m-gangnam-bad', 'gangnam', 1, 'Gangnam Style', 'BTS', '2012', 'Gangnam Style is PSY’s 2012 hit.',
      'artist', 'know', 'PSY'],
    ['m-shape-bad', 'shape', 1, 'Shape of You', 'Shawn Mendes', '2017', 'Shape of You is Ed Sheeran’s, from 2017.',
      'artist', 'know', 'Ed Sheeran'],
    ['m-jaiho-bad', 'jaiho', 1, 'Jai Ho', 'Arijit Singh', '2008', 'Jai Ho is A. R. Rahman’s, from Slumdog Millionaire.',
      'artist', 'know', 'A. R. Rahman'],
    ['m-spirit-bad', 'spirit', 2, 'Smells Like Teen Spirit', 'Pearl Jam', '1991', 'Both are grunge bands, but this one is Nirvana.',
      'artist', 'know', 'Nirvana'],
    ['m-blinding-bad', 'blinding', 2, 'Blinding Lights', 'Drake', '2019', 'Both are from Toronto, but this one is The Weeknd.',
      'artist', 'know', 'The Weeknd'],
    ['m-tunak-bad', 'tunak', 2, 'Tunak Tunak Tun', 'A. R. Rahman', '1998', 'Tunak Tunak Tun is Daler Mehndi’s 1998 hit.',
      'artist', 'know', 'Daler Mehndi'],
    ['m-bohemian-bad', 'bohemian', 2, 'Bohemian Rhapsody', 'Queen', '1965', 'Queen only formed in 1970. It came out in 1975.',
      'year', 'know', '1975'],
    ['m-prayer-bad', 'prayer', 2, 'Like a Prayer', 'Madonna', '2005', 'Like a Prayer came out in 1989, not 2005.',
      'year', 'know', '1989'],
    ['m-dancing-bad', 'dancing', 2, 'Dancing Queen', 'ABBA', '1996', 'Dancing Queen came out in 1976, not 1996.',
      'year', 'know', '1976']
  ]);


  // ---- Decks ----
  // One deck per app, in title-screen order. `client` is the app’s short name (HUD, Results, ticket); `pick` is
  // its title-screen card (app, need, optional sub, and its picture: img, flag or sleeve). Each deck has one
  // list. Practice is one fake that never enters a round; `coach.fact` is the practice hint.
  // Copy bands follow trust: ≥ 90, 70–89, < 70. rewards.js appends the bounty sentence to each payoff.
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
        sights: { name: 'Sights', policy: 'Policy: photo, name and location must all match.',
                  fields: [['photo', 'Photo'], ['name', 'Name'], ['where', 'Location']], objField: 'photo' }
      },
      split: { sights: [10, 4] },   // [entries, fakes]
      practice: sights([
        ['p-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Rome, Italy', 'The Eiffel Tower is in Paris, not Rome.',
          'where', 'know', 'Paris, France']
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
        countries: { name: 'Countries', policy: 'Policy: flag, country and capital must all match.',
                     fields: [['flag', 'Flag'], ['country', 'Country'], ['capital', 'Capital']], objField: 'flag' }
      },
      split: { countries: [10, 4] },
      practice: country([
        ['p-india', 'in', 1, 'in', 'India', 'Mumbai', 'India’s capital is New Delhi. Mumbai is its financial capital.',
          'capital', 'know', 'New Delhi']
      ]),
      items: COUNTRIES
    },
    music: {
      id: 'music', client: 'Music streaming app',
      pick: { app: 'Music streaming app', need: 'needs songs credited to the right artist',
              sub: 'Fake uploads steal artists’ pay.', sleeve: { color: '#11998e', color2: '#38ef7d', mark: 'JH' } },
      copy: {
        mission: 'Keep the music app’s song credits right.',
        headlines: ['Clean list. Artists get paid.', 'Mostly clean. A few fake uploads slipped in.',
                    'Leaky list. Fakes took artists’ pay.'],
        quotes: ['“Every play went to the right artist today. Thank you!”',
                 '“A few fake uploads got listed. We filed removal requests.”',
                 '“Fake uploads took artists’ pay. We’re pausing the charts until they’re clean.”'],
        quoteBy: 'Music streaming app (fictional)',
        payoffs: ['{client} kept {trust}% of listeners’ trust, and every play paid the right artist.',
                  '{client} kept {trust}% of listeners’ trust. Each fake upload that got listed took an artist’s pay.',
                  '{client} lost listeners’ trust (down to {trust}%): fakes took artists’ pay, and it stops earning until the list is clean.']
      },
      coach: { fact: 'Thriller is Michael Jackson’s.' },
      lists: {
        songs: { name: 'Songs', policy: 'Policy: song, artist and year must all match.',
                 fields: [['song', 'Song'], ['artist', 'Artist'], ['year', 'Released']] }
      },
      split: { songs: [10, 4] },
      practice: songs([
        ['p-thriller', 'thriller', 1, 'Thriller', 'Madonna', '1982', 'Thriller is Michael Jackson’s, from 1982.',
          'artist', 'know', 'Michael Jackson']
      ]),
      items: SONGS
    }
  };
})();
