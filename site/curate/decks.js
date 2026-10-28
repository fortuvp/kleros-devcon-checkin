// Curate game content: one fictional travel app, its three lists and every entry. Data only: rules.js deals
// the round, game.js shows it. Facts (capitals, flags, locations) were checked by hand; re-check before merge.
// `node scripts/curate-check.js` validates this file (ids, fields, tells, lengths, shapes, flags, one odd field).
(function () {
  // ---- Lists ----
  var LISTS = {
    countries: { name: 'Countries', policy: 'Policy: flag, country and capital must all match.',
                 fields: [['flag', 'Flag'], ['country', 'Country'], ['capital', 'Capital']], objField: 'flag' },
    landmarks: { name: 'Landmarks', policy: 'Policy: model, name and location must all match.',
                 fields: [['model', 'Model'], ['name', 'Name'], ['where', 'Location']], objField: 'model' },
    mumbai: { name: 'Mumbai', policy: 'Policy: real Mumbai sights only. City and type must be true.',
              fields: [['place', 'Place'], ['city', 'City'], ['type', 'Type']] }
  };

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

  // ---- Landmark models ----
  // [material colour, words for the Model row]. Each shape is an original simplified silhouette (objects.js).
  var MODELS = {
    eiffel: ['#8a6a4f', 'Iron lattice tower'],
    pisa: ['#efe6d2', 'Leaning white tower'],
    bigben: ['#c9a66b', 'Gothic clock tower'],
    liberty: ['#5fae9a', 'Green statue with a torch'],
    tajmahal: ['#f1ecff', 'White dome, four minarets'],
    opera: ['#f4f1ea', 'White shell-shaped roofs'],
    colosseum: ['#d4a373', 'Oval arena of arches'],
    burj: ['#a9c4d8', 'Very tall stepped spire'],
    goldengate: ['#c0362c', 'Red suspension bridge'],
    christ: ['#e6e2d8', 'Statue, arms spread wide'],
    pyramid: ['#d9b26f', 'Stone pyramid'],
    sagrada: ['#c8b48a', 'Basilica with tall spires']
  };

  // ---- Builders ----
  // Rows keep the file small. Each row becomes a full item:
  // { id, list, twin, lvl, obj: { shape, color?, flag? }, f: { the list’s 3 fields }, bad, also, tell, fix, why }
  // `bad` is the one odd field (null for a good entry): the other two always agree with each other.
  // `tell` is 'card' when the card plus the policy show the flaw, 'know' when it takes knowing the fact.
  function item(list, r, f, obj, lvl, at) {
    var it = { id: r[0], list: list, twin: r[1] || null, lvl: lvl, obj: obj, f: f,
               bad: r[at + 1] || null, also: [], why: r[at] };
    if (it.bad) { it.tell = r[at + 2]; it.fix = r[at + 3]; }
    return it;
  }
  // Country rows: [id, twin, lvl, drawn flag, country, capital, why, bad, tell, fix]
  // The Flag row always describes the flag that is drawn, so a wrong flag shows on the card.
  function country(rows) {
    return rows.map(function (r) {
      var fl = FLAGS[r[3]];
      return item('countries', r, { flag: fl[1], country: r[4], capital: r[5] }, { shape: 'flag', flag: fl[0] }, r[2], 6);
    });
  }
  // Landmark rows: [id, twin, lvl, drawn model, name, location, why, bad, tell, fix]
  function landmark(rows) {
    return rows.map(function (r) {
      var m = MODELS[r[3]];
      return item('landmarks', r, { model: m[1], name: r[4], where: r[5] }, { shape: r[3], color: m[0] }, r[2], 6);
    });
  }
  // Mumbai rows: [id, twin, shape, colour, lvl, place, city, type, why, bad, tell, fix]
  // The landmark always has the place’s true shape, so a wrong type can be seen on the card.
  function city(rows) {
    return rows.map(function (r) {
      return item('mumbai', r, { place: r[5], city: r[6], type: r[7] }, { shape: r[2], color: r[3] }, r[4], 8);
    });
  }

  // ---- Countries (waving flag; the flag is the `flag` field and can be tapped; 20 good, 10 fake) ----
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
    ['c-in', null, 1, 'in', 'India', 'New Delhi', 'India’s tricolour and capital. All three match.'],
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

  // ---- Landmarks (3D model; the model is the `model` field and can be tapped; 12 good, 10 fake) ----
  // Twins follow the claimed landmark, so one round never lists the same name twice.
  var LANDMARKS = landmark([
    ['l-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Paris, France', 'Model, name and location all match.'],
    ['l-pisa', 'pisa', 1, 'pisa', 'Leaning Tower of Pisa', 'Pisa, Italy', 'It leans, and it’s in Pisa. All three match.'],
    ['l-bigben', null, 1, 'bigben', 'Big Ben', 'London, UK', 'Model, name and location all match.'],
    ['l-liberty', null, 1, 'liberty', 'Statue of Liberty', 'New York, USA', 'Model, name and location all match.'],
    ['l-taj', 'taj', 1, 'tajmahal', 'Taj Mahal', 'Agra, India', 'The Taj Mahal stands in Agra. All three match.'],
    ['l-opera', null, 1, 'opera', 'Sydney Opera House', 'Sydney, Australia', 'Model, name and location all match.'],
    ['l-colosseum', 'colosseum', 1, 'colosseum', 'Colosseum', 'Rome, Italy', 'Model, name and location all match.'],
    ['l-burj', 'burj', 1, 'burj', 'Burj Khalifa', 'Dubai, UAE', 'Model, name and location all match.'],
    ['l-goldengate', 'goldengate', 1, 'goldengate', 'Golden Gate Bridge', 'San Francisco, USA',
      'Model, name and location all match.'],
    ['l-christ', 'christ', 1, 'christ', 'Christ the Redeemer', 'Rio de Janeiro, Brazil',
      'It overlooks Rio from Corcovado. All three match.'],
    ['l-pyramid', 'pyramid', 1, 'pyramid', 'Great Pyramid of Giza', 'Giza, Egypt', 'Model, name and location all match.'],
    ['l-sagrada', 'sagrada', 1, 'sagrada', 'Sagrada Família', 'Barcelona, Spain', 'Gaudí’s basilica in Barcelona.'],
    ['l-taj-bad', 'taj', 1, 'tajmahal', 'Taj Mahal', 'Mumbai, India', 'The Taj Mahal is in Agra, not Mumbai.',
      'where', 'know', 'Agra, India'],
    ['l-burj-bad', 'burj', 1, 'burj', 'Burj Khalifa', 'Abu Dhabi, UAE', 'The Burj Khalifa is in Dubai, not Abu Dhabi.',
      'where', 'know', 'Dubai, UAE'],
    ['l-christ-bad', 'christ', 1, 'christ', 'Christ the Redeemer', 'Lisbon, Portugal',
      'Near Lisbon stands a cousin, Cristo Rei. The original is in Rio.', 'where', 'know', 'Rio de Janeiro, Brazil'],
    ['l-pisa-bad', 'pisa', 1, 'pisa', 'Leaning Tower of Pisa', 'Rome, Italy', 'The clue is in the name: it’s in Pisa.',
      'where', 'know', 'Pisa, Italy'],
    ['l-eiffel-bad', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Berlin, Germany', 'The Eiffel Tower is in Paris, not Berlin.',
      'where', 'know', 'Paris, France'],
    ['l-brooklyn-bad', 'goldengate', 1, 'goldengate', 'Brooklyn Bridge', 'San Francisco, USA',
      'A red bridge in San Francisco: that’s the Golden Gate.', 'name', 'card', 'Golden Gate Bridge'],
    ['l-bigben-bad', 'eiffel', 1, 'bigben', 'Eiffel Tower', 'Paris, France',
      'Look at the model: that’s Big Ben, not the Eiffel Tower.', 'model', 'card', 'Iron lattice tower'],
    ['l-pyramid-bad', 'colosseum', 1, 'pyramid', 'Colosseum', 'Giza, Egypt', 'A pyramid in Giza is no Colosseum.',
      'name', 'card', 'Great Pyramid of Giza'],
    ['l-liberty-bad', 'christ', 1, 'liberty', 'Christ the Redeemer', 'Rio de Janeiro, Brazil',
      'Look at the model: that’s the Statue of Liberty’s torch.', 'model', 'card', 'Statue, arms spread wide'],
    ['l-sagrada-bad', 'taj', 1, 'sagrada', 'Taj Mahal', 'Barcelona, Spain',
      'Spires in Barcelona: that’s the Sagrada Família.', 'name', 'card', 'Sagrada Família']
  ]);

  // ---- Mumbai (landmark miniature; 18 good, 15 fake) ----
  // Left out on purpose: Taj Mahal (the Taj Mahal Palace hotel is in Mumbai), Elephanta (Raigad district).
  // Unchanged from v1 apart from the list id.
  var MUMBAI_ITEMS = city([
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

  // ---- Deck ----
  // One mixed deck. Practice cards live apart and never enter a round: the first breaks the policy, the
  // second is good. `client` is an internal key; the visible word is the app’s name.
  window.CURATE_DECKS = {
    travel: {
      id: 'travel', client: 'Travel app',
      copy: {
        story1: 'A travel app shows these lists to millions of travellers. Scammers keep sneaking fakes in.',
        payoff: 'Clean lists keep travellers safe, and the app keeps earning.',
        quotes: ['“Travellers only saw real entries today. Come back tomorrow?”',
                 '“A few fakes got through. We filed removal requests.”',
                 '“Travellers went to fake places. We’re pausing the lists until they’re clean.”'],   // trust ≥ 90, 70–89, < 70
        quoteBy: 'Travel app (fictional)',
        // Report payoff by the same trust bands; rewards.js appends the bounty sentence.
        payoffs: ['{client} kept {trust}% of travellers’ trust, so they keep using it and it keeps earning.',
                  '{client} kept {trust}% of travellers’ trust. Each fake that got listed cost it travellers.',
                  '{client} lost travellers’ trust (down to {trust}%): fakes reached them, and it stops earning until the lists are clean.']
      },
      hero: [{ shape: 'flag', flag: FLAGS['in'][0] }, { shape: 'eiffel', color: MODELS.eiffel[0] },
             { shape: 'tajmahal', color: MODELS.tajmahal[0] }],
      lists: LISTS,
      easy: 'landmarks', late: null,   // the opening three come from Landmarks
      split: { countries: [7, 3], landmarks: [7, 3], mumbai: [6, 2] },   // [entries, fakes]
      practice: country([
        ['prac-india', null, 1, 'in', 'India', 'Mumbai', 'India’s capital is New Delhi. Mumbai is its financial capital.',
          'capital', 'know', 'New Delhi']
      ]).concat(landmark([
        ['prac-eiffel', 'eiffel', 1, 'eiffel', 'Eiffel Tower', 'Paris, France', 'Every line checks out: the Eiffel Tower is in Paris.']
      ])),
      items: COUNTRIES.concat(LANDMARKS, MUMBAI_ITEMS)
    }
  };
})();
