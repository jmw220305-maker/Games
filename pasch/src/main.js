// Einstieg: FX, Audio, Eingabe und App booten, Profil laden, Titelbildschirm (oder Debug-Autostart).
import { initFx, time } from './fx/index.js';
import { audio } from './audio/audio.js';
import { initInput } from './ui/input.js';
import { createApp } from './ui/app.js';
import * as G from './game/index.js';

const params = new URLSearchParams(location.search);
const num = (k) => (params.has(k) && params.get(k) !== '' && !Number.isNaN(Number(params.get(k))) ? Number(params.get(k)) : null);
const opts = {
  speed: num('speed'),
  money: num('money'),
  ante: num('ante'),
  noTutorial: params.get('notutorial') === '1',
};

initFx({ palette: 'menu', forceFallback: params.has('nogl') });
initInput();

// Audio bei jeder Nutzergeste entsperren (idempotent); Musik beim ersten Mal starten.
let musicOn = false;
const unlock = () => {
  audio.init();
  if (!musicOn) { musicOn = true; audio.music.start(); }
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

const app = createApp(document.getElementById('app'), opts);
window.__pasch = { app, G, time };

if (params.get('autostart') === '1') {
  app.startRun({ cup: params.get('cup') || 'wood', stake: num('stake') || 1, seed: params.get('seed') || null });
} else {
  app.showTitle();
}
