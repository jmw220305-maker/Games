// Validators for the §4 floor guarantees. Used by the generator (self-check) and by tests/dungeon.test.js.
// Each returns a list of human-readable error strings (empty = valid).
import { TILE, ROOM_TYPES } from '../game/constants.js';
import { BIOMES } from '../data/biomes.js';
import { SIDES, doorCells, doorInfo, laneRect, chebField, flood, isWalkable, isDanger } from './util.js';

const { FLOOR, WALL, DOOR, VOID } = TILE;
const TILE_VALUES = new Set(Object.values(TILE));
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const DELTA = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const FIGHT = new Set(['combat', 'elite', 'challenge']);
const PROP_KINDS = new Set(['chest', 'pedestal', 'shrine', 'forge', 'fountain', 'portal', 'barrel', 'crystal', 'torch', 'statue', 'bones', 'stalagmite', 'mushroom']);

export const LIMITS = Object.freeze({ minW: 13, maxW: 40, minH: 11, maxH: 28, bossMinW: 25, bossMinH: 19, minOpen: 0.55 });

/** Validate one room. opts: { biome (object) } */
export function validateRoom(room, opts = {}) {
  const errs = [];
  const E = (m) => errs.push(`room ${room.id} (${room.type}): ${m}`);
  const { w, h, tiles } = room;
  if (!ROOM_TYPES.includes(room.type)) E(`unknown type ${room.type}`);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < LIMITS.minW || w > LIMITS.maxW || h < LIMITS.minH || h > LIMITS.maxH) E(`bad size ${w}x${h}`);
  if (!(tiles instanceof Uint8Array) || tiles.length !== w * h) { E('tiles must be Uint8Array(w*h)'); return errs; }
  for (let i = 0; i < tiles.length; i++) if (!TILE_VALUES.has(tiles[i])) { E(`bad tile value ${tiles[i]}`); break; }

  // border: only WALL / VOID / DOOR; walkable tiles must be enclosed (no VOID in their 8-neighbourhood)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (border && t !== WALL && t !== VOID && t !== DOOR) { E(`non-wall tile on border at ${x},${y}`); return errs; }
      if (isWalkable(t) || t === TILE.PIT) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (tiles[(y + dy) * w + x + dx] === VOID) { E(`open tile ${x},${y} touches VOID`); return errs; }
        }
      }
    }
  }

  // doors
  let doorTileCount = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === DOOR) doorTileCount++;
  let listed = 0;
  for (const side of SIDES) {
    const d = room.doors[side];
    if (!d) continue;
    listed += 2;
    if (!Number.isInteger(d.to)) E(`door ${side} has no target`);
    const edgeOk = side === 'n' ? d.ty === 0 : side === 's' ? d.ty === h - 1 : side === 'w' ? d.tx === 0 : d.tx === w - 1;
    if (!edgeOk) E(`door ${side} not on its border (${d.tx},${d.ty})`);
    const cells = doorCells(side, d);
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] !== DOOR) E(`door ${side} tile ${x},${y} is not DOOR`);
    }
    const along = side === 'n' || side === 's';
    const flank = along ? [[d.tx - 1, d.ty], [d.tx + 2, d.ty]] : [[d.tx, d.ty - 1], [d.tx, d.ty + 2]];
    for (const [x, y] of flank) if (tiles[y * w + x] !== WALL) E(`door ${side} flank ${x},${y} is not WALL`);
    const [ax, ay, bx, by] = laneRect(side, d, w, h, 3, 0);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (tiles[y * w + x] !== FLOOR) E(`door ${side} approach ${x},${y} is not FLOOR`);
    }
  }
  if (doorTileCount !== listed) E(`DOOR tile count ${doorTileCount} != listed ${listed}`);
  if (!listed) E('room has no doors');

  // reachability from every door
  const { cells: dcells, entrances } = doorInfo(room);
  let walk = 0;
  for (let i = 0; i < tiles.length; i++) if (isWalkable(tiles[i])) walk++;
  for (const side of SIDES) {
    const d = room.doors[side];
    if (!d) continue;
    const ent = entrances.filter(([x, y]) => (side === 'n' ? y === 1 : side === 's' ? y === h - 2 : side === 'w' ? x === 1 : x === w - 2)
      && doorCells(side, d).some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1));
    const { count } = flood(tiles, w, h, ent);
    if (count !== walk) E(`only ${count}/${walk} walkable tiles reachable from door ${side}`);
  }

  // no hazards near doors / player start
  const dd = chebField(w, h, dcells);
  const ps = room.playerStart;
  const sd = ps ? chebField(w, h, [[ps.tx, ps.ty]]) : null;
  for (let i = 0; i < tiles.length; i++) {
    if (!isDanger(tiles[i])) continue;
    if (dd[i] <= 2) { E(`hazard/spikes/ice within 2 of a door at ${i % w},${(i / w) | 0}`); break; }
    if (sd && sd[i] <= 2) { E('hazard near player start'); break; }
  }

  // open space
  let interior = 0, open = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const t = tiles[y * w + x];
    if (t === VOID) continue;
    if (t === WALL) {
      let shell = false;
      for (let dy = -1; dy <= 1 && !shell; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1 || tiles[ny * w + nx] === VOID) { shell = true; break; }
      }
      if (shell) continue;
    }
    interior++;
    if (t === FLOOR || t === TILE.ICE) open++;
  }
  if (interior && open / interior < LIMITS.minOpen) E(`only ${(100 * open / interior).toFixed(0)}% open interior`);

  // props
  const occ = new Uint8Array(w * h);
  for (const p of room.props) {
    if (!PROP_KINDS.has(p.kind)) E(`unknown prop kind ${p.kind}`);
    if (!Number.isInteger(p.tx) || !Number.isInteger(p.ty) || p.tx < 0 || p.ty < 0 || p.tx >= w || p.ty >= h) { E(`prop ${p.kind} out of bounds`); continue; }
    const i = p.ty * w + p.tx;
    if (tiles[i] !== FLOOR) E(`prop ${p.kind} at ${p.tx},${p.ty} not on FLOOR`);
    if (dd[i] <= 3) E(`prop ${p.kind} at ${p.tx},${p.ty} within 3 of a door`);
    if (occ[i]) E(`two props on ${p.tx},${p.ty}`);
    occ[i] = 1;
    if (p.kind === 'chest' && !['common', 'rare', 'cursed'].includes(p.tier)) E('chest without valid tier');
    if (p.kind === 'pedestal' && (!['relic', 'weapon', 'heal', 'boon', 'random'].includes(p.offer) || (p.price !== 'auto' && p.price !== 0))) E('bad pedestal');
  }
  let occWalk = 0;
  for (let i = 0; i < tiles.length; i++) if (occ[i] && isWalkable(tiles[i])) occWalk++;
  const withProps = flood(tiles, w, h, entrances, occ);
  // from every door on its own (a flood from all doors at once misses props that split the room in two)
  for (const side of SIDES) {
    const d = room.doors[side];
    if (!d) continue;
    const ent = entrances.filter(([x, y]) => doorCells(side, d).some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1));
    const fromDoor = flood(tiles, w, h, ent, occ);
    if (fromDoor.count !== walk - occWalk) { E(`props block paths from door ${side} (${fromDoor.count}/${walk - occWalk} reachable)`); break; }
  }
  if (ps) {
    if (tiles[ps.ty * w + ps.tx] !== FLOOR) E('playerStart not on FLOOR');
    if (occ[ps.ty * w + ps.tx]) E('prop on playerStart');
  }

  // spawns
  const biome = opts.biome;
  const ids = biome ? new Set(biome.enemies.map((e) => e.id)) : null;
  if (!Array.isArray(room.spawns)) E('spawns must be an array');
  for (const wave of room.spawns) {
    if (typeof wave.delay !== 'number' || wave.delay < 0) E('wave delay invalid');
    if (!wave.entries.length) E('empty wave');
    for (const e of wave.entries) {
      const i = e.ty * w + e.tx;
      if (!Number.isInteger(e.tx) || !Number.isInteger(e.ty) || e.tx < 0 || e.ty < 0 || e.tx >= w || e.ty >= h) { E('spawn out of bounds'); continue; }
      if (tiles[i] !== FLOOR) E(`spawn ${e.id} at ${e.tx},${e.ty} not on FLOOR`);
      if (dd[i] <= 3) E(`spawn ${e.id} at ${e.tx},${e.ty} within 3 of a door`);
      if (occ[i]) E(`spawn ${e.id} on a prop`);
      if (!withProps.seen[i]) E(`spawn ${e.id} unreachable`);
      if (e.elite !== undefined && !(Number.isInteger(e.elite) && e.elite >= 1)) E('bad elite value');
      if (ids && room.type !== 'boss' && !ids.has(e.id)) E(`enemy ${e.id} not in biome roster`);
    }
  }

  // type rules
  const doorCount = SIDES.filter((s) => room.doors[s]).length;
  if (room.type === 'boss') {
    if (w < LIMITS.bossMinW || h < LIMITS.bossMinH) E(`boss arena too small ${w}x${h}`);
    if (doorCount !== 1) E('boss room must have exactly one door');
    if (room.spawns.length !== 1 || room.spawns[0].entries.length !== 1) E('boss room must have one wave with one entry');
    else if (biome && room.spawns[0].entries[0].id !== biome.boss) E('boss id mismatch');
    if (room.props.some((p) => p.kind !== 'torch')) E('boss room may only hold torches');
  } else if (FIGHT.has(room.type)) {
    if (!room.spawns.length) E('fight room without spawns');
  } else if (room.spawns.length) E('non-combat room with spawns');
  if (room.type === 'start' && !ps) E('start room without playerStart');
  if (room.type !== 'start' && ps) E('playerStart outside the start room');
  const torches = room.props.filter((p) => p.kind === 'torch').length;
  if (torches < 2) E(`only ${torches} torches`);
  return errs;
}

/** Validate a whole floor (graph + quotas + every room). */
export function validateFloor(floor, biomeArg) {
  const errs = [];
  const E = (m) => errs.push(m);
  const biome = biomeArg || BIOMES[floor.biome];
  const rooms = floor.rooms;
  if (!Array.isArray(rooms) || !rooms.length) return ['no rooms'];
  const cells = new Set();
  rooms.forEach((r, i) => {
    if (r.id !== i) E(`rooms[${i}].id = ${r.id}`);
    const k = `${r.gx},${r.gy}`;
    if (cells.has(k)) E(`duplicate grid cell ${k}`);
    cells.add(k);
  });
  // doors symmetric + grid adjacent
  for (const r of rooms) {
    for (const side of SIDES) {
      const d = r.doors[side];
      if (!d) continue;
      const o = rooms[d.to];
      if (!o) { E(`room ${r.id} door ${side} -> missing room ${d.to}`); continue; }
      const back = o.doors[OPP[side]];
      if (!back || back.to !== r.id) E(`door ${r.id}.${side} -> ${o.id} not mirrored`);
      if (o.gx - r.gx !== DELTA[side][0] || o.gy - r.gy !== DELTA[side][1]) E(`door ${r.id}.${side} -> ${o.id} not grid-adjacent`);
    }
  }
  // connectivity + depth
  const start = rooms[floor.startRoomId], boss = rooms[floor.bossRoomId];
  if (!start || start.type !== 'start') E('startRoomId does not point at the start room');
  if (!boss || boss.type !== 'boss') E('bossRoomId does not point at the boss room');
  const dist = new Array(rooms.length).fill(-1);
  if (start) {
    dist[start.id] = 0;
    const q = [start.id];
    for (let k = 0; k < q.length; k++) {
      const r = rooms[q[k]];
      for (const s of SIDES) {
        const d = r.doors[s];
        if (d && rooms[d.to] && dist[d.to] < 0) { dist[d.to] = dist[r.id] + 1; q.push(d.to); }
      }
    }
  }
  for (const r of rooms) {
    if (dist[r.id] < 0) E(`room ${r.id} unreachable`);
    else if (r.depth !== dist[r.id]) E(`room ${r.id} depth ${r.depth} != ${dist[r.id]}`);
  }
  if (boss && Math.max(...dist) > dist[boss.id]) E('boss is not the farthest room');
  // quotas
  const count = {};
  for (const r of rooms) count[r.type] = (count[r.type] || 0) + 1;
  const c = (t) => count[t] || 0;
  if (c('start') !== 1) E(`start count ${c('start')}`);
  if (c('boss') !== 1) E(`boss count ${c('boss')}`);
  if (c('shop') !== 1) E(`shop count ${c('shop')}`);
  if (c('treasure') < 1 || c('treasure') > 2) E(`treasure count ${c('treasure')}`);
  if (c('forge') > 1) E(`forge count ${c('forge')}`);
  if (c('rest') !== 1) E(`rest count ${c('rest')}`);
  if (c('challenge') > 1) E(`challenge count ${c('challenge')}`);
  if (c('secret') > 1) E(`secret count ${c('secret')}`);
  if (c('elite') < 1 || c('elite') > 2) E(`elite count ${c('elite')}`);
  if (floor.index < 5) {
    if (c('shrine') < 1 || c('shrine') > 2) E(`shrine count ${c('shrine')}`);
    if (floor.index >= 2 && c('forge') !== 1) E('forge missing');
  }
  if (start) {
    for (const s of SIDES) {
      const d = start.doors[s];
      if (d && rooms[d.to] && rooms[d.to].type !== 'combat') E(`room next to start is ${rooms[d.to].type}`);
    }
    if (start.spawns.length) E('start room has spawns');
  }
  for (const r of rooms) {
    if (r.type === 'secret') {
      if (r.secret !== true) E('secret room without secret flag');
      if (SIDES.filter((s) => r.doors[s]).length !== 1) E('secret room is not a dead end');
    }
    if (r.type === 'rest' && boss && r.depth < Math.ceil(dist[boss.id] / 2)) E('rest room in the first half');
    for (const m of validateRoom(r, { biome })) E(m);
  }
  return errs;
}
