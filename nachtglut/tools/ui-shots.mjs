#!/usr/bin/env node
// UI screenshot tour (Playwright): title, setup, Aschealtar, Chronik, settings, HUD, choice, map, pause,
// character sheet, death + victory — at desktop 1280×720, phone 390×844 and phone landscape 844×390.
//
//   node tools/serve.mjs 8137 &   (or any static server)
//   node tools/ui-shots.mjs [--url http://localhost:8137/] [--out <dir>] [--only desktop,phone,landscape] [--fresh]
//
// Exits with code 1 when the page logs console errors / uncaught exceptions.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const BASE = opt('url', 'http://localhost:8137/');
const OUT = resolve(opt('out', 'ui-shots'));
const ONLY = opt('only', '').split(',').filter(Boolean);
const FRESH = args.includes('--fresh');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
  { name: 'landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
].filter((v) => !ONLY.length || ONLY.includes(v.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fill the live save with plausible progress so the meta screens have content. */
async function seedSave(page, { tutorialSeen }) {
  await page.evaluate(({ tutorialSeen, fresh }) => {
    const app = window.__nachtglut;
    const game = app.game;
    const reg = app.modules.registry || {};
    const s = game.save;
    if (fresh) { s.tutorialSeen = tutorialSeen; return; }
    const day = 86400000, now = Date.now();
    s.ash = 640; s.totalAsh = 1820;
    s.upgrades = { vitality: 3, might: 2, precision: 1, swiftness: 2, spark_pouch: 2, fate_dice: 1, slag_skin: 1 };
    s.unlocks = { characters: ['bearer', 'shadow'], weapons: [], difficulties: 2 };
    const pickSome = (obj, frac) => Object.keys(obj || {}).filter((_, i, a) => i < Math.ceil(a.length * frac));
    const enemies = {};
    pickSome(reg.ENEMIES, 0.45).forEach((id, i) => { enemies[id] = { seen: true, kills: 300 - i * 23 > 0 ? 300 - i * 23 : 3 }; });
    const relics = {};
    pickSome(reg.RELICS, 0.4).forEach((id, i) => { relics[id] = 1 + (i % 4); });
    const boons = {};
    pickSome(reg.BOONS, 0.5).forEach((id, i) => { boons[id] = 2 + (i % 5); });
    s.codex = {
      enemies, relics, boons,
      weapons: { ember_bolt: 9, scatter_coal: 3, frost_needle: 2 },
      bosses: { boss_cinder: { seen: true, kills: 2, bestTime: 431 }, boss_mycel: { seen: true, kills: 0, bestTime: 0 } },
    };
    s.achievements = { first_death: now - 3 * day, boss_cinder: now - day };
    Object.assign(s.stats, {
      runs: 9, wins: 1, deaths: 7, abandons: 1, kills: 1480, eliteKills: 41, bossKills: 4, bestFloor: 5, bestKills: 402, bestLevel: 21,
      bestHit: 188, playTime: 9123, fastestWin: 1622, longestRun: 1622, highestDifficultyWon: 1, totalSparks: 4211, sparksSpent: 3020,
      damageDealt: 251233, damageTaken: 4120, roomsCleared: 120, floorsCleared: 14, relicsFound: 38, boonsChosen: 77, chests: 31,
    });
    s.characterStats = { bearer: { runs: 8, wins: 1, deaths: 6, kills: 1400, bestFloor: 5, bestDifficulty: 1, fastestWin: 1622 }, shadow: { runs: 1, wins: 0, deaths: 1, kills: 80, bestFloor: 2, bestDifficulty: -1, fastestWin: 0 } };
    s.history = [
      { date: now - 3600e3, victory: false, character: 'bearer', difficulty: 1, floor: 2, biome: 'fungal', time: 612, kills: 188, level: 9, ash: 96, killedBy: 'Myzelmutter', seedLabel: 'K7PQ2M' },
      { date: now - day, victory: true, character: 'bearer', difficulty: 1, floor: 5, biome: 'core', time: 1622, kills: 402, level: 21, ash: 512, seedLabel: 'GLUT42' },
      { date: now - 2 * day, victory: false, abandoned: true, character: 'shadow', difficulty: 0, floor: 1, biome: 'ash', time: 95, kills: 12, level: 2, ash: 4, seedLabel: 'ZX3R8T' },
    ];
    s.tutorialSeen = tutorialSeen;
    s.seenHints = {};
    s.uiPrefs = { character: 'bearer', difficulty: 1 };
    app.bus.emit('meta:change', { save: s });
  }, { tutorialSeen, fresh: FRESH });
}

async function run() {
  const browser = await chromium.launch();
  const problems = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, hasTouch: !!vp.hasTouch, isMobile: !!vp.isMobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    const touch = !!vp.hasTouch;
    const shot = async (name) => {
      await sleep(350);
      const file = `${OUT}/${vp.name}-${name}.png`;
      await page.screenshot({ path: file });
      console.log('  saved', file);
    };
    const press = async (sel) => {
      const loc = page.locator(sel).first();
      if (touch) await loc.tap(); else await loc.click();
      await sleep(250);
    };
    const back = async () => { await press('.screen:not(.is-under) .btn-back'); };

    console.log(`[${vp.name}] ${vp.viewport.width}×${vp.viewport.height}`);
    await page.goto(`${BASE}?autopause=0&god=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__nachtglut && window.__nachtglut.ui && window.__nachtglut.ui.api, null, { timeout: 15000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await seedSave(page, { tutorialSeen: vp.name !== 'phone' });
    await sleep(600);
    await shot('01-title');

    await press('.title-menu .btn >> nth=0');
    await shot('02-setup');
    // pick the locked weaver to show the unlock state
    const weaver = page.locator('.char-card[data-id="weaver"]');
    if (await weaver.count()) { if (touch) await weaver.tap(); else await weaver.click(); await shot('02b-setup-locked'); }
    await back();

    await press('.title-menu .btn >> nth=1');
    await shot('03-altar');
    await back();

    await press('.title-menu .btn >> nth=2');
    await shot('04-chronik');
    await press('.tab >> text=Erfolge');
    await shot('04b-chronik-erfolge');
    await press('.tab >> text=Verlauf');
    await shot('04c-chronik-verlauf');
    await press('.tab >> text=Statistik');
    await shot('04d-chronik-statistik');
    await press('.tab >> text=Gegner');
    await back();

    await press('.title-menu .btn >> nth=3');
    await shot('05-settings');
    await back();

    // run
    await press('.title-menu .btn >> nth=0');
    await press('.btn-go');
    await sleep(3200);
    if (touch) {
      // put a thumb on the move stick so the floating stick shows
      await page.evaluate(() => {
        const layer = document.querySelector('.touch-layer.show');
        if (!layer) return;
        const x = innerWidth * 0.2, y = innerHeight * 0.78;
        layer.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
        layer.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: x + 30, clientY: y - 18, bubbles: true }));
      });
    }
    await shot('06-hud');
    if (touch) {
      await page.evaluate(() => {
        const layer = document.querySelector('.touch-layer');
        layer && layer.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true }));
      });
    }

    // richer HUD: perks, second weapon, shield, low hp, boss
    await page.evaluate(() => {
      const { game } = window.__nachtglut;
      const run = game.run;
      const p = run.player;
      for (let i = 0; i < 6; i++) run.giveRelic();
      const reg = window.__nachtglut.modules.registry || {};
      const boons = Object.keys(reg.BOONS || {});
      for (let i = 0; i < Math.min(4, boons.length); i++) { run.giveBoon(boons[i]); if (i < 2) run.giveBoon(boons[i]); }
      run.giveCurse && run.giveCurse();
      const wid = Object.keys(reg.WEAPONS || {}).find((id) => id !== p.weapon.id);
      if (wid) run.giveWeapon(wid, 3);
      p.swapWeapon && p.swapWeapon();
      p.sparks += 137;
      p.shield = 18;
      p.hp = Math.round(p.stats.maxHp * 0.24);
      p.statuses.burn = { t: 4, power: 1, stacks: 1, tick: 0.5 };
      p.statuses.chill = { t: 4, power: 1, stacks: 1, tick: 0.5 };
      const w = run.world;
      const boss = w.spawnEnemy('boss_cinder', p.x + 70, p.y - 30);
      if (boss && !w.boss) w.boss = boss;
      if (boss) { boss.spawnT = 0; boss.hp = boss.maxHp * 0.62; }
      window.__nachtglut.bus.emit('ui:toast', { text: 'Relikt erhalten: Glutherz', kind: 'good' });
    });
    await sleep(1400);
    await shot('07-hud-rich');

    await page.evaluate(() => window.__nachtglut.ui.api.toggleMap(true));
    await shot('08-map');
    await page.evaluate(() => window.__nachtglut.ui.api.toggleMap(false));

    await page.evaluate(() => window.__nachtglut.game.run.offerRelicChoice(3));
    await sleep(700);
    await shot('09-choice');
    await sleep(400);
    if (touch) await page.locator('.ccard').first().tap(); else await page.keyboard.press('Digit1');
    await sleep(500);
    await page.evaluate(() => { const r = window.__nachtglut.game.run; r.pendingBoons = 1; });
    await sleep(900);
    await shot('09b-choice-boon');
    if (touch) await page.locator('.ccard').first().tap(); else await page.keyboard.press('Digit2');
    await sleep(400);

    await page.evaluate(() => window.__nachtglut.game.pause());
    await shot('10-pause');
    await press('.pause-menu .btn >> nth=1');
    await shot('11-charsheet');
    await back();
    if (touch) await press('.pause-menu .btn >> nth=0'); else await page.keyboard.press('Escape');
    await sleep(300);

    // death
    await page.evaluate(() => { const r = window.__nachtglut.game.run; r.revives = 0; r.onPlayerDeath(r.world.boss || null, {}); });
    await sleep(4300);
    await shot('12-death');

    // victory
    await page.evaluate(() => { const g = window.__nachtglut.game; g.startRun({ character: 'bearer', difficulty: 1 }); });
    await sleep(600);
    await page.evaluate(() => { const r = window.__nachtglut.game.run; r.stats.kills = 402; r.stats.bossKills = 5; r.floorIndex = 5; r.finish(true); });
    await sleep(3200);
    await shot('13-victory');

    await page.evaluate(() => window.__nachtglut.game.toMenu());
    await sleep(500);
    const state = await page.evaluate(() => window.__nachtglut.game.state);
    if (state !== 'menu') errors.push(`expected menu state at the end, got ${state}`);
    if (errors.length) problems.push(...errors.map((e) => `${vp.name}: ${e}`));
    await ctx.close();
  }
  await browser.close();
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log('  ' + p);
    process.exitCode = 1;
  } else {
    console.log('\nNo console errors.');
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
