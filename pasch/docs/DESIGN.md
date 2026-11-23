# Pasch – Spieldesign

*Ein Würfel-Roguelike im Browser. Wirf, halte, würfle nach – und lass die Zahlen explodieren.*

Grundlage: `docs/research/research_mechanics.md` (Regeln, Wahrscheinlichkeiten, Balancing) und
`docs/research/research_feel.md` (Spielgefühl, Sound, Rezepte). **Alles ist eigenständig**: eigener Name, eigene
Begriffe, eigene Optik (Neon-Nachtmarkt). Keine Namen, Figuren, Grafiken oder Texte aus anderen Spielen.

Sprache der Oberfläche: **Deutsch**. Code, Bezeichner und IDs: Englisch/ASCII.

---

## 1. Kernschleife

Ein **Lauf** besteht aus **8 Einsätzen**. Jeder Einsatz hat drei **Partien**:

| Partie | Ziel (× Basis) | Belohnung | Überspringbar |
|---|---|---|---|
| Kleine Partie | ×1 | $3 | ja → Marke |
| Große Partie | ×1,5 | $4 | ja → Marke |
| Wächter-Partie | ×2 (Wächter kann ändern) | $5 | nein |

Basisziele je Einsatz: **300 · 800 · 2.000 · 5.000 · 11.000 · 20.000 · 35.000 · 50.000**.
Wer Einsatz 8 schafft, hat gewonnen und darf **endlos** weiterspielen:
`base(a) = 50000 · 1.6^(a−8) ^ (1 + 0.2·(a−8))` (gerundet auf 2 signifikante Stellen).

### Eine Partie
- Der Spieler hat **4 Würfe** und einen gemeinsamen Vorrat von **3 Nachwürfen** pro Partie.
- **Wurf beginnen**: alle Würfel der Schale werden geworfen (kostenlos).
- Danach beliebig oft: Würfel **halten** (Klick / Taste 1–7, kostenlos) und **nachwürfeln** (kostet 1 Nachwurf,
  wirft alle nicht gehaltenen Würfel neu).
- **Werten**: Der Spieler wählt eine der möglichen Hände (Standard: die ranghöchste) und wertet. Das kostet 1 Wurf.
  Punkte werden zum Partie-Ergebnis addiert. Gehaltene Würfel werden danach freigegeben.
- Ergebnis ≥ Ziel → Partie gewonnen (sofort, verbleibende Würfe bringen je $1).
- Würfe = 0 und Ziel nicht erreicht → Lauf verloren.
- Nach jeder gewonnenen Partie: **Abrechnung** (Belohnung, +$1 je übrigem Wurf, Zinsen $1 je $5 Vermögen, max. $5)
  → **Laden**.

### Wertung
`Ergebnis = Punkte × Multi` (ganzzahlig abgerundet).
Farben: **Punkte = Türkis/Mint**, **Multi = Pink**, **×Multi = Bernstein**, **Geld = Gold**.

Reihenfolge (fest, wird 1:1 animiert):
1. **Hand**: Basis-Punkte und Basis-Multi der Hand (inkl. Stufe). Wächter-Modifikatoren.
2. **Würfel** – jeder *wertende* Würfel von links nach rechts (Reihenfolge in der Schale):
   a. Augen als Punkte (+v). b. Material des Würfels. c. Prägung der Fläche. d. Talismane mit „wenn ein Würfel
   gewertet wird“ (links → rechts). e. Wiederholungen („Nochmal!“): Echo-Prägung, Talismane – wiederholt a–d.
3. **Talismane** links → rechts: Effekte „auf die Hand“ (+Punkte, +Multi, ×Multi, Geld).
4. Ergebnis = Punkte × Multi. Nachwirkungen (Glas zerspringt, skalierende Talismane wachsen, Geld).

Wertende Würfel = die Würfel, die die gewählte Hand bilden. Stein-Flächen werten **immer** mit.

---

## 2. Hände

| ID | Name | Basis | je Stufe | wertende Würfel |
|---|---|---|---|---|
| `scatter` | Streuung | 5 × 1 | +10 / +1 | höchster Würfel |
| `pair` | Paar | 10 × 2 | +15 / +1 | die 2 |
| `twopair` | Zwei Paare | 20 × 2 | +20 / +1 | die 4 |
| `triple` | Drilling | 30 × 3 | +20 / +2 | die 3 |
| `smallrun` | Kleine Straße | 35 × 3 | +25 / +2 | die 4 aufeinanderfolgenden |
| `parity` | Gleichklang | 40 × 3 | +20 / +2 | 5 Würfel, alle gerade oder alle ungerade |
| `fullhouse` | Full House | 40 × 4 | +25 / +2 | die 5 |
| `bigrun` | Große Straße | 60 × 5 | +30 / +3 | die 5 aufeinanderfolgenden |
| `quad` | Vierling | 60 × 7 | +30 / +3 | die 4 |
| `pasch` | Pasch | 120 × 12 | +35 / +4 | die 5 gleichen |
| `sixer` *(geheim)* | Sechsling | 200 × 20 | +50 / +5 | 6 gleiche (nur mit ≥ 6 Würfeln) |
| `skyladder` *(geheim)* | Himmelsleiter | 160 × 14 | +40 / +4 | 6 aufeinanderfolgende |

Regeln:
- Eine Hand **enthält** kleinere Hände (Full House enthält Paar, Zwei Paare, Drilling; Große Straße enthält Kleine
  Straße; Vierling enthält Drilling und Paar …). Der Spieler darf jede enthaltene Hand wählen (z. B. für Wächter
  „Das Echo“). Talismane wie „Zwillingsglocke (wenn die Hand ein Paar enthält)“ prüfen die *gewählte* Hand auf
  Enthaltensein.
- Mit mehr als 5 Würfeln zählt jeweils die beste Auswahl (Gleichklang: 5 beliebige Würfel gleicher Parität).
- Leere Flächen (Wert 0) und Stein-Flächen haben keine Augenzahl und bilden keine Hände.
- **Stern**-Flächen (wild) zählen als beliebige Augenzahl (beste Belegung wird gesucht).
- Geheime Hände erscheinen in der Handliste erst, nachdem sie einmal gewertet wurden.

---

## 3. Würfel

Der Spieler besitzt eine **Schale** mit Würfeln (Start: 5 normale W6, Flächen 1–6). Maximal **5 Würfel**
(+1 durch Privileg „Sechster Würfel“, +1 durch Talisman „Sechster Sinn“; Phantom-Würfel zählen nicht).

Ein Würfel = Form (W4, W6, W8) + Flächen (je Wert + optional Prägung) + optional Material.
Jede Fläche fällt gleich wahrscheinlich (Ausnahme Blei).

### Prägungen (auf einer Fläche)
| ID | Name | Wirkung beim Werten |
|---|---|---|
| `gold` | Gold | +$1 |
| `ruby` | Rubin | +4 Multi |
| `azure` | Azur | +30 Punkte |
| `star` | Stern | zählt als beliebige Augenzahl (wild); Augen-Punkte = gewählter Wert |
| `echo` | Echo | Würfel wird 1× wiederholt („Nochmal!“) |
| `glass` | Glas | ×2 Multi; danach 1/4 Chance: Fläche zerspringt (wird leer, Prägung weg) |
| `stone` | Stein | +50 Punkte, keine Augenzahl, wertet immer |
| `clover` | Klee | 1/5: +20 Multi; 1/15: +$20 (unabhängig) |

### Materialien (ganzer Würfel)
| ID | Name | Wirkung |
|---|---|---|
| `lead` | Blei | höchste Fläche fällt doppelt so oft |
| `bone` | Knochen | beim Werten +2× Augen als zusätzliche Punkte |
| `prism` | Prisma | beim Werten +10 Multi |
| `crystal` | Kristall | beim Werten ×1,5 Multi |
| `phantom` | Phantom | zählt nicht gegen das Würfellimit |

### Formen
W4 (1–4, Paare leichter), W6, W8 (1–8, mehr Punkte, Straßen 4–8 möglich). Der „Former“ macht aus W6 einen W8
(Flächen 7 und 8 kommen hinzu, vorhandene Flächen bleiben).

---

## 4. Talismane (5 Plätze, wirken links → rechts, Reihenfolge per Drag & Drop)

Seltenheit im Laden 70 % gewöhnlich / 25 % ungewöhnlich / 5 % selten; legendär nur durch „Seelenstein“.
Preise: gewöhnlich $4–5, ungewöhnlich $6–7, selten $8–10, legendär –. Verkaufswert = Hälfte (abgerundet, min. $1).
Keine Duplikate im Laden, solange man den Talisman besitzt.

**Gewöhnlich**
1. `snake_eye` **Schlangenauge** – +8 Multi je gewerteter 1.
2. `sixpack` **Sechserpack** – +30 Punkte je gewerteter 6.
3. `even_line` **Gerade Linie** – +10 Multi, wenn alle wertenden Würfel gerade sind.
4. `odd_bird` **Komischer Vogel** – +10 Multi, wenn alle wertenden Würfel ungerade sind.
5. `twin_bell` **Zwillingsglocke** – +8 Multi, wenn die Hand ein Paar enthält.
6. `triad` **Dreiklang** – +12 Multi, wenn die Hand einen Drilling enthält.
7. `ladder` **Leiter** – +12 Multi, wenn die Hand eine Straße enthält.
8. `pip_counter` **Augenzähler** – +Punkte = 2× Augensumme *aller* Würfel.
9. `deep_dive` **Tiefgang** – +15 Multi, wenn die Augensumme aller Würfel ≤ 12.
10. `high_tide` **Flut** – +50 Punkte, wenn die Augensumme aller Würfel ≥ 24.
11. `patience` **Geduld** – +4 Multi je ungenutztem Nachwurf.
12. `lucky_penny` **Glückspfennig** – +$1 je gewerteter 6.
13. `center` **Mittelpunkt** – der mittlere Würfel der Schale wird 1× wiederholt (wenn er wertet).
14. `lucky_seven` **Glückssieben** – +7 Multi je Würfelpaar (unter allen Würfeln), dessen Summe 7 ist.
15. `tally` **Kerbholz** – gewinnt dauerhaft +3 Punkte, jedes Mal wenn eine Hand mit Paar gewertet wird.
16. `prime` **Primzahl** – +5 Multi je gewerteter 2, 3 oder 5.
17. `cup` **Lederbecher** – +4 Multi.
18. `stocking` **Sparstrumpf** – +$2 am Ende jeder gewonnenen Partie.
19. `high_roller` **Hochstapler** – +20 Punkte je gewertetem Würfel mit 5 oder mehr Augen.
20. `first_throw` **Erster Wurf** – ×2 Multi im ersten Wurf einer Partie, wenn kein Nachwurf benutzt wurde.

**Ungewöhnlich**
21. `echo_chamber` **Echokammer** – Würfel mit der häufigsten Augenzahl werden 1× wiederholt.
22. `loaded` **Gezinkt** – ×1,5 Multi; −1 Nachwurf pro Partie.
23. `domino` **Domino** – jeder wertende Würfel gibt +Multi in Höhe der Augen seines linken Nachbarn.
24. `momentum` **Schwung** – ×(1 + 0,2·n) Multi; n wächst um 1, wenn die Hand ranghöher als die vorige ist, sonst n = 0.
25. `hoard` **Hamsterbecher** – ungenutzte Nachwürfe gehen in die nächste Partie über (max. +3).
26. `rebate` **Rabatt** – jeder Nachwurf gibt $1 (max. $3 pro Partie).
27. `collector` **Sammler** – +3 Multi je verschiedener Augenzahl unter allen Würfeln.
28. `tally_board` **Kerbbrett** – ×(1 + 0,25·n) Multi; n wächst um 1 pro gewertetem Vierling oder besser.
29. `gold_rush` **Goldrausch** – Gold-Prägungen geben zusätzlich +$1 und +8 Multi.
30. `sticky` **Klebrige Finger** – gehaltene Würfel geben +15 Punkte, wenn sie werten.
31. `crown` **Bröckelnde Krone** – ×3 Multi; verliert ×0,25 nach jeder Partie, zerbricht bei ×1.
32. `tower` **Würfelturm** – +1 Nachwurf pro Partie.
33. `stamina` **Ausdauer** – +1 Wurf pro Partie.
34. `modesty` **Bescheidenheit** – ×2 Multi, wenn die gewählte Hand genau „Paar“ ist.
35. `spirit` **Würfelgeist** – gewinnt dauerhaft +1 Multi je benutztem Nachwurf.

**Selten**
36. `pentagram` **Pentagramm** – ×4 Multi bei Pasch oder Sechsling.
37. `clockwork` **Uhrwerk** – wurde in diesem Wurf kein Nachwurf benutzt, werden alle wertenden Würfel 1× wiederholt.
38. `philosopher` **Stein der Weisen** – jede gewertete 6 gibt ×1,25 Multi.
39. `copycat` **Nachahmer** – kopiert den Talisman rechts daneben (wenn kopierbar).
40. `second_wind` **Zweiter Atem** – 1× pro Partie: verfehlt der letzte Wurf das Ziel, gibt es einen weiteren Wurf.
41. `ledger` **Hauptbuch** – ×(1 + 0,1 je $5 Vermögen) Multi.
42. `sixth_sense` **Sechster Sinn** – solange du ihn besitzt: ein zusätzlicher normaler W6 in der Schale.
43. `chain` **Kettenreaktion** – bei Straßen werden alle wertenden Würfel 1× wiederholt.
44. `fairy` **Glücksfee** – Klee-Chancen verdoppelt; jedes Klee-Glück gibt zusätzlich ×1,5 Multi.

**Legendär** (nur durch Seelenstein)
45. `infinity` **Unendlichkeit** – der höchste wertende Würfel wird (Augen − 1)-mal wiederholt.
46. `fate` **Schicksalsweber** – alle Einsen zählen als Stern (wild).
47. `hollow_king` **Hohler König** – ×(1 + 1 je freiem Talismanplatz) Multi.
48. `croupier` **Croupier** – ×1,25 Multi je gewerteter Fläche mit Prägung.

---

## 5. Verbrauchsgüter (2 Plätze)

### Sternbilder (Hand-Stufe +1), $3
Je Hand eins: `c_scatter` Streulicht, `c_pair` Zwillinge, `c_twopair` Doppelstern, `c_triple` Dreigestirn,
`c_smallrun` Kleiner Pfad, `c_parity` Waage, `c_fullhouse` Haus der Sterne, `c_bigrun` Milchstraße,
`c_quad` Kreuz des Südens, `c_pasch` Polarstern; geheim (nur wenn die Hand schon gewertet wurde):
`c_sixer` Sechsgestirn, `c_skyladder` Himmelstor.

### Werkzeuge, $3 (ziel: Würfelfläche(n) im Würfel-Inspektor bzw. Würfel)
| ID | Name | Wirkung |
|---|---|---|
| `t_chisel` | Meißel | 1 Fläche auf einen gewählten Wert setzen (1 … Seitenzahl) |
| `t_mirror` | Spiegel | 1 Fläche auf eine andere Fläche desselben Würfels kopieren |
| `t_gold` | Goldlack | Gold auf 1 Fläche |
| `t_ruby` | Rubinstaub | Rubin auf 1 Fläche |
| `t_azure` | Azurtinte | Azur auf bis zu 2 Flächen |
| `t_echo` | Echo-Rune | Echo auf 1 Fläche |
| `t_glass` | Glasbläser | Glas auf bis zu 2 Flächen |
| `t_stone` | Steinmetz | Stein auf 1 Fläche |
| `t_clover` | Kleeblatt | Klee auf bis zu 2 Flächen |
| `t_lead` | Bleiguss | Würfel wird Blei |
| `t_shaper` | Former | W6 → W8 (Flächen 7 und 8 neu) |
| `t_coin` | Münzwurf | Geld verdoppeln (max. +$20) |
| `t_seer` | Seher | erzeugt bis zu 2 zufällige Sternbilder (freie Plätze) |
| `t_nudge` | Stupser | *nur im Wurf*: ein geworfener Würfel zeigt ±1 (nur dieser Wurf) |
| `t_flip` | Wende | *nur im Wurf*: ein geworfener Würfel dreht auf die Gegenseite (Seiten+1−v) |

### Mystik (nur aus Mystikbeuteln), $4
| ID | Name | Wirkung |
|---|---|---|
| `m_star` | Sternenstaub | Stern-Prägung auf 1 Fläche |
| `m_prism` | Prismensplitter | Würfel wird Prisma |
| `m_crystal` | Kristallauge | Würfel wird Kristall |
| `m_phantom` | Phantomhauch | neuer Phantom-W6 in der Schale |
| `m_double` | Doppelgänger | kopiert einen zufälligen Talisman (braucht freien Platz) |
| `m_soul` | Seelenstein | erzeugt einen legendären Talisman (braucht freien Platz) |
| `m_wish` | Wunschbrunnen | alle Hände +1 Stufe; Geld auf $0 |

---

## 6. Wächter (Boss-Partien)

Am Anfang jedes Einsatzes wird der Wächter gezogen und **angezeigt** (Vorbereitung möglich). Kein Wächter zweimal
pro Lauf, solange Auswahl übrig ist.

| ID | Name | ab Einsatz | Wirkung |
|---|---|---|---|
| `leaden` | Der Bleierne | 1 | Einsen und Zweien zählen nicht (keine Punkte, keine Hände) |
| `miser` | Der Geizhals | 2 | keine Nachwürfe |
| `lonely` | Der Einsame | 2 | nur 1 Wurf; Ziel ×1 statt ×2 |
| `echo` | Das Echo | 1 | keine Hand zweimal werten |
| `fixation` | Die Fixierung | 3 | nur die zuerst gewertete Hand ist danach erlaubt |
| `fog` | Der Nebel | 1 | 2 zufällige Würfel landen verdeckt („?“) bis zum Werten |
| `toll` | Der Zöllner | 1 | −$1 je Nachwurf |
| `shackle` | Die Fessel | 1 | ein zufälliger Würfel ist gefesselt: kann nicht gehalten werden |
| `turner` | Der Wender | 2 | nach jedem Nachwurf dreht ein zufälliger Würfel auf die Gegenseite |
| `wall` | Die Mauer | 2 | Ziel ×4 |
| `thief` | Der Dieb | 2 | ein zufälliger Talisman ist in dieser Partie deaktiviert |
| `grudge` | Der Groll | 3 | gewertete Würfel geben für den Rest der Partie keine Augen-Punkte |
| `chill` | Die Kälte | 3 | Basis-Multi der Hand halbiert |
| `abyss` | **Der Abgrund** | nur 8 | Ziel ×6 |
| `eclipse` | **Die Finsternis** | nur 8 | alle Würfel landen verdeckt; Nachwürfe decken auf |

„Wächterbann“ (Privileg) erlaubt 1× pro Einsatz einen neuen Wächter zu ziehen.

---

## 7. Laden

Nach jeder gewonnenen Partie. Inhalt:
- **2 Angebotsplätze** (Talisman 60 %, Sternbild 25 %, Werkzeug 15 %).
- **2 Beutel** (zufällig aus der Tabelle), **1 Privileg** pro Einsatz (bleibt bis gekauft oder neuer Einsatz).
- **Neu mischen**: $5, +$1 je weiteres Mal (Reset in jedem Laden).
- Kaufen, Verkaufen (Talismane, Verbrauchsgüter), Verbrauchsgüter benutzen.

Beutel (Inhalt wird geöffnet, man wählt):
| ID | Name | Preis | Inhalt |
|---|---|---|---|
| `p_star` | Sternbeutel | $4 | wähle 1 aus 3 Sternbildern |
| `p_tool` | Werkzeugbeutel | $4 | wähle 1 aus 3 Werkzeugen (sofort benutzbar oder behalten) |
| `p_charm` | Talismanbeutel | $5 | wähle 1 aus 2 Talismanen |
| `p_dice` | Würfelbeutel | $5 | wähle 1 aus 3 besonderen Würfeln; er ersetzt einen gewählten Würfel |
| `p_mystic` | Mystikbeutel | $6 | wähle 1 aus 2 Mystik-Gütern |
| `p_mega_star` | Großer Sternbeutel | $8 | wähle 2 aus 5 Sternbildern |

Würfel im Würfelbeutel: zufällige Form (75 % W6, 15 % W4, 10 % W8), 1–3 Prägungen, 30 % Material (kein Phantom).

## 8. Privilegien ($10, eins pro Einsatz im Laden)
| ID | Name | Wirkung | Voraussetzung |
|---|---|---|---|
| `v_cup` | Großer Becher | +1 Nachwurf pro Partie | – |
| `v_cup2` | Riesenbecher | +1 Nachwurf pro Partie | v_cup |
| `v_hand` | Ausdauertraining | +1 Wurf pro Partie | – |
| `v_slot` | Vitrine | +1 Talismanplatz | – |
| `v_slot2` | Galerie | +1 Talismanplatz | v_slot |
| `v_haggle` | Feilscher | alle Ladenpreise −25 % (abgerundet) | – |
| `v_interest` | Zinseszins | Zinsobergrenze $10 | – |
| `v_sixth` | Sechster Würfel | +1 Würfellimit und ein neuer normaler W6 | – |
| `v_ban` | Wächterbann | 1× pro Einsatz Wächter neu ziehen | – |
| `v_pouch` | Tasche | +1 Verbrauchsplatz | – |
| `v_shop` | Großer Laden | +1 Angebotsplatz | – |
| `v_stars` | Sternkarte | Sternbilder im Laden doppelt so häufig | – |

## 9. Marken (Belohnung fürs Überspringen; wirken beim nächsten passenden Ereignis)
`tag_money` Investition (+$15 nach der nächsten Wächter-Partie) · `tag_charm` Gönner (nächster Laden: 1 gratis
ungewöhnlicher Talisman) · `tag_star` Sternschnuppe (gratis Großer Sternbeutel) · `tag_tool` Werkstatt (gratis
Werkzeugbeutel) · `tag_sale` Ausverkauf (nächster Laden: Angebote gratis neu mischen ×2, Preise −50 %) ·
`tag_throw` Rückenwind (+1 Wurf in der nächsten Partie) · `tag_dice` Würfelmacher (gratis Würfelbeutel) ·
`tag_double` Doppel (die nächste Marke wird verdoppelt).

## 10. Becher (Startvarianten, freischaltbar)
| ID | Name | Wirkung | Freischaltung |
|---|---|---|---|
| `wood` | Holzbecher | Standard | – |
| `red` | Roter Becher | +1 Nachwurf pro Partie | Einsatz 3 erreichen |
| `blue` | Blauer Becher | +1 Wurf pro Partie | Einsatz 4 erreichen |
| `gold` | Goldbecher | Start mit $12, Zinsobergrenze $7 | 50 Würfe gewertet |
| `black` | Schwarzer Becher | +1 Talismanplatz, −1 Wurf | einen Lauf gewinnen |
| `loaded` | Gezinkter Becher | jeder Würfel hat statt der 1 eine 6; alle Ziele ×1,5 | Pasch werten |
| `tiny` | Vierbecher | 6 W4 statt 5 W6 (Würfellimit 6) | 5 Läufe beendet |
| `star` | Sternbecher | Start mit Sternkarte und 2 Sternbildern „Zwillinge“ | 10 Sternbilder benutzt |

## 11. Schwierigkeit (Stufen, kumulativ, je Becher nach Sieg freigeschaltet)
1 Normal · 2 Kleine Partie gibt kein Geld · 3 Ziele ×1,2 · 4 −1 Nachwurf · 5 Wächter-Ziele ×2,5 statt ×2.

## 12. Meta
Profil in `localStorage`: Einstellungen, Statistik (Läufe, Siege, höchster Wurf, beste Hand, Würfe, …),
Sammlung (entdeckte Talismane, Hände, Wächter), Freischaltungen, laufender Lauf (Fortsetzen). Einfache
**Erfolge** (20–30), die Becher freischalten.

## 13. Look & Feel (Kurzfassung – Details in ARCHITECTURE §6 und research_feel.md)
- **Neon-Nachtmarkt**: tiefviolett-blauer, wirbelnder Hintergrund (WebGL-Shader, 3 Farbbänder, beschleunigt beim
  Werten), Filz-Schale in der Mitte, CRT-Scanlines + Vignette (abschaltbar).
- Würfel: echte CSS-3D-Würfel (Elfenbein #f4ecd8, Augen #231a2e, dicke dunkle Kontur), tumbeln, springen, landen
  mit Klack. W4/W8 werden ebenfalls als Würfel mit passender Flächenzahl-Anzeige dargestellt (Würfelkörper W6-Form
  mit Formsymbol – Zahlen statt Augen bei Werten > 6).
- Alles federt (Federn statt linearer Tweens), alles wackelt beim Auslösen (juice_up), Zahlen zählen hoch,
  Tonhöhe steigt mit jedem Auslöser, Bildschirmwackeln skaliert mit der Punktzahl, Flammen wenn das Ziel fällt.
- Schrift: „Pixelify Sans“ (Google Fonts) mit Fallback, Zahlen tabellarisch.
