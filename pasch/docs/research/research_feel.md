# Game-feel research: Balatro-like dice roguelike (vanilla JS, DOM/Canvas, WebAudio)

Confidence: [S] = sourced web, [M] = recalled from Balatro's decompiled Lua (LÖVE) as discussed by modders (verify; treat as strong starting values), [R] = recommended engineering value (tune by ear/eye).

## 1. What makes Balatro feel good

### 1.1 The "juice_up" primitive (the single most important thing) [M]
Every element that "does something" (card scoring, joker trigger, button press, money change) calls `juice_up(amount, rot)`:
```
amount default 0.4 (cards scoring ~0.3, small UI ~0.1..0.2); duration 0.4s
rot = ±0.6*amount (random sign)  (radians-ish in their units; in CSS use ~ ±6..12deg max)
on start: scale snapped to 1 - 0.6*amount   (a squash/anticipation dip)
each frame t = now - start, k = max(0, (end-now)/(end-start)):
  scaleOffset = amount * sin(50.8 * t) * k^3
  rotOffset   = rot    * sin(40.8 * t) * k^2
render scale = baseScale(spring-back to 1) + scaleOffset
```
=> a ~8 Hz decaying wobble (50.8 rad/s ≈ 8.1Hz) with cubic decay. Different frequencies for scale and rotation stop it looking mechanical. JS port: `scale = 1 + A*Math.sin(50.8*t)*Math.pow(k,3)`, `rot = R*Math.sin(40.8*t)*k*k`. For CSS units use A≈0.12–0.25 scale, R≈4–10deg.

### 1.2 Everything is springs, not tweens [M]
Balatro's Moveable objects have a target transform (T) and visible transform (VT); VT chases T every frame with velocity + damping (exponential approach, ~frame-rate independent). Result: cards never teleport, re-layout is free (just change targets), dragged cards lag and lean in drag direction (rotation proportional to x-velocity, clamped). Recipe:
```
vel += (target - pos) * stiffness * dt;  vel *= Math.pow(damping, dt*60); pos += vel*dt
stiffness ≈ 180-300 (/s²), damping per-frame 0.70-0.82  => slight overshoot ("springy")
OR critically-damped-ish lerp: pos += (target-pos)*(1-Math.exp(-dt*14))
drag lean: rotZ = clamp(velX * 0.02, -15, 15) deg, eased back with same spring
```

### 1.3 Hover tilt + idle sway [M/S]
- Card hover: card lifts (≈ -12px, scale 1.05) and tilts in 3D toward the cursor: rotateX = -(my-0.5)*2*maxTilt, rotateY = (mx-0.5)*2*maxTilt, maxTilt ≈ 10-15deg, with a specular sheen moving opposite the tilt. Balatro does the tilt in the card shader (fake perspective on the quad); in DOM: `perspective(600px) rotateX() rotateY()` on the card, plus a radial-gradient highlight at (100-mx%, 100-my%).
- Idle sway: every card has a phase offset; rotation ≈ sin(t*1.2 + phase)*1.5deg, y ≈ sin(t*0.9+phase)*2px; the ambient 3D tilt also slowly orbits (tilt angle driven by time) so foil/holo sheen drifts even when idle.
- Hand fan: cards in hand arranged on an arc: rotation_i = (i - (n-1)/2) * ~3-4deg, y_i += |offset|^2 * ~3px.
- Hover sound: soft paper/tick, pitch randomized ±5%. Selected card raises ~-24px [S: blakecrosley recreation: hover translateY(-12px) scale(1.05) 150ms ease-out; selected translateY(-24px) scale(1.08)].

### 1.4 The scoring sequence [M + S]
Order: hand name + base chips×mult appear in the side panel with a juice_up; cards played slide up to center; then each scoring card in left→right order:
1. card juice_up (~0.3), "+X" text pops above card (blue for chips, red for mult, gold/yellow for $; xMult in red with white-ish "X" badge), text itself scale-pops (0 → 1.2 → 1 in ~150ms) and fades after ~0.6s.
2. chips counter in panel juice_ups and its number jumps (Balatro snaps the chips/mult numbers per event rather than long rolls; the total score at the end is eased/rolled).
3. sound: "chips" tick; pitch rises per successive trigger [M: pitch param increments by small steps ~+0.05-0.1 per event, slight random jitter]. [S: third-party analysis says rising scale C D E F G per card.]
4. delay before next event ≈ 0.4–0.6s at 1x speed [M: event queue delays scaled by G.SETTINGS.GAMESPEED (options 0.5/1/2/4)]. Retriggers show "Again!" text.
- Then held-in-hand effects, then jokers left→right, each wiggling (juice_up) and emitting its message.
- Then chips × mult resolves: both boxes slam together, total "hand score" appears, then it flows into the round score which counts up over ~0.5-1s with a tick sound.
- Flames: when the current hand's chips×mult would exceed the blind requirement (and scaled by log of score vs target), the chips and mult boxes gain flame shader overlays (blue flames on chips, red on mult), intensity growing with score magnitude; a whoosh/fire crackle sound layer starts. [M: G.ARGS.score_intensity derived from log10(score)/log10(required).]
- Shake/“screen jiggle”: room jiggles proportional to hand score intensity. [S recreation tiers: ≤1k 2px/200ms, >1k 4px/300ms, >10k 8px + ±1deg/500ms.]
- Win: "blind defeated" banner, coin cash-out list ticks each line with coin sound, dollar text gold.

### 1.5 Background & CRT [M]
- Full-screen animated "paint swirl" fragment shader: polar-coordinate swirl (angle += f(length)*spin), iterated domain warp (5 iterations of `uv += sin(uv.yx*k + t)` style), quantized into 3 colour bands (two colours + contrast). Colours tween to match state (green/teal default, red for boss blind, blue in shop). Speed increases briefly on score.
- CRT post-process: subtle barrel distortion, scanlines, chromatic offset, noise, vignette, bloom. Pixel font, pixel-art cards scaled up with nearest neighbour, but everything moves at sub-pixel smoothness (the contrast "pixel art + smooth motion" is a big part of the look).
- Reduced-motion toggle exists in Balatro (removes swirl/gyration/much juice) [S: press-start patch notes].

### 1.6 Developer notes [S]
LocalThunk: solo dev, LÖVE/Lua; code mostly if/else, readable; game speed setting; credits players continuing after ante 8 because the effects are satisfying. No detailed public talk on juice located.

## 2. General juice literature

### 2.1 Juice it or lose it (Jonasson & Purho, 2012)
Breakout made juicy step by step: tweening entrances (elastic ease, staggered delays), squash/stretch on impact, colour flash, sound with pitch variation, particles, screen shake, eyes/personality, music. Lesson: layer many small reactions to every input; nothing static; staggered timings.

### 2.2 Art of Screenshake (Jan Willem Nijman, Vlambeer, 2013) — relevant subset
Bigger/brighter projectiles, muzzle flash (1–2 frames white), faster, less accuracy, impact effects, hit animation, enemy knockback, permanence (debris stays), camera lerp, screen shake, player knockback, sleep/hitstop (20–60ms freeze on big impact), more bass on sounds, randomize pitch, delay on explosions. Key ideas for us: hitstop before big reveals, permanence (dice leave marks/scores stay), bass on big hits, shake directional (kick opposite of event).

### 2.3 Trauma shake (Squirrel Eiserloh, GDC 2016) [S]
```
trauma ∈ [0,1]; add 0.2–0.6 per event (clamped)
shake = trauma^2 (or ^3)
offsetX = maxOffset * shake * noise(seed,   t*freq)   // noise ∈ [-1,1], Perlin/simplex, NOT Math.random
offsetY = maxOffset * shake * noise(seed+1, t*freq)
angle   = maxAngle  * shake * noise(seed+2, t*freq)
trauma -= decay*dt   (decay ≈ 0.8–1.5 /s)
maxOffset ≈ 8–16px (DOM UI: 6–10px), maxAngle ≈ 1.5–3deg, freq ≈ 15–25 Hz
```
Cheap noise for JS: sum of 2–3 sines with irrational freqs: `n(t)=Math.sin(t*1.0)*0.5+Math.sin(t*2.31+1.7)*0.3+Math.sin(t*4.77+3.1)*0.2`. Translational shake on a wrapping container; keep text readable (cap). Always option to disable.

### 2.4 Other primitives
- Hitstop/freeze: 40–80ms pause of the animation clock on big hits (xMult, crossing target). For a UI game, implement as "time scale = 0 for N ms" in the event queue, often with a white flash.
- Squash & stretch: preserve volume: scaleX = 1+s, scaleY = 1/(1+s). Impact squash s=0.15–0.3 for 60–100ms then spring back with overshoot.
- Anticipation: 80–150ms wind-up (scale 0.92 or pull back 4–8px) before release.
- Overshoot ease (easeOutBack): c1=1.70158, c3=c1+1; f(x)=1+c3*(x-1)^3+c1*(x-1)^2; CSS cubic-bezier(0.34,1.56,0.64,1). Elastic for pops: f(x)=2^(-10x)*sin((x*10-0.75)*2π/3)+1.
- Number counting: tween displayed value with easeOutCubic/expo over 300ms (small) to 1200ms (huge, scale with log10(delta)); tick sound every digit change but rate-limited (≥30–45ms apart) and pitch ramping with progress; final value lands with a pop (scale 1.25→1, 150ms). Use tabular-nums font feature to prevent jitter.
- Chromatic punch: on big event, offset R/B copies ±2–4px for 100–150ms (CSS: text-shadow -3px 0 #f0f8, 3px 0 #0ff8, or canvas drawImage channels with globalCompositeOperation='lighter').
- Camera kick: translate 6–12px in event direction, return with spring over 150–250ms (directional, unlike random shake).
- Flash: full-screen white/coloured overlay opacity 0.15–0.35, decay 120ms.
- Particles: 8–24 per burst, speeds 150–500 px/s, gravity 600–1200 px/s², drag 0.9/frame, lifetime 400–900ms, size shrink to 0, 2–3 colours; spark streaks drawn as lines along velocity.
- Pitch variation: every repeated SFX ±3–8% random detune so it never sounds like a machine gun.

## 3. Dice-specific feel

### 3.1 CSS 3D cube die
```
.scene { perspective: 600px; }               /* 400–800px; lower = more dramatic */
.die   { width:64px;height:64px; position:relative; transform-style:preserve-3d; will-change:transform; }
.face  { position:absolute; inset:0; backface-visibility:hidden; border-radius:12%; }
.f1{transform:rotateY(0)   translateZ(32px)} .f6{transform:rotateY(180deg) translateZ(32px)}
.f2{transform:rotateY(90deg) translateZ(32px)} .f5{transform:rotateY(-90deg) translateZ(32px)}
.f3{transform:rotateX(90deg) translateZ(32px)} .f4{transform:rotateX(-90deg) translateZ(32px)}
```
Rotation that shows face f to viewer (for the layout above): 1:(0,0) 6:(0,180) 2:(0,-90) 5:(0,90) 3:(-90,0) 4:(90,0) as (rotX,rotY). To land: target = base[f] + 360*k on each axis (k=2–4 random per axis, add the die's previous accumulated turns so it always spins forward), plus small random rotZ (±8deg) for natural look. Keep accumulated angles (never reset to 0 or it spins backwards).
Animate with JS (requestAnimationFrame) not CSS transition, so you can do: launch arc (translateY up 40–80px then down, i.e. parabola), rotation following easeOutCubic/quart over 600–900ms, then landing bounce (2 bounces: heights 12px, 4px, ~90ms each) and a final settle wobble (rotZ damped spring). Shadow: separate flat ellipse under die, scale/opacity inversely with height (scale 1→0.6, opacity 0.35→0.15 at apex).
Simpler alternative for many dice / perf: 2D die (rounded square div with pips) doing: tumble = random rotateZ spins + rapid face swaps every 50–80ms decelerating (interval *= 1.15 each swap), with scaleX squish (cos) to fake rotation; then landing squash. Honestly feels great and scales to 20+ dice.
Perf: animate only transform/opacity; will-change on active dice only; avoid box-shadow animation (use pseudo-element opacity); <= ~15 3D dice simultaneous fine on mobile; avoid filter:blur on moving 3D elements; promote via translateZ(0).

### 3.2 Rolling choreography
- Anticipation: on Roll press, dice dip down 4px + scale 0.95 for 80ms (also rattle: random ±3px jitter at 30Hz for 120ms = "shaking in the cup").
- Stagger launch 40–70ms per die. Duration 650–900ms; last die (or the decisive one) gets +250–400ms extra spin and slower deceleration = suspense reveal. Optional: when a combo is "almost there", slow the last die further and raise a tension drone.
- Land: hitstop 30–50ms on landing frame, squash (scaleY 0.85/scaleX 1.12, 70ms), clack sound with velocity-scaled gain, 4–6 dust particles, tiny shake (trauma +0.08 per die).
- Result reveal: once all settled, dice that form the combo juice_up in sequence (60–90ms apart) with rising pitch, glow outline in combo colour; combo name banner pops (easeOutBack, 250ms).
- Held/locked dice: click → die lifts to a "hold tray" or gets a lock badge: translateY(-10px), outline 3px accent, little lock "clink" (high metallic ping 2.5kHz), slight desaturation of the unlock state? (keep readable). Locked dice don't roll but do a small "resist" shake (±2px, 100ms) when Roll is pressed so player sees they stayed. Unlock: drop with bounce + softer lower clink.
- Rerolls counter: pips that burst when consumed.

## 4. WebAudio recipes (all times in seconds)
Master chain: sources → sfxBus(gain 0.8) → compressor(threshold -18, knee 12, ratio 4, attack .003, release .15) → destination; musicBus → lowpass → master. Create AudioContext on first user gesture (resume()). Preallocate one 1s white-noise buffer and reuse.

Helper envelope: `g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+a); g.gain.exponentialRampToValueAtTime(0.0001,t+a+d)`.

- Dice clack (per impact): noise burst 25–40ms → bandpass f=2200–3800Hz (random per hit), Q=4–8 → gain peak 0.5*velocity, decay 0.03–0.05. Plus "body": triangle osc 700–1100Hz pitch-dropping 15% over 30ms, peak 0.25, decay 0.04. Plus optional low thud on table: sine 140Hz→80Hz 60ms peak 0.2. For a roll in a cup: 6–12 clacks randomly spaced 25–70ms, decaying gain.
- Dice rattle/tumble on screen: series of clacks whose spacing grows as die slows (interval *= 1.2).
- Chip tick (rising): square or triangle osc, freq = base*2^(step/12), base ~523Hz (C5), step++ per trigger (cap ~+24 then wrap or slow); envelope a=.002 d=.06; add a sine an octave up at 0.3 gain; lowpass 4kHz to tame square. Major-pentatonic steps (0,2,4,7,9,12...) sound nicer than chromatic.
- Mult hit (deeper thump): sine 180Hz→60Hz exponential over 0.12, peak 0.7, decay .18; plus noise burst through lowpass 800Hz 40ms; plus a short sawtooth 220Hz with lowpass sweeping 2000→300 (body "whomp"). Pitch also climbs per mult step (+1 semitone).
- xMult (bright zap): sawtooth 440→1760Hz exponential in 0.08 then gain decay .25; second detuned saw (+7 cents); highpass 300; ring with feedback delay (0.06s, feedback .3) ; add a sine "bell" at 2x freq decay .4. Optionally a brief bitcrush-ish waveshaper.
- Coin/cash: two square/triangle blips B5 (988Hz) then E6 (1319Hz) 70ms apart, each a=.002 d=.12; for register "ka-ching": add noise burst highpassed 5kHz 50ms + bell (sine 2637Hz + 3951Hz, decay .5).
- UI hover: sine 1200–1500Hz, 15ms, peak 0.05, random ±5%. UI click: noise 10ms bandpass 3kHz Q2 + sine 800Hz 30ms peak .15. Button down/up pair: down lower pitch (600), up higher (900).
- Card/die select: triangle 660Hz → 880Hz glide 40ms. Deselect: reverse.
- Score count-up tick: very short (10ms) sine at 1500Hz + progress*800Hz, rate-limited 35ms.
- Target crossed / "on fire": noise through bandpass swept 400→3000Hz over 0.6s (whoosh) + low sine 55Hz swell + crackle (random clicks via noise gated by random short envelopes).
- Win fanfare: arpeggio C5 E5 G5 C6 (triangle + square @0.3), 90ms apart, last note held .6s with vibrato (LFO 6Hz, depth 8 cents); chord pad under (saw ×3 detuned, lowpass 1500). ~1.2s.
- Fail: descending saw/triangle G4 F#4 F4 → E4 each 180ms with pitch slide down -100 cents and lowpass closing 2000→300; final low sine 80Hz thud. "Wah-wah" but soft.
- Music generator: 70–85 BPM lo-fi; chord loop e.g. Fmaj7–Em7–Dm7–Cmaj7 (or ii-V-I-vi in a minor key: Am9–Dm9–G13–Cmaj9). Pad: 3–4 voices, each 2 detuned saws (±6 cents) → lowpass 900Hz Q1 → gain .08, attack .8 release 1.5. Bass: sine/triangle root, quarter notes. Drums: kick (sine 150→45Hz 0.15s), snare/rim (noise bandpass 1800 + triangle 180Hz), hats (noise highpass 7kHz 30ms, swing 55–60%). Vinyl: low-level pink-ish noise lowpassed 3kHz gain .01 + random crackle clicks. Schedule with lookahead scheduler (setInterval 25ms, schedule notes within next 100ms using ctx.currentTime). During scoring: musicLowpass.frequency.setTargetAtTime(4000, now, 0.15); after: back to 900 with timeConstant 0.6. In boss rounds: swap progression to minor, add tension.
- Global: randomize SFX pitch ±4%; limit polyphony per sound (max 6 instances); duck music -4dB on big events (setTargetAtTime).

## 5. UX
- Scoring readability: persistent panel: [Combo name] [CHIPS box] × [MULT box] = hand score; round score / target with progress bar. Each "+X" popup appears at the source (die/relic) AND the receiving box juices, so cause→effect is visible. Use consistent colour coding & icons; also always-visible text, not colour-only (colour-blind: shape/icon + label).
- Order of resolution predictable (left→right dice, then relics left→right); highlight the active source with outline + raise.
- Tooltips: on hover (desktop, 250ms delay) / long-press 350ms (mobile); tooltip shows keyword glossary highlights (coloured spans), positioned with flip/clamp to viewport; enter animation 120ms scale .95→1.
- Speed: 1x/2x/4x (+ "instant" option); divide all event delays & tween durations by speed, but keep SFX durations; at 4x skip popups' hold time and merge ticks. Click/tap anywhere during scoring = fast-forward (speed x8 until end of hand). Space/Enter = Roll/Confirm; number keys 1–5 toggle hold die.
- Mobile: pointer events (pointerdown/up) unified; touch targets ≥44px; no hover dependency; tilt via device orientation optional; disable double-tap zoom (touch-action: manipulation); layout scaling via CSS clamp/vmin; avoid 300ms click delay; use `navigator.vibrate(10–20)` on dice land/score if available (Android).
- Accessibility: `prefers-reduced-motion` → disable shake, swirl, tilt, idle sway; keep fades & counters; settings toggles for shake intensity (0/50/100%), screen flash, CRT; volume sliders music/sfx separate; keyboard focus rings.
- Original palette ideas (avoid Balatro's green felt/red-blue): 
  A) "Midnight Arcade": bg #12102a→#2a1650 gradient swirl, chips = #3ee6c4 (mint), mult = #ff5fa2 (hot pink), xMult = #ffd166 (amber), money = #f9c74f, text #f3ecff, outline #0b0918.
  B) "Desert Casino": bg #2b1b17, teal felt #1f5f5b, chips #7fd1ff, mult #ff7a3d (orange), gold #ffcf5c, cream text #fff3d6.
  C) "Neon Jade": bg #07161a, jade #00c389, magenta mult #ff3d7f, cyan chips #2fd6ff.
  Dice: ivory #f4ecd8 with dark pips #231a2e; special dice tinted (glass translucent, gold, obsidian). Use thick 3–4px dark outlines + hard drop shadows (offset 0 4px, no blur) for a chunky readable look.
- Fonts (Google Fonts): "Press Start 2P" (very pixel, headings only), "Silkscreen", "VT323" (CRT terminal, good for numbers), "Pixelify Sans" (readable pixel, variable), "Jersey 10"/"Jersey 15", "Tiny5", "Micro 5". Recommend Pixelify Sans or Jersey 15 for body + big numbers; use `font-variant-numeric: tabular-nums` where supported, else monospace digits. Text outline via `-webkit-text-stroke` or 4-direction text-shadow for pop.

## 6. Juice checklist (concrete)
1. All moving UI uses spring follow (stiffness ~220, damping .78) — no linear tweens.
2. juice_up(amount) = 0.4s, scale A*sin(50.8t)*k³, rot R*sin(40.8t)*k², initial dip 1-0.6A.
3. Card/die hover: lift 8–12px, scale 1.05, 150ms, 3D tilt ±12deg toward cursor, perspective 600px.
4. Specular sheen gradient follows tilt (opacity .15–.3).
5. Idle sway: ±1.5deg, ±2px, period 4–7s, per-item phase.
6. Hand/dice row arranged on gentle arc (±3deg per slot).
7. Drag lean: rotZ = vx*0.02 clamped ±15deg.
8. Roll anticipation: 80ms dip + 120ms rattle (±3px @30Hz).
9. Stagger dice launch 50ms each.
10. Tumble 650–900ms easeOutQuart, 2–4 extra turns per axis, accumulate angles.
11. Last die +300ms suspense; tension riser if combo pending.
12. Landing: hitstop 35ms, squash 0.85/1.12 for 70ms, bounces 12px then 4px.
13. Shadow ellipse scales with die height.
14. Clack: noise 30ms bandpass 2.2–3.8k Q6 + triangle body 900Hz, gain by impact velocity.
15. Hold die: lift 10px, accent outline 3px, clink 2.5kHz; locked dice resist-shake ±2px on roll.
16. Score trigger interval 1x: start 450ms, multiply by 0.9 per trigger, floor 120ms (accelerating chain).
17. Chip tick pitch +1 step of pentatonic per trigger (base C5); reset per hand.
18. "+X" popup: spawn at source, scale 0→1.25→1 (180ms easeOutBack), rise 24px, hold 500ms, fade 200ms.
19. Receiving box juice_up 0.25 per event; colour flash to white 60ms.
20. Mult hit: sine 180→60Hz thump, trauma +0.15.
21. xMult: bright saw zap, hitstop 60ms, chromatic split 3px 120ms, trauma +0.3.
22. Total count-up: duration 300ms + 250ms*log10(delta), easeOutExpo, ticks ≥35ms apart, end pop 1.25→1.
23. Trauma shake: trauma², maxOffset 10px, maxAngle 2deg, noise 20Hz, decay 1.2/s.
24. Shake budget scales with log10(score/target); cap so text remains readable.
25. "On fire" when hand ≥ target: flame/particle overlay on score boxes, intensity = clamp(log10(score/target)+0.3,0,1), whoosh SFX.
26. Crossing target: white flash 0.25 → 0 in 150ms, bass drop (55Hz swell), confetti 40 particles.
27. Background swirl shader (canvas/WebGL or CSS conic+blur fallback) speeds up 2x during scoring, colour shifts by state.
28. Music lowpass opens 900→4000Hz during scoring (setTargetAtTime τ=.15), closes τ=.6.
29. CRT overlay: scanlines 3–4px period @ .08–.15 opacity, vignette .35, optional barrel via SVG filter off by default on mobile.
30. Buttons: press scale .94 (60ms), release overshoot 1.04 → 1 (spring), click SFX pair low/high.
31. Every SFX pitch-randomized ±4%; polyphony cap 6.
32. Money: coins fly from source to wallet along curve (350ms, stagger 40ms), coin blip per arrival with rising pitch.
33. Shop items enter staggered 60ms, easeOutBack, slight random rot ±4deg.
34. Purchase: item shrinks to 0 with spin 200ms + register ka-ching; insufficient funds: horizontal shake ±6px 3 cycles 240ms + low buzz 110Hz square 120ms.
35. Round transitions: wipe/zoom 400–500ms; never block input longer than needed; tap to skip.
36. Speed 1x/2x/4x/instant divides all delays; tap-to-fast-forward during scoring.
37. Reduced motion: no shake/sway/tilt/swirl/flash; keep colour & sound.
38. Numbers use tabular digits and outlined text; big numbers abbreviated (1.2e6) with full value on hover.
39. Particles: 8–24 per burst, life 400–900ms, gravity 900px/s², shrink to 0.
40. Pause rendering heavy effects when tab hidden; cap DPR at 2 for canvas.

## Sources
- https://blakecrosley.com/guides/design/balatro (third-party recreation values)
- https://www.gamesradar.com/games/roguelike/after-winning-big-at-the-game-awards-and-taking-hours-of-our-time-in-2024-balatro-creator-reveals-their-most-productive-night-resulted-in-one-of-the-games-most-satisfying-features
- https://press-start.com.au/news/2024/04/08/the-latest-balatro-update-has-some-massive-changes-that-should-make-winning-easier/
- https://www.pcgamer.com/software/balatros-mind-bending-code-uses-mouse-jitter-for-random-number-generation-along-with-a-bunch-of-clever-maths-im-too-dense-to-fully-appreciate/
- https://80.lv/articles/balatro-s-card-movements-shaders-recreated-in-unity ; https://github.com/mixandjam/balatro-feel
- https://forum.defold.com/t/community-challenge-recreate-balatro-card-effects-in-defold/76854
- https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing ; https://bevy.org/examples/camera/2d-screen-shake/ ; https://kidscancode.org/godot_recipes/3.x/2d/screen_shake/
- https://gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games
- https://dev.to/dailydevtips1/creating-a-3d-dice-in-css-3ad5 ; https://www.w3schools.com/css/css3_3dtransforms_cube.asp
- https://dev.to/sendotltd/sample-free-drum-synthesis-in-web-audio-building-kick-snare-and-hi-hat-from-oscillators-in-60-2c0k ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques
