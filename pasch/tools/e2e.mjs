// End-to-End-Durchlauf mit Playwright (Chromium): spielt einen Lauf über die Oberfläche bis mindestens Einsatz 2
// (inkl. Wächter-Partie), testet Laden/Beutel/Werkzeug mit Zielwahl, Speichern/Fortsetzen, Sieg/Niederlage,
// Hochformat-Durchlauf und dist/pasch.html per file://. Macht Screenshots aller Bildschirme.
//
//   node tools/serve.mjs 8093 &   node tools/e2e.mjs [--out DIR] [--port 8093] [--quick]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = createRequire(path.join(process.env.NODE_PATH || '/usr/local/lib/node_modules_global', 'x.js'))('playwright'));
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(ROOT, 'dist', 'shots')));
const PORT = Number(arg('--port', 8093));
const BASE = `http://localhost:${PORT}/index.html`;
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const log = (...a) => console.log('[e2e]', ...a);

async function newPage(browser, tag, portrait) {
  const ctx = await browser.newContext({
    viewport: portrait ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 1, hasTouch: !!portrait, isMobile: !!portrait,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(`${tag} pageerror: ${e.message}`); console.log(tag, 'PAGEERROR', e.message, e.stack); });
  page.on('console', (m) => {
    if (m.type() === 'error') { errors.push(`${tag} console: ${m.text()}`); console.log(tag, 'CONSOLE', m.text()); }
  });
  page.tag = tag;
  return { ctx, page };
}

const shot = async (page, name) => {
  const f = path.join(OUT, `${name}-${page.tag}.png`);
  await page.screenshot({ path: f });
  log('screenshot', path.basename(f));
};
const state = (page) => page.evaluate(() => {
  const a = window.__pasch.app;
  const r = a.run;
  return r ? {
    phase: r.phase, ante: r.ante, blindIndex: r.blindIndex, money: r.money, stage: a.rv && a.rv.stageName,
    busy: a.busy || (a.rv && a.rv.play.busy), rolled: !!(r.round && r.round.rolled), score: r.round && r.round.score,
    target: r.round && r.round.target, throwsLeft: r.round && r.round.throwsLeft, rerollsLeft: r.round && r.round.rerollsLeft,
    talismans: r.talismans.length, consumables: r.consumables.length,
  } : null;
});
async function until(page, fn, arg, ms = 20000) {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
}
const stageIs = (page, name, ms) => until(page, (n) => { const a = window.__pasch.app; return a.rv && a.rv.stageName === n && !a.busy && !a.rv.play.busy; }, name, ms);
const clickText = async (page, scope, re) => {
  const loc = page.locator(`${scope} .btn`, { hasText: re }).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.click();
};

/** Ein Wurf: beginnen (falls nötig), halten nach häufigster Augenzahl, nachwürfeln, werten. */
async function playThrow(page, { midShot } = {}) {
  await until(page, () => { const a = window.__pasch.app; return a.rv && a.rv.stageName === 'play' && !a.rv.play.busy; });
  let s = await state(page);
  if (!s.rolled) {
    await clickText(page, '.sub-play', /Wurf beginnen/);
    await until(page, () => { const a = window.__pasch.app; return a.run.round && a.run.round.rolled && !a.rv.play.busy; });
  }
  for (let k = 0; k < 3; k++) {
    s = await state(page);
    if (s.rerollsLeft <= 0) break;
    const holds = await page.evaluate(() => {
      const r = window.__pasch.app.run.round.rolled;
      const c = {};
      r.forEach((x) => { if (!x.hidden && x.v > 0) c[x.v] = (c[x.v] || 0) + 1; });
      let best = 0, bv = 0;
      for (const [v, n] of Object.entries(c)) if (n > best || (n === best && Number(v) > bv)) { best = n; bv = Number(v); }
      return r.map((x, i) => ({ i, want: best >= 2 && x.v === bv && !x.shackled, held: x.held }));
    });
    if (holds.filter((x) => x.want).length >= 4) break;
    for (const hd of holds) {
      if (hd.want !== hd.held) await page.locator(`.tray .die[data-index="${hd.i}"]`).click();
    }
    const allHeld = await page.evaluate(() => window.__pasch.app.run.round.rolled.every((x) => x.held));
    if (allHeld) break;
    await clickText(page, '.sub-play', /Nachwürfeln/);
    await until(page, () => !window.__pasch.app.rv.play.busy);
  }
  if (midShot) await shot(page, 'play-holds');
  // Hand per Pfeiltaste einmal wechseln und zurück (Tastatur-Test)
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  if (midShot) await page.evaluate(() => { window.__pasch.time.speed = 1; });
  await clickText(page, '.sub-play', /Werten|Fehlwurf/);
  if (midShot) {
    await page.waitForTimeout(1700);
    await shot(page, 'scoring');
    await page.evaluate(() => { window.__pasch.time.speed = 4; });
  }
  await until(page, () => { const a = window.__pasch.app; return !a.busy && !a.rv.play.busy; }, null, 30000);
  await page.waitForTimeout(150);
}

async function playRound(page, shots) {
  let n = 0;
  for (;;) {
    const s = await state(page);
    if (s.phase !== 'round') return s.phase;
    await playThrow(page, { midShot: shots && n === 0 });
    n++;
    await page.waitForTimeout(100);
    const s2 = await state(page);
    if (s2.phase !== 'round') {
      await until(page, (ph) => { const a = window.__pasch.app; return a.rv.stageName !== 'play' || ph !== 'round'; }, s2.phase, 15000);
      return s2.phase;
    }
  }
}

/** Ziel im Inspektor wählen (generisch nach Modus) und bestätigen. */
async function chooseTarget(page) {
  await page.locator('.modal .insp').waitFor({ timeout: 5000 });
  if (await page.locator('.modal .insp-rolled').count()) {
    await page.locator('.modal .insp-rolled').first().click();
    if (await page.locator('.modal .insp-values .btn').count()) await page.locator('.modal .insp-values .btn').last().click();
  } else if (await page.locator('.modal .net-cell').count()) {
    const title = await page.locator('.modal .modal-title').textContent();
    // Flächen: erste Fläche des ersten Würfels (+ eine zweite desselben Würfels bei Mehrfachwahl)
    const cells = page.locator('.modal .insp-list .insp-die').first().locator('.net-cell');
    const dieMode = await page.locator('.modal .insp-list .insp-die').first().evaluate((el) => !el.querySelector('.net-cell') || false);
    void dieMode; void title;
    await cells.nth(0).click();
    const status = await page.locator('.modal .insp-status').textContent();
    if (/Zielfläche|bis zu/.test(status)) await page.locator('.modal .insp-list .insp-die').first().locator('.net-cell').nth(1).click();
    if (await page.locator('.modal .insp-values .btn').count()) await page.locator('.modal .insp-values .btn').nth(2).click();
    if (/Würfel wählen|Wähle einen Würfel/.test(await page.locator('.modal .insp-status').textContent())) await page.locator('.modal .insp-die').first().click();
  }
  const st = await page.locator('.modal .insp-status').textContent();
  if (/Wähle einen Würfel/.test(st)) await page.locator('.modal .insp-list .insp-die').first().click();
  await shot(page, 'inspector-target');
  await page.locator('.modal .modal-buttons .btn--go').click();
  await page.waitForTimeout(400);
}

async function shopVisit(page, { shots, tool } = {}) {
  await stageIs(page, 'shop');
  await page.waitForTimeout(500);
  if (shots) await shot(page, 'shop');
  // Talisman/Angebot kaufen (erstes bezahlbares)
  const offers = page.locator('.shop-offers .offer:not(.offer--sold) .btn');
  if (await offers.count()) {
    await offers.first().click();
    await page.waitForTimeout(700);
  }
  // Beutel öffnen
  const packs = page.locator('.shop-packs .offer:not(.offer--sold) .btn');
  if (await packs.count()) {
    const before = (await state(page)).money;
    await packs.first().click();
    await page.waitForTimeout(300);
    const s = await state(page);
    if (s.phase === 'pack') {
      await stageIs(page, 'pack');
      await until(page, () => !document.querySelector('.sub-pack .btn--disabled.btn') || document.querySelectorAll('.pack-acts .btn').length > 0);
      await page.waitForTimeout(1600);
      if (shots) await shot(page, 'pack');
      await pickInPack(page);
    } else log('pack not affordable', before);
  }
  // Werkzeug mit Ziel benutzen (wird ins Inventar gelegt, falls keins da ist)
  if (tool) {
    await page.evaluate((id) => {
      const a = window.__pasch.app;
      if (a.run.consumables.length >= a.run.limits.consumables) a.run.consumables.pop();
      a.run.consumables.push({ uid: `e2e_${id}`, id });
      a.rv.refresh();
    }, tool);
    await page.locator(`.belt-consumables .card[data-uid="e2e_${tool}"]`).click({ force: true });
    await page.locator('.cardmenu .btn', { hasText: 'Benutzen' }).click();
    await chooseTarget(page);
    const left = await page.evaluate((id) => window.__pasch.app.run.consumables.some((c) => c.id === id && c.uid === `e2e_${id}`), tool);
    if (left) errors.push(`tool ${tool} was not used`);
    else log('tool used:', tool);
  }
  if (shots) {
    // Verkaufen-Menü eines Talismans
    const t = page.locator('.belt-talismans .card').first();
    if (await t.count()) { await t.click({ force: true }); await page.waitForTimeout(300); await shot(page, 'sell-menu'); await page.mouse.click(5, 790); }
  }
  await stageIs(page, 'shop');
  await clickText(page, '.sub-shop', /Nächste Partie/);
  await stageIs(page, 'blinds');
}

async function pickInPack(page) {
  for (let guard = 0; guard < 6; guard++) {
    const s = await state(page);
    if (s.phase !== 'pack') return;
    await page.waitForTimeout(300);
    const btn = page.locator('.pack-item:not(.pack-item--gone) .pack-acts .btn:not(.btn--disabled)').first();
    if (!(await btn.count())) { await clickText(page, '.sub-pack', /Überspringen/); await page.waitForTimeout(500); continue; }
    const label = await btn.textContent();
    await btn.click();
    if (/…/.test(label)) {
      await chooseTarget(page);
    }
    await page.waitForTimeout(1200);
    const s2 = await state(page);
    if (s2.phase === 'pack' && (await page.locator('.pack-item:not(.pack-item--gone) .pack-acts .btn:not(.btn--disabled)').count()) === 0) {
      await clickText(page, '.sub-pack', /Überspringen/);
      await page.waitForTimeout(500);
    }
  }
}

async function cashout(page, shots) {
  await stageIs(page, 'result');
  await until(page, () => { const b = document.querySelector('.result-actions .btn'); return b && b.getAttribute('aria-disabled') === 'false'; }, null, 20000);
  if (shots) await shot(page, 'result');
  await page.locator('.result-actions .btn').click();
}

async function mainRun(browser, portrait) {
  const tag = portrait ? 'p' : 'l';
  const { ctx, page } = await newPage(browser, tag, portrait);
  await page.goto(`${BASE}?speed=4&notutorial=1`);
  await page.waitForTimeout(1200);
  await shot(page, 'title');
  await clickText(page, '.title-menu', /Neues Spiel/);
  await page.locator('.modal .newrun').waitFor();
  await page.locator('.seed-input').fill(portrait ? 'HANDY' : 'ABC');
  await shot(page, 'newrun');
  await page.locator('.modal .modal-buttons .btn--hot').click();
  await stageIs(page, 'blinds');
  await page.waitForTimeout(500);
  await shot(page, 'blinds');
  // Geld aufstocken, damit der Laden-Test kaufen kann
  await page.evaluate(() => { const a = window.__pasch.app; a.run.money = 40; a.rv.refresh(); });
  let rounds = 0;
  let sawWarden = false;
  const tools = ['t_gold', 't_chisel', 't_mirror', 't_lead'];
  while (rounds < 9) {
    const s = await state(page);
    if (s.phase === 'lost' || s.phase === 'won') break;
    if (s.ante >= 2 && sawWarden && s.phase === 'blinds' && rounds >= 4) break;
    await stageIs(page, 'blinds');
    const isWarden = s.blindIndex === 2;
    await page.locator('.blind--current .btn--hot').click();
    await stageIs(page, 'play', 30000);
    if (isWarden) { sawWarden = true; await shot(page, 'warden'); }
    const ph = await playRound(page, rounds === 0);
    rounds++;
    log(tag, 'round', rounds, 'ante', s.ante, 'blind', s.blindIndex, '→', ph);
    if (ph === 'lost') break;
    if (ph === 'cashout') {
      await cashout(page, rounds === 1);
      await shopVisit(page, { shots: rounds === 1, tool: tools[(rounds - 1) % tools.length] });
    }
  }
  const s = await state(page);
  log(tag, 'end state', JSON.stringify(s));
  if (s.ante < 2 || !sawWarden) errors.push(`${tag}: did not reach ante 2 with warden (ante ${s.ante}, phase ${s.phase})`);
  if (s.phase === 'lost') { await stageIs(page, 'gameover'); await page.waitForTimeout(800); await shot(page, 'gameover-lost'); }
  // Dialoge
  if (s.phase !== 'lost') {
    await page.keyboard.press('Escape');
    await page.locator('.modal-panel--pause').waitFor();
    await shot(page, 'pause');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__pasch.app.showHandTable());
    await page.waitForTimeout(400);
    await shot(page, 'handtable');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__pasch.app.showInspector());
    await page.waitForTimeout(400);
    await shot(page, 'inspector');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__pasch.app.showSettings());
    await page.waitForTimeout(400);
    await shot(page, 'settings');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  return { ctx, page };
}

/** Speichern & Fortsetzen mitten im Wurf */
async function resumeTest(browser) {
  const { ctx, page } = await newPage(browser, 'r', false);
  await page.goto(`${BASE}?autostart=1&seed=RESUME&speed=4&notutorial=1`);
  await stageIs(page, 'blinds');
  await page.locator('.blind--current .btn--hot').click();
  await stageIs(page, 'play');
  await until(page, () => { const a = window.__pasch.app; return a.run.round.rolled && !a.rv.play.busy; });
  await page.locator('.tray .die[data-index="1"]').click();
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => JSON.stringify(window.__pasch.app.run.round.rolled));
  await page.goto(`${BASE}?speed=4&notutorial=1`);
  await page.waitForTimeout(900);
  await clickText(page, '.title-menu', /Fortsetzen/);
  await stageIs(page, 'play');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => JSON.stringify(window.__pasch.app.run.round.rolled));
  const shown = await page.evaluate(() => [...document.querySelectorAll('.tray .die')].map((d) => d.dataset.value + (d.classList.contains('die--held') ? 'H' : '')).join(','));
  log('resume rolled equal:', before === after, 'shown', shown);
  if (before !== after) errors.push('resume: rolled state differs');
  if (!shown.includes('H')) errors.push('resume: held die not shown');
  await shot(page, 'resumed');
  // Niederlage erzwingen: letzter Wurf, unerreichbares Ziel
  await page.evaluate(() => { const r = window.__pasch.app.run.round; r.throwsLeft = 1; r.target = 1e9; window.__pasch.app.rv.hud.update(); });
  await clickText(page, '.sub-play', /Werten|Fehlwurf/);
  await stageIs(page, 'gameover', 30000);
  await page.waitForTimeout(900);
  await shot(page, 'gameover-lost');
  await ctx.close();
}

/** Sieg: Einsatz 8, kleine/große Partie überspringen, Wächter mit kleinem Ziel → Sieg, Endlos weiter. */
async function winTest(browser, portrait) {
  const { ctx, page } = await newPage(browser, portrait ? 'wp' : 'w', portrait);
  await page.goto(`${BASE}?autostart=1&seed=WIN&speed=4&notutorial=1&ante=8`);
  for (let k = 0; k < 2; k++) {
    await stageIs(page, 'blinds');
    await page.locator('.blind--current .btn', { hasText: 'Überspringen' }).click();
    await page.waitForTimeout(600);
    for (let g = 0; g < 4 && (await state(page)).phase === 'pack'; g++) {
      await stageIs(page, 'pack');
      await page.waitForTimeout(1500);
      await clickText(page, '.sub-pack', /Überspringen/);
      await page.waitForTimeout(600);
    }
  }
  await stageIs(page, 'blinds');
  await page.locator('.blind--current .btn--hot').click();
  await stageIs(page, 'play', 30000);
  await page.evaluate(() => { const r = window.__pasch.app.run.round; r.target = 1; });
  await playThrow(page);
  await stageIs(page, 'gameover', 30000);
  await page.waitForTimeout(1200);
  await shot(page, 'gameover-won');
  await clickText(page, '.go-buttons', /Endlos/);
  await stageIs(page, 'result');
  log('endless ok');
  // Sammlung
  await page.evaluate(() => window.__pasch.app.showCollection());
  await page.waitForTimeout(900);
  await shot(page, 'collection');
  await page.locator('.coll-tab', { hasText: 'Erfolge' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'achievements');
  await ctx.close();
}

async function distTest(browser) {
  const file = path.join(ROOT, 'dist', 'pasch.html');
  if (!fs.existsSync(file)) { log('dist/pasch.html missing – skipped'); return; }
  const { ctx, page } = await newPage(browser, 'dist', false);
  await page.goto(`file://${file}?autostart=1&seed=DIST&speed=4&notutorial=1`);
  await stageIs(page, 'blinds');
  await page.locator('.blind--current .btn--hot').click();
  await stageIs(page, 'play');
  await playThrow(page);
  await shot(page, 'dist');
  log('dist ok');
  await ctx.close();
}

const browser = await chromium.launch();
try {
  const quick = process.argv.includes('--quick');
  const a = await mainRun(browser, false);
  await a.ctx.close();
  if (!quick) {
    const b = await mainRun(browser, true);
    await b.ctx.close();
    await resumeTest(browser);
    await winTest(browser, false);
    await winTest(browser, true);
    await distTest(browser);
  }
} catch (e) {
  errors.push(`exception: ${e.stack || e.message}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.log('\nFEHLER:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\ne2e OK – Screenshots in', OUT);
