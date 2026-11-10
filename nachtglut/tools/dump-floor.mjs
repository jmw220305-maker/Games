#!/usr/bin/env node
// Dump a generated floor as ASCII.
//   node tools/dump-floor.mjs <floorIndex> <seed> [--map] [--type=combat] [--validate]
// --map: only minimap + summary; --type=x: only rooms of that type; --validate: run the §4 validator.
import { generateFloor } from '../src/gen/floorgen.js';
import { validateFloor } from '../src/gen/validate.js';
import { biomeForFloor } from '../src/data/biomes.js';
import { hashString } from '../src/core/rng.js';
import { TILE } from '../src/game/constants.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));
const index = Math.max(1, Math.min(5, parseInt(pos[0] || '1', 10) || 1));
const seedArg = pos[1] ?? '1';
const seed = /^\d+$/.test(seedArg) ? Number(seedArg) >>> 0 : hashString(seedArg);
const typeFilter = [...flags].find((f) => f.startsWith('--type='))?.slice(7);

const LETTER = { start: 'S', boss: 'B', combat: 'c', elite: 'E', treasure: 'T', shop: '$', shrine: 'H', forge: 'F', rest: 'R', challenge: 'X', secret: '?' };
const TILE_CH = { [TILE.FLOOR]: '.', [TILE.WALL]: '#', [TILE.PIT]: 'o', [TILE.DOOR]: '+', [TILE.SPIKES]: '^', [TILE.HAZARD]: '~', [TILE.ICE]: '=', [TILE.VOID]: ' ' };
const PROP_CH = {
  chest: (p) => (p.locked ? 'L' : p.tier === 'cursed' ? 'K' : 'C'), pedestal: () => 'P', shrine: () => 'S', forge: () => 'F', fountain: () => 'Q',
  barrel: (p) => (p.explosive ? 'x' : 'b'), crystal: () => '*', torch: () => 't', statue: (p) => (p.role === 'merchant' ? 'M' : 'T'),
  bones: () => 'z', stalagmite: () => 'A', mushroom: () => 'm', portal: () => 'O',
};

const t0 = performance.now();
const biome = biomeForFloor(index);
const floor = generateFloor({ index, biome, seed });
const ms = performance.now() - t0;

// minimap: each grid cell = 3-char label + 1 connector column; rows alternate rooms / vertical links
const W = floor.gridW * 4, H = floor.gridH * 2;
const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
for (const r of floor.rooms) {
  const label = (LETTER[r.type] + r.id).padEnd(3, ' ');
  for (let k = 0; k < 3; k++) grid[r.gy * 2][r.gx * 4 + k] = label[k];
  if (r.doors.e) grid[r.gy * 2][r.gx * 4 + 3] = '-';
  if (r.doors.s) grid[r.gy * 2 + 1][r.gx * 4] = '|';
}
console.log(`Floor ${index} (${biome.id}) seed ${seed} — ${floor.rooms.length} rooms, generated in ${ms.toFixed(1)} ms`);
console.log('S start  B boss  c combat  E elite  T treasure  $ shop  H shrine  F forge  R rest  X challenge  ? secret\n');
console.log(grid.map((row) => '  ' + row.join('').trimEnd()).join('\n'));
console.log('');

if (!flags.has('--map')) {
  for (const r of floor.rooms) {
    if (typeFilter && r.type !== typeFilter) continue;
    const doors = Object.entries(r.doors).map(([s, d]) => `${s}->${d.to}${d.secret ? '(secret)' : ''}`).join(' ');
    const nEnemies = r.spawns.reduce((a, wv) => a + wv.entries.length, 0);
    console.log(`#${r.id} ${r.type.toUpperCase()} depth ${r.depth} ${r.w}x${r.h} shape=${r.shape} layout=${r.layout} doors: ${doors}`);
    if (r.spawns.length) {
      console.log(`   waves: ${r.spawns.map((wv, k) => `${k + 1}[${wv.delay}s] ` + summarize(wv.entries)).join(' | ')}  (${nEnemies} enemies)`);
    }
    const chars = [];
    for (let y = 0; y < r.h; y++) {
      const row = [];
      for (let x = 0; x < r.w; x++) row.push(TILE_CH[r.tiles[y * r.w + x]] ?? '?');
      chars.push(row);
    }
    r.spawns.forEach((wv, k) => {
      for (const e of wv.entries) if (/[.=]/.test(chars[e.ty][e.tx])) chars[e.ty][e.tx] = e.elite ? 'e' : String(Math.min(9, k + 1));
    });
    for (const p of r.props) chars[p.ty][p.tx] = (PROP_CH[p.kind] || (() => '%'))(p);
    if (r.playerStart) chars[r.playerStart.ty][r.playerStart.tx] = '@';
    console.log(chars.map((row) => '   ' + row.join('')).join('\n'));
    console.log('');
  }
  console.log('props: C chest K cursed L locked P pedestal S shrine F forge Q fountain b barrel x explosive * crystal t torch');
  console.log('       T statue M merchant z bones A stalagmite m mushroom @ start; digits = wave, e = elite spawn\n');
}

function summarize(entries) {
  const m = {};
  for (const e of entries) m[e.id + (e.elite ? `*${e.elite}` : '')] = (m[e.id + (e.elite ? `*${e.elite}` : '')] || 0) + 1;
  return Object.entries(m).map(([k, v]) => `${v}x${k}`).join(', ');
}

const types = {};
const enemies = {};
let elites = 0;
for (const r of floor.rooms) {
  types[r.type] = (types[r.type] || 0) + 1;
  for (const wv of r.spawns) for (const e of wv.entries) { enemies[e.id] = (enemies[e.id] || 0) + 1; if (e.elite) elites++; }
}
console.log('rooms by type:', Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('enemies:', Object.entries(enemies).map(([k, v]) => `${k} ${v}`).join(', '), `| total ${Object.values(enemies).reduce((a, b) => a + b, 0)}, elites ${elites}`);
if (flags.has('--validate')) {
  const errs = validateFloor(floor, biome);
  console.log(errs.length ? `INVALID:\n  ${errs.join('\n  ')}` : 'valid ✓');
}
