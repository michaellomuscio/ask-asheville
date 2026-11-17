// Scenario presets: a date, the kind of day it is, how much of each kind of travel happens,
// weather, and any events. Multipliers are relative to an ordinary day of that type
// (weekday / Saturday / Sunday) and stack with the user's demand slider.
//
// Volumes behind the visitor numbers: Buncombe County drew about 13.9 million visitors in
// 2023 (5.0 M overnight, 9.0 M day-trippers; Explore Asheville / Asheville Watchdog), with just
// under 10,000 hotel rooms and about 8,000 vacation rentals in 2025, and spending in 2025 still
// ~13% below 2023 after Hurricane Helene. October is the peak month.

/** Events any scenario can switch on. Times are local hours; window = timed-entry period. */
export const EVENT_CATALOG = [
  {
    id: 'tourists', label: 'Asheville Tourists game', venue: 'mccormick', attendance: 2600, start: 18.58, end: 21.4, occupancy: 2.8,
    regional: 0.12, visitors: 0.12, localKm: 10,
    note: 'Minor-league baseball at HomeTrust Park (the renamed McCormick Field): about 4,000 seats; 2025 average crowd 2,553. Weeknight games start at 6:35 pm.',
  },
  {
    id: 'orange_peel', label: 'Concert at The Orange Peel', venue: 'orange_peel', attendance: 1050, start: 20, end: 23, occupancy: 2.1,
    regional: 0.25, visitors: 0.15, localKm: 12, parkRadius: 700,
    note: 'Sold-out show on Biltmore Avenue (about 1,050 standing). Doors 7 pm, show 8 pm; downtown decks fill.',
  },
  {
    id: 'hcca', label: 'Arena concert, Harrah\'s Cherokee Center', venue: 'hcca', attendance: 7000, start: 20, end: 22.75, occupancy: 2.3,
    regional: 0.35, visitors: 0.12, localKm: 14, parkRadius: 900,
    note: 'ExploreAsheville.com Arena holds up to about 7,200. Arrivals overlap the tail of the evening commute.',
  },
  {
    id: 'hellbender', label: 'Concert at Hellbender amphitheater', venue: 'hellbender', attendance: 6000, start: 18, end: 21.75, occupancy: 2.4,
    regional: 0.35, visitors: 0.12, localKm: 14, parkRadius: 1200,
    note: 'New ~6,000-person outdoor venue near Biltmore Village (opened August 2026); shows must end by 10 pm.',
  },
  {
    id: 'candlelight', label: 'Biltmore Candlelight Christmas Evenings', venue: 'biltmore', attendance: 5000, window: [16.5, 20], stayHours: 2.6,
    occupancy: 2.6, regional: 0.3, visitors: 0.45, localKm: 25,
    note: 'Ticketed evening tours, Nov 3, 2026 – Jan 9, 2027. Per-evening counts are not published; 5,000 guests is an estimate. All traffic enters at the Biltmore Village gate.',
  },
  {
    id: 'winter_lights', label: 'Winter Lights at the NC Arboretum', venue: 'arboretum', attendance: 3500, window: [18, 20.5], stayHours: 1.6,
    occupancy: 3.0, regional: 0.3, visitors: 0.25, localKm: 18,
    note: 'Nov 13, 2026 – Jan 3, 2027, 6–10 pm, timed entry per vehicle. Nightly attendance is an estimate (over 100,000 a season).',
  },
  {
    id: 'fireworks', label: 'July 4th fireworks downtown', venue: 'downtown', attendance: 18000, start: 21.5, end: 21.9, occupancy: 2.9,
    regional: 0.2, visitors: 0.2, localKm: 12, parkRadius: 1500,
    note: 'Downtown Independence Day celebration with fireworks around 9:30 pm. Crowd size is an estimate.',
  },
];

export const SCENARIOS = [
  {
    id: 'weekday',
    label: 'School-day weekday',
    short: 'Weekday',
    date: '2026-10-14',
    startHour: 6.5,
    weather: 'clear',
    mult: {},
    description: 'An ordinary Wednesday in mid-October: schools in session, the full commute, errands, deliveries, interstate traffic, and early leaf-season visitors.',
  },
  {
    id: 'summer',
    label: 'Summer weekday (no school)',
    short: 'Summer',
    date: '2026-07-15',
    startHour: 6.5,
    weather: 'clear',
    school: false,
    mult: { commute: 0.95, other: 1.08, tourist: 1.15 },
    hotelOccupancy: 0.82,
    description: 'Mid-July: no school runs or buses, slightly lighter commutes (vacations), more errands and summer visitors.',
  },
  {
    id: 'saturday',
    label: 'Saturday',
    short: 'Saturday',
    date: '2026-09-12',
    startHour: 8,
    weather: 'clear',
    mult: {},
    description: 'A September Saturday: little commuting, shopping and errands peak at midday, more visitors.',
  },
  {
    id: 'sunday',
    label: 'Sunday',
    short: 'Sunday',
    date: '2026-09-13',
    startHour: 8,
    weather: 'clear',
    mult: {},
    description: 'A September Sunday: church traffic in the morning, a quieter afternoon.',
  },
  {
    id: 'leaf_peak',
    label: 'Fall leaf-peak weekend',
    short: 'Leaf peak',
    date: '2026-10-24',
    startHour: 8,
    weather: 'clear',
    mult: { tourist: 1.9, regional: 1.25, other: 1.05 },
    hotelOccupancy: 0.95,
    dayTrippers: 16000,
    touristSpots: { craggy: 0.14, folk_art: 0.08, brp_vc: 0.07, arboretum: 0.07, biltmore: 0.1, downtown: 0.22 },
    description: 'Late October, when color peaks at Asheville\'s elevation: hotels nearly full, roughly twice the visitors, heavy traffic to Blue Ridge Parkway stops (Craggy Gardens, Folk Art Center), Biltmore and downtown. Peak-day visitor counts are not published; volumes are estimates.',
  },
  {
    id: 'tourists_game',
    label: 'Asheville Tourists night game',
    short: 'Ballgame',
    date: '2026-08-21',
    startHour: 16,
    weather: 'clear',
    mult: {},
    events: ['tourists'],
    description: 'A Friday night game at HomeTrust Park (McCormick Field), first pitch 6:35 pm, about 3,000 fans; arrivals overlap the evening rush near Biltmore Avenue and Charlotte Street.',
    eventPatch: { tourists: { attendance: 3100 } },
  },
  {
    id: 'orange_peel',
    label: 'Orange Peel concert night',
    short: 'Orange Peel',
    date: '2026-10-16',
    startHour: 17,
    weather: 'clear',
    mult: {},
    events: ['orange_peel'],
    description: 'A sold-out Friday show downtown: doors at 7 pm, show at 8 pm, everyone leaving around 11 pm.',
  },
  {
    id: 'arena',
    label: 'Big arena concert',
    short: 'Arena show',
    date: '2026-10-22',
    startHour: 16,
    weather: 'clear',
    mult: {},
    events: ['hcca'],
    description: 'About 7,000 fans at Harrah\'s Cherokee Center on a Thursday; a third drive in from neighboring counties on I-26 and I-40.',
  },
  {
    id: 'candlelight',
    label: 'Biltmore Candlelight Christmas evening',
    short: 'Candlelight',
    date: '2026-12-12',
    startHour: 14,
    weather: 'cloudy',
    mult: { other: 1.25, tourist: 1.0, regional: 1.2 },
    hotelOccupancy: 0.8,
    events: ['candlelight', 'winter_lights'],
    touristSpots: { biltmore: 0.12, grove_park: 0.08, downtown: 0.26 },
    description: 'A December Saturday: holiday shopping, Candlelight Christmas Evenings at Biltmore (all entering through Biltmore Village) and Winter Lights at the Arboretum.',
  },
  {
    id: 'thanksgiving_eve',
    label: 'Thanksgiving Eve travel day',
    short: 'Thanksgiving Eve',
    date: '2026-11-25',
    startHour: 10,
    weather: 'cloudy',
    school: false,
    mult: { commute: 0.72, through: 1.9, regional: 1.2, other: 1.12, tourist: 1.05 },
    description: 'The Wednesday before Thanksgiving: schools out, many leaving work early, grocery runs, and nearly twice the through traffic on I-26 and I-40.',
  },
  {
    id: 'black_friday',
    label: 'Black Friday',
    short: 'Black Friday',
    date: '2026-11-27',
    startHour: 7,
    weather: 'clear',
    school: false,
    mult: { commute: 0.45, other: 1.45, tourist: 1.2, regional: 1.4 },
    touristSpots: { asheville_mall: 0.14, outlets: 0.14, biltmore_park: 0.08 },
    otherProfile: [0.6, 0.3, 0.2, 0.2, 0.4, 1.4, 3.2, 5.2, 6.6, 7.6, 8.4, 8.8, 8.8, 8.4, 8.0, 7.6, 7.2, 6.6, 5.6, 4.4, 3.2, 2.2, 1.4, 0.8],
    description: 'Shopping traffic all day toward Asheville Mall (Tunnel Road), Tanger Outlets (Brevard Road) and Biltmore Park; light commuting.',
  },
  {
    id: 'july4',
    label: 'July 4th fireworks downtown',
    short: 'July 4th',
    date: '2026-07-04',
    startHour: 15,
    weather: 'clear',
    school: false,
    mult: { tourist: 1.2, other: 0.95 },
    hotelOccupancy: 0.9,
    events: ['fireworks'],
    description: 'Independence Day (a Saturday in 2026): a holiday schedule, then a downtown crowd for the fireworks and a heavy exit after about 9:50 pm.',
  },
  {
    id: 'snow',
    label: 'Snow day',
    short: 'Snow day',
    date: '2027-01-20',
    startHour: 6.5,
    weather: 'snow',
    school: false,
    mult: { commute: 0.8, other: 0.75, tourist: 0.4, freight: 0.7, through: 0.6 },
    hotelOccupancy: 0.45,
    description: 'A January weekday with snow: schools closed, many people stay home, and everyone who drives goes about 45% slower.',
  },
];

/** A scenario with its event list resolved against the catalog. */
export function resolveScenario(idOrObject) {
  const base = typeof idOrObject === 'string' ? SCENARIOS.find((s) => s.id === idOrObject) : idOrObject;
  // Already resolved (events are objects, e.g. when a running scenario is restarted): keep its events as they are.
  if (base && Array.isArray(base.events) && base.events.some((e) => typeof e === 'object')) {
    return { ...base, events: base.events.map((e) => ({ ...e })) };
  }
  const sc = base || SCENARIOS[0];
  const active = new Set(sc.events || []);
  const events = EVENT_CATALOG.map((e) => ({ ...e, ...(sc.eventPatch?.[e.id] || {}), active: active.has(e.id) }));
  return { ...sc, events };
}
