# Übergabenotizen der Build-Agenten

## Audio (src/audio)
- `audio.*` ist vor `init()` und in Node gefahrlos; `init()` bei JEDER Nutzergeste aufrufen (idempotent, resumed).
- Gedrosselte Sounds: hover 35 ms, tick 30 ms, dice_clack 6 ms Mindestabstand.
- `play(name, {step, gain, pitch, pan})`: step = Pentatonik-Stufe (chip/mult bis 12, tick bis 10, darüber glitzernder);
  `tick` akzeptiert auch `{progress:0..1}`; bei `dice_clack` ist gain = Aufprallstärke (0–2).
- Musik: Moods menu/round/shop/warden, Wechsel am nächsten Takt; `scoringOpen(bool)`; `duck(db=4, ms=400)` (dB als Betrag).
- `src/audio/offline.js` nur für Tests. Testseite: `tools/audio-test.html`.

## FX & Würfel (src/fx, ui/components/die.js, tray.js)
- Einmal `initFx({palette:'menu'})` (aus `src/fx/index.js`, re-exportiert alles, plus `setCRT`).
- `const tray = createTray(el); tray.setDice(run.dice, round.rolled)`; Wurf: `await tray.roll(indices, results)`
  (values = Zahlen oder Rolled-Objekte `{v, faceIndex, hidden}`; parallel zu indices ODER volle Länge).
  Spannungswürfel: standardmäßig der letzte (+300 ms); `suspenseIndex:null` schaltet ab. Gehaltene Würfel nie werfen.
- Sounds über Hooks verdrahten: `tray.onLand=(i,imp)=>audio.play('dice_clack',{gain:imp})`, `onBounce`, `onLaunch` (rattle),
  `onHighlight(i,k)` (chip-Stufe k); `tickNumber(..., {onTick(step,progress,value)})`.
- Wertung: `await tray.highlight(dice)`; Popups an `tray.getDieRect(i)` (oben Mitte); danach `tray.clearHighlight()`.
- KEIN eigenes CSS-`transform` auf Elemente, die juice/pressable/flames bekommen – Wrapper nutzen. `#app` bekommt den Shake.
- Flammen hängen ein Canvas in die Box (isolation:isolate; position:relative falls static).
- Klassen: `.die` (data-index/value/face/hidden), `.die--held/--scoring/--rolling/--debuffed/--shackled/--m-<mat>/--w4|6|8`;
  `.tray > .tray-felt > .tray-row`, `--die-size`, `--die-gap`; `#fx-layer` (z 60), `.fx-popup--*`, `.fx-banner--*`, `body.crt`, `body.fx-reduced`.
- Einstellungen: `time.speed`, `shake.strength` (0/0.5/1), `time.flashes`, `setCRT()`, `time.reducedMotion`; Tippen beim Werten: `time.skipping=true`.
- Extras: `bigHit()`, `particles.flyCoins(x0,y0,x1,y1,{count,onArrive})`, `particles.ring`, `die.turn()` (Stupser/Wender/Aufdecken), `nope(el)` (nicht leisten können).
- Testseite `tools/fx-test.html` (`?nogl` = CSS-Fallback).

## Logik (src/game, src/core)
- `import * as G from './game/index.js'` – Aktionen, Inhalte (G.TALISMANS, G.CONSUMABLES, G.WARDENS, G.VOUCHERS, G.PACKS,
  G.TAGS, G.CUPS, G.STAKES, G.HANDS, G.ACHIEVEMENTS, G.MARK_INFO, G.MATERIAL_INFO, *_IDS), `G.meta`. Aktionen werfen nie.
- Extras: `mustFizzle`, `previewCashOut`, `sellPrice`, `handTable`, `describe*` (Talisman/Consumable/Hand/Warden/Voucher/Tag/Pack/Stake/Offer),
  `serializeRun`, `loadRun`, `isOver`, `validateTarget`, `anteBase`, `blindTarget`. `previewScore` NUR Bot/Debug.
- Index i gleich in `run.dice` und `round.rolled`. Nach dem Werten `round.rolled = null` → nächster Wurf braucht `beginThrow`.
- Phasen: blinds → round → cashout → shop ⇄ pack → blinds …; Sieg in Einsatz 8 → 'won'; `continueEndless` → cashout.
- `availableHands` Einträge: handId, name, rank, dice, scoring, values, base{chips,mult}, level, allowed, reason, secret, hidden.
- Fehlwurf: `mustFizzle(run)` true → `scoreThrow(run)` wertet 0 Punkte (`result.fizzle`), kostet Wurf.
- Nebel/Finsternis: `hidden:true` (roll-Events liefern null für versteckte Werte, UI zeigt „?“); Fessel: `shackled:true`;
  Wender: `flip`-Event nach Nachwurf; Dieb: `talisman.disabled`.
- Werkzeug-Ziele: face `{die,face[,value]}` · faces `{faces:[{die,face},…]}` (Spiegel: 2, gleicher Würfel, erste = Vorlage) ·
  die `{die}` · rolled `{rolled[,delta:±1]}` · null. Fehler verbraucht nichts.
- Beutel: Kauf öffnet sofort (phase 'pack'); Marken-Beutel direkt nach Überspringen. Werkzeug/Mystik im Beutel:
  `target===undefined` = behalten, sonst sofort benutzen. Würfel: `{die:i}` ersetzt. Event `packClosed` nach letzter Wahl.
- Meta: `newProfile, migrateProfile, syncProfile(profile, run), finishRun(profile, run), isCupUnlocked, maxStake,
  collectionSummary`; Keys `PROFILE_KEY`/`RUN_KEY` mit core/storage.js.
- Event-Typen vollständig in ARCHITECTURE §3.

## QA-/Feel-Pass
- Toasts: höchstens 2 sichtbar, doppelte Meldungen werden zusammengefasst, oben rechts (Hochformat oben Mitte),
  klick-durchlässig (`pointer-events:none`) und unter Dialogen (z 79) – sie verdecken nie einen Knopf.
- Scorebox: `sb.setIdle()` zeigt ohne liegende Würfel den letzten Wurf gedimmt („Letzter Wurf“, `sb.last` setzt der
  Scoreplayer) bzw. „Bereit“; außerhalb des Spiel-Bildschirms ruft `hud.update()` das automatisch auf.
- `hoverTilt` setzt `.fx-hover` + `--fx-lift`: ein `::before` hält die alte Trefferfläche, damit angehobene Karten am
  unteren Rand nicht flackern/Klicks verlieren.
- Neuer Sound `tension` (Anstieg + Herzschlag): letzter Wurf der Partie (Banner „Letzter Wurf!“, Schale pulsiert rot,
  `.play--last`) und Nachwurf mit nur 1–2 offenen Würfeln (`tray.roll(..., {forceSuspense})`).
- Halten: zusätzlich leises `dice_clack` + juice. Neue Hand-Chips ploppen auf; bessere Hand → Scorebox-Pop.
- Partie-Sieg (Einsatz 8): Feuerwerk/Goldblitz im Spiel-Bildschirm (`app.wonFanfare`, Spielende spielt die Fanfare
  nicht doppelt). Niederlage: Hitstop, roter Blitz, Würfel „tot“, Welt entsättigt (`.fx-defeat`), ~1,5 s.
- Querformat-Handy (`landscape and max-height:500px`): eigener kompakter Block am Ende von `style.css`; der
  Hochformat-Block greift bei `max-width:760px` nur noch ab 501 px Höhe.
- Laden-Palette (background.js `shop`) Petrol/Violett statt Gelb-Grün. Zähler zählen mit outQuart (kein toter Auslauf).

## Formsprache der Gegenstände (ui/components/itemshapes.js)
- `createCard` wählt per `shapeOf(model)` die Form; neue Inhalte brauchen nur `glyph`/`hue`/`rarity`/`kind`.
- Talisman-Zustandsabzeichen weiter über `.card-badge` (belt.js `badgeFor`, inkl. `def.badge`).
- Verdeckt (`.card--down`) zeigen Formen ihre dunkle Silhouette + „?“, Talismane die Kartenrückseite.
- Kleine Symbole `shapeIcon(form)` in Laden-Etiketten, Tooltips, Kartenmenü; Toasts nehmen `{shape}`.
- Animationen nur transform/opacity (Legendär-Schimmer, Goldfolie, Mystik-Nebel, Edelstein-Glimmen); `body.fx-reduced` stoppt sie.

## Talismane 49–100 (talismans2.js)
- `makeExtraTalismans(TALISMANS)` liefert die 52 neuen Definitionen; talismans.js hängt sie an `T` an → ein gemeinsames
  `TALISMANS`/`TALISMAN_IDS` (100). Neue generische Hooks/Flags: siehe Kopf von talismans.js und ARCHITECTURE §2.
- Karten-Zähler: `def.badge(t)` (belt.js `badgeFor` fragt ihn zuerst). Zündschnur zerbricht direkt aus `scoreThrow`
  (`talismanBreak` → play.js `breakCard`), Leuchtturm erzeugt `retrigger`-Schritte ohne `dieIndex` (Popup an der Karte).
- Bot-Auswertung je Talisman: `node tools/sim.mjs --runs 400 --seed B --by-talisman` (Lift-Spalte, DESIGN §14).
