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
Die   = { id: string, sides: 4|6|8, faces: Face[], material: null|'lead'|'bone'|'prism'|'crystal'|'phantom',
          src?: uid /* Würfel gehört zu einem Talisman (Sechster Sinn) – zählt nicht gegen das Limit */ }
Rolled = { dieId, faceIndex, v /* Logikwert inkl. Stupser – bei hidden NICHT anzeigen ("?") */, hidden: bool,
           held: bool, shackled: bool /*Fessel: nicht haltbar*/, nudged: int /*Summe der Stupser*/ }
Talisman = { uid: string, id: string, state: {} /*z.B. {n:3} für skalierende*/, disabled: bool /*Dieb*/ }
Consumable = { uid, id }
Run = {
  version: 1, seed: string, cup: string, stake: int,
  rng: { roll, shop, chance, warden, pack, misc },       // Streams {s:uint32}
  ante: int, blindIndex: 0|1|2,                          // aktuelle/ nächste Partie
  phase: 'blinds'|'round'|'cashout'|'shop'|'pack'|'won'|'lost',   // ('endless' wird nicht benutzt: run.endless)
  money: int, dice: Die[], talismans: Talisman[], consumables: Consumable[],
  limits: { talismans: 5, consumables: 2, dice: 5, shopSlots: 2 },
  base: { throws: 4, rerolls: 3, interestCap: 5 },
  handLevels: { [handId]: int /*1..*/ }, handPlays: { [handId]: int },
  vouchers: string[], tags: string[] /*gehaltene Marken (ohne Beutel-Marken)*/,
  wardens: { current: string, seen: string[] },          // Wächter des aktuellen Einsatzes
  blinds: [ {kind:'small'|'big'|'warden', name, target, reward, state:'upcoming'|'current'|'skipped'|'done',
             tagOffer /*Marken-ID, null beim Wächter*/, wardenId? /*nur Wächter*/} ×3 ],
  round: null | {
    kind, wardenId|null, target, score, throwsLeft, rerollsLeft, rolled: Rolled[]|null /*Index = Index in run.dice*/,
    rolledThisTurn: bool, rerollsUsedThisThrow: int, rerollsUsed: int, throwsUsed: int,
    playedHands: string[], lastHandRank: int, flags: { grudged: dieId[], rebate: int, secondWindUsed, thiefUid? }
  },
  shop: null | { offers: Offer[], packs: Offer[], voucher: Offer|null, rerollCost: int, rerolls: int,
                 freeRerolls: int /*Ausverkauf*/, sale: bool },
  pack: null | { packId, choices: Offer[], picksLeft: int, returnPhase: 'shop'|'blinds' },
  pendingPacks: string[],      // Gratis-Beutel aus Marken (werden automatisch nacheinander geöffnet)
  anteVoucher: string|null, wardenRerolledAnte: int, endless: bool, won: bool, nextUid: int,
  seen: { talismans: [], consumables: [], wardens: [] },  // für die Sammlung
  stats: { throws, rerolls, bestThrow, bestHand, moneyEarned, hands:{id:n}, roundsWon, wardensBeaten,
           wardensBeatenIds, skips, constellationsUsed, consumablesUsed, talismansBought, maxTalismans, maxMoney,
           glassShattered, retriggers, maxRetriggers, legendaryOwned, wardenNoReroll, maxHandLevel, highestAnte,
           packsOpened, shopRerolls, scoreByAnte:{ante:best}, lostTo: null|{ante, blind, wardenId, score, target} },
  metaRecorded?: {...}         // gesetzt von meta.finishRun
  log: []
}
Offer = { kind:'talisman'|'consumable'|'pack'|'voucher'|'die', id, price, basePrice?, sold:bool, free?:bool,
          die?: Die /*nur Würfelbeutel*/ }
```
Würfel-Reihenfolge in der Schale = `run.dice`-Reihenfolge = `round.rolled`-Reihenfolge (Index `i` überall gleich).
Wächter-Effekte im Rolled-State: **Nebel/Finsternis** → `hidden:true` (Werte zählen für Hände trotzdem; UI zeigt „?“,
`roll`-Events liefern dafür `null`), **Fessel** → `shackled:true` (toggleHold lehnt ab), **Wender** → `flip`-Event
nach dem Nachwurf, **Dieb** → `talisman.disabled:true` für die Partie.

### Inhaltsdefinitionen (`content/*.js`)
```js
// talismans.js
export const TALISMANS = { snake_eye: {
  id, name:'Schlangenauge', rarity:'common'|'uncommon'|'rare'|'legendary', price:5,
  desc:'+8 Multi je gewerteter 1.', copyable: true, glyph: '⚀', hue: 140, init?: {n:0} /*Startzustand*/,
  // Hooks (alle optional, rein). Wertungs-Hooks geben Effekte zurück:
  //   [{type:'chips',amount}|{type:'mult',amount}|{type:'xmult',factor}|{type:'money',amount}|{type:'text'|'grow',text}]
  onDie(ctx, d, t), retrigger(ctx, d, t) -> int, preHand(ctx, t) /*Wachstum, nicht kopiert*/, onHand(ctx, t),
  onScored(ctx, t), modifyRules(rules, run, t), onReroll(run, t, round) -> events, onRoundEnd(run, t, info) -> events,
  cashout(run, t) -> $, onAcquire(run, t), onRemove(run, t), describe(t, run) -> string|null
}}
```
`CONSUMABLES` (`kind:'star'|'tool'|'mystic'`, `price`, `hand` bei Sternbildern, `target`, `usableIn: 'any'|'round'`,
`use(run, target) -> events`, `validate?(run, target) -> Fehlertext|null`), `WARDENS` (`minAnte`, `finale`,
`targetMul?`, Regel-Flags: `leaden, rerollsZero, throwsOne, noRepeat, fixation, fogCount, eclipse, toll, shackle,
turner, thief, grudge, chill`), `VOUCHERS` (`price`, `requires`, `apply(run)`), `PACKS` (`price, kind, size, picks,
weight`), `TAGS` (`timing:'now'|'shop'|'round'|'warden'|'tag'`, `pack?`), `CUPS` (`unlock` = Erfolgs-ID, `targetMul?`,
`apply(run)`), `STAKES` (1–5), `ACHIEVEMENTS` (`check(stats)`, `unlocks:{kind:'cup', id}|null`).
Prägungen/Materialien: `MARK_INFO`, `MATERIAL_INFO` (name, desc, glyph, hue) aus `constants.js`.

Jedes Inhaltsobjekt hat `id, name, desc` und für die Darstellung `glyph` (1–3 Zeichen, Unicode-Symbole erlaubt,
keine Emojis) und `hue` (0–360).

**Werkzeug-Ziele** (`CONSUMABLES[id].target` → Form des `target`-Arguments; `die` = Index in `run.dice`,
`face` = Flächenindex):
| target | Argument | Beispiele |
|---|---|---|
| `null` | `null` | Sternbilder, Münzwurf, Seher, Phantomhauch, Doppelgänger, Seelenstein, Wunschbrunnen |
| `{type:'face', count:1}` | `{die, face}` | Goldlack, Rubinstaub, Echo-Rune, Steinmetz, Sternenstaub |
| `{type:'face', count:1, value:true}` | `{die, face, value}` (1 … sides) | Meißel |
| `{type:'faces', count:2}` | `{faces:[{die, face}, …]}` (1–2 verschiedene) | Azurtinte, Glasbläser, Kleeblatt |
| `{type:'faces', count:2, exact:true, sameDie:true}` | `{faces:[Vorlage, Ziel]}` | Spiegel |
| `{type:'die'}` | `{die}` | Bleiguss, Former (nur W6), Prismensplitter, Kristallauge |
| `{type:'rolled', delta:true}` | `{rolled, delta: +1\|-1}` (nur im Wurf) | Stupser |
| `{type:'rolled'}` | `{rolled}` (nur im Wurf, nicht verdeckt) | Wende |

---

## 3. game – Aktionen (`game/run.js`, alles gebündelt in `game/index.js`)

Alle Aktionen mutieren `run` und geben `{ ok:true, events:[...] }` oder `{ ok:false, reason:'…deutscher Text…' }`
zurück (nie Exceptions). Events sind kleine Objekte, die die UI animiert (Typen unten). Die UI liest danach den
Zustand neu. **Import:** `import * as G from './game/index.js'` – enthält alle Aktionen, alle Inhalte
(`G.TALISMANS`, `G.CONSUMABLES`, `G.WARDENS`, `G.VOUCHERS`, `G.PACKS`, `G.TAGS`, `G.CUPS`, `G.STAKES`, `G.HANDS`,
`G.ACHIEVEMENTS`, `G.MARK_INFO`, `G.MATERIAL_INFO`, `*_IDS`-Listen, `G.content` als Sammelobjekt) und `G.meta`.

```js
newRun({ seed, cup='wood', stake=1 }) -> Run
startBlind(run)                    // 'blinds' → 'round' (aktuelle Partie). events [{type:'warden',id}, talismanDisabled, tagUsed]
skipBlind(run)                     // kleine/große Partie überspringen → Marke; events [{type:'tag', id}, ggf. {type:'packOpen'}]
                                   //   Beutel-Marken öffnen sofort (phase 'pack', danach zurück zu 'blinds')
rerollWarden(run)                  // Privileg v_ban, 1× pro Einsatz, phase 'blinds'
beginThrow(run)                    // Wurf beginnen: alle Würfel werfen. events [{type:'roll', dice:[i...], results:[v|null]}]
toggleHold(run, i)                 // i = Index in round.rolled; events [{type:'hold'|'unhold', die:i}]
reroll(run)                        // Nachwurf; events [{type:'roll',…}, ggf. money (Zöllner/Rabatt), talismanGrow, flip]
availableHands(run) -> [{ handId, name, rank, dice:[i...] /*Hand*/, scoring:[i...] /*+ Stein*/, values:int[]
                          /*Belegung inkl. Wild*/, base:{chips, mult} /*inkl. Stufe + Kälte*/, level, allowed:bool,
                          reason:string|null, secret:bool, hidden:bool /*verdeckte Würfel beteiligt*/ }]  // ranghöchste zuerst
mustFizzle(run) -> bool            // keine erlaubte Hand → nur Fehlwurf möglich (scoreThrow ohne handId)
previewHand(run, handId?) -> { handId, name, chips, mult, dice /*wertende*/, level, allowed } | null
previewScore(run, handId?) -> ScoreResult-artig (auf Kopie; verrät Zufall – nur Bot/Debug)
scoreThrow(run, handId?) -> { ok, result: ScoreResult, events }  // wertet; prüft Sieg/Niederlage/Zweiter Atem
previewCashOut(run) -> [{label, amount, kind}] | null
cashOut(run) -> { ok, events, breakdown:[{label, amount, kind:'reward'|'throws'|'interest'|'talisman'|'tag'}], total }
                                   // 'cashout' → 'shop' (Laden wird aufgebaut, Laden-Marken eingelöst)
shopReroll(run)                    // nur Angebotsplätze; Ausverkauf: freeRerolls zuerst
buy(run, offerIndex | {section:'offers'|'packs'|'voucher', index})  // Beutel öffnen sich sofort (phase 'pack')
sell(run, {kind:'talisman'|'consumable', uid}) / sellPrice(run, {kind, uid}) -> $
moveTalisman(run, from, to)
useConsumable(run, uid, target) -> {ok, events}   // target gemäß Tabelle §2; prüft Ziel, Phase, Plätze
validateTarget(run, consumableDef, target) -> Fehlertext|null
openPack(run)                      // öffnet den nächsten wartenden Gratis-Beutel (normalerweise automatisch)
pickFromPack(run, choiceIndex, target?)
   // Talisman: braucht freien Platz. Sternbild: sofort angewendet.
   // Werkzeug/Mystik: target === undefined → behalten (freier Platz nötig);
   //                  sonst sofort benutzen (target-Objekt wie bei useConsumable, null bei zielfreien Gütern).
   // Würfel (Offer.die): target {die:i} ersetzt run.dice[i]; ohne target nur, wenn das Würfellimit Platz hat.
   // Nach der letzten Wahl (picksLeft 0) schließt der Beutel: events […, {type:'packClosed'}] und phase = returnPhase.
skipPack(run)
leaveShop(run)                     // → nächste Partie ('blinds'), nach dem Wächter neuer Einsatz (event newAnte)
continueEndless(run)               // 'won' → 'cashout', run.endless = true
getRoundRules(run) -> { throws, rerolls, interestCap, talismanSlots, consumableSlots, diceLimit, target, reward,
                        wardenId, throwsLeft?, rerollsLeft? }  // effektive Werte inkl. Talismane/Privilegien/Wächter/Stufe/Marken
handTable(run) -> [{handId, name, level, chips, mult, plays}]   // Info-Tabelle (geheime erst nach dem ersten Werten)
describeTalisman(t, run), describeConsumable(c, run), describeHand(id, run), describeWarden(id),
describeVoucher(id), describeTag(id), describePack(id), describeStake(id), describeOffer(run, offer)
serializeRun(run) -> string, loadRun(stringOrObject) -> Run|null, isOver(run) -> bool
anteBase(ante), blindTarget(run, kind, wardenId), interest(run), priceFor(run, basePrice)
```

### ScoreResult (wichtigste Schnittstelle Logik → Animation)
```js
ScoreResult = {
  handId, handName, level, total, chips, mult /*Endwerte*/, scoreBefore, scoreAfter, target, cleared: bool,
  dice: [i...] /*wertende Würfel*/, money /*in der Wertung verdient*/, fizzle: bool /*Fehlwurf: total 0*/,
  steps: Step[],   // in exakt der Reihenfolge, in der sie animiert werden
}
Step = {
  type: 'hand'      // Basis gesetzt (chips/mult = Basis; bei Fehlwurf 0/0)
      | 'chips'     // +Punkte:              {amount}
      | 'mult'      // +Multi:               {amount}
      | 'xmult'     // ×Multi:               {factor}
      | 'money'     // Geld:                 {amount}
      | 'retrigger' // „Nochmal!“            {}   – steht VOR der Wiederholung des Würfels
      | 'text'      // Hinweis (z.B. „Kein Glück“, „Groll: keine Augen“, „Kälte: …“, „Fehlwurf …“) {text}
      | 'shatter'   // Glasfläche zerspringt {}   (in den Nachwirkungen)
      | 'grow',     // skalierender Talisman wächst {text}
  source: { kind:'hand'|'die'|'talisman'|'warden'|'face', index:int /* Würfel- oder Talisman-Index, -1 sonst */, uid? },
  chips, mult,     // laufende Werte NACH diesem Schritt (UI zeigt sie direkt an; mult kann Fließkomma sein)
  dieIndex?: int,  // bei Würfelschritten (auch Talisman-„onDie“-Schritten): welcher Würfel
}
```
Die UI braucht nichts nachzurechnen: sie zeigt nach jedem Schritt `chips`/`mult` an; `total = floor(chips × mult)`.

### Event-Typen (Rückgaben der Aktionen)
`roll {dice:[i], results:[v|null]}` · `hold/unhold {die}` · `flip {die, v, faceIndex}` · `nudge {die, v}` ·
`money {amount, reason}` · `tag {id}` · `tagUsed {id}` · `warden {id}` · `talismanDisabled {uid}` ·
`talismanGrow {uid, text}` · `talismanBreak {uid}` · `faceShatter {dieId, faceIndex}` · `roundWon` · `roundLost` ·
`runWon` · `extraThrow {uid}` (Zweiter Atem) · `newAnte {ante, wardenId}` · `shopReroll` · `packOpen {packId}` ·
`packClosed` · `gainTalisman {uid, id}` · `gainConsumable {uid, id}` · `consumableUsed {id}` · `levelUp {handId, level}` ·
`faceChange {dieId, faceIndex, v?, mark?}` · `dieChange {dieId, material?|sides?}` · `gainDie {dieId}` ·
`replaceDie {index, dieId, oldDieId}` · `voucher {id}` · `sold {kind, uid}` · `move {from, to}` ·
`message {text}` · aus `meta`: `unlock {kind:'cup'|'stake', id, stake?}` · `achievement {id}`.

### Hände (`game/hands.js`)
```js
export const HANDS = { pair: {id, name, rank, chips, mult, perLevel:{chips, mult}, secret, desc, glyph, hue}, ... }
export const HAND_ORDER  // aufsteigend nach Rang
export function detectHands(values:int[] /*0 = keine Augen*/, wildMask:bool[], {wildMax}) -> [{handId, dice:[i...], values}]
// alle enthaltenen Hände, ranghöchste zuerst; bei Wild: beste Belegung (Multimengen-Suche, n ≤ 7)
export function handBase(handId, level) -> {chips, mult}
export function contains(handId, otherId) -> bool  // Enthaltensein-Relation für Talismane und Fixierung
```
`smallrun` ⊂ `bigrun` ⊂ `skyladder`; `pair` ⊂ `twopair` ⊂ `fullhouse`; `pair` ⊂ `triple` ⊂ `fullhouse`;
`triple` ⊂ `quad` ⊂ `pasch` ⊂ `sixer`. `parity` steht für sich. `scatter` ist immer verfügbar.

### Meta (`game/meta.js`, rein; als `G.meta`)
```js
PROFILE_KEY = 'pasch.profile', RUN_KEY = 'pasch.run'
newProfile() -> Profile    // {version, settings:{speed, volume:{master,sfx,music}, muted, shake, flashes, crt,
                           //   reducedMotion, autoThrow}, stats, collection:{talismans:{id:'seen'|'owned'},
                           //   consumables:{id:'seen'}, hands:{id:1}, wardens:{id:'seen'|'beaten'}},
                           //   unlocks:{cups:[id], stakes:{cupId:maxStake}}, achievements:{id:true}, history:[]}
migrateProfile(obj) -> Profile           // auch für null/alte Stände
syncProfile(profile, run) -> events      // während des Laufs (idempotent): Sammlung + Erfolge/Freischaltungen
finishRun(profile, run) -> events        // bei 'lost'/'won' (und erneut am Ende von Endlos: nur Zuwachs)
isCupUnlocked(profile, cup), maxStake(profile, cup) -> 0..5, collectionSummary(profile), aggregateStats(profile, run)
```
Persistenz: `core/storage.js` `load(key, fallback)` / `save(key, value)` / `remove(key)`;
z. B. `profile = G.meta.migrateProfile(load(G.meta.PROFILE_KEY, null))`, `run = G.loadRun(load(G.meta.RUN_KEY, null))`.

### Balance-Bot (`tools/sim.mjs`)
`node tools/sim.mjs --runs N --seed S --cup ID --stake N [--verbose] [--samples K]`. Spielt N Läufe headless: Halten nach
Monte-Carlo-Erwartungswert über Kandidaten (gleiche Augen, Straßenfenster, Parität …), Nachwürfe solange der
Erwartungswert steigt, Talismankauf nach echtem Nutzen (letzte 24 Würfe des Bots mit/ohne Talisman neu gewertet),
levelt die Haupthand, benutzt Werkzeuge mit einfacher Zielwahl. Meldet Siegquote, Endstation je Einsatz, Niederlagen
nach Partie/Wächter, Punkte je Wurf und Geld je Einsatz. `playRun(seed, {cup, stake, fast})` ist exportiert
(`fast:true` = Preis-Heuristik statt Neuwertung, für Tests). Ergebnisse: DESIGN §14.

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
- Formsprache (`components/itemshapes.js`, von `createCard` genutzt): jede Kategorie eigene Silhouette (inline SVG
  100×140, gleiche Trefferfläche `--cw × 1,4`): Talisman = gerahmte Karte (Rahmen = Seltenheitsfarbe, Edelstein
  ● gewöhnlich / ◆ ungewöhnlich / ⬢ selten / ✦ legendär + Schimmer, Amulett an Kette, Namensband) · Sternbild =
  achteckige Sternenkarte (Sternbild deterministisch aus der ID, Handname + „+1 Stufe“) · Werkzeug = Hängeetikett ·
  Mystik = Kristall-Raute mit Nebel · Beutel = Stoffbeutel mit Aufnäher · Privileg = perforierter Coupon mit Stempel ·
  Würfelbeutel-Würfel = echter Würfel auf Samtkissen (verdeckt unter Glocke). Klassen `.card--shape.shape-<form>`,
  Glyphe `.sg`, Name `.sn`. Leisten: Talismane in Samt-Vitrine, Verbrauchsgüter in Leder-Tasche.

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
