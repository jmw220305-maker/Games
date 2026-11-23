# Pasch – Architektur und Schnittstellen

Vanilla JavaScript (ES-Module, ES2020), DOM + CSS-3D für Würfel/Karten, Canvas/WebGL für Hintergrund und
Partikel, WebAudio für Sound und Musik. **Keine Laufzeit-Abhängigkeiten, keine Bild-/Audiodateien.**
Dev: `npm start` (statischer Server, `index.html` lädt `src/main.js` als Modul). Build: `npm run build` →
`dist/pasch.html` (eine offline lauffähige Datei, per Doppelklick) und `dist/pasch.artifact.html` (Fragment).
Tests: `npm test` (`node --test tests/*.test.js`), nur für reine Logik (kein DOM).

Regeln für alle Module:
- `src/game/**` und `src/core/**` sind **rein** (kein DOM, kein `window`, kein `Date.now()`, kein
  `Math.random()`): sie laufen in Node für Tests und den Balance-Bot.
- Alle Zufälle über `core/rng.js`-Streams im Run-State (Speichern/Laden reproduzierbar).
- Run-State ist **reines JSON** (serialisierbar mit `JSON.stringify`), keine Klassen-Instanzen, keine Funktionen.
- Inhalte sind Daten + Hook-Funktionen in `src/game/content/*.js`, registriert über IDs.
- Deutsche Texte stehen in den Inhaltsdefinitionen (`name`, `desc`); UI-Texte in `src/ui/text.js`.
- Kein `alert/confirm/prompt`. Alle Animationen respektieren Spielgeschwindigkeit und „Bewegung reduzieren“.

```
pasch/
  index.html  style.css  package.json
  src/main.js                      Einstieg: Audio/FX/UI booten, Profil laden, Titelbildschirm
  src/core/   rng.js util.js format.js storage.js
  src/game/   constants.js dice.js hands.js scoring.js run.js shop.js economy.js meta.js
              content/{talismans,consumables,wardens,vouchers,packs,tags,cups,stakes,achievements}.js
  src/audio/  audio.js (Fassade) engine.js sfx.js music.js
  src/fx/     time.js springs.js juice.js shake.js particles.js popups.js ticker.js background.js flames.js
  src/ui/     app.js text.js input.js tooltip.js
              components/{die.js,tray.js,card.js,button.js,hud.js,scorebox.js,inspector.js}
              screens/{title.js,blinds.js,play.js,shop.js,pack.js,result.js,gameover.js,collection.js,settings.js}
              scoreplayer.js       spielt ScoreResult.steps als Animation ab
  tests/      *.test.js
  tools/      build.mjs serve.mjs sim.mjs (Balance-Bot) fx-test.html audio-test.html
```

---

## 1. core

### `core/rng.js`
```js
export function hashSeed(str) -> uint32                 // FNV-1a o. ä.
export function makeStream(seed:uint32) -> {s:uint32}   // JSON-State (sfc32/mulberry32)
export function next(stream) -> float [0,1)             // mutiert stream.s
export function int(stream, lo, hi) -> int              // inklusiv
export function pick(stream, arr) -> item
export function weighted(stream, [[item, weight], ...]) -> item
export function shuffle(stream, arr) -> arr (in place)
export function chance(stream, p) -> bool
export function randomSeedString() -> string            // nur hier darf Math.random benutzt werden (UI-Seed)
```
### `core/util.js`, `core/format.js`
`clamp, lerp, sum, countBy, deepClone`. `formatNumber(n)` → `"1.234"`, ab 1e6 `"1,23 Mio."`, ab 1e9 `"4,5 Mrd."`,
ab 1e12 Exponent `"3,1e14"`. `formatMoney(n)` → `"$12"`. `formatMult(x)` → `"×1,5"`.
### `core/storage.js`
`load(key, fallback)`, `save(key, value)` über `localStorage` mit try/catch (in Node: In-Memory-Fallback).

---

## 2. game – Datenmodell (JSON)

```js
Face  = { v: int /*0 = leer*/, mark: null|'gold'|'ruby'|'azure'|'star'|'echo'|'glass'|'stone'|'clover' }
Die   = { id: string, sides: 4|6|8, faces: Face[], material: null|'lead'|'bone'|'prism'|'crystal'|'phantom' }
Rolled = { dieId, faceIndex, v /* angezeigter Wert inkl. Stupser */, hidden: bool, held: bool,
           shackled: bool, nudged: int /*0 oder ±1, Werkzeug Stupser*/ }
Talisman = { uid: string, id: string, state: {} /*z.B. {n:3} für skalierende*/, disabled: bool }
Consumable = { uid, id }
Run = {
  version: 1, seed: string, cup: string, stake: int,
  rng: { roll, shop, chance, warden, pack, misc },       // Streams
  ante: int, blindIndex: 0|1|2,                          // aktuelle/ nächste Partie
  phase: 'blinds'|'round'|'cashout'|'shop'|'pack'|'won'|'lost'|'endless',
  money: int, dice: Die[], talismans: Talisman[], consumables: Consumable[],
  limits: { talismans: 5, consumables: 2, dice: 5, shopSlots: 2 },
  base: { throws: 4, rerolls: 3, interestCap: 5 },
  handLevels: { [handId]: int /*1..*/ }, handPlays: { [handId]: int },
  vouchers: string[], tags: string[],
  wardens: { current: string, seen: string[] },          // Wächter des aktuellen Einsatzes
  blinds: [ {kind:'small'|'big'|'warden', target, reward, state:'upcoming'|'current'|'skipped'|'done', tagOffer} ×3 ],
  round: null | {
    target, score, throwsLeft, rerollsLeft, rolled: Rolled[]|null, rolledThisTurn: bool,
    rerollsUsedThisThrow: int, playedHands: string[], lastHandRank: int, flags: {}
  },
  shop: null | { offers: Offer[], packs: Offer[], voucher: Offer|null, rerollCost: int, rerolls: int },
  pack: null | { packId, choices: Offer[], picksLeft: int },
  stats: { throws, rerolls, bestThrow, bestHand, moneyEarned, ... },
  log: [] // optional
}
Offer = { kind:'talisman'|'consumable'|'pack'|'voucher'|'die', id, price, sold:bool, uid?, die? }
```

### Inhaltsdefinitionen (`content/*.js`)
```js
// talismans.js
export const TALISMANS = { snake_eye: {
  id, name:'Schlangenauge', rarity:'common'|'uncommon'|'rare'|'legendary', price:5,
  desc:'+8 Multi je gewerteter 1',      // darf {platzhalter} nutzen; describe(t) liefert fertigen Text
  copyable: true, icon: '🐍'?  // KEINE Emojis – stattdessen `glyph`: kurzer Text/Symbol für das Kartenbild, z.B. '1·1'
  glyph: '⚀', hue: 140,                // Kartenfarbe (HSL-Hue), UI zeichnet daraus die Karte
  // Hooks (alle optional, rein, bekommen ctx – siehe scoring):
  onDie(ctx, die) {}, onHand(ctx) {}, retrigger(ctx, die) -> int,
  modifyRound(run, round) {}, onRoundEnd(run, t) -> events, onReroll(ctx) {}, onScored(ctx) {},
  onAcquire(run, t) {}, onRemove(run, t) {},
  describe(t, run) -> string           // aktueller Text inkl. Zustand (z.B. "derzeit ×1,4")
}}
```
Gleiches Muster für `CONSUMABLES` (`kind:'star'|'tool'|'mystic'`, `target: null | {type:'face'|'faces'|'die'|'rolled', count, value?:true}`,
`usableIn: 'any'|'round'`, `use(run, target) -> events`), `WARDENS` (`minAnte`, `finale`, `targetMul`, Hooks),
`VOUCHERS`, `PACKS`, `TAGS`, `CUPS`, `STAKES`, `ACHIEVEMENTS`.

Jedes Inhaltsobjekt hat `id, name, desc` und für die Darstellung `glyph` (1–3 Zeichen, Unicode-Symbole erlaubt,
keine Emojis) und `hue` (0–360).

---

## 3. game – Aktionen (`game/run.js`)

Alle Aktionen mutieren `run` und geben `{ ok:true, events:[...] }` oder `{ ok:false, reason:'…deutscher Text…' }`
zurück. Events sind kleine Objekte, die die UI animiert (Typen unten). Die UI liest danach den Zustand neu.

```js
newRun({ seed, cup='wood', stake=1 }) -> Run
startBlind(run)                    // phase 'blinds' → 'round' (aktuelle Partie)
skipBlind(run)                     // kleine/große Partie überspringen → Marke; events [{type:'tag', id}]
rerollWarden(run)                  // Privileg v_ban
beginThrow(run)                    // Wurf beginnen: alle Würfel werfen. events [{type:'roll', dice:[i...], results}]
toggleHold(run, i)                 // i = Index in round.rolled
reroll(run)                        // Nachwurf; events [{type:'roll', dice:[i...]}, ggf. {type:'money'}...]
availableHands(run) -> [{ handId, name, rank, dice:[i...], base:{chips, mult}, level }]  // ranghöchste zuerst
previewHand(run, handId?) -> { handId, chips, mult, dice }      // nur Basis (für die Live-Anzeige)
scoreThrow(run, handId?) -> { ok, result: ScoreResult, events }  // wertet; prüft Sieg/Niederlage
cashOut(run) -> { ok, events, breakdown:[{label, amount}] }      // phase 'cashout' → 'shop'
shopReroll(run) / buy(run, offerIndex | {section:'offers'|'packs'|'voucher', index})
sell(run, {kind:'talisman'|'consumable', uid})
moveTalisman(run, from, to)
useConsumable(run, uid, target) -> {ok, events}
openPack / pickFromPack(run, choiceIndex, target?) / skipPack(run)
leaveShop(run)                     // → nächste Partie ('blinds'), ggf. neuer Einsatz
continueEndless(run)
getRoundRules(run) -> { throws, rerolls, ... }  // effektive Werte inkl. Talismane/Privilegien/Wächter
describe*(…)                       // Texte für Tooltips
```

### ScoreResult (wichtigste Schnittstelle Logik → Animation)
```js
ScoreResult = {
  handId, handName, level, total, scoreBefore, scoreAfter, target, cleared: bool,
  steps: Step[],   // in exakt der Reihenfolge, in der sie animiert werden
}
Step = {
  type: 'hand'      // Basis gesetzt:        {chips, mult}
      | 'chips'     // +Punkte:              {amount}
      | 'mult'      // +Multi:               {amount}
      | 'xmult'     // ×Multi:               {factor}
      | 'money'     // Geld:                 {amount}
      | 'retrigger' // „Nochmal!“            {}
      | 'text'      // Hinweis (z.B. „Zersprungen!“, „Gefesselt“) {text}
      | 'shatter'   // Glasfläche zerspringt {}
      | 'grow',     // skalierender Talisman wächst {text}
  source: { kind:'hand'|'die'|'talisman'|'warden'|'face', index:int /* Würfel- oder Talisman-Index */, uid? },
  chips, mult,     // laufende Werte NACH diesem Schritt (UI zeigt sie direkt an)
  dieIndex?: int,  // bei Würfelschritten: welcher Würfel (für Popup-Position)
}
```
Die UI braucht nichts nachzurechnen: sie zeigt nach jedem Schritt `chips`/`mult` an.

### Event-Typen (Rückgaben der Aktionen)
`roll {dice:[i], results:[v]}` · `money {amount, reason}` · `tag {id}` · `talismanGrow {uid, text}` ·
`talismanBreak {uid}` · `faceShatter {dieId, faceIndex}` · `roundWon` · `roundLost` · `runWon` · `extraThrow`
(Zweiter Atem) · `unlock {kind, id}` · `achievement {id}` · `message {text}`.

### Hände (`game/hands.js`)
```js
export const HANDS = { pair: {id, name, rank, chips, mult, perLevel:{chips, mult}, secret}, ... }
export function detectHands(values:int[] /*0 = keine Augen*/, wildMask:bool[]) -> [{handId, dice:[i...]}]
// alle enthaltenen Hände, ranghöchste zuerst; bei Wild: beste Belegung (alle Kombinationen probieren, n ≤ 7)
export function handBase(handId, level) -> {chips, mult}
export function contains(handId, otherId) -> bool  // Enthaltensein-Relation für Talismane
```
`smallrun` ⊂ `bigrun` ⊂ `skyladder`; `pair` ⊂ `twopair` ⊂ `fullhouse`; `pair` ⊂ `triple` ⊂ `fullhouse` ⊂ …;
`triple` ⊂ `quad` ⊂ `pasch` ⊂ `sixer`. `parity` steht für sich. `scatter` ist immer verfügbar.

### Balance-Bot (`tools/sim.mjs`)
Spielt N Läufe headless mit einfacher Strategie (halten nach Erwartungswert-Heuristik, kauft Talismane nach Preis/
Seltenheit, levelt meistgespielte Hand) und meldet: erreichter Einsatz (Verteilung), Siegquote, Punkte je Wurf je
Einsatz, Geld je Einsatz, Wächter-Niederlagen. Ziel (mit gutem Bot): Siegquote 15–35 %, Einsatz 1 fast immer
geschafft, Einsatz 2–3 selten Endstation.

---

## 4. audio (`src/audio/audio.js` – Fassade, die einzige Datei, die UI importiert)
```js
export const audio = {
  init(),                 // AudioContext beim ersten User-Gesture erzeugen/resumen (idempotent)
  setVolume('master'|'sfx'|'music', 0..1), mute(bool),
  play(name, opts={}),    // opts: {pitch: halbtöne, step: int (Pentatonik-Stufe), gain, pan}
  music: { start(), stop(), setMood('menu'|'round'|'shop'|'warden'), scoringOpen(bool), duck(db, ms) },
}
```
Sound-Namen (alle synthetisiert, ±4 % Zufalls-Tonhöhe, max. 6 Instanzen je Name):
`hover, click, press, release, deny, roll_start, dice_rattle, dice_clack {gain}, dice_land, hold, unhold,
chip {step}, mult {step}, xmult, money, coin, retrigger, shatter, grow, hand_reveal, target_cross, flame,
round_won, run_won, round_lost, buy, sell, reroll_shop, pack_open, card_flip, card_pick, warden_reveal,
tick {step} (Hochzählen), whoosh, level_up, tag, error`.
Musik: prozeduraler Lo-Fi/Synthwave-Loop (70–85 BPM), Moods ändern Akkorde/Instrumente, Tiefpass öffnet beim Werten.
Testseite `tools/audio-test.html` mit Knöpfen für alle Sounds und Moods.

---

## 5. fx (`src/fx/*`) – wiederverwendbare Effekt-Bausteine, keine Spiellogik

Alle Effekte nur über `transform`/`opacity` (Ausnahmen: kurzer `filter` bei `chroma`, Canvas). Eine gemeinsame
rAF-Schleife (`time.js`); versteckter Tab → alles pausiert. Sammel-Import: `src/fx/index.js` (re-exportiert alles).

```js
// index.js
export function initFx({root=#app, fxCanvas=#fx, bgCanvas=#bg, palette='menu', reducedMotion, crt, forceFallback})
export function setCRT(on)                       // body.crt (Scanlines + Vignette)

// time.js – zentrale Uhr
export const time = {
  speed: 1 /*0.5|1|2|4*/, skipping: false /*Tippen beim Werten → Spieluhr ×skipFactor(8)*/, flashes: true,
  reducedMotion /*get/set, setzt body.fx-reduced; Standard aus prefers-reduced-motion*/,
  now() /*Spieluhr ms: läuft ×speed, steht bei Hitstop*/, realNow(), dt /*Spiel-s*/, realDt, rate, frozen,
  hitstop(ms) /*Spieluhr anhalten*/, wait(ms) -> Promise /*Spieluhr ⇒ ÷speed, Hitstop verlängert*/,
  onFrame(fn(dt, realDt)) -> unsubscribe, afterFrame(fn) -> unsubscribe,
  tween(ms, fn(eased, raw), {ease, delay}) -> Promise (mit .cancel()), toReal(ms) }
export const ease = { linear, inQuad, outQuad, inOutSine, outCubic, outQuart, outQuint, outExpo, outBack, outElastic }
// springs.js – Federn + Transform-Ebenen (mehrere Effekte auf einem Element ohne Konflikt; 1 transform-Write/Frame)
export class Spring { constructor(value, {k=220, damp=0.78}); target; value; vel; step(dt); settled; snap(v) }
export function springTo(el, {x,y,rot,scale}, {k, damp, layer='spring', snap}) -> Promise (eingeschwungen)
export function setLayer(el, name, {x,y,z,rot,rx,ry,scale,sx,sy}|null), getLayer, clearLayer, setPerspective(el, px)
//   ⚠ Elemente mit fx-Effekten nicht zusätzlich per CSS transformieren (Wrapper benutzen).
// juice.js
export function juice(el, amount=0.3, {rot, dur=0.4})   // juice_up (research_feel §1.1) → Promise
export function squash(el, s=0.2, ms=90)  ·  nope(el, px=6, cycles=3, ms=240) /*„geht nicht“-Schütteln*/
export function jitter(el, px=2, ms=110)  ·  popIn(el, ms=260, delay=0)  ·  pop(el, from=1.25, ms=160)
export function hoverTilt(el, {maxDeg=12, lift=10, scale=1.05, perspective=600}) -> detach  // setzt --fx-mx/--fx-my/--fx-glare
export function idleSway(el, seed, {deg=1.5, px=2}) -> stop
export function pressable(el, {down=0.94}) -> detach      // Knopf 0,94 → Überschwinger
// shake.js – Trauma² · Sinus-Rauschen, max 10 px / 2°, Abklingen 1,2/s, Echtzeit
export const shake = { add(trauma), kick(dx, dy), strength: 1 /*0|0.5|1*/, setRoot(el), reset(), trauma }
// particles.js  (Canvas #fx, DPR ≤ 2, läuft nur solange Partikel leben)
export const particles = { init(canvas),
  burst(x, y, {count=14, color /*Hex|Array|'chips'|'mult'|'xmult'|'money'|'confetti'|'dust'*/, speed=[150,500],
         gravity=900, life=[.4,.9], size, shape:'square'|'spark'|'coin'|'confetti'|'dust', spread=2π, angle=-π/2, drag, jitter}),
  ring(x, y, {radius=60, color, life=.35}),               // Schockwelle
  confetti(n=40),                                         // 2 Kanonen unten + Regen
  flyCoins(x0, y0, x1, y1, {count=5, dur=350, stagger=40, size, onArrive(i)}) -> Promise,  // Münzen zur Geldanzeige
  count, clear() }
// popups.js  (DOM-Layer #fx-layer, z-index 60, über allem)
export function popup(x, y, text|number, {kind:'chips'|'mult'|'xmult'|'money'|'info', big, hold=500, rise=24, dx}) -> Promise
//   Zahlen bekommen Präfix: chips/mult „+30“, xmult „×2“, money „$3“
export function banner(text, {kind:'hand'|'chips'|'mult'|'xmult'|'money'|'win'|'lose'|'warden'|'info', sub, hold=900, y=0.36}) -> Promise
export function flash(color='#fff', alpha=0.25, ms=150) -> Promise   // time.flashes=false → aus; reduziert → ×0,3
export function chroma(ms=120, el=#app)                               // Rot/Cyan-Versatz (Klasse .fx-chroma)
export function bigHit({hitstop=60, trauma=0.3, flashAlpha=0.12})     // ×Multi-Paket: Hitstop+Chroma+Shake+Blitz
// ticker.js
export function tickNumber(el, from, to, {duration /*300+250·log10Δ*/, onTick(stepIndex, progress, value) /*≥35 ms*/,
  format(n), pop=true, juice, easing}) -> Promise     // Schluss-Pop 1,25 → 1; neuer Aufruf bricht alten ab
// background.js
export const background = { init(canvas, {resolution=0.5, forceFallback}), setPalette(name|[4 Hex], instant=false),
  setIntensity(0..1), pulse(amount=1), palette, webgl, destroy() }   // Paletten: menu round warden shop win lose
export const PALETTES
// flames.js
export function setFlames(el, intensity 0..1, {color:'chips'|'mult'|'xmult'|'money'|Hex}) // 0 = ausklingen + entfernen
export function clearFlames(), flameIntensity(score, target) -> 0..1   // clamp(log10(score/target)+0.3)
```

### Würfel & Schale (`ui/components/die.js`, `tray.js`)
```js
createDie(dieData, {value, faceIndex, hidden}) -> {
  el, data, value, faceIndex, hidden, held, rolling,
  setData(die), show(value, {faceIndex, hidden}),               // sofort
  roll(value, {delay, duration, suspense, faceIndex, hidden, anticipate=true}) -> Promise (gelandet),
  turn(value, {faceIndex, hidden, ms=380}) -> Promise,          // kurzes Umkippen: Stupser, Wender, Aufdecken
  setHeld(b), setScoring(b), juice(amount), resist(), setDebuffed(b), setShackled(b), rect(), destroy(),
  onLand(impact), onBounce(impact), onLaunch() }                 // Hooks (Zuweisung)
createTray(container, {maxSize=88, minSize=30}) -> {
  el, count, dieSize, dice,
  setDice(dice:Die[], rolled?:Rolled[]), roll(indices|null, values, {suspenseIndex, stagger=50}) -> Promise,
  //   values: Zahl oder {v, faceIndex, hidden}; parallel zu indices ODER voll (values[i]) wenn values.length===Anzahl
  //   suspenseIndex: Standard letzter geworfener Würfel (+300 ms); null = keiner
  setHeld(i, b), onDieClick(fn(i, ev)), getDieRect(i), dieEl(i), die(i), show(i, v, o), turn(i, v, o),
  highlight(indices, {gap=75, amount=0.3, keep=true}) -> Promise, clearHighlight(), setInteractive(b), layout(), destroy(),
  onLand(i, impact), onBounce(i, impact), onLaunch(), onHighlight(i, k) }  // Hooks für Sounds (Zuweisung)
```
DOM-Zustand je Würfel: `.die[data-index][data-value][data-face][data-hidden]`, Klassen `die--held`, `die--scoring`,
`die--rolling`, `die--debuffed`, `die--shackled`, `die--m-<material>`, `die--w<sides>`. Größe über `--die-size` (Schale setzt sie).

Testseite `tools/fx-test.html` (`?nogl` = CSS-Hintergrund): Würfel werfen/halten/umdrehen, alle Effekte per Knopf.

---

## 6. ui

### Bildschirme
`title` (Neues Spiel / Fortsetzen / Sammlung / Einstellungen; Becher- und Stufenwahl) → `blinds` (3 Partien des
Einsatzes als Karten, Wächter mit Wirkung, Überspringen mit Marken-Vorschau) → `play` → `result` (Abrechnung mit
fliegenden Münzen) → `shop` (↔ `pack`) → `blinds` … → `gameover` (Sieg/Niederlage, Statistik, Endlos/Neu).

### `play`-Bildschirm (Querformat; Hochformat stapelt)
```
┌──────────────┬──────────────────────────────────────────────────┐
│ Partie/Ziel  │  [Talisman][Talisman][Talisman][ ][ ]   [Verbr.] │
│ Ergebnis     │                                                  │
│ ┌──────────┐ │           ⬛ Filz-Schale mit Würfeln ⬛            │
│ │HANDNAME  │ │       🎲   🎲   🎲   🎲   🎲   (gehalten = höher)  │
│ │PUNKTE×MUL│ │                                                  │
│ └──────────┘ │   Handwahl: [Paar ▸ Drilling ▸ Full House]       │
│ Würfe  Nachw.│   [ NACHWÜRFELN (2) ]      [ WERTEN ]            │
│ $ Geld       │                                                  │
│ Einsatz 3/8  │                 Handtabelle (Info)               │
└──────────────┴──────────────────────────────────────────────────┘
```
- Ein Wurf startet automatisch („Wurf beginnen“ Knopf + Leertaste; Option „automatisch werfen“).
- Würfel: Klick/Tippen oder Tasten 1–7 = halten. Leertaste/R = nachwürfeln, Enter = werten.
- Handwahl als Chips unter der Schale; Live-Vorschau Basis-Punkte × Multi im Scorebox.
- Würfel-Inspektor (`components/inspector.js`): zeigt alle Würfel als Netz (alle Flächen) – Ziel für Werkzeuge,
  auch als reine Ansicht („Deine Würfel“).
- Talismane: Karten mit `glyph` + Farbe aus `hue`, Seltenheitsrand, Tooltip mit `describe()`, Drag & Drop zum
  Umsortieren, Verkaufen über Tooltip-Knopf.

### Scoreplayer (`ui/scoreplayer.js`)
Spielt `ScoreResult.steps` ab:
- `hand`: Banner mit Handname, Scorebox setzt Basis, Hand-Sound.
- Würfelschritte: Würfel juice + hebt sich, Popup über dem Würfel (Farbe nach Typ), Zielbox wackelt,
  Ton `chip`/`mult` mit steigender Stufe, Zeitabstand `450 ms × 0,9^n`, min. 120 ms (÷ speed).
- Talismanschritte: Karte springt hoch + juice, Popup an der Karte, `xmult` mit Hitstop 60 ms, Chroma, Trauma +0,3.
- Ende: Punkte × Multi verschmelzen zur Summe (Ticker), Ergebnis zählt hoch; Trauma ∝ log10(Summe);
  Flammen, wenn `cleared`; Ziel überschritten → Flash, Konfetti, `target_cross`.
- Tippen/Klicken während des Abspielens = `time.skipping` (Rest in ≤ 300 ms).

### Einstellungen
Spielgeschwindigkeit (0,5/1/2/4), Lautstärken (Gesamt/Effekte/Musik), Bildschirmwackeln (0/50/100 %),
Blitze an/aus, CRT an/aus, Bewegung reduzieren (Standard aus `prefers-reduced-motion`), automatisch werfen,
Spielstand löschen.

### Farben (CSS-Variablen in `style.css`)
```
--bg0:#0d0b1f; --bg1:#1b1338; --bg2:#2a1650; --felt:#123c3a; --felt-edge:#0a2422;
--chips:#3ee6c4; --mult:#ff5fa2; --xmult:#ffd166; --money:#f9c74f; --text:#f4ecd8; --muted:#9b8fb8;
--die:#f4ecd8; --pip:#231a2e; --outline:#120c1e;
--common:#7fb8ff; --uncommon:#5be37d; --rare:#ff6b6b; --legendary:#c77dff;
```
Dicke dunkle Konturen (3 px), harte Schatten (`0 4px 0 var(--outline)`), Pixel-Schrift, Zahlen `tabular-nums`.

### Responsiv & Eingabe
Pointer-Events überall, Touch-Ziele ≥ 44 px, Hover-Effekte nur bei `(hover: hover)`, Langdruck 350 ms = Tooltip.
Hochformat: Talismane oben, Scorebox kompakt oben, Schale Mitte, Knöpfe unten.

---

## 7. Zuständigkeiten (Agenten)
| Bereich | Dateien |
|---|---|
| Logik & Inhalte | `src/core/**`, `src/game/**`, `tests/**`, `tools/sim.mjs` |
| Audio | `src/audio/**`, `tools/audio-test.html` |
| FX & Würfel-Darstellung | `src/fx/**`, `src/ui/components/die.js`, `src/ui/components/tray.js`, `tools/fx-test.html`, Basis-Styles in `style.css` (Abschnitt `/* === fx & dice === */`) |
| UI & Integration | `src/main.js`, `src/ui/**` (außer die/tray), `index.html`, restliches `style.css` |
Jeder Agent ändert nur seine Dateien; Schnittstellenänderungen werden in diesem Dokument nachgetragen.
