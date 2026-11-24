# Pasch

Ein Würfel-Roguelike für den Browser im Stil eines **Neon-Nachtmarkts**: wirf fünf Würfel, halte die guten,
würfle nach und werte Hände wie Paar, Straße oder Pasch. 100 Talismane, Sternbilder, Werkzeuge und besondere Würfel
lassen die Punkte explodieren – acht Einsätze mit je drei Partien und einem Wächter stehen zwischen dir und dem Sieg.

Vanilla JavaScript, DOM/CSS-3D, Canvas/WebGL und WebAudio – keine Laufzeit-Abhängigkeiten, keine Bild- oder Audiodateien.

## Spielen

- **Offline:** `dist/pasch.html` per Doppelklick öffnen (eine einzige Datei, nach `npm run build`).
- **Entwicklung:** `npm install && npm start` → http://localhost:8080

Desktop (Querformat) und Handy (Hochformat) werden unterstützt.

### Steuerung

| Aktion | Maus/Touch | Tastatur |
|---|---|---|
| Wurf beginnen / nachwürfeln | Knopf | Leertaste (oder R) |
| Würfel halten | Würfel antippen | 1–7 |
| Hand wählen | Chip unter der Schale | ← / → |
| Werten | „Werten“ | Enter |
| Pause | ⚙ | Esc |
| Tooltip | Zeiger darauf | – (Touch: lange drücken) |
| Talismane umsortieren | ziehen | – |
| Verkaufen / Benutzen | Karte antippen | – |

Tippen während einer Wertung spult die Animation vor.

## Befehle

```
npm start            # Dev-Server (tools/serve.mjs)
npm test             # Logik-Tests (node --test)
npm run build        # dist/pasch.html (+ dist/pasch.artifact.html)
npm run sim          # Balance-Bot
node tools/e2e.mjs   # Playwright-Durchlauf (Dev-Server auf Port 8093 nötig), Screenshots nach dist/shots
```

Debug-URL-Parameter: `?seed=abc&autostart=1&cup=wood&stake=1&money=99&ante=3&speed=4&notutorial=1&nogl`.

## Aufbau

- `src/game`, `src/core` – reine Spiellogik (Node-testbar), siehe `docs/ARCHITECTURE.md`
- `src/audio` – synthetisierte Sounds und prozedurale Musik
- `src/fx` – Juice-Bausteine (Federn, Shake, Partikel, Popups, Flammen, Hintergrund-Shader)
- `src/ui` – Bildschirme, Komponenten, Scoreplayer; Einstieg `src/main.js`

Design: `docs/DESIGN.md` · Spielgefühl: `docs/research/research_feel.md`.
