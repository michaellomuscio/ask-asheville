// Turns a typed question into an answer with evidence.
//
// Everything runs in the browser from the data already loaded: no AI service, no network request,
// nothing a student types leaves the device. The reader below finds the places, measures, times of day
// and kinds of question it knows, then a matching "answerer" does the arithmetic and says how it knows.
// When it can't tell what is being asked it says so and offers questions it can answer.

import { METRICS, METRIC_BY_ID, BLOCK_TWIN, GLOSSARY } from './catalog.js';
import { norm } from './gazetteer.js';
import { MI } from './core.js';

const num = new Intl.NumberFormat('en-US');
const round = (v, to = 1) => Math.round(v / to) * to;

export function fmt(v, unit) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no data';
  if (unit === 'usd') return `$${num.format(v >= 10000 ? round(v, 100) : Math.round(v))}`;
  if (unit === 'pct') return `${(v * 100).toFixed(v < 0.095 && v > 0 ? 1 : 0)}%`;
  if (unit === 'year') return v <= 1939 ? 'before 1940' : String(Math.round(v));
  if (unit === 'years') return `${v.toFixed(1)} years`;
  if (Math.abs(v) >= 100) return num.format(Math.round(v));
  return v.toFixed(v < 10 ? 2 : 1);
}
const mins = (sec) => {
  const m = sec / 60;
  if (m < 1) return 'under a minute';
  if (m < 59.5) return `${Math.round(m)} minute${Math.round(m) === 1 ? '' : 's'}`;
  return `${Math.floor(m / 60)} hr ${Math.round(m % 60)} min`;
};
/** "about 14 minutes", but "under a minute" on its own. */
const aboutMins = (sec) => (sec < 60 ? 'under a minute' : `about ${mins(sec)}`);
const minSec = (sec) => `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')} s`;
const miles = (mi) => `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mile${mi.toFixed(1) === '1.0' ? '' : 's'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** A value with its unit words where a bare number would be unclear: "4,917 people per square mile". */
const fv = (m, v, unit) => (m.unitWord && unit === 'num' ? `${fmt(v, unit)} ${m.unitWord}` : fmt(v, unit));
/** "Where are the most kids and teens?" / "Where is the highest rent?" for a measure and direction. */
const whereQ = (m, dir = 'hi') => {
  const phrase = dir === 'hi' ? m.hi : m.lo;
  const plural = /^the (most|fewest) /.test(phrase) || /[^s]s$/.test(phrase.split(' ').pop());
  return `Where ${plural ? 'are' : 'is'} ${phrase}?`;
};
/** Highway names the way people say them: "I-26 / I-240", not "Billy Graham Freeway (I 26 / I 240)". */
const roadLabel = (name) => {
  const inter = [...new Set((name.match(/\bI \d+\b/g) || []).map((x) => x.replace(' ', '-')))];
  if (inter.length) return inter.slice(0, 2).join(' / ');
  const us = /^(US|NC) \d+[A-Z]?(?: \/ |$)/.exec(name);
  if (us) return name.split(' / ')[0];
  return name.replace(/ \(.*\)$/, '');
};
const list = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const clockLabel = (h) => {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${hh % 12 === 0 ? 12 : hh % 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'a.m.' : 'p.m.'}`;
};

const SRC = {
  acs: 'American Community Survey 2020–2024, U.S. Census Bureau',
  dec: '2020 Census, U.S. Census Bureau',
  lodes: 'Census LEHD jobs data, 2023',
  osm: 'OpenStreetMap roads and buildings',
  sim: 'This simulation’s traffic model',
  ors: 'Road speeds checked against openrouteservice drive times',
  usgs: 'USGS 3DEP elevation',
  ncdot: 'NCDOT traffic counts',
  nces: 'National Center for Education Statistics school lists',
  county: 'Buncombe County GIS (addresses, school attendance districts)',
  research: 'Local agency and news reports collected for this project',
};
const CAVEAT = {
  survey: 'These numbers come from a survey of a sample of homes, so each one is an estimate. For small areas, treat close results as a tie.',
  drive: 'Drive times are modeled. Real trips change with weather, crashes, road work and how you drive.',
  response: 'Modeled from station locations and road speeds. It assumes a crew is in the station and ready, which is not always true.',
  around: 'Neighborhoods have no official edges. This uses the Census areas around the map label, so it is a close guess, not a boundary.',
};

const CATEGORIES = [
  { id: 'fire', kinds: ['fire'], one: 'fire station', many: 'fire stations', re: /\bfire (stations?|departments?|houses?)\b|\bfirehouses?\b/ },
  { id: 'hospital', kinds: ['hospital'], one: 'hospital', many: 'hospitals', re: /\bhospitals?\b|\bemergency rooms?\b|\b(the )?er\b|\burgent care\b|\bdoctors?\b/, filter: null },
  { id: 'college', kinds: ['college'], one: 'college', many: 'colleges', re: /\bcolleges?\b|\buniversit(y|ies)\b/ },
  { id: 'school', kinds: ['school'], one: 'school', many: 'schools', re: /\b(elementary|middle|high|charter|private|public|primary|intermediate)? ?schools?\b/ },
  { id: 'police', kinds: ['police'], one: 'police station', many: 'police stations', re: /\bpolice (stations?|departments?|posts?)\b|\bsheriff'?s? office\b/ },
  { id: 'ems', kinds: ['ems'], one: 'ambulance base', many: 'ambulance bases', re: /\b(ems|ambulance) (bases?|stations?)\b/ },
  { id: 'hotel', kinds: ['hotel'], one: 'hotel', many: 'hotels', re: /\bhotels?\b|\bmotels?\b|\binns?\b|\bplaces to stay\b/ },
  { id: 'venue', kinds: ['venue'], one: 'landmark', many: 'landmarks and attractions', re: /\blandmarks?\b|\battractions?\b|\bvenues?\b|\bthings to (do|see)\b|\bfun places\b|\btourist (spots|places)\b/ },
];
const UNAVAILABLE = [
  [/\b(parks?|playgrounds?|greenways?|trails?|hik(e|ing))\b/, 'parks, playgrounds and trails'],
  [/\b(restaurants?|food|pizza|coffee|cafes?|grocery|groceries|stores?|shops?|supermarkets?)\b/, 'restaurants, stores and other businesses'],
  [/\b(crimes?|robber|murder|theft|arrests?|safest|dangerous)\b/, 'crime'],
  [/\b(bus|buses|bus stops?|transit|art bus)\b/, 'city bus routes and stops'],
  [/\b(bike|bikes|biking|bicycl|sidewalks?|walk(ing|able)?)\b/, 'bike lanes, sidewalks and walking routes'],
  [/\b(flood|flooding|floods|helene|hurricane|landslides?)\b/, 'flooding and storm damage'],
  [/\b(test scores?|grades|best school|worst school|school ratings?|rankings?)\b/, 'school test scores or ratings'],
  [/\b(vote|voting|voters?|election|democrats?|republicans?|politic)/, 'voting or politics'],
  [/\b(pollution|air quality|trees|tree cover|temperature|heat island|rainfall|climate)\b/, 'air, trees and climate'],
  [/\b(race|racial|white (people|residents)|asian|native american|religion|church)/, 'that topic in detail (the map has the share of Black and of Hispanic or Latino residents)'],
  [/\b(homeless|unhoused|eviction)/, 'homelessness'],
  [/\b(taxes|property tax|budget|spend)/, 'taxes and city budgets'],
  [/\bhow many (cops|police|officers|firefighters|teachers|doctors|nurses|paramedics)\b/, 'how many people work in each job'],
  [/\b(mayor|city council|commissioners?|governor|president|elected|government)\b/, 'local government and elected officials'],
  [/\b(how (hot|cold|warm)|how much (snow|rain)|snow a lot|rain a lot|weather|forecast)\b/, 'weather records or forecasts (the weather in the simulation is something you set, not a forecast)'],
  [/\b(history|founded|how old is (asheville|the city)|who built|named after)\b/, 'local history'],
];
const SCENARIO_WORDS = [
  ['snow', /\bsnow(s|y|ing|ed)?\b|\bsnow day\b|\bice\b|\bicy\b|\bblizzard\b/],
  ['leaf_peak', /\bleaf\b|\bleaves\b|\bfall colou?rs?\b|\bleaf.?peep|\bautumn\b|\bfall (weekend|season|tourists?)\b/],
  ['tourists_game', /\b(baseball|ball ?game|tourists game|asheville tourists)\b/],
  ['orange_peel', /\borange peel (concert|show)\b/],
  ['arena', /\b(arena|big) (concert|show)\b|\bconcert\b/],
  ['candlelight', /\bchristmas\b|\bcandlelight\b|\bholiday (lights|shopping)\b|\bwinter lights\b/],
  ['thanksgiving_eve', /\bthanksgiving\b/],
  ['black_friday', /\bblack friday\b|\bholiday shopping\b/],
  ['july4', /\bjuly (4|4th|fourth)\b|\bfourth of july\b|\b4th of july\b|\bfireworks\b|\bindependence day\b/],
  ['summer', /\bsummer\b|\bno school\b|\bschool is out\b|\bsummer break\b/],
  ['saturday', /\bsaturdays?\b|\bweekends?\b/],
  ['sunday', /\bsundays?\b/],
  ['weekday', /\b(school day|weekday|normal day|regular day|ordinary day|typical day)\b/],
];
const WEATHER_WORDS = [['rain', /\brain(s|y|ing)?\b/], ['storm', /\b(thunder)?storms?\b|\blightning\b/], ['fog', /\bfog(gy)?\b/], ['clear', /\bsunny\b|\bclear (sky|skies|weather|day)\b/], ['cloudy', /\bcloud(y|s)\b/]];

/** Questions the engine is known to answer, shown as suggestions and used to test it. */
export const QUESTION_BANK = [
  { group: 'Getting around', qs: ['How long does it take to drive from Black Mountain to downtown?', 'How far is the airport from UNCA?', 'How many people live within 15 minutes of Mission Hospital?',
    'Where is traffic worst right now?', 'When is traffic the worst?', 'Which road is the busiest?', 'How is traffic on Patton Avenue?', 'Where do the most people have long commutes?',
    'Where do the most households have no car?', 'How many people live within 10 minutes of downtown?', 'How long does it take to drive from Weaverville to the airport at 5:30 pm?'] },
  { group: 'People', qs: ['How many people live in Asheville?', 'Where do the most kids live?', 'Where do the most older adults live?', 'Which town has the youngest residents?',
    'Where is it most crowded?', 'Compare Weaverville and Black Mountain', 'What is the median age in Montreat?', 'Tell me about West Asheville', 'How many people live in Buncombe County?',
    'Where do the biggest households live?'] },
  { group: 'Homes and money', qs: ['Where is rent the highest?', 'Where are the oldest homes?', 'Where are the newest homes?', 'Where are the most vacation homes?',
    'Which town has the highest household income?', 'What is the median income in Asheville?', 'Where are the most apartments?', 'Where do the most renters live?',
    'Is income related to college degrees?', 'Do places with more renters have more households without a car?', 'Where are homes the most expensive?'] },
  { group: 'Emergencies', qs: ['How fast can an ambulance get to Barnardsville?', 'How fast can a fire truck get to Biltmore Forest?', 'Where should a new fire station go?',
    'What is the closest hospital to Leicester?', 'How many fire stations are there?', 'What share of people can a fire truck reach in 4 minutes?', 'How far is the nearest emergency room from Black Mountain?',
    'Show the ambulance response map'] },
  { group: 'Days and events', qs: ['What happens to traffic on a snow day?', 'What happens during leaf season?', 'What happens when there is a baseball game?', 'What happens on Black Friday?',
    'What does a Saturday look like?', 'What happens when school is out for summer?', 'What happens on July 4th?'] },
  { group: 'Land and places', qs: ['What is the highest point in Buncombe County?', 'How high is downtown Asheville?', 'How many schools are there?', 'How many students go to Asheville High?',
    'Where are the jobs?', 'How many buildings are in Buncombe County?', 'What is the tallest building?', 'How many miles of road are there?', 'When does the sun set?',
    'Which school is Montford zoned for?', 'How many visitors come to Asheville?'] },
];

export class Asker {
  /** @param {import('./core.js').Lab} lab */
  constructor(lab, view) {
    this.lab = lab;
    this.view = view; // map actions (see ui.js MapView)
    this.app = lab.app;
    this.gaz = lab.gaz;
  }

  // --- Reading the question -------------------------------------------------------------------------

  parse(raw) {
    const lab = this.lab;
    const found = this.gaz.find(raw);
    const text = found.text; // normalized, padded with spaces
    // The question with place names blanked out, so "Black Mountain" is not read as a measure.
    let rest = text;
    for (const h of found.hits) rest = rest.slice(0, h.start) + ' '.repeat(h.end - h.start) + rest.slice(h.end);
    const has = (re) => re.test(text);
    const q = { raw: raw.trim(), text, rest, hits: found.hits, has, ents: found.hits.map((h) => h.ent) };

    // "my house", "here": a spot the student chose, or what is selected on the map.
    q.wantsMine = /\b(my (house|home|place|spot|apartment|street|neighbou?rhood|school|address)|where i live|i live|from home|to home|my location)\b/.test(text);
    q.wantsHere = /\b(here|this (spot|place|building|house|school|road)|the selected)\b/.test(text);
    q.self = null;
    if (q.wantsMine && lab.mySpot) q.self = lab.mySpot;
    else if (q.wantsHere || q.wantsMine) q.self = lab.selectionEntity() || lab.mySpot;
    q.address = this.findAddress(raw);
    if (q.address) q.ents.push(q.address);

    // Measures.
    q.metrics = [];
    for (const m of lab.metrics) {
      let bestLen = 0; let at = -1;
      for (const re of m.syn) {
        const hit = re.exec(rest);
        if (hit && hit[0].length > bestLen) { bestLen = hit[0].length; at = hit.index; }
      }
      if (bestLen) q.metrics.push({ m, len: bestLen, at });
    }
    // "people" is in almost every question; it only means population when nothing more specific is named.
    if (q.metrics.some((x) => !x.m.generic)) q.metrics = q.metrics.filter((x) => !x.m.generic);
    // Longer, more specific phrases win; drop a measure whose match sits inside a longer one ("rent" in "renters").
    q.metrics.sort((a, b) => b.len - a.len);
    q.metrics = q.metrics.filter((a, i) => !q.metrics.slice(0, i).some((b) => a.at < b.at + b.len && b.at < a.at + a.len));
    // "expensive" alone means home value unless rent is named.
    if (q.metrics.length > 1 && /\brents?\b/.test(rest)) q.metrics = q.metrics.filter((x) => x.m.id !== 'median_home_value' || /\b(home|house)/.test(rest));
    q.metrics.sort((a, b) => a.at - b.at);

    // Direction.
    q.dir = null;
    if (/\b(most|highest|biggest|largest|greatest|maximum|top|tallest|best|richest|wealthiest|oldest|newest|youngest|busiest|priciest|densest|worst)\b/.test(rest) || /\bmore\b|\bhigher\b/.test(rest)) q.dir = 'hi';
    if (/\b(fewest|lowest|least|smallest|minimum|bottom|cheapest|poorest|emptiest)\b/.test(rest) || /\bfewer\b|\blower\b|\bless\b/.test(rest)) q.dir = q.dir && /\b(most|highest)\b/.test(rest) ? q.dir : 'lo';
    const m0 = q.metrics[0]?.m;
    if (m0) {
      if (m0.hiWords?.some((re) => re.test(rest))) q.dir = 'hi';
      if (m0.loWords?.some((re) => re.test(rest))) q.dir = 'lo';
      if (m0.id === 'median_age' && /\byoungest\b/.test(rest)) q.dir = 'lo';
      if (m0.id === 'median_age' && /\boldest\b/.test(rest)) q.dir = 'hi';
    }

    // Time of day.
    q.basis = null;
    q.hour = null;
    const tm = /\b(?:at|by|around|before|after)?\s*(\d{1,2})(?:\s(\d{2}))?\s?(a ?m|p ?m)\b/.exec(rest) || /\bat (\d{1,2}) (\d{2})\b/.exec(rest);
    if (tm) {
      let h = Number(tm[1]) % 12;
      const pm = tm[3] ? tm[3].startsWith('p') : h >= 1 && h <= 6;
      if (pm) h += 12;
      q.hour = h + (tm[2] ? Number(tm[2]) / 60 : 0);
      q.basis = q.hour >= 6.5 && q.hour <= 9.5 ? 'am' : q.hour >= 15.5 && q.hour <= 18.5 ? 'pm' : q.hour >= 21 || q.hour <= 5.5 ? 'free' : 'live';
    }
    if (/\b(no traffic|without traffic|empty roads?|middle of the night|free flow|at night|late at night)\b/.test(rest)) q.basis = 'free';
    else if (/\b(morning rush|in the morning|before school|to school|morning traffic|morning commute)\b/.test(rest)) q.basis = 'am';
    else if (/\b(rush hour|after school|after work|afternoon|evening rush|evening traffic|5 ?30)\b/.test(rest) && !q.basis) q.basis = 'pm';
    else if (/\b(right now|now|currently|at the moment|this minute|live traffic)\b/.test(rest) && !q.basis) q.basis = 'live';

    q.minutes = null;
    const mm = /\b(\d{1,3}) ?(minutes?|mins?)\b/.exec(rest) || /\b(\d{1,3}) minute\b/.exec(rest);
    if (mm) q.minutes = Number(mm[1]);
    const mi = /\b(\d{1,3}) ?miles?\b/.exec(rest);
    q.miles = mi ? Number(mi[1]) : null;

    q.scenario = null;
    for (const [id, re] of SCENARIO_WORDS) if (re.test(rest)) { q.scenario = id; break; }
    q.weather = null;
    for (const [id, re] of WEATHER_WORDS) if (re.test(rest)) { q.weather = id; break; }

    q.service = /\b(ambulances?|paramedics?|ems|medics?)\b/.test(rest) ? 'ems'
      : /\bfire (trucks?|engines?|fighters?|departments?|crews?)\b|\bfirefighters?\b|\bfiremen\b/.test(rest) ? 'fire'
        : /\b(police|cops?|officers?|sheriff|deput(y|ies))\b/.test(rest) ? 'police'
          : /\b(911|first responders?|emergency help|help arrive|help get)\b/.test(rest) ? 'medical' : null;
    q.category = null;
    for (const c of CATEGORIES) if (c.re.test(rest)) { q.category = c; break; }
    // "hospital" inside a place name ("Mission Hospital") still asks about that place, not the category.
    q.schoolLevel = /\belementary\b/.test(rest) ? 'elem' : /\bmiddle\b/.test(rest) ? 'middle' : /\bhigh\b/.test(rest) ? 'high' : null;
    q.schoolSub = /\bcharter\b/.test(rest) ? 'charter' : /\bprivate\b/.test(rest) ? 'private' : /\bpublic\b/.test(rest) ? 'public' : null;
    return q;
  }

  /** "12 Main St" -> the matching county address point, if exactly one street fits. */
  findAddress(raw) {
    const a = this.app.addresses;
    if (!a) return null;
    const m = /\b(\d{1,5})\s+([a-z0-9 .'-]+?)\s+(road|rd|street|st|avenue|ave|drive|dr|lane|ln|way|court|ct|circle|cir|place|pl|boulevard|blvd|highway|hwy|trail|trl|parkway|pkwy|terrace|ter|loop|cove|cv|run|ridge|rdg|extension|ext|heights|hts|plaza|plz|square|sq|alley|aly|point|pt|crossing|xing)\b/i.exec(raw);
    if (!m) return null;
    const abbr = { road: 'RD', street: 'ST', avenue: 'AVE', drive: 'DR', lane: 'LN', court: 'CT', circle: 'CIR', place: 'PL', boulevard: 'BLVD', highway: 'HWY', trail: 'TRL', parkway: 'PKWY', terrace: 'TER', cove: 'CV', ridge: 'RDG', extension: 'EXT', heights: 'HTS', plaza: 'PLZ', square: 'SQ', alley: 'ALY', point: 'PT', crossing: 'XING' };
    const suffix = (abbr[m[3].toLowerCase()] || m[3]).toUpperCase();
    const want = `${m[1]} ${m[2].toUpperCase().replace(/[.']/g, '').replace(/\s+/g, ' ')} ${suffix} `;
    for (let i = 0; i < a.labels.length; i++) {
      if (a.labels[i].startsWith(want)) {
        const x = a.x[i]; const z = a.z[i];
        const label = a.labels[i].replace(/\s+\d{5}$/, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        return { type: 'point', name: label, x, z, node: this.lab.net.nearestNode(x, z, (n) => this.lab.net.nodeRank[n] >= 1), radius: 800, building: a.building[i], address: true };
      }
    }
    return null;
  }

  // --- Answering ------------------------------------------------------------------------------------

  /** Returns an answer object; never throws for a question it can't read. */
  ask(raw) {
    const q = this.parse(raw);
    let a = null;
    try {
      a = this.route(q);
    } catch (err) {
      console.error('Ask failed', err);
      a = null;
    }
    if (!a) a = this.unknown(q);
    a.question = q.raw;
    a.sub = (a.sub || '').replace(/\.\.(?=\s|$)/g, '.');
    a.sources ||= [];
    a.figures ||= [];
    a.follow = (a.follow || []).filter((f, i, arr) => f && arr.indexOf(f) === i && norm(f) !== norm(q.raw)).slice(0, 4);
    return a;
  }

  route(q) {
    const t = q.text;
    const rest = q.rest;
    const ents = q.ents;
    const metric = q.metrics[0]?.m || null;
    const is = (re) => re.test(rest);

    if (/^ (help|examples?|what can (i|you) (ask|do)|what (do|can) you know|how does this work|how do i use this|what is this) /.test(t)) return this.help();
    if (/\b(mount|mt) mitchell\b/.test(t)) return this.mitchell();
    if (is(/\b(what is|what are|whats|what does|define|definition of|meaning of|explain|what do you mean)\b/) && !ents.length) {
      const g = this.glossary(q);
      if (g) return g;
    }
    if (is(/\b(glossary|what does .* mean|define|definition of|meaning of)\b/)) { const g = this.define(q); if (g) return g; }

    // Emergencies.
    const stationWord = /\b(fire stations?|firehouses?|ems bases?|ambulance (bases?|stations?)|police (stations?|posts?))\b/.exec(rest);
    if (stationWord && is(/\b(where should|where would|where could|best (place|spot|location|site)|new|another|one more|add(ing)?|build|put)\b/) && !is(/\bhow many\b/)) {
      return this.bestStation(/fire/.test(stationWord[0]) ? 'fire' : /police/.test(stationWord[0]) ? 'police' : 'ems');
    }
    if (q.service && is(/\b(how (fast|long|quick|quickly|soon|many minutes)|response|respond|arrive|get to|reach|come|gets? here|takes?|coverage|cover|share|percent|map)\b/)) {
      return this.response(q, q.service);
    }
    if (is(/\b(response time|911 call|call 911|emergency response)\b/)) return this.response(q, q.service || 'medical');

    // Schools.
    if (is(/\b(zoned|school zone|attendance (zone|district)|assigned school)\b/) || (is(/\b(which|what) (public )?schools?\b/) && is(/\b(go to|attend|zoned|would i|do kids|for)\b/) && (ents.length || q.self))) {
      return this.zoned(q);
    }
    const schoolEnt = ents.find((e) => e.type === 'poi' && (e.kind === 'school' || e.kind === 'college'));
    if (schoolEnt && is(/\b(students?|enrol|how big|how many (kids|people)|grades?)\b/)) return this.schoolInfo(schoolEnt);

    // Closest thing of a kind.
    if (is(/\b(closest|nearest|near(by)?|close to)\b/) && q.category && !is(/\bhow many\b/)) return this.nearest(q);

    // Who lives within N minutes.
    if ((is(/\b(how many|who|what (share|percent|fraction)|number of)\b/) && is(/\b(within|in under|less than|inside|in)\b/) && q.minutes && (ents.length || q.self))
      || (q.minutes && is(/\bminute (drive|ride|trip)\b/) && is(/\bhow many\b/))) {
      return this.reach(q);
    }

    // Trips between places.
    const tripWords = is(/\b(how long|how far|how many (minutes|miles)|drive|driving|get from|get to|distance|trip|travel|route|directions|commute from)\b/);
    if (ents.filter((e) => e.type !== 'county').length >= 3 && is(/\bor\b/) && is(/\b(faster|closer|quicker|shorter|nearer|farther|further|longer)\b/)) {
      const d = this.driveCompare(q);
      if (d) return d;
    }
    if (tripWords && (ents.length >= 2 || (ents.length === 1 && !metric && !q.category) || (q.self && ents.length >= 1))) {
      const d = this.drive(q);
      if (d) return d;
    }

    // Counting things.
    if (is(/\bhow many\b/) && is(/\bstudents?\b/) && !metric) return this.students(q);
    if (is(/\b(how many|number of|count)\b/) && q.category) return this.count(q);
    const tot = this.totalsQ(q);
    if (tot) return tot;

    // Comparing places.
    if (ents.length >= 2 && (is(/\b(compare|comparison|versus|vs|difference|different|or|than|both|and)\b/) || !metric) && !tripWords) return this.compare(q);

    // Two measures: is there a pattern?
    if (q.metrics.length >= 2 && is(/\b(related|relationship|relate|connect(ed|ion)?|correlat|affect|depend|go together|linked?|tend to|pattern|versus|vs|compared? (to|with)|do (places|areas|neighbou?rhoods|people)|does|have more|have fewer|also have)\b/)) {
      return this.relate(q.metrics[0].m, q.metrics[1].m);
    }

    // Traffic.
    if (is(/\b(traffic|congest|jams?|backed up|gridlock|rush hour|busiest|slowest|stuck)\b/) || (is(/\bhow many (cars|vehicles|trucks)\b/))) {
      if (q.scenario && is(/\b(what happens|what if|how does|during|when|on a|look like|change|affect)\b/)) return this.scenario(q);
      return this.traffic(q);
    }

    // A different kind of day, or weather.
    if (q.scenario && (is(/\b(what happens|what if|what does|how does|show|during|when|on a|look like|change|affect|simulate|switch|make it|go to|try|see)\b/) || rest.trim().split(/\s+/).length <= 4)) return this.scenario(q);
    if (q.weather && is(/\b(make it|what if it|when it|start|turn on|show|let it)\b/)) return this.weatherQ(q);

    // Land.
    if (is(/\b(highest (point|place|mountain|peak|spot|elevation|ground)|tallest (mountain|peak|hill)|lowest (point|place|spot|elevation|ground))\b/)) return this.extremes(is(/\blowest\b/) ? 'lo' : 'hi');
    if (is(/\b(how high|elevation|altitude|above sea level|how tall is)\b/) && (ents.length || q.self)) return this.elevation(q);
    if (is(/\b(tallest|biggest|largest|highest) (building|skyscraper|tower)\b/)) return this.building(is(/\btallest|highest\b/) ? 'tall' : 'big');
    if (is(/\b(sunrise|sunset|sun (rises?|sets?|comes? up|goes? down)|get(s)? dark|daylight|how long is the day)\b/)) return this.sun();
    if (is(/\b(set|go to|jump to|change|skip to|make it)\b/) && q.hour !== null && !ents.length) return this.setTime(q.hour);

    // Measures.
    if (metric) {
      const town = is(/\b(which|what) (towns?|cit(y|ies)|communit(y|ies)|places?)\b/) || (q.dir && is(/\b(towns?|cit(y|ies)|communit(y|ies))\b/) && !is(/\bpart of (town|the city)\b/));
      if (town && ents.every((e) => e.type === 'county')) return this.rankTowns(metric, q.dir || 'hi');
      const area = ents.find((e) => ['town', 'hood', 'point', 'county'].includes(e.type)) || (ents[0]?.type === 'poi' ? ents[0] : null) || (q.self && (q.wantsMine || q.wantsHere) ? q.self : null);
      const superl = q.dir && is(/\b(where|which|what (area|part|neighbou?rhood|place)|most|highest|fewest|lowest|least|oldest|newest|youngest|richest|poorest|cheapest|biggest|smallest|densest)\b/);
      if (area && area.type !== 'county' && !(superl && is(/\bwhere|which\b/) && this.lab.bgsOf(area).length >= 4)) return this.statAt(metric, area, q);
      if (area && area.type !== 'county' && superl) return this.rank(metric, q.dir, area);
      if (superl || is(/\b(where|which)\b/)) return this.rank(metric, q.dir || 'hi', null);
      if (area) return this.statAt(metric, area, q);
      return this.layer(metric);
    }

    // Things the data doesn't include: say so plainly instead of guessing.
    for (const [re, what] of UNAVAILABLE) if (re.test(rest)) return this.noData(what, q);

    // A place by itself.
    if (ents.length === 1) {
      const e = ents[0];
      if (e.type === 'road') return this.traffic(q);
      if (is(/\b(how many|population|how big)\b/)) return this.statAt(METRIC_BY_ID.population, e, q);
      return this.profile(e);
    }
    if (q.category && is(/\b(where|show|find|map|list|all)\b/)) return this.count(q);
    if (q.self && (q.wantsMine || q.wantsHere)) return this.profile(q.self);
    if (q.wantsMine && !this.lab.mySpot) return this.needSpot();
    return null;
  }

  // --- Answerers ---------------------------------------------------------------------------------------

  help() {
    return {
      kind: 'help', headline: 'Ask about people, places, roads and emergencies',
      sub: 'Type a question in your own words. Name real places (towns, neighborhoods, schools, roads) and I will work out the answer from Census counts, public records and the traffic simulation, then show the evidence on the map.',
      follow: ['How many people live in Asheville?', 'How long does it take to drive from Black Mountain to downtown?', 'Where do the most kids live?', 'How fast can an ambulance get to Barnardsville?'],
      map: '', show: () => {},
    };
  }

  unknown(q) {
    const follow = [];
    const e = q.ents[0];
    const m = q.metrics[0]?.m;
    if (e && e.type !== 'road') follow.push(`Tell me about ${e.name}`, `How long does it take to drive from ${e.name} to downtown?`, `How many people live within 10 minutes of ${e.name}?`);
    if (m) follow.push(whereQ(m));
    follow.push('Where do the most kids live?', 'How many people live in Asheville?', 'Where is traffic worst right now?', 'How fast can an ambulance get to Barnardsville?');
    return {
      kind: 'unknown', miss: true, headline: 'I’m not sure how to answer that one',
      sub: 'I can answer questions about people and homes (from the Census), drive times and traffic, emergency response, schools, elevation and what happens on different kinds of days. Try naming a place or a measure, or pick one of these.',
      follow, map: '', show: () => {},
    };
  }

  noData(what, q) {
    const e = q.ents[0];
    return {
      kind: 'nodata', miss: true, headline: `This map doesn’t have data on ${what}`,
      sub: 'A good question, but the answer isn’t in the data loaded here, and I won’t guess. A city or county office, a local news archive or the library could be the right source. Here are related questions I can answer.',
      follow: e ? [`Tell me about ${e.name}`, `How many people live within 10 minutes of ${e.name}?`, 'Where do the most kids live?'] : ['Where do the most households have no car?', 'Where is it most crowded?', 'Where do the most kids live?', 'Where is traffic worst right now?'],
      map: '', show: () => {},
    };
  }

  needSpot() {
    return {
      kind: 'needspot', miss: true, headline: 'First, choose your spot',
      sub: 'Click a building on the map (or search an address), then press “Make this my spot”. After that you can ask things like “How long does it take to drive from my spot to downtown?” Your spot is saved only in this browser.',
      follow: ['How long does it take to drive from Black Mountain to downtown?'], map: '', show: () => {},
    };
  }

  /** A word from the glossary ("What is a median?"). */
  glossary(q) {
    const explicit = /\b(mean|means|define|definition|meaning|explain)\b/.test(q.rest);
    if (q.metrics.length && !explicit) return null;
    const words = [['median', 'Median'], ['average', 'Average (mean)'], ['mean', 'Average (mean)'], ['block group', 'Block group'], ['census block', 'Census block'], ['american community survey', 'American Community Survey'],
      ['margin of error', 'Margin of error'], ['estimate', 'Estimate'], ['household', 'Household'], ['per capita', 'Per capita'], ['density', 'Density'], ['free flow', 'Free flow'], ['congestion', 'Congestion'],
      ['simulation', 'Simulation'], ['model', 'Model'], ['correlation', 'Correlation'], ['response time', 'Response time'], ['commute', 'Commute'], ['poverty line', 'Poverty line'], ['evidence', 'Evidence'], ['claim', 'Claim'], ['census', 'Census']];
    const body = q.rest.replace(/\b(what does|what is|what are|whats|mean|means|define|definition of|meaning of|explain|what do you mean by)\b/g, ' ');
    const hit = words.find(([w]) => new RegExp(`\\b${w}s?\\b`).test(body));
    if (!hit) return null;
    const g = GLOSSARY.find((x) => x.term === hit[1]);
    const follow = { Median: ['What is the median income in Asheville?', 'Where is rent the highest?'], Correlation: ['Is income related to college degrees?'], 'Margin of error': ['What is the median age in Montreat?'],
      Density: ['Where is it most crowded?'], 'Response time': ['How fast can an ambulance get to Barnardsville?'], Simulation: ['When is traffic the worst?'], Commute: ['Where do the most people have long commutes?'] }[g.term] || ['Where do the most kids live?', 'How many people live in Asheville?'];
    return { kind: 'glossary', headline: g.term, sub: g.def, figures: [], sources: [], follow, map: '', show: () => {} };
  }

  mitchell() {
    return {
      kind: 'mitchell', headline: '6,684 feet', sub: 'Mount Mitchell is 6,684 feet above sea level, the highest peak east of the Mississippi River. It stands just outside Buncombe County, in Yancey County, so this map’s Census data stops short of it. The highest ground inside Buncombe County is close by, along the same range.',
      figures: [{ label: 'Mount Mitchell', value: '6,684 ft', badge: 'measured' }], sources: ['U.S. Geological Survey'], follow: ['What is the highest point in Buncombe County?', 'How high is downtown Asheville?', 'How high is Black Mountain?'], map: '', show: () => {},
    };
  }

  define(q) {
    const m = q.metrics[0]?.m;
    if (!m) return null;
    return { kind: 'define', headline: m.label, sub: m.def, sources: [m.source], follow: [whereQ(m), `Which town has ${m.hi}?`], map: 'The map is colored by this measure.', show: () => this.view.layer(m.id) };
  }

  /** A measure for one place, next to the county, state and nation. */
  statAt(m, ent, q) {
    const lab = this.lab;
    const unit = lab.unitOf(m.id);
    const s = lab.stat(ent, m.id);
    if (!s) return null;
    const twin = BLOCK_TWIN[m.id];
    const figures = [];
    let headline; let sub;
    const where = ent.type === 'point' || ent.type === 'spot' ? `the area around ${ent.name}` : ent.type === 'poi' ? `the area around ${ent.name}` : ent.name;
    if (m.id === 'population') {
      const p20 = lab.pop2020(ent);
      headline = `${num.format(p20)} people`;
      if (ent.type === 'town' || ent.type === 'county') {
        sub = `${ent.name} had ${num.format(p20)} residents in the 2020 Census, the most recent full count.`;
        figures.push({ label: `${ent.name}, 2020 Census`, value: num.format(p20), badge: 'counted' });
        const est = ent.type === 'town' ? ent.official.m.population : lab.places.county.m.population;
        if (est) figures.push({ label: 'Newer estimate (2020–2024 survey)', value: num.format(Math.round(est)), badge: 'surveyed' });
        if (ent.type === 'town' && ent.official.land_sqmi) figures.push({ label: 'Land area', value: `${ent.official.land_sqmi.toFixed(1)} square miles`, badge: 'measured' });
        if (ent.type === 'town') figures.push({ label: 'Share of Buncombe County', value: fmt(p20 / lab.totals().pop2020, 'pct'), badge: 'counted' });
      } else {
        const r = ent.radius || 1000;
        headline = `About ${num.format(round(p20, p20 > 2000 ? 100 : 10))} people`;
        sub = `About ${num.format(p20)} people lived within ${miles(r / MI)} of ${ent.name} in the 2020 Census.`;
        figures.push({ label: `Within ${miles(r / MI)}, 2020 Census`, value: num.format(p20), badge: 'counted' });
      }
    } else if (s.asCount) {
      headline = `About ${num.format(round(s.value, 100))} jobs`;
      sub = `About ${num.format(Math.round(s.value))} jobs are located in ${where}. That counts where people work, not where workers live.`;
      figures.push({ label: `Jobs in ${where}`, value: num.format(Math.round(s.value)), badge: 'counted' });
    } else {
      const v = fmt(s.value, unit);
      headline = s.how === 'blockgroups' ? `About ${v}` : v;
      // "How many kids live in Weaverville?" wants a number of people, not only a share.
      const people = { pct_under_18: 'residents under 18', pct_65_plus: 'residents 65 and older', pct_hispanic: 'Hispanic or Latino residents', pct_black: 'Black residents', pct_poverty: 'residents below the poverty line' }[m.id];
      const basePop = ent.type === 'town' ? ent.official.m.population : ent.type === 'county' ? lab.places.county.m.population : null;
      if (people && basePop && q && /\bhow many\b/.test(q.rest)) {
        const n = s.value * basePop;
        headline = `About ${num.format(round(n, n > 2000 ? 100 : 10))}`;
        figures.push({ label: `${cap(people)}: ${ent.name}`, value: `about ${num.format(round(n, n > 2000 ? 100 : 10))}`, badge: 'surveyed' });
      }
      const noun = m.noun.replace(/^the /, '');
      sub = `${cap(m.noun)} in ${where} is ${s.how === 'blockgroups' ? 'about ' : ''}${v}.`;
      if (s.how === 'official' && s.moe) sub += ` The survey’s margin of error is plus or minus ${fmt(s.moe, unit === 'years' ? 'years' : unit)}.`;
      if (s.how === 'blockgroups') sub += ` That is an average of the ${s.n} Census block group${s.n === 1 ? '' : 's'} around it${s.n > 1 && Number.isFinite(s.lo) ? `, which range from ${fmt(s.lo, unit)} to ${fmt(s.hi, unit)}` : ''}.`;
      figures.push({ label: `${cap(noun)}: ${where}`, value: v, badge: s.badge });
      const base = twin || m.id;
      for (const w of lab.wider(base)) figures.push({ label: w.name, value: fmt(w.value, lab.unitOf(base)), badge: 'surveyed' });
    }
    const chart = m.id !== 'population' && !s.asCount ? this.barsVs(ent, m, s) : null;
    return {
      kind: 'stat', headline, sub, figures, chart, sources: [m.id === 'population' ? SRC.dec : s.badge === 'counted' ? (m.id === 'jobs_density_b' ? SRC.lodes : SRC.dec) : SRC.acs],
      caveat: s.how === 'blockgroups' || ent.type === 'hood' || ent.type === 'point' || ent.type === 'poi' ? CAVEAT.around : m.badge === 'surveyed' && m.id !== 'population' ? CAVEAT.survey : undefined,
      map: ent.type === 'county' ? 'The map is colored by this measure.' : `The outlined area is ${ent.type === 'town' ? ent.name : `the part of the map counted for ${ent.name}`}.`,
      follow: this.followPlace(ent, m),
      show: () => {
        if (ent.type === 'county') { this.view.layer(m.id); this.view.county(); } else { this.view.outline(ent); this.view.frameEnt(ent); }
      },
    };
  }

  barsVs(ent, m, s) {
    const lab = this.lab;
    const base = BLOCK_TWIN[m.id] || m.id;
    const unit = lab.unitOf(m.id);
    const rows = [{ label: ent.type === 'point' || ent.type === 'poi' ? `Near ${ent.name}` : ent.name, value: s.value, strong: true }];
    for (const w of lab.wider(base)) if (!(ent.type === 'county' && w.name === 'Buncombe County')) rows.push({ label: w.name, value: w.value });
    if (rows.length < 2) return null;
    return { type: 'bars', unit, rows, format: (v) => fmt(v, unit) };
  }

  followPlace(ent, m) {
    const out = [];
    const name = ent.type === 'spot' ? 'my spot' : ent.name;
    if (m && m.id !== 'population') out.push(whereQ(m));
    if (ent.type !== 'county') {
      out.push(`How long does it take to drive from ${name} to ${ent === this.gaz.get('downtown') ? 'the airport' : 'downtown'}?`);
      if (ent.type === 'town') out.push(`Compare ${ent.name} and ${ent.name === 'Asheville' ? 'Black Mountain' : 'Asheville'}`);
      out.push(`How fast can an ambulance get to ${name}?`);
    } else out.push('Which town has the most people?', 'Where is it most crowded?');
    return out;
  }

  /** The top or bottom areas county-wide (or inside a town) for a measure. */
  rank(m, dir, within) {
    const lab = this.lab;
    const unit = lab.unitOf(m.id);
    let r = lab.rank(m.id, dir, 3);
    if (within) {
      const full = lab.rank(m.id, dir, 400);
      const allow = new Set(full.geo === 'bg' ? lab.bgsOf(within) : lab.blocksOf(within));
      const rows = full.rows.filter((x) => allow.has(x.unit)).slice(0, 3);
      if (rows.length) r = { ...full, rows, ties: 1 };
    }
    if (!r.rows.length) return null;
    const top = r.rows[0];
    const phrase = dir === 'hi' ? m.hi : m.lo;
    const areaWord = r.geo === 'bg' ? 'neighborhood area' : 'block';
    const v = (x) => (r.asCount ? `about ${num.format(round(x, 100))} jobs` : fv(m, x, unit));
    const short = (x) => (r.asCount ? num.format(round(x, 100)) : fmt(x, unit));
    // Two areas can sit by the same map label; say so instead of repeating the name.
    const usedNames = new Set();
    for (const x of r.rows) {
      if (usedNames.has(x.where)) x.where = `${/^in /.test(x.where) ? 'in another part of ' : 'also '}${x.where.replace(/^in /, '')}`;
      usedNames.add(x.where);
    }
    const place = (x) => x.where.replace(/^in /, '');
    const figures = r.rows.map((x, i) => ({ label: `${i + 1}. ${cap(place(x))}`, value: short(x.value), badge: m.badge, pin: i + 1 }));
    const cty = r.county;
    if (cty && !cty.asCount) figures.push({ label: 'Buncombe County overall', value: fmt(cty.value, unit), badge: cty.badge });
    if (cty && cty.asCount) figures.push({ label: 'All of Buncombe County', value: `${num.format(round(cty.value, 100))} jobs`, badge: cty.badge });
    const scope = within ? ` in and around ${within.name}` : ' in Buncombe County';
    let headline = cap(place(top));
    let sub;
    if (r.ties >= 3) {
      headline = `${r.ties} areas tie`;
      const floor = m.id === 'median_year_built' && top.value <= 1939;
      sub = `${r.ties} of the ${num.format(r.count)} ${areaWord}s${scope} tie for ${phrase}${floor ? '' : `, at ${v(top.value)}`}. They include ${list(r.rows.map((x) => place(x)))}.${m.id === 'median_year_built' && top.value <= 1939 ? ' The survey doesn’t report a median year earlier than 1939, so these are the areas where most homes went up before 1940.' : ''}`;
    } else {
      sub = `Out of ${num.format(r.count)} ${areaWord}s${scope}, the one with ${phrase} is ${top.where}: ${v(top.value)}.`;
      if (r.rows[1]) sub += ` Next ${r.rows.length > 2 ? 'are' : 'is'} ${list(r.rows.slice(1).map((x) => `${place(x)} (${short(x.value)})`))}.`;
    }
    const tie = r.rows[1] && r.ties < 3 && Math.abs(r.rows[1].value - top.value) <= Math.abs(top.value) * 0.04;
    const pins = r.rows.map((x, i) => ({ x: x.x, z: x.z, n: i + 1, label: `${cap(place(x))}: ${short(x.value)}` }));
    return {
      kind: 'rank', metricId: m.id, headline, sub, figures, sources: [m.badge === 'counted' ? (m.id === 'jobs_density_b' ? SRC.lodes : SRC.dec) : SRC.acs],
      caveat: m.badge === 'surveyed' ? `${CAVEAT.survey}${tie ? ' The top two here are close enough to call a tie.' : ''}`
        : m.id === 'pct_vacant_b' || m.id === 'pct_kids_b' ? 'The 2020 Census added small random changes to block counts to protect privacy, so tiny blocks can look odd.'
          : m.id === 'jobs_density_b' ? 'Jobs are counted where the employer reports them, which is sometimes a head office instead of where people actually work.' : undefined,
      chart: { type: 'histogram', unit, values: r.values, marks: r.ties >= 3 ? [top.value] : r.rows.map((x) => x.value), format: (x) => short(x), caption: `Each bar counts ${areaWord}s. The yellow marks are the top ${r.ties >= 3 ? 'value' : 'three'}.` },
      map: `The map is colored by ${m.label.toLowerCase()}: yellow is high, purple is low. The numbered pins are ${r.ties >= 3 ? 'three of the areas that tie' : 'the top three'}.`,
      follow: [`Which town has ${phrase}?`, whereQ(m, dir === 'hi' ? 'lo' : 'hi'), this.pairQuestion(m), `What is ${m.noun} in Asheville?`],
      show: () => {
        this.view.layer(m.id);
        this.view.pins(pins);
        if (within) this.view.frameEnt(within); else this.view.framePoints(r.rows, 9000);
      },
    };
  }

  pairQuestion(m) {
    const pairs = { median_income: 'pct_bachelors', pct_bachelors: 'median_income', pct_renter: 'pct_no_vehicle', pct_no_vehicle: 'pct_renter', median_rent: 'median_income', median_home_value: 'median_income',
      pct_under_18: 'avg_household_size', pct_65_plus: 'median_home_value', density: 'pct_renter', pct_commute_30: 'density', median_age: 'pct_renter', pct_poverty: 'pct_no_vehicle', pct_apartments: 'density',
      pct_wfh: 'pct_bachelors', pct_seasonal: 'median_age', median_year_built: 'density', pct_drive_alone: 'density', pct_mobile: 'median_income', pct_single_family: 'pct_renter' };
    const o = METRIC_BY_ID[pairs[m.id]];
    if (!o || BLOCK_TWIN[m.id] || this.lab.geoOf(m.id) !== 'bg') return 'Is income related to college degrees?';
    return `Is ${m.label.toLowerCase()} related to ${o.label.toLowerCase()}?`;
  }

  rankTowns(m, dir) {
    const lab = this.lab;
    const id = BLOCK_TWIN[m.id] || m.id;
    const mm = METRIC_BY_ID[id];
    const unit = lab.unitOf(id);
    const rows = lab.rankTowns(id, dir);
    if (!rows.length) return null;
    const top = rows[0];
    const val = (r) => (id === 'population' ? num.format(lab.pop2020(r.ent)) : fmt(r.s.value, unit));
    if (id === 'population') rows.sort((a, b) => (dir === 'hi' ? 1 : -1) * (lab.pop2020(b.ent) - lab.pop2020(a.ent)));
    const t0 = rows[0];
    return {
      kind: 'ranktowns', headline: t0.ent.name,
      sub: `Of the ${rows.length} towns and communities the Census reports in Buncombe County, ${t0.ent.name} has ${dir === 'hi' ? mm.hi : mm.lo}: ${val(t0)}. ${rows[1] ? `${rows[1].ent.name} is next at ${val(rows[1])}.` : ''}`,
      figures: rows.slice(0, 6).map((r, i) => ({ label: `${i + 1}. ${r.ent.name}`, value: val(r), badge: id === 'population' ? 'counted' : 'surveyed' })),
      chart: { type: 'bars', unit, rows: rows.map((r) => ({ label: r.ent.name, value: id === 'population' ? lab.pop2020(r.ent) : r.s.value, strong: r === t0 })), format: (v) => (id === 'population' ? num.format(v) : fmt(v, unit)) },
      sources: [id === 'population' ? SRC.dec : SRC.acs],
      caveat: id === 'population' ? undefined : 'Small towns have small survey samples, so their estimates can be off by a lot. Montreat and Barnardsville have fewer than 1,000 residents.',
      map: `${t0.ent.name} is outlined. The pins mark the top three.`,
      follow: [`Tell me about ${t0.ent.name}`, whereQ(mm, dir), `Compare ${t0.ent.name} and ${rows[rows.length - 1].ent.name}`],
      show: () => {
        this.view.outline(t0.ent);
        this.view.pins(rows.slice(0, 3).map((r, i) => ({ x: r.ent.x, z: r.ent.z, n: i + 1, label: `${r.ent.name}: ${val(r)}` })));
        this.view.county();
      },
      _unused: top,
    };
  }

  /** Just color the map by a measure and say what the pattern is. */
  layer(m) {
    const lab = this.lab;
    const unit = lab.unitOf(m.id);
    const r = lab.rank(m.id, 'hi', 1);
    const lo = lab.rank(m.id, 'lo', 1);
    const c = r.county;
    return {
      kind: 'layer', headline: m.label,
      sub: `${m.def} The map is now colored by it.${r.asCount ? '' : ` Across Buncombe County it runs from ${fmt(r.min, unit)} to ${fmt(r.max, unit)}${c && !c.asCount ? `; the county overall is ${fmt(c.value, unit)}` : ''}.`}`,
      figures: [
        { label: `Highest: ${r.rows[0].where.replace(/^in /, '')}`, value: r.asCount ? `${num.format(round(r.rows[0].value, 100))} jobs` : fmt(r.rows[0].value, unit), badge: m.badge },
        ...(r.asCount ? [] : [{ label: `Lowest: ${lo.rows[0].where.replace(/^in /, '')}`, value: fmt(lo.rows[0].value, unit), badge: m.badge }]),
        ...(c && !c.asCount ? [{ label: 'Buncombe County overall', value: fmt(c.value, unit), badge: c.badge }] : []),
      ],
      chart: r.asCount ? null : { type: 'histogram', unit, values: r.values, marks: [], format: (v) => fmt(v, unit), caption: `How the ${num.format(r.count)} areas are spread out.` },
      sources: [m.badge === 'counted' ? (m.id === 'jobs_density_b' ? SRC.lodes : SRC.dec) : SRC.acs],
      caveat: m.badge === 'surveyed' ? CAVEAT.survey : undefined,
      map: 'Yellow is high and purple is low. Move the pointer over the map to read any area.',
      follow: [whereQ(m), `Which town has ${m.hi}?`, this.pairQuestion(m)],
      show: () => { this.view.layer(m.id); this.view.county(); },
    };
  }

  compare(q) {
    const lab = this.lab;
    const [a, b] = q.ents.filter((e) => e.type !== 'road').slice(0, 2);
    if (!a || !b) return null;
    const focus = q.metrics.map((x) => x.m.id);
    const ids = focus.length ? focus : ['population', 'median_age', 'pct_under_18', 'pct_65_plus', 'median_income', 'median_home_value', 'median_rent', 'pct_renter', 'pct_bachelors', 'pct_commute_30', 'median_year_built'];
    const rows = [];
    for (const id of ids) {
      const base = BLOCK_TWIN[id] || id;
      const m = METRIC_BY_ID[base];
      const unit = lab.unitOf(base);
      const sa = lab.stat(a, base); const sb = lab.stat(b, base);
      if (!sa || !sb) continue;
      const va = base === 'population' ? lab.pop2020(a) : sa.value;
      const vb = base === 'population' ? lab.pop2020(b) : sb.value;
      rows.push({ id: base, label: m.label, a: base === 'population' ? num.format(va) : fmt(va, unit), b: base === 'population' ? num.format(vb) : fmt(vb, unit), va, vb, badge: base === 'population' ? 'counted' : 'surveyed' });
    }
    if (!rows.length) return null;
    const drive = a.type === 'county' || b.type === 'county' || Math.hypot(a.x - b.x, a.z - b.z) < 500 ? null : lab.drive(a, b);
    const approx = [a, b].some((e) => e.type !== 'town' && e.type !== 'county');
    let headline = `${a.name} and ${b.name}`;
    let sub;
    if (focus.length === 1) {
      const r0 = rows[0];
      const m = METRIC_BY_ID[r0.id];
      const hiEnt = r0.va >= r0.vb ? a : b;
      headline = Math.abs(r0.va - r0.vb) < 1e-9 ? 'They are the same' : `${hiEnt.name} is higher`;
      sub = `${cap(m.noun)}: ${a.name} ${r0.a}, ${b.name} ${r0.b}.`;
    } else {
      const pa = lab.pop2020(a); const pb = lab.pop2020(b);
      const big = pa >= pb ? a : b; const small = pa >= pb ? b : a;
      const ratio = Math.max(pa, pb) / Math.max(1, Math.min(pa, pb));
      sub = `${big.name} has ${ratio >= 1.5 ? `about ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} times as many people as` : ratio >= 1.1 ? 'somewhat more people than' : 'about as many people as'} ${small.name} (${num.format(Math.max(pa, pb))} and ${num.format(Math.min(pa, pb))} in the 2020 Census).`;
      if (ratio >= 1.1 && /\b(bigger|larger|more people|biggest|smaller)\b/.test(q.rest)) headline = `${big.name} has more people`;
    }
    if (drive) sub += ` They are ${miles(drive.miles)} apart by road, ${aboutMins(drive.times.free)} with no traffic.`;
    return {
      kind: 'compare', headline, sub,
      table: { cols: [a.name, b.name], rows },
      figures: rows.slice(0, 4).map((r) => ({ label: r.label, value: `${r.a} vs ${r.b}`, badge: r.badge })),
      sources: [SRC.dec, SRC.acs], caveat: approx ? CAVEAT.around : CAVEAT.survey,
      map: drive ? 'Both places are marked, and the line is the fastest route between them.' : 'Both places are marked.',
      follow: [`Tell me about ${a.name}`, `Tell me about ${b.name}`, `How long does it take to drive from ${a.name} to ${b.name}?`, 'Which town has the highest household income?'],
      show: () => {
        this.view.clearAreas();
        this.view.pins([{ x: a.x, z: a.z, n: 'A', label: a.name }, { x: b.x, z: b.z, n: 'B', label: b.name }]);
        if (drive) this.view.route(drive.route.edges);
        this.view.framePoints([a, b], 6000);
      },
    };
  }

  relate(ma, mb) {
    const lab = this.lab;
    const a = BLOCK_TWIN[ma.id] ? METRIC_BY_ID[BLOCK_TWIN[ma.id]] : ma;
    const b = BLOCK_TWIN[mb.id] ? METRIC_BY_ID[BLOCK_TWIN[mb.id]] : mb;
    if (lab.geoOf(a.id) !== 'bg' || lab.geoOf(b.id) !== 'bg' || a.id === b.id) return null;
    const r = lab.relate(a.id, b.id);
    const abs = Math.abs(r.r);
    const strength = abs >= 0.7 ? 'strong' : abs >= 0.4 ? 'moderate' : abs >= 0.2 ? 'weak' : 'no clear';
    const dirWord = r.r > 0 ? 'tend to be higher together' : 'tend to move in opposite directions';
    const headline = abs < 0.2 ? 'No clear pattern' : `Yes, a ${strength} pattern`;
    const ua = lab.unitOf(a.id); const ub = lab.unitOf(b.id);
    return {
      kind: 'relate', headline,
      sub: abs < 0.2
        ? `Across ${r.n} neighborhood areas, ${a.label.toLowerCase()} and ${b.label.toLowerCase()} don’t rise or fall together in any steady way (correlation ${r.r.toFixed(2)}).`
        : `Across ${r.n} neighborhood areas in Buncombe County, ${a.label.toLowerCase()} and ${b.label.toLowerCase()} ${dirWord}. The correlation is ${r.r.toFixed(2)} on a scale from -1 to 1, which is a ${strength} link.`,
      figures: [{ label: 'Correlation (r)', value: r.r.toFixed(2), badge: 'surveyed' }, { label: 'Areas compared', value: String(r.n), badge: 'surveyed' }],
      chart: { type: 'scatter', pts: r.pts, xLabel: a.label, yLabel: b.label, xFormat: (v) => fmt(v, ua), yFormat: (v) => fmt(v, ub), slope: r.slope, intercept: r.intercept, r: r.r },
      sources: [SRC.acs],
      caveat: 'A pattern is not proof that one thing causes the other. Something else could be behind both. Each dot is an area, not a person, so it says nothing about any one household.',
      map: `The map is colored by ${a.label.toLowerCase()}. Each dot in the chart is one neighborhood area.`,
      follow: [whereQ(a), whereQ(b), this.pairQuestion(b)],
      show: () => { this.view.layer(a.id); this.view.county(); },
    };
  }

  drive(q) {
    const lab = this.lab;
    const places = q.ents.filter((e) => e.type !== 'county');
    let from; let to;
    const downtown = this.gaz.get('downtown');
    if (places.length >= 2) {
      [from, to] = places;
      // "to X from Y" reads backward.
      const h = q.hits;
      if (h.length >= 2 && /\bfrom\s$/.test(q.text.slice(0, h[1].start)) && /\bto\s$/.test(q.text.slice(0, h[0].start))) [from, to] = [to, from];
    } else if (places.length === 1) {
      const other = q.self || (places[0] === downtown ? null : downtown);
      if (!other) return q.wantsMine ? this.needSpot() : null;
      const toFirst = /\bto\s$/.test(q.text.slice(0, q.hits[0]?.start ?? 0)) || q.self;
      [from, to] = toFirst && !/\bfrom\s$/.test(q.text.slice(0, q.hits[0]?.start ?? 0)) ? [other, places[0]] : [places[0], other];
    } else return null;
    if (from === to) return null;
    const d = lab.drive(from, to);
    if (!d) return { kind: 'drive', miss: true, headline: 'No road route found', sub: `I couldn’t find a road route between ${from.name} and ${to.name}.`, follow: [], map: '', show: () => {} };
    const basis = q.basis || 'free';
    const t = d.times[basis];
    const slow = Math.max(d.times.am, d.times.pm);
    const extra = slow - d.times.free;
    let sub = `Driving from ${from.name} to ${to.name} takes ${aboutMins(t)} ${lab.basisLabel(basis)}. It is ${miles(d.miles)} by road${d.roads.length ? `, mostly on ${list([...new Set(d.roads.map(roadLabel))])}` : ''}.`;
    if (basis === 'free' && extra > 90) sub += ` School-day rush hour adds about ${mins(extra)}.`;
    return {
      kind: 'drive', headline: cap(aboutMins(t)), sub,
      figures: [
        { label: 'No traffic', value: mins(d.times.free), badge: 'simulated' },
        { label: '8 a.m. school day', value: mins(d.times.am), badge: 'simulated' },
        { label: '5:30 p.m. school day', value: mins(d.times.pm), badge: 'simulated' },
        { label: 'Right now in the simulation', value: mins(d.times.live), badge: 'simulated' },
        { label: 'Distance by road', value: miles(d.miles), badge: 'measured' },
        { label: 'Straight-line distance', value: miles(d.straightMiles), badge: 'measured' },
      ],
      chart: { type: 'bars', unit: 'min', rows: [['No traffic', 'free'], ['8 a.m.', 'am'], ['5:30 p.m.', 'pm'], ['Right now', 'live']].map(([label, k]) => ({ label, value: d.times[k] / 60, strong: k === basis })), format: (v) => `${Math.round(v)} min` },
      sources: [SRC.osm, SRC.ors, SRC.sim], caveat: CAVEAT.drive,
      map: 'The yellow line is the fastest route with no traffic. A is the start and B is the end.',
      follow: [`How long does it take to drive from ${to.name} to ${from.name}?`, `How many people live within 15 minutes of ${to.name}?`, 'Where is traffic worst right now?', 'When is traffic the worst?'],
      show: () => {
        this.view.clearAreas();
        this.view.route(d.route.edges);
        this.view.pins([{ x: from.x, z: from.z, n: 'A', label: cap(from.name) }, { x: to.x, z: to.z, n: 'B', label: cap(to.name) }]);
        this.view.framePoints([from, to], 5000);
      },
    };
  }

  /** "Is it faster to get to the airport from Weaverville or Black Mountain?" */
  driveCompare(q) {
    const lab = this.lab;
    const hits = q.hits.filter((h) => h.ent.type !== 'county');
    // The shared end is the place right after "to"; the other two are the choices.
    let common = hits.find((h) => /\bto( the)?\s$/.test(q.text.slice(0, h.start))) || hits[0];
    const others = hits.filter((h) => h !== common).map((h) => h.ent).slice(0, 2);
    common = common.ent;
    const rows = others.map((e) => ({ ent: e, d: lab.drive(e, common) })).filter((r) => r.d);
    if (rows.length < 2) return null;
    const basis = q.basis || 'free';
    rows.sort((a, b) => a.d.times[basis] - b.d.times[basis]);
    const [w, l] = rows;
    const gap = l.d.times[basis] - w.d.times[basis];
    return {
      kind: 'drivecompare', headline: gap < 60 ? 'About the same' : `${w.ent.name} is closer`,
      sub: `To ${common.name} ${lab.basisLabel(basis)}: ${aboutMins(w.d.times[basis])} from ${w.ent.name} (${miles(w.d.miles)}) and ${aboutMins(l.d.times[basis])} from ${l.ent.name} (${miles(l.d.miles)}).${gap >= 60 ? ` ${w.ent.name} is quicker by about ${mins(gap)}.` : ''}`,
      figures: rows.flatMap((r) => [{ label: `${r.ent.name}, no traffic`, value: mins(r.d.times.free), badge: 'simulated' }, { label: `${r.ent.name}, 5:30 p.m. school day`, value: mins(r.d.times.pm), badge: 'simulated' }, { label: `${r.ent.name}, distance by road`, value: miles(r.d.miles), badge: 'measured' }]),
      chart: { type: 'bars', unit: 'min', rows: rows.map((r, i) => ({ label: r.ent.name, value: r.d.times[basis] / 60, strong: i === 0 })), format: (v) => `${Math.round(v)} min` },
      sources: [SRC.osm, SRC.ors, SRC.sim], caveat: CAVEAT.drive,
      map: `The yellow line is the quicker route. A and B are the two starting places; the dot is ${common.name}.`,
      follow: [`How long does it take to drive from ${l.ent.name} to ${common.name}?`, `Compare ${w.ent.name} and ${l.ent.name}`, 'When is traffic the worst?'],
      show: () => {
        this.view.clearAreas();
        this.view.route(w.d.route.edges);
        this.view.pins([{ x: w.ent.x, z: w.ent.z, n: 'A', label: w.ent.name }, { x: l.ent.x, z: l.ent.z, n: 'B', label: l.ent.name }, { x: common.x, z: common.z, n: '', label: cap(common.name) }]);
        this.view.framePoints([w.ent, l.ent, common], 6000);
      },
    };
  }

  reach(q) {
    const lab = this.lab;
    const ent = q.ents.find((e) => e.type !== 'county') || q.self;
    if (!ent) return null;
    const basis = q.basis || 'free';
    const want = Math.max(2, Math.min(90, q.minutes || 15));
    const bands = [...new Set([5, 10, 15, 20, 30, want])].sort((a, b) => a - b);
    const r = lab.reach(ent, basis, bands);
    const hit = r.bands.find((b) => b.minutes === want);
    const share = hit.residents / r.total;
    const kidsWanted = /\b(kids|children|students|teens)\b/.test(q.rest);
    return {
      kind: 'reach', headline: `About ${num.format(round(kidsWanted ? hit.kids : hit.residents, 100))} ${kidsWanted ? 'kids ages 5–17' : 'people'}`,
      sub: `About ${num.format(round(hit.residents, 100))} people live within a ${want}-minute drive of ${ent.name} ${lab.basisLabel(basis)}. That is ${fmt(share, 'pct')} of everyone in Buncombe County${kidsWanted ? `, including about ${num.format(round(hit.kids, 100))} kids ages 5 to 17` : ''}.`,
      figures: r.bands.map((b) => ({ label: `Within ${b.minutes} minutes`, value: `${num.format(round(b.residents, 100))} people`, badge: 'simulated' })),
      chart: { type: 'bars', unit: 'num', rows: r.bands.map((b) => ({ label: `${b.minutes} min`, value: b.residents, strong: b.minutes === want })), format: (v) => num.format(round(v, 100)) },
      sources: [SRC.dec, SRC.osm, SRC.sim],
      caveat: 'People are placed in homes so that every Census block adds up to its 2020 count; drive times are modeled. Read these as close estimates.',
      map: `Colors show the drive time to ${ent.name}: green is close, red is far. Lines are 5 minutes apart.`,
      follow: [`How many people live within ${want === 15 ? 30 : 15} minutes of ${ent.name}?`, `How many people live within ${want} minutes of ${ent.name === 'downtown Asheville' ? 'Mission Hospital' : 'downtown'}?`, `How fast can an ambulance get to ${ent.name}?`],
      show: () => { this.view.heat(r.times, { name: ent.name, basis, maxMinutes: Math.max(30, want), bandMinutes: 5 }); this.view.pins([{ x: ent.x, z: ent.z, n: '', label: cap(ent.name) }]); const rr = Math.max(9000, want * 800); this.view.fit(ent.x - rr, ent.x + rr, ent.z - rr, ent.z + rr, 1.0); },
    };
  }

  nearest(q) {
    const lab = this.lab;
    const c = q.category;
    const ent = q.ents.find((e) => e.type !== 'county') || q.self || (q.wantsMine ? null : this.gaz.get('downtown'));
    if (!ent) return this.needSpot();
    let filter = null;
    if (c.id === 'hospital') filter = /\b(er|emergency)\b/.test(q.rest) ? (p) => p.sub === 'ed' : (p) => p.sub === 'ed' || p.sub === 'hospital' || p.sub === 'va';
    if (c.id === 'school') {
      filter = (p) => (!q.schoolSub || p.sub === q.schoolSub)
        && (!q.schoolLevel || (q.schoolLevel === 'high' ? (p.hi ?? 0) >= 12 : q.schoolLevel === 'middle' ? (p.lo ?? 0) <= 8 && (p.hi ?? 0) >= 7 && (p.lo ?? 0) >= 5 : (p.lo ?? 9) <= 1));
    }
    const self = ent.type === 'poi' ? ent.poi : null;
    const rows = lab.nearest(c.kinds, ent, 4, (p) => p !== self && (!filter || filter(p)), ['fire', 'ems', 'police'].includes(c.id)).slice(0, 3);
    if (!rows.length) return null;
    const one = `${q.schoolSub ? `${q.schoolSub} ` : ''}${q.schoolLevel ? `${{ elem: 'elementary', middle: 'middle', high: 'high' }[q.schoolLevel]} ` : ''}${c.id === 'hospital' && /\b(er|emergency)\b/.test(q.rest) ? 'emergency room' : c.one}`;
    const top = rows[0];
    const nm = (p) => p.name.replace(/ \(.*\)$/, '');
    return {
      kind: 'nearest', headline: nm(top.poi),
      sub: `The closest ${one} to ${ent.name} is ${nm(top.poi)}, ${aboutMins(top.sec)} away by road with no traffic (${miles(top.miles)} in a straight line).`,
      figures: rows.map((r, i) => ({ label: `${i + 1}. ${nm(r.poi)}`, value: mins(r.sec), badge: 'simulated', pin: i + 1 })),
      sources: [c.id === 'school' || c.id === 'college' ? SRC.nces : SRC.research, SRC.osm],
      caveat: c.id === 'ems' ? 'Most ambulance base locations are approximate: the county’s crews work mainly out of fire stations.' : CAVEAT.drive,
      map: `The pins are the three closest ${c.many}. The line is the route to the closest.`,
      follow: [`How long does it take to drive from ${ent.name} to ${nm(top.poi)}?`, c.id === 'hospital' ? `How fast can an ambulance get to ${ent.name}?` : `How many ${c.many} are there?`, `Tell me about ${ent.name}`],
      show: () => {
        this.view.clearAreas();
        this.view.markers(c.kinds);
        const r = this.app.router.route(ent.node, top.poi.node, this.app.weights('free'));
        if (r) this.view.route(r.edges);
        this.view.pins([{ x: ent.x, z: ent.z, n: '', label: cap(ent.name) }, ...rows.map((x, i) => ({ x: x.poi.x, z: x.poi.z, n: i + 1, label: `${nm(x.poi)}: ${mins(x.sec)}` }))]);
        this.view.framePoints([ent, ...rows.map((x) => x.poi)], 3500);
      },
    };
  }

  count(q) {
    const lab = this.lab;
    const c = q.category;
    const area = q.ents.find((e) => e.type === 'town' || e.type === 'hood');
    const inArea = area ? new Set(lab.blocksOf(area)) : null;
    let rows = this.app.data.pois.filter((p) => c.kinds.includes(p.kind));
    if (c.id === 'school') rows = rows.filter((p) => (!q.schoolSub || p.sub === q.schoolSub) && (!q.schoolLevel || (q.schoolLevel === 'high' ? (p.hi ?? 0) >= 12 : q.schoolLevel === 'middle' ? (p.hi ?? 0) >= 7 && (p.lo ?? 0) >= 5 && (p.hi ?? 0) <= 9 : (p.lo ?? 9) <= 1)));
    if (c.id === 'hospital' && /\b(er|emergency)\b/.test(q.rest)) rows = rows.filter((p) => p.sub === 'ed');
    if (inArea) rows = rows.filter((p) => inArea.has(this.app.overlays.areaAt(p.x, p.z).block));
    const where = area ? `in ${area.name}` : 'in Buncombe County';
    const label = `${q.schoolSub ? `${q.schoolSub} ` : ''}${q.schoolLevel ? `${{ elem: 'elementary', middle: 'middle', high: 'high' }[q.schoolLevel]} ` : ''}${rows.length === 1 ? c.one : c.many}`;
    const figures = [];
    let extra = '';
    if (c.id === 'school') {
      const by = { public: 0, charter: 0, private: 0 };
      let students = 0;
      for (const p of rows) { by[p.sub] = (by[p.sub] || 0) + 1; students += p.enrollment || 0; }
      for (const k of ['public', 'charter', 'private']) if (by[k]) figures.push({ label: `${cap(k)} schools`, value: String(by[k]), badge: 'counted' });
      figures.push({ label: 'Students enrolled (all listed schools)', value: num.format(students), badge: 'counted' });
      extra = ` Together they enroll about ${num.format(round(students, 100))} students.`;
    } else if (c.id === 'hotel' && !area) {
      const t = this.app.facts?.tourism;
      if (t?.hotel_rooms_2025) figures.push({ label: 'Hotel rooms in the county (2025)', value: t.hotel_rooms_2025.replace(' per night', ''), badge: 'surveyed' });
      if (t?.vacation_rentals_2025) figures.push({ label: 'Vacation rentals (2025)', value: t.vacation_rentals_2025, badge: 'surveyed' });
    } else if (c.id === 'fire') {
      const by = new Map();
      for (const p of rows) by.set(p.department || 'Other', (by.get(p.department || 'Other') || 0) + 1);
      for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) figures.push({ label: k, value: String(v), badge: 'counted' });
    } else if (c.id === 'hospital') {
      for (const p of rows) figures.push({ label: p.name.replace(/ \(.*\)$/, ''), value: p.sub === 'ed' ? '24-hour emergency room' : p.sub === 'va' ? 'Veterans hospital' : 'No emergency room', badge: 'counted' });
      const eds = rows.filter((p) => p.sub === 'ed').length;
      extra = ` ${eds} of them ${eds === 1 ? 'has' : 'have'} a 24-hour emergency room open to everyone.`;
    }
    return {
      kind: 'count', headline: `${rows.length} ${label}`,
      sub: `The map lists ${rows.length} ${label} ${where}.${extra}${c.id === 'ems' ? ' Most ambulance base locations are approximate.' : ''}${c.id === 'hotel' ? ' That is hotels, motels and inns on OpenStreetMap; vacation rentals are not included.' : ''}`,
      figures, sources: [c.id === 'school' || c.id === 'college' ? SRC.nces : c.id === 'hotel' ? SRC.osm : SRC.research],
      map: `Every ${c.one} is marked with a pin. Click one to learn about it.`,
      follow: c.id === 'school' ? ['How many students go to Asheville High?', 'What is the closest school to downtown?', 'Where do the most kids live?']
        : c.id === 'fire' ? ['Where should a new fire station go?', 'What share of people can a fire truck reach in 4 minutes?', 'How fast can a fire truck get to Barnardsville?']
          : c.id === 'hospital' ? ['How far is the nearest emergency room from Black Mountain?', 'How many people live within 15 minutes of Mission Hospital?'] : [`What is the closest ${c.one} to downtown?`, 'How many visitors come to Asheville?'],
      show: () => { this.view.clearAreas(); this.view.markers(c.kinds); if (area) this.view.frameEnt(area); else this.view.county(); },
    };
  }

  students(q) {
    const ent = q.ents.find((e) => e.type === 'poi' && (e.kind === 'school' || e.kind === 'college'));
    if (ent) return this.schoolInfo(ent);
    const schools = this.app.data.pois.filter((p) => p.kind === 'school');
    const by = { public: 0, charter: 0, private: 0 };
    for (const p of schools) by[p.sub] = (by[p.sub] || 0) + (p.enrollment || 0);
    const total = by.public + by.charter + by.private;
    return {
      kind: 'students', headline: `About ${num.format(round(total, 100))} students`,
      sub: `The ${schools.length} schools on the map enroll about ${num.format(round(total, 100))} students from pre-K through 12th grade. Most go to public schools.`,
      figures: [{ label: 'Public schools', value: num.format(by.public), badge: 'counted' }, { label: 'Charter schools', value: num.format(by.charter), badge: 'counted' }, { label: 'Private schools', value: num.format(by.private), badge: 'counted' }],
      chart: { type: 'bars', unit: 'num', rows: [{ label: 'Public', value: by.public, strong: true }, { label: 'Charter', value: by.charter }, { label: 'Private', value: by.private }], format: (v) => num.format(v) },
      sources: [SRC.nces], caveat: 'Enrollment comes from federal school lists for 2022–23 and 2023–24, so it is a year or two old. Homeschooled students are not counted.',
      map: 'Every school is marked with a pin.', follow: ['How many schools are there?', 'Where do the most kids live?', 'How many students go to Asheville High?'],
      show: () => { this.view.clearAreas(); this.view.markers(['school']); this.view.county(); },
    };
  }

  schoolInfo(ent) {
    const p = ent.poi;
    const g = (x) => (x === -1 ? 'pre-K' : x === 0 ? 'kindergarten' : `grade ${x}`);
    const r = this.lab.reach(ent, 'free', [10, 20]);
    const kind = p.kind === 'college' ? 'college' : `${p.sub} school`;
    return {
      kind: 'school', headline: p.enrollment ? `${num.format(p.enrollment)} students` : ent.name,
      sub: `${ent.name} is a ${kind}${p.lo !== undefined ? ` for ${g(p.lo)} through ${g(p.hi)}` : ''}${p.enrollment ? ` with ${num.format(p.enrollment)} students` : ''}. About ${num.format(round(r.bands[0].kids, 100))} kids ages 5 to 17 live within a 10-minute drive.`,
      figures: [
        ...(p.enrollment ? [{ label: 'Students', value: num.format(p.enrollment), badge: 'counted' }] : []),
        ...(p.lo !== undefined ? [{ label: 'Grades', value: `${cap(g(p.lo))} to ${g(p.hi)}`, badge: 'counted' }] : []),
        { label: 'Kids 5–17 within 10 minutes', value: num.format(round(r.bands[0].kids, 100)), badge: 'simulated' },
        { label: 'Kids 5–17 within 20 minutes', value: num.format(round(r.bands[1].kids, 100)), badge: 'simulated' },
      ],
      sources: [SRC.nces, SRC.dec], caveat: 'Enrollment is from federal school lists and may be a year or two old.',
      map: `Colors show the drive time to ${ent.name}.`,
      follow: [`How long does it take to drive from downtown to ${ent.name}?`, 'How many schools are there?', `How many people live within 15 minutes of ${ent.name}?`],
      show: () => { this.view.markers(['school', 'college']); this.view.heat(r.times, { name: ent.name, basis: 'free', maxMinutes: 30, bandMinutes: 5 }); this.view.pins([{ x: ent.x, z: ent.z, n: '', label: ent.name }]); this.view.top(); this.view.fly(ent.x, ent.z, 20000); },
    };
  }

  zoned(q) {
    const lab = this.lab;
    const ent = q.ents.find((e) => e.type !== 'county' && !(e.type === 'poi' && e.kind === 'school')) || q.self;
    if (!ent) return q.wantsMine ? this.needSpot() : { kind: 'zoned', miss: true, headline: 'Which place?', sub: 'Name a neighborhood or an address, like “Which school is Montford zoned for?” or “Which school is 70 Court Plaza zoned for?”', follow: ['Which school is Montford zoned for?', 'Which school is Arden zoned for?'], map: '', show: () => {} };
    const z = lab.zoned(ent.x, ent.z);
    if (!z.length) return { kind: 'zoned', miss: true, headline: 'No school zone found there', sub: `I couldn’t find a public school attendance zone at ${ent.name}.`, follow: ['How many schools are there?'], map: '', show: () => {} };
    return {
      kind: 'zoned', headline: z.map((x) => x.school.name).join(' → '),
      sub: `Homes ${ent.type === 'hood' || ent.type === 'town' ? 'in' : 'at'} ${ent.name} are in the attendance zones for ${list(z.map((x) => `${x.school.name} (${x.level.toLowerCase()})`))}.`,
      figures: z.map((x) => ({ label: `${x.level} school`, value: x.school.name, badge: 'counted' })),
      sources: [SRC.county],
      caveat: 'From Buncombe County’s attendance district maps. Asheville City elementary schools are chosen by families, not assigned by address, and districts change. A school office has the final word.',
      map: 'The pins are the zoned schools.',
      follow: [`What is the closest school to ${ent.name}?`, `Tell me about ${ent.name}`, 'How many schools are there?'],
      show: () => {
        this.view.clearAreas();
        this.view.markers(['school']);
        const pts = z.map((x) => this.app.data.pois.find((p) => p.kind === 'school' && p.name === x.school.name)).filter(Boolean);
        this.view.pins([{ x: ent.x, z: ent.z, n: '', label: cap(ent.name) }, ...pts.map((p, i) => ({ x: p.x, z: p.z, n: i + 1, label: p.name }))]);
        this.view.framePoints([ent, ...pts], 3500);
      },
    };
  }

  response(q, kind) {
    const lab = this.lab;
    const ent = q.ents.find((e) => e.type !== 'county') || ((q.wantsMine || q.wantsHere) ? q.self : null);
    const unit = { ems: 'an ambulance', fire: 'a fire engine', police: 'a police car', medical: 'the first medical help (a fire engine or an ambulance)' }[kind];
    const title = { ems: 'Ambulance', fire: 'Fire engine', police: 'Police', medical: 'First medical help' }[kind];
    const live = q.basis === 'live';
    const r = lab.response(kind, ent, live);
    const share = /\b(share|percent|fraction|how many people|coverage|cover)\b/.test(q.rest);
    const th = kind === 'fire' ? [240 + 140, 480 + 140, 720 + 140] : kind === 'police' ? [300, 600, 900] : [480 + 120, 539, 900];
    const stats = this.app.coverageStats(r.times, [300, 480, 600, 900, 1200]);
    const covFig = stats.within.map((w) => ({ label: `Reached within ${Math.round(w.seconds / 60)} minutes of the call`, value: `${fmt(w.share, 'pct')} of residents`, badge: 'simulated' }));
    const facts = this.app.facts || {};
    if (ent && Number.isFinite(r.at) && !share) {
      const goal = kind === 'ems' || kind === 'medical' ? 539 : kind === 'fire' ? 380 : null;
      const st = r.station;
      return {
        kind: 'response', headline: `About ${minSec(r.at)}`,
        sub: `From the moment someone calls 911, ${unit} could reach ${ent.name} in about ${minSec(r.at)} ${live ? 'in current traffic' : 'on clear roads'}. That includes about ${kind === 'police' ? 'a minute and a half' : 'two minutes'} to take the call and get rolling.${st && kind !== 'police' ? ` The closest station by road is ${st.poi.name.replace(/ \(.*\)$/, '')}.` : ''}${goal ? ` ${r.at <= goal ? 'That is inside' : 'That is longer than'} the ${kind === 'fire' ? 'national guideline of about 6 minutes for a first fire engine' : 'county’s goal of 8 minutes 59 seconds for an ambulance'}.` : ''}`,
        figures: [{ label: `${title} at ${ent.name}`, value: minSec(r.at), badge: 'simulated' }, ...(st && kind !== 'police' ? [{ label: 'Drive from the closest station (normal speeds)', value: mins(st.sec), badge: 'simulated' }] : []), ...covFig.slice(1, 4)],
        sources: [SRC.research, SRC.osm, SRC.sim],
        caveat: kind === 'police' ? 'This measures from police buildings. Officers and sheriff’s deputies usually answer calls from patrol cars already on the road, and each department covers only its own area, so treat this as a rough guide.' : CAVEAT.response,
        map: `Colors show how long ${unit} takes to arrive after a 911 call: green is fast, red is slow.`,
        follow: [`How fast can ${kind === 'fire' ? 'an ambulance' : 'a fire truck'} get to ${ent.name}?`, `What is the closest hospital to ${ent.name}?`, `Where should a new ${kind === 'police' ? 'police station' : kind === 'fire' ? 'fire station' : 'ambulance base'} go?`, `What share of people can ${kind === 'fire' ? 'a fire truck' : 'an ambulance'} reach in ${kind === 'fire' ? 4 : 8} minutes?`],
        show: () => { this.view.coverage(kind, live ? 'live' : 'free'); this.view.markers(kind === 'medical' ? ['fire', 'ems', 'hospital'] : [kind, 'hospital']); this.view.pins([{ x: ent.x, z: ent.z, n: '', label: `${cap(ent.name)}: ${minSec(r.at)}` }]); this.view.top(); this.view.fly(ent.x, ent.z, 26000); },
      };
    }
    // County-wide coverage.
    const mainTh = q.minutes ? q.minutes * 60 + (kind === 'police' ? 90 : kind === 'fire' ? 140 : 120) : th[0];
    const main = this.app.coverageStats(r.times, [mainTh]).within[0];
    const travelMin = Math.round((mainTh - (kind === 'police' ? 90 : kind === 'fire' ? 140 : 120)) / 60);
    return {
      kind: 'coverage', headline: `${fmt(main.share, 'pct')} of residents`,
      sub: `${cap(unit)} can reach about ${fmt(main.share, 'pct')} of Buncombe County residents (${num.format(round(main.residents, 1000))} people) within ${travelMin} minutes of driving, which is about ${Math.round(mainTh / 60)} minutes after the 911 call. ${kind === 'fire' ? 'National guidelines aim for a first fire engine within 4 minutes of driving.' : kind === 'ems' || kind === 'medical' ? (facts.ems?.goal || '') : ''}`,
      figures: covFig,
      chart: { type: 'bars', unit: 'pct', rows: stats.within.map((w) => ({ label: `${Math.round(w.seconds / 60)} min`, value: w.share, strong: false })), format: (v) => fmt(v, 'pct') },
      sources: [SRC.research, SRC.osm, SRC.dec], caveat: `${CAVEAT.response}${kind === 'ems' || kind === 'medical' ? ` ${facts.ems?.actual_2016_2022 || ''}` : ''}`,
      map: `Colors show how long ${unit} takes to arrive after a 911 call. Red and dark areas wait the longest.`,
      follow: [`Where should a new ${kind === 'police' ? 'police station' : kind === 'fire' ? 'fire station' : 'ambulance base'} go?`, `How fast can ${kind === 'fire' ? 'a fire truck' : 'an ambulance'} get to Barnardsville?`, `How many ${kind === 'fire' ? 'fire stations' : 'hospitals'} are there?`],
      show: () => { this.view.coverage(kind, live ? 'live' : 'free'); this.view.markers(kind === 'medical' ? ['fire', 'ems'] : [kind]); this.view.top(); this.view.county(); },
    };
  }

  bestStation(kind) {
    const lab = this.lab;
    const threshold = kind === 'fire' ? 380 : kind === 'police' ? 480 : 539;
    const r = lab.bestNewStation(kind, threshold);
    if (!r.top.length) return null;
    const word = { fire: 'fire station', ems: 'ambulance base', police: 'police station' }[kind];
    const t = r.top[0];
    const limit = kind === 'fire' ? 'about 6 minutes of the 911 call (4 minutes of driving)' : kind === 'ems' ? '8 minutes 59 seconds of the 911 call (the county’s goal)' : '8 minutes of the 911 call';
    return {
      kind: 'beststation', headline: cap(t.where.replace(/^in /, '')),
      sub: `Today about ${fmt(r.covered / r.total, 'pct')} of residents are within ${limit}. I tested ${r.tried} possible sites on main roads. One new ${word} ${t.where} would bring about ${num.format(round(t.gain, 100))} more people inside that time, the biggest gain of any site.`,
      figures: [...r.top.map((x, i) => ({ label: `${i + 1}. ${cap(x.where)}`, value: `+${num.format(round(x.gain, 100))} people`, badge: 'simulated', pin: i + 1 })),
        { label: 'Residents inside the time today', value: fmt(r.covered / r.total, 'pct'), badge: 'simulated' }, { label: 'Residents outside it today', value: num.format(round(r.unserved, 100)), badge: 'simulated' }],
      sources: [SRC.research, SRC.dec, SRC.osm],
      caveat: 'This only counts how many more people would be reached in time. Real decisions also weigh cost, land, staffing, how often each area calls 911, and help from neighboring stations.',
      map: 'The numbered pins are the three best sites found. Colors show today’s response times; red areas wait the longest.',
      follow: [`What share of people can ${kind === 'fire' ? 'a fire truck' : 'an ambulance'} reach in ${kind === 'fire' ? 4 : 8} minutes?`, `How many ${kind === 'fire' ? 'fire stations' : 'hospitals'} are there?`, 'Where is it most crowded?'],
      show: () => {
        this.view.coverage(kind === 'ems' ? 'ems' : kind, 'free');
        this.view.markers([kind]);
        this.view.pins(r.top.map((x, i) => ({ x: x.x, z: x.z, n: i + 1, label: `+${num.format(round(x.gain, 100))} people` })));
        this.view.top(); this.view.county();
      },
      actions: [{ label: `Add a ${word} at site 1`, run: () => { this.app.addStation(kind, t.x, t.z); } }],
    };
  }

  traffic(q) {
    const lab = this.lab;
    const app = this.app;
    const rest = q.rest;
    const road = q.ents.find((e) => e.type === 'road');
    const summary = app.typicalSummary;
    if (road) {
      const basis = q.basis === 'am' || q.basis === 'pm' ? q.basis : 'live';
      const r = lab.roadNow(road, basis);
      const slow = r.ratio > 1.15;
      // A state counting station on this road: its label starts with the road's short name.
      const key = road.name.replace(/^the /, '').replace(/ \(.*\)$/, '').replace(' Road', ' Rd').replace(' Avenue', ' Ave').replace(' Highway', ' Hwy').replace(' Street', ' St');
      const count = (app.facts?.traffic_counts || []).filter((c) => c.label.startsWith(`${key} `) || (!/^I-/.test(key) && !/^I-/.test(c.label) && c.label.includes(key))).sort((a, b) => b.aadt - a.aadt)[0];
      const when = basis === 'live' ? `Right now in the simulation (${clockLabel(app.world.clock.hour)})` : `At ${basis === 'am' ? '8 a.m.' : '5:30 p.m.'} on a typical school day`;
      return {
        kind: 'road', headline: slow ? `${Math.round((r.ratio - 1) * 100)}% slower than empty roads` : 'Flowing freely',
        sub: `${when}, traffic on ${road.name} averages about ${Math.round(r.nowMph)} mph. With empty roads it would be about ${Math.round(r.ffMph)} mph.${count ? ` A state traffic counter (${count.label.replace(/ \(.*\)$/, '')}) recorded about ${num.format(count.aadt)} vehicles a day in ${count.year}.` : ''}`,
        figures: [{ label: basis === 'live' ? 'Average speed now' : `Average speed at ${basis === 'am' ? '8 a.m.' : '5:30 p.m.'}`, value: `${Math.round(r.nowMph)} mph`, badge: 'simulated' }, { label: 'Speed with no traffic', value: `${Math.round(r.ffMph)} mph`, badge: 'simulated' },
          ...(count ? [{ label: `Vehicles per day (${count.year})`, value: num.format(count.aadt), badge: 'measured' }] : []), { label: 'Slowest stretch', value: `${Math.round((r.worstRatio - 1) * 100)}% slower`, badge: 'simulated' }],
        sources: [SRC.sim, ...(count ? [SRC.ncdot] : [])], caveat: 'The simulation imitates a typical day; it is not live traffic.',
        map: `Roads are colored by how slow they are ${basis === 'live' ? 'right now' : 'in the simulation right now (the answer above is for the time you asked about)'}: green is moving, red is crawling. The pin is the slowest stretch.`,
        follow: ['When is traffic the worst?', 'Where is traffic worst right now?', 'Which road is the busiest?', `How is traffic on ${road.name} at 5:30 pm?`],
        show: () => { this.view.clearAreas(); this.view.roads('congestion'); this.view.orbit(); this.view.pins([{ x: r.worstX, z: r.worstZ, n: '!', label: 'Slowest stretch' }]); this.view.fly(road.x, road.z, 4500, 0.7); },
      };
    }
    if (/\b(busiest|most (cars|traffic|vehicles|used)|carr(y|ies) the most|biggest road)\b/.test(rest) && !/\b(time|when|hour)\b/.test(rest)) {
      const counts = [...(app.facts?.traffic_counts || [])].sort((a, b) => b.aadt - a.aadt);
      if (!counts.length) return null;
      const t = counts[0];
      return {
        kind: 'busiest', headline: `${num.format(t.aadt)} vehicles a day`,
        sub: `The busiest road counted in Buncombe County is ${t.label}, where a state counter recorded about ${num.format(t.aadt)} vehicles a day in ${t.year}. That is about ${num.format(Math.round(t.aadt / 24 / 60))} every minute, averaged over a whole day.`,
        figures: counts.slice(0, 6).map((c, i) => ({ label: `${i + 1}. ${c.label}`, value: num.format(c.aadt), badge: 'measured', pin: i < 3 ? i + 1 : undefined })),
        chart: { type: 'bars', unit: 'num', rows: counts.slice(0, 8).map((c, i) => ({ label: c.label.replace(/ \(.*\)$/, '').replace(/ near .*$/, '').replace(/ between .*$/, ''), value: c.aadt, strong: i === 0 })), format: (v) => num.format(v) },
        sources: [SRC.ncdot], caveat: 'These are yearly averages from 16 counting stations chosen for this project, not every road.',
        map: 'The pins are the three busiest counting stations.',
        follow: ['When is traffic the worst?', 'Where is traffic worst right now?', 'How is traffic on Patton Avenue?'],
        show: () => { this.view.clearAreas(); this.view.roads('congestion'); this.view.pins(counts.slice(0, 3).map((c, i) => ({ x: c.x, z: c.z, n: i + 1, label: `${num.format(c.aadt)} a day` }))); this.view.orbit(); this.view.fly(-1500, 2500, 14000, 0.8); },
      };
    }
    if (/\b(when|what time|which hour|worst time|rush hour|time of day)\b/.test(rest) && summary) {
      const day = q.scenario === 'saturday' ? 'saturday' : 'weekday';
      const d = summary.days[day];
      const hrs = d.hourly.slice(1, 24).map((h) => ({ hour: h.hour, active: h.active, mph: h.kmh * 0.621371 }));
      const peak = hrs.reduce((a, b) => (b.active > a.active ? b : a));
      const slow = hrs.reduce((a, b) => (b.mph < a.mph && b.active > 2000 ? b : a));
      const am = hrs.filter((h) => h.hour >= 6 && h.hour <= 10).reduce((a, b) => (b.active > a.active ? b : a));
      return {
        kind: 'when', headline: `Around ${clockLabel(slow.hour)}`,
        sub: `On a simulated ${day === 'weekday' ? 'school day' : 'Saturday'}, roads are fullest and slowest around ${clockLabel(slow.hour)}: about ${num.format(round(peak.active, 100))} vehicles are moving at once and the average speed drops to ${Math.round(slow.mph)} mph. ${day === 'weekday' ? `The morning peak comes around ${clockLabel(am.hour)}. ` : ''}At 3 a.m. the average is about ${Math.round(hrs[2].mph)} mph.`,
        figures: [{ label: 'Most vehicles moving at once', value: `${num.format(d.peakActiveVehicles)} at ${clockLabel(Number(d.peakAt.split(':')[0]) + Number(d.peakAt.split(':')[1]) / 60)}`, badge: 'simulated' },
          { label: 'Slowest hour', value: `${clockLabel(slow.hour)}, ${Math.round(slow.mph)} mph average`, badge: 'simulated' }, { label: 'Vehicle trips in the day', value: num.format(round(d.vehicleTrips, 1000)), badge: 'simulated' },
          { label: 'Average trip', value: `${d.avgTripMin} minutes`, badge: 'simulated' }],
        chart: { type: 'line', rows: hrs.map((h) => ({ x: h.hour, y: h.active })), xLabel: 'Hour of the day', yLabel: 'Vehicles on the road', xFormat: (v) => clockLabel(v).replace(' a.m.', 'a').replace(' p.m.', 'p'), yFormat: (v) => num.format(v), mark: slow.hour },
        sources: [SRC.sim, SRC.lodes], caveat: 'This is a full simulated day built from Census commuting data, school schedules and visitor counts. It imitates a typical day; real days vary.',
        map: `The clock is now set to ${clockLabel(slow.hour - 0.5)} so you can watch it build. Roads are colored by how slow they are.`,
        follow: ['Where is traffic worst right now?', 'What does a Saturday look like?', 'What happens to traffic on a snow day?'],
        show: () => { this.view.clearAreas(); if (day === 'weekday' && app.world.scenario?.id !== 'weekday') this.view.scenario('weekday'); this.view.hour(slow.hour - 0.5); this.view.roads('congestion'); this.view.orbit(); this.view.fly(-800, 1200, 9000, 0.75); },
      };
    }
    if (/\bhow many (cars|vehicles|trucks)\b/.test(rest)) {
      const st = app.world.stats();
      const d = summary?.days.weekday;
      return {
        kind: 'cars', headline: `${num.format(st.active || 0)} vehicles right now`,
        sub: `At ${clockLabel(app.world.clock.hour)} in the simulation, ${num.format(st.active || 0)} cars, trucks and buses are on Buncombe County roads.${d ? ` Over a whole school day the simulation makes about ${num.format(round(d.vehicleTrips, 1000))} trips, with up to ${num.format(d.peakActiveVehicles)} vehicles moving at once.` : ''}`,
        figures: [{ label: 'On the road now', value: num.format(st.active || 0), badge: 'simulated' }, { label: 'Average speed now', value: `${Math.round((st.avgSpeedKmh || 0) * 0.621371)} mph`, badge: 'simulated' }, ...(d ? [{ label: 'Trips in a school day', value: num.format(round(d.vehicleTrips, 1000)), badge: 'simulated' }] : [])],
        sources: [SRC.sim], map: 'Each moving light is a vehicle.', follow: ['When is traffic the worst?', 'Which road is the busiest?', 'Where is traffic worst right now?'], show: () => { this.view.clearAreas(); this.view.roads('plain'); },
      };
    }
    // Where is it slow right now?
    const rows = lab.slowRoads(5);
    const st = app.world.stats();
    if (!rows.length) {
      return {
        kind: 'slow', headline: 'Traffic is moving freely',
        sub: `At ${clockLabel(app.world.clock.hour)} in the simulation no main road is much slower than normal. Try moving the clock to 8 a.m. or 5:30 p.m.`,
        figures: [{ label: 'Vehicles on the road', value: num.format(st.active || 0), badge: 'simulated' }], sources: [SRC.sim], map: 'Roads are colored by how slow they are; green means moving.',
        follow: ['When is traffic the worst?', 'Which road is the busiest?'], show: () => { this.view.clearAreas(); this.view.roads('congestion'); },
      };
    }
    return {
      kind: 'slow', headline: roadLabel(rows[0].full),
      sub: `At ${clockLabel(app.world.clock.hour)} in the simulation, the road losing the most time to traffic is ${roadLabel(rows[0].full)}, with about ${miles(rows[0].miles)} of slow lanes. ${rows[1] ? `${roadLabel(rows[1].full)} is next.` : ''}`,
      figures: rows.map((r, i) => ({ label: `${i + 1}. ${roadLabel(r.full)}`, value: `${miles(r.miles)} slow`, badge: 'simulated', pin: i < 3 ? i + 1 : undefined })),
      sources: [SRC.sim], caveat: 'The simulation imitates a typical day; it is not live traffic. Ask again later in the simulated day and the answer changes.',
      map: 'Roads are colored by how slow they are right now: green is moving, red is crawling.',
      follow: ['When is traffic the worst?', 'Which road is the busiest?', 'How is traffic on Patton Avenue?', 'What happens to traffic on a snow day?'],
      show: () => { this.view.clearAreas(); this.view.roads('congestion'); this.view.pins(rows.slice(0, 3).map((r, i) => ({ x: r.x, z: r.z, n: i + 1, label: roadLabel(r.full) }))); this.view.orbit(); this.view.framePoints(rows.slice(0, 3), 5000, 0.8); },
    };
  }

  scenario(q) {
    const app = this.app;
    const sc = (app.world.scenarios || []).find((s) => s.id === q.scenario);
    if (!sc) return this.simOff();
    const watch = {
      snow: ['Speeds drop everywhere, not just at the usual jams.', 'With schools closed there is no morning drop-off rush.', 'Compare a drive time now with the same trip on a school day.'],
      leaf_peak: ['Watch the Blue Ridge Parkway, the Biltmore gate and downtown fill by midday.', 'I-26 and I-40 carry visitors in from other counties.'],
      tourists_game: ['Watch the streets around HomeTrust Park (McCormick Field) before the 6:35 p.m. first pitch.', 'The crowd arrives on top of the evening rush.'],
      orange_peel: ['Downtown parking decks fill before the 8 p.m. show.', 'Everyone leaves at once around 11 p.m.'],
      arena: ['About 7,000 fans head downtown as the evening rush is ending.', 'A third of them drive in from other counties on I-26 and I-40.'],
      candlelight: ['Every car to Biltmore enters through one gate at Biltmore Village.', 'Holiday shoppers add traffic near the mall and the outlets.'],
      thanksgiving_eve: ['Through traffic on I-26 and I-40 nearly doubles.', 'Fewer people commute, but more drive to stores.'],
      black_friday: ['Watch Tunnel Road (the mall), Brevard Road (the outlets) and Biltmore Park.', 'The morning commute is light.'],
      july4: ['A crowd of about 18,000 gathers downtown for the fireworks.', 'Watch what happens just after 9:50 p.m. when everyone leaves at once.'],
      summer: ['No school buses or drop-off lines in the morning.', 'More visitors and more midday trips.'],
      saturday: ['Hardly any morning rush.', 'Shopping and errands make midday the busiest time.'],
      sunday: ['A small morning peak, then a quiet afternoon.'],
      weekday: ['The morning rush builds from 7 to 8:30 a.m.', 'The afternoon rush is longer: schools let out, then work does.'],
    }[sc.id] || [];
    const evs = (sc.events || []).map((e) => (typeof e === 'string' ? e : e.id));
    const startHour = sc.id === 'snow' || sc.id === 'weekday' || sc.id === 'summer' ? 7.75 : sc.startHour + 0.5;
    return {
      kind: 'scenario', headline: sc.label,
      sub: `${sc.description} The simulation has switched to this day and is refilling the roads.`,
      figures: watch.map((w, i) => ({ label: `Watch for ${i + 1}`, value: w, wide: true })),
      sources: [SRC.sim, SRC.research],
      caveat: 'A scenario is a what-if. Visitor and crowd sizes are estimates, and the model can only show effects it was built to include.',
      map: 'Roads are colored by how slow they are. Use the time slider and speed buttons at the bottom to watch the day unfold.',
      follow: ['Where is traffic worst right now?', 'When is traffic the worst?', sc.id === 'weekday' ? 'What happens to traffic on a snow day?' : 'What happens on a normal school day?', 'How long does it take to drive from Black Mountain to downtown right now?'],
      show: () => { this.view.clearAreas(); this.view.scenario(sc.id, startHour); this.view.roads('congestion'); this.view.orbit(); if (evs.length) this.view.flyEvent(evs[0]); else this.view.home(); },
    };
  }

  /** Days, events and the sun need the running simulation (it is off with ?nosim in the address). */
  simOff() {
    return { kind: 'simoff', miss: true, headline: 'That needs the traffic simulation', sub: 'This page was opened in map-only mode, without moving traffic, so it can’t show different days or times. Remove “?nosim” from the address and reload to turn the simulation on.',
      follow: ['Where do the most kids live?', 'How fast can an ambulance get to Barnardsville?', 'How many people live in Asheville?'], map: '', show: () => {} };
  }

  weatherQ(q) {
    const names = { rain: 'Rain', storm: 'A thunderstorm', fog: 'Fog', clear: 'Clear skies', cloudy: 'Clouds' };
    return {
      kind: 'weather', headline: names[q.weather],
      sub: `The weather in the simulation is now ${q.weather === 'clear' ? 'clear' : q.weather}. ${q.weather === 'rain' || q.weather === 'storm' || q.weather === 'fog' ? 'Drivers slow down in bad weather, so trips take a little longer.' : ''}`,
      figures: [], sources: [SRC.sim], map: 'Use the weather buttons at the bottom to change it back.',
      follow: ['What happens to traffic on a snow day?', 'Where is traffic worst right now?'], show: () => { this.app.setWeather(q.weather); },
    };
  }

  elevation(q) {
    const lab = this.lab;
    const ent = q.ents.find((e) => e.type !== 'county') || q.self;
    if (!ent) return null;
    const ft = lab.elevationFt(ent.x, ent.z);
    const down = this.gaz.get('downtown');
    const dft = lab.elevationFt(down.x, down.z);
    const ext = lab.extremes();
    return {
      kind: 'elevation', headline: `${num.format(round(ft, 10))} feet above sea level`,
      sub: `${cap(ent.name)} sits about ${num.format(round(ft, 10))} feet above sea level.${ent !== down ? ` That is ${num.format(Math.abs(round(ft - dft, 10)))} feet ${ft >= dft ? 'higher' : 'lower'} than downtown Asheville (${num.format(round(dft, 10))} feet).` : ''}`,
      figures: [{ label: cap(ent.name), value: `${num.format(round(ft, 10))} ft`, badge: 'measured' }, { label: 'Downtown Asheville', value: `${num.format(round(dft, 10))} ft`, badge: 'measured' },
        { label: 'Highest ground in the county', value: `${num.format(round(ext.hi.h * 3.28084, 10))} ft`, badge: 'measured' }, { label: 'Lowest ground in the county', value: `${num.format(round(ext.lo.h * 3.28084, 10))} ft`, badge: 'measured' }],
      sources: [SRC.usgs], caveat: 'Read from a terrain grid with a point every 30 meters, so sharp peaks and buildings are smoothed out.',
      map: 'The pin marks the spot. Tilt the view to see the land rise around it.',
      follow: ['What is the highest point in Buncombe County?', `Tell me about ${ent.name}`, 'What is the lowest point in Buncombe County?'],
      show: () => { this.view.clearAreas(); this.view.pins([{ x: ent.x, z: ent.z, n: '', label: `${cap(ent.name)}: ${num.format(round(ft, 10))} ft` }]); this.view.orbit(); this.view.fly(ent.x, ent.z, 5000, 0.35); },
    };
  }

  extremes(which) {
    const lab = this.lab;
    const e = lab.extremes()[which];
    const ft = e.h * 3.28084;
    const where = this.gaz.describe(e.x, e.z);
    const hi = which === 'hi';
    const ang = (Math.atan2(e.x, -e.z) * 180) / Math.PI;
    const corner = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((ang + 360) % 360) / 45) % 8];
    return {
      kind: 'extreme', headline: `${num.format(round(ft, 10))} feet`,
      sub: hi
        ? `The highest ground inside Buncombe County is about ${num.format(round(ft, 10))} feet above sea level, in the far ${corner} of the county, ${where}. That is ${num.format(round(ft - lab.elevationFt(0, 0), 10))} feet above downtown Asheville. Mount Mitchell, the highest peak east of the Mississippi River at 6,684 feet, is just over the county line in Yancey County.`
        : `The lowest ground in Buncombe County is about ${num.format(round(ft, 10))} feet above sea level, in the far ${corner} of the county, ${where}. Water runs downhill, so a county’s lowest ground is usually where a river or creek flows out of it.`,
      figures: [{ label: hi ? 'Highest ground' : 'Lowest ground', value: `${num.format(round(ft, 10))} ft`, badge: 'measured' }, { label: hi ? 'Lowest ground' : 'Highest ground', value: `${num.format(round(lab.extremes()[hi ? 'lo' : 'hi'].h * 3.28084, 10))} ft`, badge: 'measured' },
        { label: 'Downtown Asheville', value: `${num.format(round(lab.elevationFt(0, 0), 10))} ft`, badge: 'measured' }],
      sources: [SRC.usgs], caveat: 'Read from a terrain grid with a point every 30 meters, so the very tip of a peak can be a little higher than this.',
      map: 'The pin marks the spot.',
      follow: [hi ? 'What is the lowest point in Buncombe County?' : 'What is the highest point in Buncombe County?', 'How high is downtown Asheville?', 'How high is Black Mountain?'],
      show: () => { this.view.clearAreas(); this.view.pins([{ x: e.x, z: e.z, n: '', label: `${num.format(round(ft, 10))} ft` }]); this.view.orbit(); this.view.fly(e.x, e.z, 9000, 0.3); },
    };
  }

  building(which) {
    const b = this.app.data.buildings;
    let best = -1; let most = -1;
    for (let i = 0; i < b.count; i++) {
      // A few one-story buildings carry a mistaken height on OpenStreetMap; a real tower has floors too.
      if (which === 'tall' && b.floors[i] < 4) continue;
      const v = which === 'tall' ? b.heightDm[i] : b.area[i];
      if (best < 0 || v > (which === 'tall' ? b.heightDm[best] : b.area[best])) best = i;
      if (most < 0 || b.floors[i] > b.floors[most]) most = i;
    }
    const nameOf = (i) => (b.name(i) || (this.app.hud.addressOf(i) || '').replace(/\s+\d{5}$/, '').replace(/\s+#\S+$/, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || 'A building with no name on the map');
    const name = nameOf(best);
    const where = this.gaz.describe(b.x[best], b.z[best]);
    const ft = b.height(best) * 3.28084;
    const figures = [{ label: 'Height', value: `about ${num.format(round(ft, 5))} ft`, badge: 'measured' }, { label: 'Stories', value: String(b.floors[best]), badge: 'measured' }, { label: 'Ground covered', value: `${num.format(round(b.area[best] * 10.764, 100))} sq ft`, badge: 'measured' }];
    let sub;
    if (which === 'tall') {
      sub = `By the heights recorded on the map, the tallest building is ${name}, ${where}: about ${num.format(round(ft, 5))} feet and ${b.floors[best]} stories.`;
      if (most !== best) {
        sub += ` The building with the most stories is ${nameOf(most).replace(/^A building/, 'a building')}, also ${this.gaz.describe(b.x[most], b.z[most])}, with ${b.floors[most]}.`;
        figures.push({ label: 'Most stories on the map', value: `${b.floors[most]} (${nameOf(most) === 'A building with no name on the map' ? 'unnamed' : nameOf(most)})`, badge: 'measured' });
      }
    } else {
      sub = `The building that covers the most ground is ${name === 'A building with no name on the map' ? 'a factory or warehouse with no name on the map' : name}, ${where}: about ${num.format(round(b.area[best] * 10.764, 1000))} square feet, or ${(b.area[best] / 4046.86).toFixed(1)} acres. That is about ${Math.round(b.area[best] / 5351)} football fields.`;
    }
    return {
      kind: 'building', headline: name, sub, figures,
      sources: [SRC.osm], caveat: 'Building heights and names come from OpenStreetMap volunteers and are incomplete. Where no height was recorded, the map estimates one from the number of floors, so a real tape measure could disagree.',
      map: 'The building is highlighted in yellow.',
      follow: [which === 'tall' ? 'What is the biggest building?' : 'What is the tallest building?', 'How many buildings are in Buncombe County?', 'Where are the jobs?'],
      show: () => { this.view.clearAreas(); this.app.select(null); this.app.buildings.select(best); this.view.orbit(); this.view.fly(b.x[best], b.z[best], Math.max(500, b.height(best) * 6, Math.sqrt(b.area[best]) * 3), 0.5); },
    };
  }

  sun() {
    const c = this.app.world.clock;
    const s = c.sunTimes ? c.sunTimes() : null;
    if (!s) return this.simOff();
    const rise = s.sunrise ?? s.rise; const set = s.sunset ?? s.set;
    const len = set - rise;
    const date = c.date ? c.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : 'this day';
    return {
      kind: 'sun', headline: `Sunset at ${clockLabel(set)}`,
      sub: `On ${date} (the date of this simulated day), the sun rises over Asheville at about ${clockLabel(rise)} and sets at about ${clockLabel(set)}. That is ${Math.floor(len)} hours ${Math.round((len % 1) * 60)} minutes of daylight.`,
      figures: [{ label: 'Sunrise', value: clockLabel(rise), badge: 'measured' }, { label: 'Sunset', value: clockLabel(set), badge: 'measured' }, { label: 'Daylight', value: `${Math.floor(len)} hr ${Math.round((len % 1) * 60)} min`, badge: 'measured' }],
      sources: ['Calculated from the Earth’s orbit and Asheville’s latitude and longitude'], caveat: 'Mountains block the sun, so in a valley it can look like sunset comes earlier.',
      map: 'The clock has jumped to just before sunset. Watch the lights come on.',
      follow: ['What happens when school is out for summer?', 'What happens to traffic on a snow day?', 'When is traffic the worst?'],
      show: () => { this.view.clearAreas(); this.view.hour(set - 0.35); this.view.orbit(); this.view.home(); },
    };
  }

  setTime(hour) {
    return { kind: 'time', headline: `The clock is set to ${clockLabel(hour)}`, sub: 'Traffic takes a simulated minute or two to catch up after a jump in time.', figures: [], sources: [], map: '',
      follow: ['Where is traffic worst right now?', 'How many cars are on the road?'], show: () => { this.view.hour(hour); } };
  }

  totalsQ(q) {
    const lab = this.lab;
    const rest = q.rest;
    if (!/\bhow many\b|\bhow big\b|\bhow large\b|\bnumber of\b/.test(rest)) return null;
    if (/\bhow many (cars|vehicles|trucks|drivers)\b/.test(rest)) return null; // that is a traffic question
    const t = lab.totals();
    const f = this.app.facts || {};
    const mk = (headline, sub, figures, sources, follow, caveat, show) => ({ kind: 'total', headline, sub, figures, sources, follow, caveat, map: '', show: show || (() => { this.view.clearAreas(); this.view.county(); }) });
    if (/\b(buildings|structures)\b/.test(rest)) {
      return mk(`${num.format(t.buildings)} buildings`, `The map has ${num.format(t.buildings)} buildings in Buncombe County, from sheds and garages to hospitals. The 2020 Census counted ${num.format(t.homes)} homes (houses, apartments and manufactured homes).`,
        [{ label: 'Buildings on the map', value: num.format(t.buildings), badge: 'counted' }, { label: 'Homes, 2020 Census', value: num.format(t.homes), badge: 'counted' }], [SRC.osm, SRC.dec], ['What is the tallest building?', 'Where are the oldest homes?', 'How many miles of road are there?'],
        'Building outlines are drawn by OpenStreetMap volunteers, so a few are missing or out of date.');
    }
    if (/\b(homes|houses|housing units|apartments)\b/.test(rest) && !q.metrics.length) {
      return mk(`${num.format(t.homes)} homes`, `The 2020 Census counted ${num.format(t.homes)} homes in Buncombe County for ${num.format(t.pop2020)} people.`,
        [{ label: 'Homes, 2020 Census', value: num.format(t.homes), badge: 'counted' }, { label: 'People, 2020 Census', value: num.format(t.pop2020), badge: 'counted' }], [SRC.dec], ['Where are the most apartments?', 'Where are the most vacation homes?', 'Where are the oldest homes?']);
    }
    if (/\b(miles of roads?|roads?|streets?|highways?)\b/.test(rest) && !q.category) {
      return mk(`About ${num.format(round(t.roadMiles, 10))} miles of road`, `The road map has about ${num.format(round(t.roadMiles, 10))} miles of streets and highways in and around Buncombe County. End to end, that is about as far as driving from Asheville to Los Angeles and back.`,
        [{ label: 'Miles of road', value: num.format(round(t.roadMiles, 10)), badge: 'measured' }, ...(t.signals ? [{ label: 'Traffic signals', value: num.format(t.signals), badge: 'counted' }] : [])], [SRC.osm], ['Which road is the busiest?', 'When is traffic the worst?', 'How many buildings are in Buncombe County?'],
        'Includes driveways and service roads drawn on OpenStreetMap, and a little road just past the county line.');
    }
    if (/\b(traffic lights?|stop ?lights?|signals?)\b/.test(rest) && t.signals) {
      return mk(`${num.format(t.signals)} traffic signals`, `The road map has ${num.format(t.signals)} intersections with traffic signals in and around Buncombe County.`, [{ label: 'Traffic signals', value: num.format(t.signals), badge: 'counted' }], [SRC.osm], ['Which road is the busiest?', 'How many miles of road are there?']);
    }
    if (/\b(visitors?|tourists?)\b/.test(rest) && f.tourism) {
      return mk(`${(f.tourism.visitors_2023 / 1e6).toFixed(1)} million visitors a year`, `Buncombe County had a record ${(f.tourism.visitors_2023 / 1e6).toFixed(1)} million visitors in 2023: ${(f.tourism.overnight_2023 / 1e6).toFixed(1)} million stayed overnight and ${(f.tourism.day_trips_2023 / 1e6).toFixed(1)} million came for the day. That is about ${Math.round(f.tourism.visitors_2023 / t.pop2020)} visitors for every resident. Visits fell after Hurricane Helene in September 2024.`,
        [{ label: 'Visitors, 2023', value: num.format(f.tourism.visitors_2023), badge: 'surveyed' }, { label: 'Stayed overnight', value: num.format(f.tourism.overnight_2023), badge: 'surveyed' }, { label: 'Day trips', value: num.format(f.tourism.day_trips_2023), badge: 'surveyed' }, { label: 'Residents, 2020 Census', value: num.format(t.pop2020), badge: 'counted' }],
        ['Explore Asheville (the county tourism agency), 2023 visitor estimates'], ['What happens during leaf season?', 'How many hotels are there?', 'Where are the most vacation homes?'], 'Visitor totals are estimates made by the tourism agency from surveys and hotel records.');
    }
    if (/\bjobs?\b/.test(rest) && !q.ents.some((e) => e.type !== 'county')) {
      return { ...mk(`About ${num.format(round(t.jobs, 1000))} jobs`, `About ${num.format(round(t.jobs, 1000))} jobs are located in Buncombe County, according to Census jobs data for 2023. The map is now colored by where they are.`,
        [{ label: 'Jobs in the county', value: num.format(round(t.jobs, 100)), badge: 'counted' }, { label: 'Residents, 2020 Census', value: num.format(t.pop2020), badge: 'counted' }], [SRC.lodes], ['Where are the jobs?', 'Where do the most people have long commutes?', 'Where do the most people work from home?']),
      show: () => { this.view.layer('jobs_density_b'); this.view.county(); } };
    }
    if (/\b(block groups?|blocks?|neighbou?rhoods?|areas)\b/.test(rest)) {
      return mk(`${lab.areas.bg.geoid.length} block groups`, `The Census divides Buncombe County into ${lab.areas.bg.geoid.length} block groups (neighborhood-sized areas used for survey results) and ${num.format(lab.areas.block.geoid.length)} blocks (the smallest areas, used for the 2020 count).`,
        [{ label: 'Block groups', value: String(lab.areas.bg.geoid.length), badge: 'counted' }, { label: 'Census blocks', value: num.format(lab.areas.block.geoid.length), badge: 'counted' }], [SRC.dec], ['Where is it most crowded?', 'How many people live in Buncombe County?']);
    }
    if (/\b(towns?|cities|communities)\b/.test(rest)) {
      const towns = this.gaz.towns;
      const inc = towns.filter((x) => x.kind !== 'community');
      return { ...mk(`${inc.length} towns and cities`, `Buncombe County has ${inc.length} incorporated places with their own governments: ${list(inc.map((x) => x.name))}. The Census also reports ${towns.length - inc.length} unincorporated communities, such as ${list(towns.filter((x) => x.kind === 'community').slice(0, 3).map((x) => x.name))}.`,
        towns.slice(0, 6).map((x) => ({ label: x.name, value: `${num.format(lab.pop2020(x))} people`, badge: 'counted' })), [SRC.dec], ['Which town has the most people?', 'Compare Weaverville and Black Mountain', 'How many people live in Asheville?']),
      show: () => { this.view.clearAreas(); this.view.pins(towns.slice(0, 8).map((x, i) => ({ x: x.x, z: x.z, n: i + 1, label: x.name }))); this.view.county(); } };
    }
    return null;
  }

  profile(ent) {
    const lab = this.lab;
    if (ent.type === 'road') return null;
    if (ent.outside) {
      return { kind: 'outside', miss: true, headline: `${ent.name} is outside Buncombe County`, sub: 'The map shows it, but the Census numbers loaded here stop at the county line.', follow: ['Tell me about Black Mountain', 'How many people live in Buncombe County?'], map: '', figures: [], show: () => { this.view.clearAreas(); this.view.orbit(); this.view.fly(ent.x, ent.z, 5000, 0.6); } };
    }
    if (ent.type === 'poi' && ent.kind === 'school') return this.schoolInfo(ent);
    const isArea = ent.type === 'town' || ent.type === 'hood' || ent.type === 'county';
    const p20 = lab.pop2020(isArea ? ent : { ...ent, radius: 800, _blocks: null });
    const ids = ['median_age', 'pct_under_18', 'median_income', 'median_home_value', 'median_rent', 'pct_renter', 'pct_bachelors', 'median_year_built'];
    const figures = [{ label: ent.type === 'town' || ent.type === 'county' ? 'People, 2020 Census' : `People within ${miles((ent.radius || 800) / MI)}`, value: num.format(p20), badge: 'counted' }];
    for (const id of ids) {
      const s = lab.stat(ent, id);
      if (s) figures.push({ label: METRIC_BY_ID[id].label, value: `${s.how === 'blockgroups' ? 'about ' : ''}${fmt(s.value, lab.unitOf(id))}`, badge: 'surveyed' });
    }
    const ft = lab.elevationFt(ent.x, ent.z);
    figures.push({ label: 'Elevation', value: `${num.format(round(ft, 10))} ft`, badge: 'measured' });
    const down = this.gaz.get('downtown');
    const d = ent.type !== 'county' && ent !== down ? lab.drive(ent, down) : null;
    if (d) figures.push({ label: 'Drive to downtown Asheville, no traffic', value: mins(d.times.free), badge: 'simulated' });
    let sub;
    if (ent.type === 'town') {
      const kind = ent.kind === 'community' ? 'a community (no town government of its own)' : `a ${ent.kind}`;
      const rank = lab.gaz.towns.slice().sort((a, b) => lab.pop2020(b) - lab.pop2020(a)).indexOf(ent) + 1;
      sub = `${ent.name} is ${kind} in Buncombe County with ${num.format(p20)} residents in the 2020 Census${rank === 1 ? ', by far the largest in the county' : `, the ${['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', '11th', '12th', '13th'][rank] || `${rank}th`} largest of ${lab.gaz.towns.length} places the Census reports`}.`;
    } else if (ent.type === 'county') {
      sub = `Buncombe County had ${num.format(p20)} residents in the 2020 Census. Asheville is its county seat and largest city, home to about a third of them.`;
    } else {
      const town = this.gaz.townAt(ent.x, ent.z, (x, z) => this.app.overlays.areaAt(x, z));
      const inTown = town ? `in ${town.kind === 'community' ? '' : `the ${town.kind} of `}${town.name}` : 'outside any town’s limits';
      const far = Math.hypot(ent.x, ent.z) / MI;
      const ang = (Math.atan2(ent.x, -ent.z) * 180) / Math.PI;
      const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((ang + 360) % 360) / 45) % 8];
      const from = far < 0.6 ? (ent === down ? 'at the center of Asheville' : 'close to the center of Asheville') : `about ${miles(far)} ${dir} of downtown Asheville`;
      if (ent.type === 'poi') {
        const p = ent.poi;
        sub = `${cap(ent.name)} is ${from}${far < 0.6 ? '' : `, ${inTown}`}${p.capacity && ['stadium', 'music', 'arena'].includes(p.sub) ? `, with room for about ${num.format(p.capacity)} people` : ''}. About ${num.format(p20)} people live within half a mile.${p.kind === 'hospital' ? ` ${p.sub === 'ed' ? 'It has a 24-hour emergency room.' : p.sub === 'va' ? 'It serves military veterans.' : 'It does not have an emergency room open to the public.'}` : p.notes && p.notes.length <= 140 ? ` ${p.notes}` : ''}`;
      } else if (ent.type === 'hood') {
        sub = `${cap(ent.name)} is ${town && town.name !== ent.name ? `a part of ${town.kind === 'community' ? '' : `the ${town.kind} of `}${town.name}` : 'a community in Buncombe County'}, ${from}. About ${num.format(p20)} people lived within ${miles((ent.radius || 800) / MI)} of the spot where the map puts its name, in the 2020 Census.`;
      } else {
        sub = `${cap(ent.name)} is ${from}${far < 0.6 ? '' : `, ${inTown}`}. About ${num.format(p20)} people lived within ${miles((ent.radius || 800) / MI)} of it in the 2020 Census.`;
      }
    }
    return {
      kind: 'profile', headline: cap(ent.name), sub, figures, sources: [SRC.dec, SRC.acs, SRC.usgs],
      caveat: ent.type === 'town' || ent.type === 'county' ? CAVEAT.survey : CAVEAT.around,
      map: isArea ? `The outlined area is ${ent.type === 'town' || ent.type === 'county' ? ent.name : `the part of the map counted for ${ent.name}`}.` : 'The pin marks the spot.',
      follow: ent.type === 'county' ? ['Which town has the most people?', 'Where is it most crowded?', 'Where do the most kids live?', 'What is the highest point in Buncombe County?']
        : [`How long does it take to drive from ${ent.type === 'spot' ? 'my spot' : ent.name} to ${ent === down ? 'the airport' : 'downtown'}?`, `How fast can an ambulance get to ${ent.type === 'spot' ? 'my spot' : ent.name}?`, ent.type === 'town' ? `Compare ${ent.name} and ${ent.name === 'Asheville' ? 'Weaverville' : 'Asheville'}` : `What is the closest school to ${ent.type === 'spot' ? 'my spot' : ent.name}?`, `How high is ${ent.type === 'spot' ? 'my spot' : ent.name}?`],
      show: () => {
        if (ent.type === 'county') { this.view.clearAreas(); this.view.county(); return; }
        if (isArea) this.view.outline(ent); else { this.view.clearAreas(); this.view.pins([{ x: ent.x, z: ent.z, n: '', label: cap(ent.name) }]); }
        this.view.frameEnt(ent);
      },
    };
  }
}

export { CATEGORIES, mins, miles, clockLabel };
