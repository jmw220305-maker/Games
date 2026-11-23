# Übergabenotizen der Build-Agenten

## Audio (src/audio)
- `audio.*` ist vor `init()` und in Node gefahrlos; `init()` bei JEDER Nutzergeste aufrufen (idempotent, resumed).
- Gedrosselte Sounds: hover 35 ms, tick 30 ms, dice_clack 6 ms Mindestabstand.
- `play(name, {step, gain, pitch, pan})`: step = Pentatonik-Stufe (chip/mult bis 12, tick bis 10, darüber glitzernder);
  `tick` akzeptiert auch `{progress:0..1}`; bei `dice_clack` ist gain = Aufprallstärke (0–2).
- Musik: Moods menu/round/shop/warden, Wechsel am nächsten Takt; `scoringOpen(bool)`; `duck(db=4, ms=400)` (dB als Betrag).
- `src/audio/offline.js` nur für Tests. Testseite: `tools/audio-test.html`.
