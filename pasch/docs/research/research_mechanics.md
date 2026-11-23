# Research: Balatro-style dice roguelike — mechanics, market, math, content

(Original-IP guidance: borrow *structures* only — ante/blind loop, chips×mult, shop. Never use Balatro names: "Joker", "Blind", "Planet", "Tarot", "Spectral", "Ante" is a generic poker word but better rename; no Balatro boss names, no CRT/psychedelic swirl look.)

---------------------------------------------------------------
## 1. Balatro core loop (reference numbers)

**Run structure**: 8 Antes to win; each Ante = Small Blind → Big Blind → Boss Blind. Small/Big can be skipped for a Tag (reward), Boss cannot. After Ante 8 boss: win, optional Endless.

**Base score per Ante (white stake)**: 300 / 800 / 2,000 / 5,000 / 11,000 / 20,000 / 35,000 / 50,000.
Endless: A9 110k, A10 560k, A11 7.2M, A12 300M, A13 47B, A14 2.9e13 … (super-exponential to force a run end).
Small = 1× base, Big = 1.5×, Boss = 2× (The Wall 4×, Violet Vessel 6×). Ante 1: 300/450/600; Ante 8: 50k/75k/100k.
Higher stakes (green+) steepen the table (A8 ≈ 80k → 100k base).

**Per round defaults**: 4 hands, 3 discards, hand size 8, play 1–5 cards. Start $4. 5 Joker slots, 2 consumable slots.

**Hands (level 1 chips × mult, +per level)**:
| Hand | Base | Per level |
|---|---|---|
| High Card | 5×1 | +10 / +1 |
| Pair | 10×2 | +15 / +1 |
| Two Pair | 20×2 | +20 / +1 |
| Three of a Kind | 30×3 | +20 / +2 |
| Straight | 30×4 | +30 / +3 |
| Flush | 35×4 | +15 / +2 |
| Full House | 40×4 | +25 / +2 |
| Four of a Kind | 60×7 | +30 / +3 |
| Straight Flush | 100×8 | +40 / +4 |
| Five of a Kind* | 120×12 | +35 / +3 |
| Flush House* | 140×14 | +40 / +4 |
| Flush Five* | 160×16 | +50 / +3 |
(*secret hands, only reachable with deck manipulation.) Planet cards = +1 level of one hand.

**Score evaluation order**: (1) identify hand → base chips & mult (from level). (2) each *scoring* card left→right: add rank chips (2–10, faces 10, Ace 11), then enhancement (Bonus +30 chips, Mult +4), edition (Foil +50 chips, Holo +10 mult, Polychrome ×1.5 mult), seal (Red = retrigger, Gold = $3). (3) held-in-hand effects (Steel ×1.5 etc.). (4) Jokers left→right; each adds +chips, +mult, or ×mult to the running total — order matters: put +mult before ×mult. (5) score = chips × mult, added to round total.

**Jokers**: 5 slots; rarities Common (~70%), Uncommon (~25%), Rare (~5%), Legendary (only via special consumable). Prices roughly $2–6 / $5–8 / $8–10; sell for half. Editions on jokers (Foil/Holo/Poly/Negative = +1 slot).

**Shop**: after each cleared blind. 2 random item slots (jokers/planets/tarots), 2 booster packs, 1 voucher per ante ($10, permanent run upgrade, e.g. +1 shop slot, −25% prices, +1 hand, interest cap $10). Reroll $5, +$1 each time within a shop, resets next shop. Packs: Normal $4 (choose 1 of 3; Buffoon 1 of 2), Jumbo $6 (1 of 5), Mega $8 (2 of 5); types Arcana (tarot), Celestial (planet), Buffoon (joker), Standard (cards), Spectral (rare powerful).

**Economy**: blind reward $3/$4/$5 (Small/Big/Boss); +$1 per unused hand; discards pay $0; interest $1 per $5 held, cap $5 (at $25). Typical income ≈ $10–15/round mid-run. Core tension: spend now (power) vs hold $25 (interest).

**Boss blinds**: ~28 bosses, each a rule twist: suit debuffed (Club/Goad/Window/Head), face cards debuffed (Plant), 0 discards (Water), 1 hand only (Needle), no repeat hand type (Eye), only one hand type (Mouth), must play 5 cards (Psychic), cards face-down (Wheel/Fish), lose $1 per card (Tooth), most-played hand → $0 (Ox), hand size −1 (Manacle), previously played cards debuffed (Pillar), 4× target (Wall). Finale bosses at Ante 8 are nastier (6× target, random joker disabled, etc.). Boss is shown at start of ante so player can prepare / reroll (voucher).

**Why it's addictive** (design analyses + LocalThunk interviews):
- Numbers explode: multiplicative ×mult produces 10^4→10^6+ scores; "watching it count up" is the dopamine payoff. Multiplicative effects feel memorable; additive ones feel forgettable.
- Synergy discovery: ~150 jokers, combos found by experimenting; each run teaches something.
- Familiar base (poker hands) = zero onboarding cost; complexity is layered on top.
- Risk/reward economy: interest vs spending, skip blinds for tags, sell/buy decisions.
- Short runs (30–60 min), instant restart, deterministic seeds; boss known in advance → planning.
- Clear per-round goal with visible target bar; partial info about the future (next boss).
- Unlock checklist (jokers, decks, stakes) gives long-term goals.
(Sources: saschb2b.github.io/game-mechanics/games/balatro/*, balatrogame.fandom.com/wiki/Planet_Cards, primagames, progameguides, gamedeveloper.com LocalThunk interview, gameinformer interview 2024-03-21.)

---------------------------------------------------------------
## 2. Existing dice roguelikes / Balatro-likes

| Game | Core idea | Praised | Criticised |
|---|---|---|---|
| **Dice A Million** (countlessnights, Feb 2026, PC/Xbox/Game Pass) | Throw physical dice onto a board; faces have effects; positional synergies (dice landing near/apart); "Rings" (80+) as joker analogue, slots = fingers; targets per round, surplus score usable as currency | Hooked reviewers (GameGrin 9/10, OpenCritic ~8); rings make builds; physics throw is tactile | Luck-dependence (top complaint), erratic balance, punishing bosses, low build diversity; "rolling dice isn't a strategic foundation" |
| **Dice of Kalma** (Pepperbox, late 2025, Very Positive) | Closest analogue: Yahtzee/poker hands with dice, 3 rerolls per round on any subset, "Skulls" = jokers, hand upgrades between goals, boss = Finnish death god | Fun, readable, strong theme | "Too derivative of Balatro" (7/10 GameSpew); 3 rerolls often not enough → runs end on bad luck; boss losses feel unfair |
| **Dicey Bizniz** (Dec 2025, $8.99) | Balatro deckbuilding + dice manipulation, 11 antes, relics | Satisfying casual | "Poker hands make it way too random" |
| **Dicey Dungeons** (Terry Cavanagh 2019) | Dice are resources placed into equipment slots | Celebrated: exposes RNG openly, player feels like a tactician because every die value is *usable* | Losing to bad rolls frustrating (top Steam complaint) |
| **Die in the Dungeon** (Atico) | Dice-bag deckbuilder, StS structure, place dice on grid | Top seller, clever placement | RNG complaints |
| **Dicefolk** (2024) | Creature tactics, dice = action pool, you can bend/manipulate faces | Fair despite RNG | Repetitive content |
| **Luck be a Landlord** | Slot-machine deckbuilder, rent escalates | Pure synergy engine; RNG accepted because the *build* is the agency | Mid-game repetition |
| **CloverPit** (2025) | Grim slot-machine Balatro-like, 96% positive | Atmosphere, charm escalation | — |

**Lessons**
1. #1 complaint across all dice games = "lost to RNG / low agency". Counter: every result must be *usable* (Dicey Dungeons), give multiple manipulation tools (hold, reroll, nudge ±1, flip to opposite face, set face), and make the target forgiving early with a skill ceiling later.
2. Don't be a reskin: Dice of Kalma was dinged for being "Balatro with dice". Add a dice-native identity: **custom faces** (the die *is* the deck), dice materials, positional/order effects, parity/sums.
3. Bosses must be counterable and telegraphed; "pure evil" bosses + RNG = rage quits.
4. Build diversity needs many viable scoring archetypes (pairs, straights, high sums, parity, single-face stacking, economy).

(Sources: gamesradar Dice A Million preview; gamegrin, thexboxhub, windowscentral reviews; opencritic; gamespew & tapsmart Dice of Kalma reviews; pocketgamer; trendingnow Dicey Bizniz; PC Gamer/RPGFan/GameSpot Dicey Dungeons reviews; TechRadar/TheSixthAxis Dicefolk; vaporlens.app review summaries.)

---------------------------------------------------------------
## 3. Dice probabilities (5d6) — computed exactly (script: dice.py in scratchpad)

**Single roll, exclusive best hand** (ranked 5K > 4K > LgStr > FH > SmStr > 3K > 2P > P > none):
| Hand | P |
|---|---|
| Pair | 37.04% |
| Two Pair | 23.15% |
| Three of a Kind | 15.43% |
| Small Straight (4 in a row, no 5) | 12.35% |
| Full House | 3.86% |
| Large Straight | 3.09% |
| Nothing (all distinct, no straight) | 3.09% |
| Four of a Kind | 1.93% |
| Five of a Kind | 0.077% (1/1296) |

**"Chasing" a target with optimal holds** (inclusive: e.g. 3K+ = at least three alike):
| Target | 1 roll | +1 reroll | +2 rerolls |
|---|---|---|---|
| Pair+ | 90.7% | 99.1% | 99.9% |
| Two Pair+ | 29.0% | 59.1% | 77.2% |
| Three+ of a kind | 21.3% | 54.1% | 74.3% |
| Small Straight+ | 15.4% | 41.2% | 61.5% |
| Full House | 3.9% | 19.1% | 36.3% |
| All even / all odd / all 4-6 | 3.1% | 23.7% | 51.3% |
| Sum ≥ 25 | 3.2% | 19.0% | 41.7% |
| Large Straight | 3.1% | 13.0% | 26.1% |
| Four+ of a kind | 2.0% | 13.2% | 29.1% |
| Five of a kind | 0.08% | 1.26% | 4.60% (matches Yahtzee lit. ~4.6%) |

Notes: high-card ("nothing") is *rarer* than pair in dice — Pair is the floor hand. Dice have no suits: add a **colour/"hue" per face or per die** to unlock a Flush analogue ("Monochrome") — with 5 dice of e.g. 3 colours flush odds are tunable via player dice choices (a deckbuilding axis!).

**Suggested hand table** (chips × mult; each scoring die also adds its pip value ×? → recommend pip value as chips, faces can be upgraded):
| Hand (original names suggested) | Rule | Base | Per level |
|---|---|---|---|
| Scatter | no pattern | 5×1 | +10/+1 |
| Pair ("Twins") | 2 alike | 10×2 | +15/+1 |
| Two Pair ("Double Twins") | 2+2 | 20×2 | +20/+1 |
| Three of a Kind ("Triplet") | 3 alike | 30×3 | +20/+2 |
| Small Run | 4 consecutive | 35×3 | +25/+2 |
| Parity ("Evens"/"Odds") | all 5 even or all odd | 40×3 | +20/+2 |
| Full House ("Crowd") | 3+2 | 40×4 | +25/+2 |
| Large Run | 5 consecutive | 60×5 | +30/+3 |
| Four of a Kind ("Quad") | 4 alike | 60×7 | +30/+3 |
| Monochrome (if colours) | 5 same colour | 50×5 | +25/+2 |
| Five of a Kind ("Pentad") | 5 alike | 120×12 | +35/+4 |
| Secret: Pentad Monochrome / 6+ dice hands | — | 160×16 | +50/+4 |
Value ∝ roughly log(1/p) of chase-probability; Balatro's own ladder works fine since dice rarities rank similarly.

---------------------------------------------------------------
## 4. Agency levers for dice

- **Throws** per round = hands (4). **Rerolls** = discards: a *shared pool* per round (3), each reroll re-throws any subset of non-held dice. Holding is free. (Kalma's 3 rerolls/round felt tight; with a shared pool of 3 the "chase" table above between columns 1 and 2 applies on average — good tension.) Alternative: 1 free reroll per throw + 2 pooled.
- Unused throws pay $1; unused rerolls $0 (relics can change that).
- **Dice bag** = deck: start with 5 standard d6; dice pool can grow (bag of 7, throw 5 random? or "tray size" 5→6). Simpler: fixed 5-dice tray, up to 7 with upgrades.
- **Face editing** (deckbuilding core): change a face's value (e.g. 1→6), duplicate a face, add **face stickers**: Gold (+$1 when scored), Mult (+4 mult), Chip (+25 chips), Wild (counts as any value for hand detection), Echo (retrigger), Glass (×2 mult, 1/4 chance to shatter face to blank), Stone (+50 chips, no value), Lucky (1/5 +20 mult), Blank (scores nothing; enables special relics).
- **Dice materials** (edition analogue on whole die): Lead/weighted (rolls its highest face 50% more often), Glass (×1.5 mult, may crack), Bone (+chips = 2× pip), Crystal (polychrome-like ×1.5), Gilded ($ on score), Ghost (doesn't take a tray slot = Negative).
- **Die shapes**: d4/d8/d10/d12 replacing a d6 (bigger pips = more chips but harder pairs; d4 = easier pairs/straights 1-4).
- **Nudge tools**: +1/−1 a die, flip to opposite face (7−x), set to chosen face — as consumables or relic charges. Huge for perceived agency.

### 42 relic ideas ("Charms" — 5 slots, trigger left→right)
Common
1. Snake Charm – +8 mult per scored 1.
2. Boxcar – +30 chips per scored 6.
3. Even Keel – +10 mult if all scored dice even.
4. Odd Fellow – +10 mult if all scored dice odd.
5. Twin Bell – +6 mult if hand contains a pair.
6. Pip Counter – +chips equal to total pips on all dice ×2.
7. Low Road – +15 mult if sum ≤ 12.
8. High Tide – +40 chips if sum ≥ 24.
9. First Throw – ×2 mult on the first throw of the round if no reroll was used.
10. Patient Hand – +5 mult per unused reroll when scoring.
11. Piggy Die – +$1 for each 6 scored; sells for +$3.
12. Center Stage – the middle die (slot 3) scores twice.
13. Ladder – +12 mult for any Run.
14. Lucky Seven – if any two dice sum to 7… +7 mult per such pair.
15. Tally Stick – +2 chips permanently each time a Pair is scored (scaling).
16. Prime Time – +6 mult per scored 2/3/5.
Uncommon
17. Echo Chamber – retrigger all scored dice showing the most common value once.
18. Loaded Gambit – ×1.5 mult; but 1 random die is rerolled before scoring.
19. Domino – each scored die adds mult equal to the previous die's pip (order on tray matters).
20. Momentum – gains ×0.1 mult each consecutive throw that scores a higher hand than the last; resets otherwise.
21. Hoarder's Cup – unused rerolls carry over to the next round (max 6).
22. Nudger – once per throw, click a die to +1 it.
23. Mirror – flips one non-held die to opposite face if that makes a better hand.
24. Snake Eyes – if exactly two 1s scored: ×3 mult.
25. Rebate – each reroll used gives $1 (max $3/round).
26. Collector – +3 mult for every distinct face value currently showing.
27. Tally Board – +1 mult permanently per Four of a Kind scored (as ×-scaler: ×1 +0.25).
28. Sieve – blank faces count as wild.
29. Gold Rush – gold faces give $2 instead of $1 and +10 mult.
30. Sixth Sense – adds a 6th die to the tray (doesn't need slot) but −1 throw.
31. Sticky Fingers – held dice give +15 chips each when scored.
32. Brittle Crown – ×3 mult; loses ×0.25 each round (sell before it dies).
Rare
33. Pentagram – Five of a Kind scores ×5 mult.
34. Clockwork – retrigger every die once if no rerolls used this throw.
35. Weightmaster – all dice become weighted toward their highest face (+1 bias).
36. Philosopher's Pip – every scored 6 gives ×1.25 mult.
37. Copycat – copies the ability of the charm to its right.
38. Second Wind – once per round, if the final throw doesn't reach target, rethrow it fully (no rerolls cost).
39. Ledger – ×1 mult +×0.1 per $5 you hold (rewards saving vs interest).
40. Gravity Well – the lowest die is set to match the highest before scoring.
41. Chain Reaction – scoring a Run retriggers the whole hand.
Legendary (via rare consumable)
42. Infinity Die – the highest scored die retriggers equal to its pip value −1.
43. Fate Weaver – before each throw choose one die's face.
44. Hollow King – ×1 mult +×1 per empty charm slot... (counter-design option).

### 10 consumables (2 slots)
Hand-leveling "Constellations"/"Sigils" (one per hand: +1 level) — the planet analogue.
Plus tool "Talismans/Inks":
1. Chisel – change one face of a die to any value.
2. Twin Seal – copy one face onto another face of same die.
3. Gilding Ink – add Gold sticker to a face.
4. Rune of Echo – add Echo (retrigger) sticker to a face.
5. Glazier – turn a die into Glass material.
6. Ballast – make a die Weighted.
7. Shaper – change a d6 into a d8 (or d4).
8. Blank Slate – erase a face to Blank, gain $5.
9. Fortune Coin – double money (max +$20).
10. Mirror Shard – duplicate a random charm (needs slot); or create a copy of last-used consumable.
11. Burner – destroy a die from bag, gain +1 permanent reroll.

### 8+ boss debuffs ("Wardens")
1. The Leaden – all 1s and 2s score 0 chips & don't count for hands.
2. The Miser – 0 rerolls this round.
3. The Single – only 1 throw (target normal ×1.0 instead of ×2).
4. The Echo – cannot score the same hand type twice.
5. The Fixation – only the first hand type played may be played again.
6. The Fog – two dice roll face-down until scored.
7. The Toll – lose $1 per reroll.
8. The Shackle – one random die is locked (cannot be held or rerolled).
9. The Inverter – after each throw one random die flips to its opposite face.
10. The Wall – target ×4.
11. The Thief – one random charm disabled for the round.
12. The Grudge – each die that scored becomes debuffed for the rest of the round.
Final (Ante 8): The Abyss (×6 target), The Eclipse (all faces hidden until rerolled once).

---------------------------------------------------------------
## 5. Balancing guidance

**Targets** (base; Small ×1, Big ×1.5, Boss ×2):
| Ante | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Base | 300 | 800 | 2,000 | 5,000 | 11,000 | 20,000 | 35,000 | 50,000 |
Growth ~2.6× early, ~1.4–1.8× late; boss of A8 = 100k. Endless: base ×~2.2 then exponent (e.g. base(a)=50k·(1.6^(a−8))^(1+0.2(a−8))).

**Power check**: Ante 1 unbuffed: Pair of 6s = (10+12)×2 = 44; Triplet of 5s = (30+15)×3 = 135; Full House ≈ (40+~20)×4 = 240. 4 throws → ~300–500 avg → Small blind OK, Boss (600) needs ~1 charm. Rule of thumb: player's *average throw* must grow ~×2.2 per ante through A4, then ×1.6. Mult must come from ×mult sources by A5+ (additive alone tops ~10–20k/throw). Aim: by A8 typical winning build ~30k–80k per throw.

**Economy** (copy proven numbers, tweak): start $4; rewards $3/$4/$5; +$1 per unused throw; interest $1 per $5 up to $5; shop 2 item slots + 2 packs + 1 upgrade ("Relic voucher") per ante at $10; reroll shop $5 +$1 each; charms common $4–6, uncommon $6–8, rare $9–10; consumables $3; packs $4/$6/$8; sell = half price. Expect ~$10–14 per round → ~1 charm + 1 consumable per shop.

**Rarity**: shop charm rarity 70/25/5; legendary only via rare pack/consumable.

**Run length**: 24 rounds (+ shops) ≈ 30–45 min; round ≤ 2 min.

**RNG/agency checklist**: telegraph boss at ante start; allow boss reroll upgrade; nudge/set tools; pity-ish shop (no duplicates; guaranteed one hand-related charm in first shop); show odds/preview of best hand while holding dice.
