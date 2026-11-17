// Every place a question can name: towns (with their exact Census blocks), neighborhoods and
// communities (map labels), schools, colleges, hospitals, landmarks, stations and major roads, plus
// the nicknames people actually use ("downtown", "the mall", "UNCA").

const norm = (s) => String(s).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Map-label names that are also everyday words or first names. They only count as places right after
// a place word ("in Grace", "near Emma"), so "grace period" or "Emma's house" don't trigger them.
const AMBIGUOUS = new Set(['democrat', 'grace', 'ivy', 'wilson', 'coleman', 'midway', 'beech', 'luther', 'jupiter', 'juno', 'canto', 'glady',
  'turnpike', 'emma', 'azalea', 'hawthorne', 'camelot', 'georgetown', 'albemarle', 'hominy', 'graphite', 'boswell', 'coburn', 'stockwood',
  'broadview', 'mountain view', 'pleasant grove', 'oak park', 'oak forest', 'spring time', 'goodluck', 'morning star', 'flat top', 'long ridge',
  'happy valley', 'chestnut hill', 'buena vista', 'highland gate', 'rolling green', 'sherwood forest', 'beverly hills', 'biltmore', 'venable',
  'acton', 'newfound', 'craggy', 'busbee', 'eskota', 'dillingham', 'walkertown', 'jugtown', 'brickton', 'rockview', 'owltown', 'shumont',
  'summerhaven', 'riceville', 'west haven', 'woodside hills', 'knollwood', 'grovemont', 'hazel green', 'redwood village', 'linwood park',
  'valley springs', 'dogwood grove', 'echo hills', 'parkway forest', 'big briar cove', 'blackberry inn', 'old candler', 'new candler',
  'wilshire park', 'swannanoa hills', 'blue ridge forest', 'pole creek', 'stony fork', 'terry fork', 'paint fork', 'forks of ivy',
  'beech glen', 'flat creek', 'gashes creek', 'dula springs', 'elk mountain', 'sulphur springs', 'hoopers creek', 'averys creek',
  'south hominy', 'murphy junction', 'bingham heights', 'candler heights', 'deaver view', 'pisgah view', 'malvern hills', 'wind oaks town homes',
  'lake lure mountain estates', 'rattlesnake lodge', 'sayles village', 'enka village', 'stoney knob', 'east biltmore', 'mountainbrook', 'royal pines']);
// ...except the ones people in Asheville really do say on their own.
for (const ok of ['emma', 'acton', 'riceville', 'royal pines', 'biltmore', 'malvern hills', 'deaver view', 'pisgah view', 'hominy', 'venable', 'newfound']) AMBIGUOUS.delete(ok);

// Places just outside the county that the map labels; the data stops at the county line.
const OUTSIDE = new Set(['fletcher', 'chimney rock', 'bat cave', 'gerton', 'lake lure mountain estates', 'earthaven ecovillage', 'bearwallow']);

/** Nicknames -> a point of interest id, a name in pois.json, or a fixed point. */
const ALIASES = [
  [['downtown', 'downtown asheville', 'pack square', 'city center', 'center of asheville', 'center of town', 'the middle of asheville'], { poiId: 'downtown' }],
  [['mall', 'asheville mall', 'the mall'], { poiId: 'asheville_mall' }],
  [['outlets', 'tanger', 'tanger outlets', 'the outlets', 'outlet mall'], { poiId: 'outlets' }],
  [['biltmore park', 'biltmore park town square'], { poiId: 'biltmore_park' }],
  [['airport', 'asheville airport', 'avl', 'asheville regional airport', 'the airport'], { poiId: 'avl' }],
  [['unca', 'unc asheville', 'university of north carolina asheville', 'unc a'], { poiId: 'unca' }],
  [['biltmore estate', 'biltmore house', 'the biltmore', 'biltmore'], { poiId: 'biltmore' }],
  [['arboretum', 'nc arboretum', 'the arboretum', 'north carolina arboretum'], { poiId: 'arboretum' }],
  [['grove park inn', 'grove park', 'omni grove park inn'], { poiId: 'grove_park' }],
  [['orange peel', 'the orange peel'], { poiId: 'orange_peel' }],
  [['hellbender'], { poiId: 'hellbender' }],
  [['mccormick field', 'hometrust park', 'tourists stadium', 'baseball stadium', 'the ballpark', 'ballpark', 'baseball field'], { poiId: 'mccormick' }],
  [['arena', 'civic center', 'harrahs', 'harrahs cherokee center', 'the arena', 'us cellular center'], { poiId: 'hcca' }],
  [['river arts district', 'rad', 'the river arts district'], { poiId: 'rad' }],
  [['biltmore village'], { poiId: 'biltmore_village' }],
  [['nature center', 'wnc nature center', 'the nature center'], { poiId: 'wnc_nature' }],
  [['folk art center'], { poiId: 'folk_art' }],
  [['craggy gardens', 'craggy'], { poiId: 'craggy' }],
  [['parkway visitor center', 'blue ridge parkway visitor center'], { poiId: 'brp_vc' }],
  [['mission hospital', 'mission', 'the hospital', 'mission health'], { poiName: 'Mission Hospital (main campus' }],
  [['va hospital', 'the va', 'va medical center', 'charles george'], { poiName: 'Charles George VA' }],
  [['ab tech', 'a b tech', 'abtech', 'asheville buncombe technical community college'], { poiName: 'Asheville-Buncombe Technical' }],
  [['montreat college'], { poiName: 'Montreat College' }],
  [['asheville high', 'asheville high school', 'ahs'], { poiName: 'Asheville High' }],
  [['roberson', 'tc roberson', 't c roberson', 'roberson high', 'tc roberson high school'], { poiName: 'Roberson High' }],
  [['reynolds high', 'ac reynolds', 'a c reynolds', 'reynolds high school'], { poiName: 'Reynolds High' }],
  [['erwin high', 'erwin high school', 'clyde a erwin'], { poiName: 'Erwin High' }],
  [['enka high', 'enka high school'], { poiName: 'Enka High' }],
  [['owen high', 'owen high school'], { poiName: 'Owen High' }],
  [['north buncombe high', 'north buncombe high school'], { poiName: 'North Buncombe High' }],
  [['sila', 'school of inquiry and life sciences'], { poiName: 'School of Inquiry and Life Sciences' }],
  [['asheville middle', 'asheville middle school'], { poiName: 'Asheville Middle' }],
  // Parts of Asheville that have no official edges; the label sits at a point people would agree on.
  [['north asheville'], { point: [-900, -4600], name: 'North Asheville', area: 2200 }],
  [['south asheville'], { point: [2300, 9500], name: 'South Asheville', area: 3000 }],
  [['east asheville'], { point: [5600, 300], name: 'East Asheville', area: 2200 }],
  [['west asheville'], { point: [-4300, 1100], name: 'West Asheville', area: 2200 }],
  [['montford'], { point: [-1500, -1100], name: 'Montford', area: 900 }],
  [['south slope'], { point: [-150, 750], name: 'South Slope', area: 500 }],
  [['shiloh'], { point: [2070, 5650], name: 'Shiloh', area: 900 }],
  [['east end', 'the block'], { point: [650, 250], name: 'East End', area: 500 }],
  [['southside'], { point: [-200, 1700], name: 'Southside', area: 800 }],
  [['enka candler', 'enka', 'candler'], { point: [-10500, 5300], name: 'Enka-Candler', area: 3500 }],
  [['arden'], { point: [1500, 13800], name: 'Arden', area: 2600 }],
  [['leicester'], { point: [-13500, -6800], name: 'Leicester', area: 4000 }],
  [['skyland'], { point: [1900, 10900], name: 'Skyland', area: 2000 }],
  [['oakley'], { point: [3700, 3600], name: 'Oakley', area: 1100 }],
  [['haw creek'], { point: [6100, -700], name: 'Haw Creek', area: 1600 }],
  [['kenilworth'], { point: [1500, 1800], name: 'Kenilworth', area: 900 }],
];

const ROAD_ALIASES = [
  [['i 26', 'i26', 'interstate 26'], 'I 26', 'I-26'],
  [['i 40', 'i40', 'interstate 40'], 'I 40', 'I-40'],
  [['i 240', 'i240', 'interstate 240'], 'I 240', 'I-240'],
  [['blue ridge parkway', 'the parkway', 'parkway'], 'Blue Ridge Parkway', 'the Blue Ridge Parkway'],
  [['hendersonville road', 'hendersonville rd'], 'Hendersonville Road', 'Hendersonville Road'],
  [['patton avenue', 'patton ave', 'patton'], 'Patton Avenue', 'Patton Avenue'],
  [['merrimon avenue', 'merrimon ave', 'merrimon'], 'Merrimon Avenue', 'Merrimon Avenue'],
  [['tunnel road', 'tunnel rd'], 'Tunnel Road', 'Tunnel Road'],
  [['brevard road', 'brevard rd'], 'Brevard Road', 'Brevard Road'],
  [['haywood road', 'haywood rd'], 'Haywood Road', 'Haywood Road'],
  [['sweeten creek road', 'sweeten creek rd', 'sweeten creek'], 'Sweeten Creek Road', 'Sweeten Creek Road'],
  [['biltmore avenue', 'biltmore ave'], 'Biltmore Avenue', 'Biltmore Avenue'],
  [['charlotte street', 'charlotte st'], 'Charlotte Street', 'Charlotte Street'],
  [['broadway', 'broadway street'], 'Broadway', 'Broadway'],
  [['long shoals road', 'long shoals rd', 'long shoals'], 'Long Shoals Road', 'Long Shoals Road'],
  [['smokey park highway', 'smoky park highway', 'smokey park hwy'], 'Smokey Park Highway', 'Smokey Park Highway'],
  [['leicester highway', 'leicester hwy'], 'Leicester Highway', 'Leicester Highway'],
  [['airport road', 'airport rd'], 'Airport Road', 'Airport Road'],
  [['fairview road', 'fairview rd'], 'Fairview Road', 'Fairview Road'],
  [['riverside drive', 'riverside dr'], 'Riverside Drive', 'Riverside Drive'],
  [['college street', 'college st'], 'College Street', 'College Street'],
  [['weaverville highway', 'weaverville hwy', 'weaverville road'], 'Weaverville', 'Weaverville Highway'],
  [['bowen bridge', 'jeff bowen bridge', 'smoky park bridge'], 'I 240', 'the Bowen Bridge (I-240)'],
];

const KIND_WORD = {
  school: 'school', college: 'college', hospital: 'hospital', fire: 'fire station', ems: 'EMS base', police: 'police station', venue: 'landmark',
  town: 'town', hood: 'area', road: 'road',
};

export class Gazetteer {
  /**
   * @param data   WorldData (pois, areas, roads)
   * @param places data/places.json
   */
  constructor(data, places) {
    this.data = data;
    this.places = places;
    this.entries = []; // {key, ent}
    this.byKey = new Map();
    const net = data.roads;
    const nodeAt = (x, z) => net.nearestNode(x, z, (i) => net.nodeRank[i] >= 1);
    const add = (keys, ent) => {
      for (const k of keys) {
        const key = norm(k);
        if (!key || this.byKey.has(key)) continue;
        this.byKey.set(key, ent);
        this.entries.push({ key, ent });
      }
    };

    // Towns with exact Census blocks. Their label point comes from the map label of the same name, else the block centroid.
    const blockXY = this.blockCenters();
    const label = new Map(data.pois.filter((p) => p.kind === 'place').map((p) => [norm(p.name), p]));
    this.towns = places.places.map((pl, i) => {
      const lp = label.get(norm(pl.name));
      let x = 0; let z = 0; let n = 0;
      places.block_place.forEach((t, b) => {
        if (t === i && blockXY.w[b]) { x += blockXY.x[b] * blockXY.w[b]; z += blockXY.z[b] * blockXY.w[b]; n += blockXY.w[b]; }
      });
      const cx = lp ? lp.x : n ? x / n : 0;
      const cz = lp ? lp.z : n ? z / n : 0;
      return { type: 'town', kind: pl.kind, name: pl.name, town: i, x: cx, z: cz, node: nodeAt(cx, cz), official: pl };
    });
    for (const t of this.towns) {
      const keys = [t.name, `${t.name} ${t.kind === 'community' ? '' : t.kind}`, `town of ${t.name}`, `city of ${t.name}`];
      if (t.name === 'Avery Creek') keys.push('averys creek', "avery's creek");
      add(keys, t);
    }
    this.county = { type: 'county', name: 'Buncombe County', x: 0, z: 0, node: nodeAt(0, 0) };
    add(['buncombe county', 'buncombe', 'the county', 'whole county', 'county'], this.county);

    // Nicknames and parts of town.
    const poiById = new Map(data.pois.filter((p) => p.id).map((p) => [p.id, p]));
    for (const [keys, t] of ALIASES) {
      let ent = null;
      if (t.poiId && poiById.has(t.poiId)) ent = this.fromPoi(poiById.get(t.poiId));
      else if (t.poiName) {
        const p = data.pois.find((q) => q.name.startsWith(t.poiName));
        if (p) ent = this.fromPoi(p);
      } else if (t.point) ent = { type: 'hood', name: t.name, x: t.point[0], z: t.point[1], node: nodeAt(t.point[0], t.point[1]), radius: t.area };
      if (ent) add(keys, ent);
    }
    // Schools, colleges, hospitals, landmarks and stations by their full names.
    for (const p of data.pois) {
      if (['school', 'college', 'hospital', 'venue', 'fire', 'ems', 'police'].includes(p.kind)) {
        const ent = this.fromPoi(p);
        const keys = [p.name, p.name.replace(/ \(.*\)$/, '')];
        if (p.kind === 'school') {
          const base = p.name.replace(/ \(.*\)$/, '');
          if (!/school|academy|college|charter|elem$/i.test(base)) keys.push(`${base} school`);
          if (/ Elem$/.test(base)) keys.push(base.replace(/ Elem$/, ' Elementary'));
          if (/Elementary$/.test(base)) keys.push(`${base} school`);
          if (/ (High|Middle)$/.test(base)) keys.push(`${base} school`);
        }
        if (p.kind === 'fire') {
          const m = /Asheville Fire Department Station (\d+)/.exec(p.name);
          if (m) keys.push(`fire station ${m[1]}`, `asheville fire station ${m[1]}`, `station ${m[1]}`);
        }
        add(keys, ent);
      }
    }
    // Map labels: neighborhoods, communities, crossroads.
    for (const p of data.pois) {
      if (p.kind !== 'place' || p.sub === 'city') continue;
      const key = norm(p.name);
      if (this.byKey.has(key)) continue;
      const big = ['town', 'village', 'suburb'].includes(p.sub);
      const ent = { type: 'hood', name: p.name, x: p.x, z: p.z, node: nodeAt(p.x, p.z), radius: big ? 2200 : 1000, outside: OUTSIDE.has(key), needsCue: AMBIGUOUS.has(key),
        minor: AMBIGUOUS.has(key) || ['hamlet', 'locality'].includes(p.sub) };
      add([p.name], ent);
    }
    // Major roads.
    this.roads = [];
    for (const [keys, match, name] of ROAD_ALIASES) {
      const ent = this.roadEntity(match, name);
      if (ent) { this.roads.push(ent); add(keys, ent); }
    }
    this.entries.sort((a, b) => b.key.length - a.key.length);
    // Named points for describing where something is ("near Shiloh").
    this.anchors = [];
    const seen = new Set();
    for (const { ent } of this.entries) {
      // Only names most people in the county would recognize.
      if ((ent.type === 'hood' || ent.type === 'town') && !ent.outside && !ent.minor && !seen.has(ent)) {
        seen.add(ent);
        this.anchors.push(ent);
      }
    }
  }

  fromPoi(p) {
    if (!p._ent) {
      const name = p.id === 'downtown' ? 'downtown Asheville' : p.id === 'biltmore' ? 'Biltmore Estate' : p.name.replace(/ \(.*\)$/, '');
      p._ent = { type: 'poi', kind: p.kind, name, x: p.x, z: p.z, node: p.node, poi: p };
    }
    return p._ent;
  }

  /** A road as a place: its named edges and the middle of its longest stretch. */
  roadEntity(match, name) {
    const net = this.data.roads;
    const edges = [];
    let best = -1;
    for (let e = 0; e < net.edgeCount; e++) {
      const nm = net.names[net.nameId[e]];
      if (!nm) continue;
      const hit = match.startsWith('I ') ? new RegExp(`(^|[ (/])${match}([ )/]|$)`).test(nm) : nm.includes(match);
      if (!hit) continue;
      edges.push(e);
      if (best < 0 || net.len[e] > net.len[best]) best = e;
    }
    if (!edges.length) return null;
    // Center: the edge nearest downtown among the long ones, so "Patton Avenue" lands where people mean.
    let mid = best;
    let d0 = Infinity;
    for (const e of edges) {
      const d = Math.hypot(net.nodeX[net.from[e]], net.nodeZ[net.from[e]]);
      if (d < d0 && net.len[e] > 60) { d0 = d; mid = e; }
    }
    const x = net.nodeX[net.from[mid]];
    const z = net.nodeZ[net.from[mid]];
    return { type: 'road', name, x, z, node: net.from[mid], edges };
  }

  /** Population-weighted centers of every Census block, from the buildings in it. */
  blockCenters() {
    if (this._bc) return this._bc;
    const b = this.data.buildings;
    const n = this.data.areas.block.geoid.length;
    const x = new Float64Array(n); const z = new Float64Array(n); const w = new Float64Array(n);
    for (let i = 0; i < b.count; i++) {
      const k = b.block[i];
      if (k < 0) continue;
      const wt = 1 + b.residents[i];
      x[k] += b.x[i] * wt; z[k] += b.z[i] * wt; w[k] += wt;
    }
    for (let k = 0; k < n; k++) if (w[k]) { x[k] /= w[k]; z[k] /= w[k]; }
    this._bc = { x, z, w };
    return this._bc;
  }

  /**
   * Every place named in a question, longest names first and never overlapping.
   * Returns [{ent, start, end, text}] in reading order. `text` is the normalized question.
   */
  find(question) {
    const text = ` ${norm(question)} `;
    const taken = new Uint8Array(text.length);
    const out = [];
    for (const { key, ent } of this.entries) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(` ${key} `, from);
        if (i < 0) break;
        from = i + 1;
        const s = i + 1;
        const e = s + key.length;
        let free = true;
        for (let k = s; k < e; k++) if (taken[k]) { free = false; break; }
        if (!free) continue;
        if (ent.needsCue && !/\b(in|near|around|at|to|from|of|and|vs|versus|between|or)\s$/.test(text.slice(0, s))) continue;
        if (ent.type === 'county' && key === 'county' && /\b(henderson|madison|haywood|mcdowell|yancey|rutherford)\s$/.test(text.slice(0, s))) continue;
        for (let k = s; k < e; k++) taken[k] = 1;
        out.push({ ent, start: s, end: e, key });
      }
    }
    out.sort((a, b) => a.start - b.start);
    return { text, hits: out, taken };
  }

  /** Exact lookup by a name or nickname. */
  get(name) {
    return this.byKey.get(norm(name)) || null;
  }

  /** "in Shiloh", "1.2 miles north of Leicester": words for where a point is. */
  describe(x, z) {
    let best = null;
    let bd = Infinity;
    for (const a of this.anchors) {
      const d = Math.hypot(a.x - x, a.z - z) - (a.type === 'town' ? 300 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return 'in Buncombe County';
    if (bd < 1100) return best.type === 'town' && best.name === 'Asheville' ? 'in downtown Asheville' : `in ${best.name}`;
    const ang = (Math.atan2(x - best.x, -(z - best.z)) * 180) / Math.PI;
    const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((ang + 360) % 360) / 45) % 8];
    const mi = bd / 1609.34;
    return `${mi < 1 ? 'just' : `about ${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`} ${dir} of ${best.name === 'Asheville' ? 'downtown Asheville' : best.name}`;
  }

  /** The town whose Census blocks contain a point, or null. */
  townAt(x, z, areaAt) {
    const blk = areaAt(x, z).block;
    const t = blk >= 0 ? this.places.block_place[blk] : -1;
    return t >= 0 ? this.towns[t] : null;
  }

  /** Short name for an area: the nearest map label. */
  nameNear(x, z) {
    let best = null;
    let bd = Infinity;
    for (const a of this.anchors) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best && bd < 2500 ? best.name : null;
  }

  kindWord(ent) {
    return ent.type === 'poi' ? KIND_WORD[ent.kind] || 'place' : KIND_WORD[ent.type] || 'place';
  }
}

export { norm };
