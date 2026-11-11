// Floor graph: room counts / type quotas (plan), grid layout (main path + branches + loops) and room types.
import { DIRS } from '../game/constants.js';

const DIR_KEYS = ['n', 'e', 's', 'w'];
const ck = (x, y) => (x + 1024) * 4096 + (y + 1024);

/** Which non-combat rooms want to be dead ends. */
const LEAFY = new Set(['shop', 'treasure', 'shrine', 'forge', 'secret']);

/**
 * Decide room count and the type quota for a floor.
 * returns { index, gauntlet, N, mainLen, specials: string[] (non-combat + elite/challenge), loops, startBranch, desiredLeaves, seq? }
 */
export function planFloor(rng, index) {
  if (index >= 5) return planGauntlet(rng, index);
  const lo = 8 + index, hi = 10 + index; // 1: 9-11, 2: 10-12, 3: 11-13, 4: 12-14
  let N = rng.int(lo, hi);
  const nonFight = ['shop', 'treasure', 'shrine', 'rest'];
  if (index >= 2 || rng.chance(0.5)) nonFight.push('forge');
  const minFights = index <= 2 ? 4 : 5; // combat + elite + challenge (incl. the start-adjacent room)
  N = Math.max(N, 2 + nonFight.length + minFights);
  const optional = [];
  if (rng.chance(0.3)) optional.push('treasure');
  if (rng.chance(0.3)) optional.push('shrine');
  if (rng.chance(0.5)) optional.push('secret');
  rng.shuffle(optional);
  for (const t of optional) {
    if (N - 2 - nonFight.length - 1 >= minFights) nonFight.push(t);
    else if (N <= hi && rng.chance(0.5)) { N++; nonFight.push(t); }
  }
  const fightRooms = N - 2 - nonFight.length;
  const fights = ['elite'];
  if (rng.chance(index >= 3 ? 0.55 : index === 2 ? 0.25 : 0.15) && fightRooms - fights.length - 1 >= 3) fights.push('elite');
  if (rng.chance(index === 1 ? 0.35 : 0.6) && fightRooms - fights.length - 1 >= 2) fights.push('challenge');
  const mainLen = Math.max(5, Math.min(9, Math.round(N * 0.5) + rng.int(-1, 1)));
  const loops = index === 1 ? (rng.chance(0.5) ? 1 : 0) : index === 2 ? 1 : rng.int(1, 2);
  const desiredLeaves = nonFight.filter((t) => LEAFY.has(t)).length;
  return {
    index, gauntlet: false, N, mainLen, specials: [...nonFight, ...fights], loops,
    startBranch: rng.chance(0.35), desiredLeaves,
    lenWeights: [{ len: 1, weight: 6 }, { len: 2, weight: 3 }, { len: 3, weight: 1 }],
  };
}

/** Final floor: start -> 3-4 hard rooms (+ rest in the second half) -> boss, with shop + treasure as side rooms. */
function planGauntlet(rng, index) {
  const hard = rng.int(3, 4);
  const seq = new Array(hard).fill('combat');
  seq[hard - 1] = 'elite';
  if (rng.chance(0.5)) seq[rng.int(1, hard - 2)] = 'elite';
  const restPos = rng.int(Math.ceil(hard / 2), hard - 1);
  seq.splice(restPos, 0, 'rest');
  const mainLen = seq.length + 2;
  return {
    index, gauntlet: true, N: mainLen + 2, mainLen, seq, specials: ['shop', 'treasure'], loops: 0,
    startBranch: false, desiredLeaves: 2, mainAnchorsOnly: true,
    lenWeights: [{ len: 1, weight: 1 }],
  };
}

class Grid {
  constructor() { this.nodes = []; this.cells = new Map(); }
  add(gx, gy, main, depth) {
    const id = this.nodes.length;
    this.nodes.push({ id, gx, gy, main, adj: [], depth });
    this.cells.set(ck(gx, gy), id);
    return id;
  }
  at(gx, gy) { const v = this.cells.get(ck(gx, gy)); return v === undefined ? -1 : v; }
  free(gx, gy) { return !this.cells.has(ck(gx, gy)); }
  link(a, b) { this.nodes[a].adj.push(b); this.nodes[b].adj.push(a); }
  unlink(a, b) {
    const A = this.nodes[a].adj, B = this.nodes[b].adj;
    A.splice(A.indexOf(b), 1); B.splice(B.indexOf(a), 1);
  }
  linked(a, b) { return this.nodes[a].adj.includes(b); }
  occupied(gx, gy) {
    let c = 0;
    for (const d of DIR_KEYS) if (!this.free(gx + DIRS[d].dx, gy + DIRS[d].dy)) c++;
    return c;
  }
  freeDirs(n) {
    const out = [];
    for (const d of DIR_KEYS) if (this.free(n.gx + DIRS[d].dx, n.gy + DIRS[d].dy)) out.push(d);
    return out;
  }
  bfs(from) {
    const dist = new Array(this.nodes.length).fill(-1);
    dist[from] = 0;
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      const a = q[h];
      for (const b of this.nodes[a].adj) if (dist[b] < 0) { dist[b] = dist[a] + 1; q.push(b); }
    }
    return dist;
  }
  leafCount(bossId) {
    let c = 0;
    for (const n of this.nodes) if (n.id !== 0 && n.id !== bossId && n.adj.length === 1) c++;
    return c;
  }
}

function tryBuild(rng, spec) {
  const g = new Grid();
  const M = spec.mainLen;
  const straight = spec.gauntlet ? 2.6 : 1.6;
  let x = 0, y = 0, prev = rng.pick(DIR_KEYS);
  g.add(0, 0, true, 0);
  for (let i = 1; i < M - 1; i++) {
    const opts = [];
    for (const d of DIR_KEYS) {
      const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
      if (!g.free(nx, ny)) continue;
      if (i === M - 2 && !g.free(nx, ny - 1)) continue; // boss sits north of the last main room
      let weight = d === prev ? straight : 1;
      if (g.occupied(nx, ny) > 1) weight *= 0.15;
      opts.push({ d, nx, ny, weight });
    }
    if (!opts.length) return null;
    const o = rng.weighted(opts);
    const id = g.add(o.nx, o.ny, true, i);
    g.link(id - 1, id);
    x = o.nx; y = o.ny; prev = o.d;
  }
  if (!g.free(x, y - 1)) return null;
  const bossId = g.add(x, y - 1, true, M - 1);
  g.link(bossId - 1, bossId);
  const bossDepth = M - 1;
  const boss = g.nodes[bossId];
  const nearBoss = (gx, gy) => Math.abs(gx - boss.gx) + Math.abs(gy - boss.gy) === 1;

  // side branches
  let remaining = spec.N - M;
  let guard = 0;
  while (remaining > 0) {
    if (++guard > 300) return null;
    const needLeaves = Math.max(0, spec.desiredLeaves - g.leafCount(bossId));
    let len = 1;
    if (remaining - 1 >= needLeaves) {
      len = rng.weighted(spec.lenWeights).len;
      len = Math.max(1, Math.min(len, remaining, remaining - needLeaves + 1));
    }
    let cands = anchors(len);
    if (!cands.length && len > 1) { len = 1; cands = anchors(1); }
    if (!cands.length) return null;
    let cur = rng.weighted(cands).id;
    let placed = 0;
    for (let k = 0; k < len; k++) {
      const n = g.nodes[cur];
      const opts = [];
      for (const d of g.freeDirs(n)) {
        const nx = n.gx + DIRS[d].dx, ny = n.gy + DIRS[d].dy;
        const crowd = g.occupied(nx, ny) - 1;
        let weight = crowd <= 0 ? 3 : crowd === 1 ? 1 : 0.3;
        if (nearBoss(nx, ny)) weight *= 0.15;
        opts.push({ nx, ny, weight });
      }
      if (!opts.length) break;
      const o = rng.weighted(opts);
      const id = g.add(o.nx, o.ny, false, n.depth + 1);
      g.link(cur, id);
      cur = id; placed++;
    }
    remaining -= placed;

    function anchors(l) {
      const out = [];
      for (const n of g.nodes) {
        if (n.id === bossId) continue;
        if (n.id === 0 && (!spec.startBranch || n.adj.length >= 2)) continue;
        if (spec.mainAnchorsOnly && (!n.main || n.id === 0)) continue;
        if (n.depth + l > bossDepth) continue;
        if (!g.freeDirs(n).length) continue;
        let weight = n.main ? 3 : 1;
        if (!n.main && n.adj.length === 1 && needLeaves > 0) weight *= 0.2;
        if (n.adj.length >= 3) weight *= 0.35;
        out.push({ id: n.id, weight });
      }
      return out;
    }
  }

  // loops: connect grid-adjacent rooms of different branches without shortening the way to the boss
  for (let l = 0; l < spec.loops; l++) {
    const pairs = [];
    for (const a of g.nodes) {
      if (a.id === 0 || a.id === bossId) continue;
      for (const d of ['e', 's']) {
        const b = g.at(a.gx + DIRS[d].dx, a.gy + DIRS[d].dy);
        if (b <= 0 || b === bossId || g.linked(a.id, b)) continue;
        pairs.push([a.id, b]);
      }
    }
    rng.shuffle(pairs);
    const leavesBefore = g.leafCount(bossId);
    for (const [a, b] of pairs) {
      if (g.bfs(a)[b] < 3) continue;
      g.link(a, b);
      const dd = g.bfs(0);
      const leaves = g.leafCount(bossId);
      if (dd[bossId] === bossDepth && Math.max(...dd) <= bossDepth && leaves >= Math.min(leavesBefore, spec.desiredLeaves)) break;
      g.unlink(a, b);
    }
  }

  const dd = g.bfs(0);
  for (const n of g.nodes) n.depth = dd[n.id];
  return { g, bossId };
}

/** Deterministic comb layout used only if random attempts keep failing (never loops forever). */
function fallbackGraph(spec) {
  const N = spec.N;
  let M = spec.mainLen;
  const capacity = (m) => {
    let c = 0;
    for (let i = 1; i <= m - 2; i++) c += i === m - 2 ? 1 : 2 * (m - 1 - i);
    return c;
  };
  while (capacity(M) < N - M) M++;
  const g = new Grid();
  for (let i = 0; i < M - 1; i++) {
    g.add(i, 0, true, i);
    if (i) g.link(i - 1, i);
  }
  const bossId = g.add(M - 2, -1, true, M - 1);
  g.link(bossId - 1, bossId);
  const slots = [];
  for (let r = 1; r < M; r++) {
    for (let i = 1; i <= M - 2; i++) {
      if (i + r > M - 1) continue;
      slots.push([i, r]);
      if (i !== M - 2) slots.push([i, -r]);
    }
  }
  for (let k = 0; k < N - M && k < slots.length; k++) {
    const [i, r] = slots[k];
    const parent = g.at(i, r > 0 ? r - 1 : r + 1);
    const id = g.add(i, r, false, i + Math.abs(r));
    g.link(parent, id);
  }
  const dd = g.bfs(0);
  for (const n of g.nodes) n.depth = dd[n.id];
  return { g, bossId };
}

/**
 * Build the grid graph. Returns { nodes: [{ id, gx, gy, main, adj, depth }], startId, bossId, gridW, gridH }.
 */
export function buildGraph(rng, plan) {
  let res = null, best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = tryBuild(rng.fork('g' + attempt), plan);
    if (!r) continue;
    const leaves = r.g.leafCount(r.bossId);
    if (leaves >= plan.desiredLeaves) { res = r; break; }
    if (!best || leaves > best.g.leafCount(best.bossId)) best = r;
    if (attempt >= 30 && best) { res = best; break; }
  }
  if (!res) res = best || fallbackGraph(plan);
  const { g, bossId } = res;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of g.nodes) {
    minX = Math.min(minX, n.gx); minY = Math.min(minY, n.gy);
    maxX = Math.max(maxX, n.gx); maxY = Math.max(maxY, n.gy);
  }
  const nodes = g.nodes.map((n) => ({
    id: n.id, gx: n.gx - minX, gy: n.gy - minY, main: n.main, adj: n.adj.slice().sort((a, b) => a - b), depth: n.depth,
  }));
  return { nodes, startId: 0, bossId, gridW: maxX - minX + 1, gridH: maxY - minY + 1 };
}

/**
 * Assign room types. returns { types: string[], lowBudget: Set<id> }.
 */
export function assignTypes(rng, graph, plan) {
  const { nodes, startId, bossId } = graph;
  const n = nodes.length;
  const types = new Array(n).fill(null);
  types[startId] = 'start';
  types[bossId] = 'boss';
  const lowBudget = new Set();
  for (const nb of nodes[startId].adj) { types[nb] = 'combat'; lowBudget.add(nb); }
  const bossDepth = nodes[bossId].depth;
  const pred = nodes[bossId].adj[0];
  const isLeaf = (i) => nodes[i].adj.length === 1;

  if (plan.gauntlet) {
    // main path is fixed: start, seq..., boss
    for (let i = 1; i <= plan.seq.length; i++) if (types[i] === null) types[i] = plan.seq[i - 1];
    const side = [];
    for (let i = 0; i < n; i++) if (types[i] === null) side.push(i);
    const order = rng.shuffle(['shop', 'treasure']);
    side.forEach((id, k) => { types[id] = order[k % 2]; });
    return { types, lowBudget };
  }

  const place = (type, score) => {
    let best = -1, bestS = -Infinity;
    for (let i = 0; i < n; i++) {
      if (types[i] !== null) continue;
      const s = score(i);
      if (s === -Infinity) continue;
      const v = s + rng.next() * 1.5;
      if (v > bestS) { bestS = v; best = i; }
    }
    if (best >= 0) types[best] = type;
    return best;
  };

  const specials = plan.specials.slice();
  const count = (t) => specials.filter((s) => s === t).length;
  const preferPred = rng.chance(0.6);
  const half = Math.ceil(bossDepth / 2);

  // secret: must be a dead end
  if (count('secret')) {
    place('secret', (i) => (isLeaf(i) ? 4 + nodes[i].depth * 0.5 + (nodes[nodes[i].adj[0]].main ? 0 : 1.5) : -Infinity));
  }
  // first elite: right before the boss, or a deep dead end
  const elites = count('elite');
  const leafSpare = () => {
    const freeLeaves = nodes.filter((nd) => types[nd.id] === null && isLeaf(nd.id)).length;
    const placed = types.filter((t) => LEAFY.has(t)).length;
    return freeLeaves > specials.filter((t) => LEAFY.has(t)).length - placed;
  };
  const eliteScore = (predBonus) => (i) => (i === pred ? predBonus : 0) + (isLeaf(i) ? (leafSpare() ? 3 : -2) : 0)
    + (nodes[i].main && nodes[i].depth >= half ? 2 : 0) + nodes[i].depth * 0.4;
  place('elite', eliteScore(preferPred ? 12 : 1));
  // rest: second half of the path
  place('rest', (i) => (nodes[i].depth >= half ? 6 : -4) + (isLeaf(i) ? 3 : 0) + (nodes[i].main ? 0 : 1) - (i === pred ? 3 : 0));
  // leafy specials
  const leafy = (bonus) => (i) => (isLeaf(i) ? 6 : 0) + (nodes[i].main ? 0 : 2) + bonus(i);
  place('shop', leafy((i) => -Math.abs(nodes[i].depth - bossDepth * 0.5) * 0.4));
  for (let k = 0; k < count('treasure'); k++) place('treasure', leafy((i) => nodes[i].depth * 0.2));
  for (let k = 0; k < count('shrine'); k++) place('shrine', leafy(() => 0));
  if (count('forge')) place('forge', leafy((i) => (nodes[i].depth >= 2 ? 1 : 0)));
  for (let k = 1; k < elites; k++) {
    place('elite', eliteScore(6));
  }
  if (count('challenge')) place('challenge', (i) => (nodes[i].main ? 0 : 2) + (nodes[i].depth >= 2 ? 1 : 0));
  for (let i = 0; i < n; i++) if (types[i] === null) types[i] = 'combat';
  return { types, lowBudget };
}
