# Nachtglut

*Die Sonne im Herzen der Welt ist erloschen. Trag die letzte Glut hinab und entzünde sie neu.*

Nachtglut ist ein düsteres Top-Down-Action-Roguelite für den Browser. Als Glutträger steigst du durch fünf Schichten des Schattenschachts hinab – **Aschegruben, Sporengrotten, Frostadern, Schattenkern, Sonnenherz** – bis zur Erloschenen Sonne. Wer fällt, wird zu Asche, und diese Asche nährt am **Aschealtar** den nächsten Abstieg.

Alles ist selbst gebaut: Vanilla JavaScript, Canvas 2D und WebAudio, ohne Laufzeit-Abhängigkeiten. Grafik, Soundeffekte und Musik entstehen zur Laufzeit im Code; es gibt keine einzige Bild- oder Audiodatei.

## Spielen

**Ohne Installation:** `dist/nachtglut.html` herunterladen und doppelklicken. Die Datei enthält das ganze Spiel und läuft offline.

**Aus dem Quellcode:**

```bash
cd nachtglut
npm start            # Dev-Server auf http://localhost:8080
```

### Steuerung

| Aktion | Tastatur / Maus | Gamepad | Touch |
|---|---|---|---|
| Bewegen | WASD / Pfeiltasten | linker Stick | linker Daumen (virtueller Stick) |
| Zielen & Schießen | Maus + Linksklick | rechter Stick + RT | automatisch (Auto-Zielen) |
| Ausweichen (Dash) | Leertaste / Shift | A / LT | Dash-Knopf |
| Fähigkeit | Q / F / Rechtsklick | X / LB | Fähigkeits-Knopf |
| Waffe wechseln | R / Tab | Y | Wechsel-Knopf |
| Interagieren | E / Enter | B | Interagieren-Knopf |
| Karte | M | Back | Karten-Knopf |
| Pause | Esc / P | Start | Pause-Knopf |

Auto-Zielen und Auto-Feuer lassen sich in den Einstellungen auch für Tastatur und Maus einschalten.

## Was drinsteckt

- **5 Charaktere** mit eigener Fähigkeit und Passiv: Glutträger, Schattenläuferin, Eisenwächter, Frostweberin, Aschenkind
- **15 Waffen** mit je 5 Stufen, vom Glutbolzen über Mörser, Bumerang-Scheibe und Kettenblitz bis zum Eisenhammer
- **27 Gegnertypen** mit eigenem, immer angekündigtem Angriffsverhalten und **12 Elite-Modifikatoren**
- **5 mehrphasige Bosse**: Schlackenkönig, Myzelmutter, Reifwyrm, Umbra der Zwillingsschatten, Die Erloschene Sonne
- **78 Relikte, 12 Flüche, 36 Segen, 12 Schreine**, die zu Builds rund um Feuer, Frost, Gift, Blitz, Schatten, Krits, Dash oder Fähigkeiten kombinieren
- **Prozedurale Etagen**: Raumgraph mit Abzweigungen und Schleifen, 18 Raum-Layouts, 6 Raumformen, Shops, Schatzkammern, Schmieden, Brunnen, Herausforderungs- und Geheimräume
- **Meta-Progression**: 26 Upgrades am Aschealtar, 11 Glutstufen (Schwierigkeitsgrade), freischaltbare Charaktere und Waffen, 45 Erfolge, Chronik mit Bestiarium und Statistiken
- **Desktop, Gamepad und Handy** (Hoch- und Querformat), Spielstand-Export und -Import

## Entwicklung

```bash
npm test                                   # alle Unit- und Integrationstests (node --test)
npm run build                              # dist/nachtglut.html (eine offline lauffähige Datei)
node tools/sim.mjs --god --seconds 300     # Bot spielt headless, mit Bericht
node tools/dump-floor.mjs 2 meinseed       # Etage als ASCII-Karte
```

Testseiten im Dev-Server: `tools/art-gallery.html` (alle Sprites und Biome), `tools/audio-test.html` (alle Sounds und Musikstücke). URL-Optionen für Tests: `?autostart=1&seed=abc&god=1&floor=3&char=shadow&diff=2`.

Die Architektur und die Schnittstellen zwischen den Modulen stehen in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/core     Zufall (deterministisch), Event-Bus, Eingabe, Mathe
src/game     Spielzustand, Lauf, Welt-Simulation, Spieler, Kampf, Perks, Gegner-KI, Bosse
src/gen      Etagen- und Raumgenerierung
src/data     Biome, Gegner, Waffen, Charaktere, Relikte, Segen, Schreine
src/meta     Spielstand, Aschealtar, Glutstufen, Erfolge, Chronik
src/render   Renderer, Licht, Effekte, prozedurale Pixel-Grafik
src/audio    Synthesizer, Soundeffekte, generative Musik
src/ui       Menüs, HUD, Touch-Steuerung
```
