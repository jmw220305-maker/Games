// Pure, DOM-free helpers for the UI (formatting, labels, layout maths). Imported by Node tests.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
export const MINUS = '−';

/** 12345 -> "12.345"; -3 -> "−3" (German grouping, typographic minus). */
export function fmtInt(n) {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? MINUS + s : s;
}

/** 1.25 -> "1,25" (German decimal comma, trailing zeros removed). */
export function fmtDec(n, digits = 1) {
  const v = Number.isFinite(n) ? n : 0;
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  const [i, d] = String(Math.abs(r)).split('.');
  const s = fmtInt(Number(i)).replace(MINUS, '') + (d ? ',' + d : '');
  return r < 0 ? MINUS + s : s;
}

/** 0.125 -> "12,5 %" */
export function fmtPct(frac, digits = 1) {
  return `${fmtDec((Number.isFinite(frac) ? frac : 0) * 100, digits)} %`;
}

/** signed percentage delta: 0.2 -> "+20 %", -0.1 -> "−10 %" */
export function fmtSignedPct(frac, digits = 0) {
  const v = Number.isFinite(frac) ? frac : 0;
  const s = fmtDec(Math.abs(v) * 100, digits);
  return `${v >= 0 ? '+' : MINUS}${s} %`;
}

/** seconds -> "m:ss" (or "h:mm:ss") */
export function fmtTime(sec) {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** seconds -> "2 Std. 5 Min." / "4 Min. 12 Sek." */
export function fmtDuration(sec) {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h > 0) return `${h} Std. ${m} Min.`;
  if (m > 0) return `${m} Min. ${s} Sek.`;
  return `${s} Sek.`;
}

/** unix ms -> "10.11.2026, 14:05" */
export function fmtDate(ms, withTime = true) {
  if (!Number.isFinite(ms) || ms <= 0) return '–';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  return withTime ? `${date}, ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

export function plural(n, one, many) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** Turn anything description-like (string, number, function with toString) into a string. */
export function text(v, fallback = '') {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'function') {
    try { const s = String(v); return s.startsWith('function') || s.startsWith('(') ? fallback : s; } catch { return fallback; }
  }
  return String(v);
}

/** Evaluate a desc that may be a function (`desc(level)`) or a string. */
export function descAt(desc, level) {
  if (typeof desc === 'function') {
    try { return text(desc(level)); } catch { return text(desc); }
  }
  return text(desc);
}

// ---------------------------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------------------------
const RARITY_FALLBACK = {
  common: { name: 'Gewöhnlich', color: '#b9b3a8' },
  uncommon: { name: 'Selten', color: '#5fd38d' },
  rare: { name: 'Episch', color: '#6aa9ff' },
  legendary: { name: 'Legendär', color: '#ffb347' },
  curse: { name: 'Fluch', color: '#c04bd6' },
};
export function rarityInfo(rarity, table) {
  const t = table || RARITY_FALLBACK;
  return t[rarity] || RARITY_FALLBACK[rarity] || t.common || RARITY_FALLBACK.common;
}

// ---------------------------------------------------------------------------------------------
// Player stats (fallback labels; meta's STAT_LABELS/formatStatValue win when present)
// ---------------------------------------------------------------------------------------------
// fmt: 'int' flat integer, 'dec' one decimal, 'pct' fraction shown as %, 'mul' multiplier shown as %,
//      'sec' seconds, 'ps' per second. lower: true = smaller is better.
export const STAT_INFO = {
  maxHp: { label: 'Max. Leben', fmt: 'int' },
  regen: { label: 'Regeneration', fmt: 'ps' },
  armor: { label: 'Rüstung', fmt: 'int' },
  dodge: { label: 'Ausweichen', fmt: 'pct' },
  iframes: { label: 'Schutzzeit nach Treffer', fmt: 'sec' },
  lifesteal: { label: 'Lebensraub', fmt: 'pct' },
  thorns: { label: 'Dornen', fmt: 'int' },
  healPower: { label: 'Heilkraft', fmt: 'mul' },
  damage: { label: 'Schaden', fmt: 'mul' },
  fireRate: { label: 'Feuerrate', fmt: 'mul' },
  critChance: { label: 'Krit. Chance', fmt: 'pct' },
  critMult: { label: 'Krit. Schaden', fmt: 'mul' },
  projSpeed: { label: 'Projektiltempo', fmt: 'mul' },
  range: { label: 'Reichweite', fmt: 'mul' },
  projSize: { label: 'Projektilgröße', fmt: 'mul' },
  pierce: { label: 'Durchschlag', fmt: 'int' },
  bounce: { label: 'Abpraller', fmt: 'int' },
  multishot: { label: 'Zusatzprojektile', fmt: 'int' },
  homing: { label: 'Zielsuche', fmt: 'dec' },
  knockback: { label: 'Rückstoß', fmt: 'mul' },
  bossDamage: { label: 'Schaden gegen Bosse', fmt: 'mul' },
  eliteDamage: { label: 'Schaden gegen Elite', fmt: 'mul' },
  burnChance: { label: 'Brandchance', fmt: 'pct' },
  chillChance: { label: 'Kältechance', fmt: 'pct' },
  poisonChance: { label: 'Giftchance', fmt: 'pct' },
  shockChance: { label: 'Schockchance', fmt: 'pct' },
  statusPower: { label: 'Effektstärke', fmt: 'mul' },
  statusDuration: { label: 'Effektdauer', fmt: 'mul' },
  physDamage: { label: 'Physischer Schaden', fmt: 'mul' },
  fireDamage: { label: 'Feuerschaden', fmt: 'mul' },
  frostDamage: { label: 'Frostschaden', fmt: 'mul' },
  poisonDamage: { label: 'Giftschaden', fmt: 'mul' },
  shockDamage: { label: 'Blitzschaden', fmt: 'mul' },
  shadowDamage: { label: 'Schattenschaden', fmt: 'mul' },
  lightDamage: { label: 'Lichtschaden', fmt: 'mul' },
  moveSpeed: { label: 'Lauftempo', fmt: 'int' },
  dashCooldown: { label: 'Sprint-Abklingzeit', fmt: 'sec', lower: true },
  dashCharges: { label: 'Sprintladungen', fmt: 'int' },
  dashDistance: { label: 'Sprintweite', fmt: 'mul' },
  skillCooldown: { label: 'Fertigkeits-Abklingzeit', fmt: 'mul', lower: true },
  skillPower: { label: 'Fertigkeitsstärke', fmt: 'mul' },
  pickupRadius: { label: 'Sammelradius', fmt: 'int' },
  lightRadius: { label: 'Lichtradius', fmt: 'int' },
  luck: { label: 'Glück', fmt: 'dec' },
  xpGain: { label: 'Erfahrung', fmt: 'mul' },
  sparkGain: { label: 'Funkengewinn', fmt: 'mul' },
  ashGain: { label: 'Aschegewinn', fmt: 'mul' },
  shopDiscount: { label: 'Händlerrabatt', fmt: 'pct' },
};

export const STAT_GROUPS = [
  { name: 'Überleben', keys: ['maxHp', 'regen', 'armor', 'dodge', 'iframes', 'lifesteal', 'thorns', 'healPower'] },
  { name: 'Angriff', keys: ['damage', 'fireRate', 'critChance', 'critMult', 'projSpeed', 'range', 'projSize', 'pierce', 'bounce', 'multishot', 'homing', 'knockback', 'bossDamage', 'eliteDamage'] },
  { name: 'Elemente', keys: ['burnChance', 'chillChance', 'poisonChance', 'shockChance', 'statusPower', 'statusDuration', 'physDamage', 'fireDamage', 'frostDamage', 'poisonDamage', 'shockDamage', 'shadowDamage', 'lightDamage'] },
  { name: 'Bewegung & Fertigkeit', keys: ['moveSpeed', 'dashCooldown', 'dashCharges', 'dashDistance', 'skillCooldown', 'skillPower'] },
  { name: 'Schicksal', keys: ['luck', 'pickupRadius', 'lightRadius', 'xpGain', 'sparkGain', 'ashGain', 'shopDiscount'] },
];

export function statLabel(key, labels) {
  const l = labels && labels[key];
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && l.label) return l.label;
  return (STAT_INFO[key] && STAT_INFO[key].label) || key;
}

export function formatStat(key, value) {
  const info = STAT_INFO[key];
  const v = Number.isFinite(value) ? value : 0;
  switch (info ? info.fmt : 'dec') {
    case 'int': return fmtInt(v);
    case 'pct': return fmtPct(v, 1).replace(',0 %', ' %');
    case 'mul': return `${fmtDec(v * 100, 0)} %`;
    case 'sec': return `${fmtDec(v, 2)} s`;
    case 'ps': return `${fmtDec(v, 1)}/s`;
    default: return fmtDec(v, 2);
  }
}

/** -1 worse, 0 same, 1 better than the base value. */
export function statTrend(key, value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base)) return 0;
  const d = value - base;
  if (Math.abs(d) < 1e-6) return 0;
  const lower = STAT_INFO[key] && STAT_INFO[key].lower;
  return (d > 0) !== !!lower ? 1 : -1;
}

/** Human one-liner for a stat modifier `{ stat, add?, mul? }` ("+20 Max. Leben", "+12 % Schaden"). */
export function describeMod(m, labels) {
  if (!m || !m.stat) return '';
  const label = statLabel(m.stat, labels);
  const info = STAT_INFO[m.stat];
  const parts = [];
  if (Number.isFinite(m.add) && m.add !== 0) {
    const sign = m.add > 0 ? '+' : MINUS;
    const a = Math.abs(m.add);
    if (info && (info.fmt === 'pct' || info.fmt === 'mul')) parts.push(`${sign}${fmtDec(a * 100, 1)} % ${label}`);
    else if (info && info.fmt === 'sec') parts.push(`${sign}${fmtDec(a, 2)} s ${label}`);
    else parts.push(`${sign}${fmtDec(a, 1)} ${label}`);
  }
  if (Number.isFinite(m.mul) && m.mul !== 1) parts.push(`${fmtSignedPct(m.mul - 1)} ${label}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Lifetime statistics (Chronik → Statistik)
// ---------------------------------------------------------------------------------------------
export const LIFETIME_STATS = [
  { key: 'runs', label: 'Abstiege' },
  { key: 'wins', label: 'Siege' },
  { key: 'deaths', label: 'Gefallen' },
  { key: 'abandons', label: 'Aufgegeben' },
  { key: 'playTime', label: 'Spielzeit', fmt: 'dur' },
  { key: 'fastestWin', label: 'Schnellster Sieg', fmt: 'time', zero: '–' },
  { key: 'longestRun', label: 'Längster Abstieg', fmt: 'time', zero: '–' },
  { key: 'bestFloor', label: 'Tiefste Ebene', zero: '–' },
  { key: 'highestDifficultyWon', label: 'Höchste bezwungene Glutstufe', neg: '–' },
  { key: 'kills', label: 'Besiegte Gegner' },
  { key: 'eliteKills', label: 'Besiegte Elitegegner' },
  { key: 'bossKills', label: 'Besiegte Bosse' },
  { key: 'bestKills', label: 'Meiste Gegner in einem Abstieg' },
  { key: 'bestLevel', label: 'Höchste Stufe' },
  { key: 'bestHit', label: 'Härtester Treffer' },
  { key: 'damageDealt', label: 'Verursachter Schaden' },
  { key: 'damageTaken', label: 'Erlittener Schaden' },
  { key: 'healed', label: 'Geheiltes Leben' },
  { key: 'critHits', label: 'Kritische Treffer' },
  { key: 'dashes', label: 'Sprints' },
  { key: 'roomsCleared', label: 'Gesäuberte Räume' },
  { key: 'floorsCleared', label: 'Bezwungene Ebenen' },
  { key: 'totalSparks', label: 'Gesammelte Funken' },
  { key: 'sparksSpent', label: 'Ausgegebene Funken' },
  { key: 'purchases', label: 'Einkäufe beim Händler' },
  { key: 'ashSpent', label: 'Am Altar geopferte Asche' },
  { key: 'relicsFound', label: 'Gefundene Relikte' },
  { key: 'cursesTaken', label: 'Erlittene Flüche' },
  { key: 'boonsChosen', label: 'Gewählte Segen' },
  { key: 'weaponsFound', label: 'Gefundene Waffen' },
  { key: 'levelUps', label: 'Stufenaufstiege' },
  { key: 'chests', label: 'Geöffnete Truhen' },
  { key: 'shrines', label: 'Besuchte Schreine' },
  { key: 'barrels', label: 'Zerschlagene Fässer' },
  { key: 'falls', label: 'Stürze in die Tiefe' },
  { key: 'revives', label: 'Aus der Asche erhoben' },
];

export function formatLifetime(entry, value) {
  const v = Number.isFinite(value) ? value : 0;
  if (entry.neg && v < 0) return entry.neg;
  if (entry.zero && v === 0) return entry.zero;
  if (entry.fmt === 'time') return fmtTime(v);
  if (entry.fmt === 'dur') return fmtDuration(v);
  return fmtInt(v);
}

// ---------------------------------------------------------------------------------------------
// Minimap layout
// ---------------------------------------------------------------------------------------------
/**
 * Lay out the seen rooms of a floor on a grid.
 * @returns {{ cols, rows, minGx, minGy, cells: Array<{id,gx,gy,col,row,type,visited,cleared,current}>, links: Array<{a,b,dir}> }}
 */
export function mapLayout(rooms, currentId, opts = {}) {
  const list = Array.isArray(rooms) ? rooms : [];
  const show = (r) => r && (opts.all || r.seen || r.visited || r.id === currentId);
  const cells = [];
  let minGx = Infinity, minGy = Infinity, maxGx = -Infinity, maxGy = -Infinity;
  for (const r of list) {
    if (!show(r) || !Number.isFinite(r.gx) || !Number.isFinite(r.gy)) continue;
    minGx = Math.min(minGx, r.gx); minGy = Math.min(minGy, r.gy);
    maxGx = Math.max(maxGx, r.gx); maxGy = Math.max(maxGy, r.gy);
    cells.push({ id: r.id, gx: r.gx, gy: r.gy, type: r.type || 'combat', visited: !!r.visited, cleared: !!r.cleared, current: r.id === currentId });
  }
  if (!cells.length) return { cols: 0, rows: 0, minGx: 0, minGy: 0, cells, links: [] };
  for (const c of cells) { c.col = c.gx - minGx; c.row = c.gy - minGy; }
  const byId = new Map(cells.map((c) => [c.id, c]));
  const links = [];
  for (const r of list) {
    if (!byId.has(r.id) || !r.doors) continue;
    for (const dir of ['e', 's']) {
      const d = r.doors[dir];
      if (d && byId.has(d.to)) links.push({ a: r.id, b: d.to, dir });
    }
    // n / w links whose partner does not list the reverse door (defensive)
    for (const dir of ['n', 'w']) {
      const d = r.doors[dir];
      if (!d || !byId.has(d.to)) continue;
      const o = list[d.to] && list[d.to].id === d.to ? list[d.to] : list.find((x) => x && x.id === d.to);
      const back = o && o.doors && o.doors[dir === 'n' ? 's' : 'e'];
      if (!back || back.to !== r.id) links.push({ a: d.to, b: r.id, dir: dir === 'n' ? 's' : 'e' });
    }
  }
  return { cols: maxGx - minGx + 1, rows: maxGy - minGy + 1, minGx, minGy, cells, links };
}

export const ROOM_ICON = {
  start: { shape: 'flame', color: '#ffb347', name: 'Feuerstelle' },
  boss: { shape: 'skull', color: '#ff4d3d', name: 'Boss' },
  treasure: { shape: 'chest', color: '#ffd35a', name: 'Schatz' },
  shop: { shape: 'coin', color: '#ffcf5a', name: 'Händler' },
  shrine: { shape: 'diamond', color: '#c9a0ff', name: 'Schrein' },
  forge: { shape: 'anvil', color: '#ff8a3c', name: 'Schmiede' },
  rest: { shape: 'cross', color: '#7be08f', name: 'Rastplatz' },
  challenge: { shape: 'x', color: '#ff6a5a', name: 'Prüfung' },
  elite: { shape: 'star', color: '#ff9f5a', name: 'Elite' },
  secret: { shape: 'dot', color: '#9fe8ff', name: 'Geheimraum' },
};

// ---------------------------------------------------------------------------------------------
// Spatial navigation (keyboard / gamepad focus movement)
// ---------------------------------------------------------------------------------------------
/**
 * Pick the best rect in a direction.
 * @param {{x,y,w,h}} from
 * @param {Array<{x,y,w,h}>} rects
 * @param {'up'|'down'|'left'|'right'} dir
 * @returns {number} index into rects or -1
 */
export function pickDirectional(from, rects, dir) {
  const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r || (r.w <= 0 && r.h <= 0)) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const dc = horiz ? (cx - fcx) * sign : (cy - fcy) * sign;
    if (dc <= 1) continue;
    // edge distance along the axis (0 when overlapping)
    let primary;
    if (horiz) primary = sign > 0 ? r.x - (from.x + from.w) : from.x - (r.x + r.w);
    else primary = sign > 0 ? r.y - (from.y + from.h) : from.y - (r.y + r.h);
    primary = Math.max(0, primary);
    // orthogonal gap (0 when the ranges overlap)
    let orth;
    if (horiz) orth = Math.max(0, r.y - (from.y + from.h), from.y - (r.y + r.h));
    else orth = Math.max(0, r.x - (from.x + from.w), from.x - (r.x + r.w));
    const centerOff = horiz ? Math.abs(cy - fcy) : Math.abs(cx - fcx);
    const score = primary + orth * 3 + centerOff * 0.15 + dc * 0.05;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------------------------
/** Smoothly move a displayed counter toward its target (never overshoots). */
export function approach(cur, target, dt, rate = 10) {
  if (!Number.isFinite(cur)) return target;
  const d = target - cur;
  if (Math.abs(d) < 0.5) return target;
  const step = d * Math.min(1, dt * rate);
  const minStep = Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.abs(d) * 0.02)) * Math.min(1, dt * 60);
  return cur + (Math.abs(step) > Math.abs(minStep) ? step : minStep);
}

export const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;

/** The character's stat profile relative to the base stats as 0..1 bars (0.5 = base). */
export function statProfile(stats, base) {
  const rel = (k, invert = false) => {
    const b = base && base[k], v = stats && stats[k];
    if (!Number.isFinite(b) || !Number.isFinite(v) || b === 0) return 0.5;
    let r = v / b;
    if (invert) r = 1 / r;
    return clamp(0.5 + (r - 1) * 1.25, 0.08, 1);
  };
  return [
    { key: 'maxHp', label: 'Leben', value: rel('maxHp') },
    { key: 'damage', label: 'Schaden', value: rel('damage') },
    { key: 'fireRate', label: 'Feuerrate', value: rel('fireRate') },
    { key: 'moveSpeed', label: 'Tempo', value: rel('moveSpeed') },
    { key: 'armor', label: 'Zähigkeit', value: clamp(0.5 + ((stats && stats.armor) || 0) * 0.08 + ((stats && stats.dodge) || 0) * 1.5, 0.08, 1) },
  ];
}

/** Completion ratio helper -> { have, total, pct } */
export function completion(have, total) {
  const t = Math.max(0, total | 0), h = Math.max(0, Math.min(t, have | 0));
  return { have: h, total: t, pct: t ? Math.round((h / t) * 100) : 0 };
}
