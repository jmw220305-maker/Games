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
