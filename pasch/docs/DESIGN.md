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

Basisziele je Einsatz: **300 · 700 · 1.800 · 4.500 · 10.000 · 20.000 · 35.000 · 50.000** (Einsatz 2–5 gegenüber dem
ersten Entwurf leicht gesenkt, siehe §14). Ziele werden auf ganze Zahlen gerundet.
Wer Einsatz 8 schafft, hat gewonnen und darf **endlos** weiterspielen (erst Abrechnung, dann Laden, dann Einsatz 9):
`base(a) = 50000 · (1.6^(a−8))^(1 + 0.2·(a−8))` (gerundet auf 2 signifikante Stellen; Einsatz 9 = 88.000).
Jeder Einsatz, der ein Vielfaches von 8 ist, bekommt einen Finale-Wächter.

Start: **$4**, 5 normale W6, 5 Talismanplätze, 2 Verbrauchsplätze.

### Eine Partie
- Der Spieler hat **4 Würfe** und einen gemeinsamen Vorrat von **3 Nachwürfen** pro Partie.
- **Wurf beginnen**: alle Würfel der Schale werden geworfen (kostenlos).
- Danach beliebig oft: Würfel **halten** (Klick / Taste 1–7, kostenlos) und **nachwürfeln** (kostet 1 Nachwurf,
  wirft alle nicht gehaltenen Würfel neu).
- **Werten**: Der Spieler wählt eine der möglichen Hände (Standard: die ranghöchste erlaubte) und wertet. Das kostet
  1 Wurf. Punkte werden zum Partie-Ergebnis addiert. Gehaltene Würfel werden danach freigegeben; der nächste Wurf
  beginnt wieder mit „Wurf beginnen“.
- **Fehlwurf**: Verbietet ein Wächter (Echo, Fixierung) jede vorliegende Hand, kann nur ein Fehlwurf gewertet werden
  (0 Punkte, kostet 1 Wurf) – so bleibt der Spieler nie stecken.
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
   Talismane, die auf Wiederholungen reagieren (Ewiges Echo), wirken direkt nach dem „Nochmal!“-Schritt.
3. **Talismane** links → rechts: Effekte „auf die Hand“ (+Punkte, +Multi, ×Multi, Geld). Wachsende Talismane
   (Kerbholz, Schwung, Kerbbrett, Pechvogel, Schneeball, Meilenstein) wachsen direkt vor ihrem eigenen Effekt
   („grow“-Schritt). Steht ein Leuchtturm links daneben, folgt ein „Nochmal!“-Schritt des Leuchtturms und der
   Talisman löst seine Hand-Effekte ein zweites Mal aus.
4. Ergebnis = Punkte × Multi. Nachwirkungen (Glas zerspringt; Scherbensammler wächst; Zündschnur verliert eine
   Ladung und verglüht ggf.); Geld aus der Wertung wird gutgeschrieben.

Wertende Würfel = die Würfel, die die gewählte Hand bilden. Stein-Flächen werten **immer** mit.
Wiederholungen werden je Würfel gesammelt (Echo-Prägung zuerst, dann Talismane links → rechts); jede erzeugt einen
„Nochmal!“-Schritt und wiederholt a–d, löst aber selbst keine weiteren Wiederholungen aus. Glas würfelt sein
Zerspringen erst in den Nachwirkungen (einmal je Fläche). Fließkomma-Multi wird erst am Ende abgerundet.

---

## 2. Hände

| ID | Name | Basis | je Stufe | wertende Würfel |
|---|---|---|---|---|
| `scatter` | Streuung | 10 × 2 | +20 / +1 | höchster Würfel |
| `pair` | Paar | 20 × 3 | +30 / +1 | die 2 |
| `twopair` | Zwei Paare | 40 × 3 | +40 / +1 | die 4 |
| `triple` | Drilling | 60 × 4 | +40 / +2 | die 3 |
| `smallrun` | Kleine Straße | 70 × 4 | +50 / +2 | die 4 aufeinanderfolgenden |
| `parity` | Gleichklang | 80 × 4 | +40 / +2 | 5 Würfel, alle gerade oder alle ungerade |
| `fullhouse` | Full House | 80 × 5 | +50 / +2 | die 5 |
| `bigrun` | Große Straße | 120 × 6 | +60 / +3 | die 5 aufeinanderfolgenden |
| `quad` | Vierling | 120 × 8 | +60 / +3 | die 4 |
| `pasch` | Pasch | 240 × 13 | +70 / +4 | die 5 gleichen |
| `skyladder` *(geheim)* | Himmelsleiter | 320 × 15 | +80 / +4 | 6 aufeinanderfolgende |
| `sixer` *(geheim)* | Sechsling | 400 × 21 | +100 / +5 | 6 gleiche (nur mit ≥ 6 Würfeln) |

Balancing (§14): gegenüber dem ersten Entwurf sind Basis-Punkte und Punkte je Stufe **verdoppelt** und das Basis-Multi
**+1** – sonst schaffte selbst ein guter Spieler Einsatz 1 nur in ~55 % der Läufe. Rangfolge = Tabellenreihenfolge
(Himmelsleiter unter Sechsling).

Regeln:
- Eine Hand **enthält** kleinere Hände: Zwei Paare ⊃ Paar; Drilling ⊃ Paar; Full House ⊃ Paar, Zwei Paare, Drilling;
  Vierling ⊃ Drilling, Paar; Pasch ⊃ Vierling, Drilling, Paar; Sechsling ⊃ Pasch …; Große Straße ⊃ Kleine Straße;
  Himmelsleiter ⊃ beide Straßen. Gleichklang und Streuung stehen für sich (Vierling enthält *nicht* Zwei Paare,
  Full House braucht zwei verschiedene Augenzahlen). Erkannt werden die tatsächlich vorliegenden Muster. Der Spieler darf jede enthaltene Hand wählen (z. B. für Wächter
  „Das Echo“). Talismane wie „Zwillingsglocke (wenn die Hand ein Paar enthält)“ prüfen die *gewählte* Hand auf
  Enthaltensein.
- Mit mehr als 5 Würfeln zählt jeweils die beste Auswahl (Gleichklang: 5 beliebige Würfel gleicher Parität).
- Leere Flächen (Wert 0) und Stein-Flächen haben keine Augenzahl und bilden keine Hände.
- **Stern**-Flächen (wild) zählen als beliebige Augenzahl von 1 bis zur größten Seitenzahl in der Schale (beste Belegung
  je Hand wird gesucht: höchste Augensumme der wertenden Würfel).
- Bei mehreren Möglichkeiten wird je Hand die höchste Auswahl genommen (z. B. das höhere Paar, die höchste Straße).
- Geheime Hände erscheinen in der Handtabelle erst, nachdem sie einmal gewertet wurden (wählbar sind sie, sobald sie
  liegen).

---

## 3. Würfel

Der Spieler besitzt eine **Schale** mit Würfeln (Start: 5 normale W6, Flächen 1–6). Maximal **5 Würfel**
(+1 durch Privileg „Sechster Würfel“, +1 durch Talisman „Sechster Sinn“; Phantom-Würfel zählen nicht).

Ein Würfel = Form (W4, W6, W8) + Flächen (je Wert + optional Prägung) + optional Material.
Jede Fläche fällt gleich wahrscheinlich (Ausnahme Blei). Die **Gegenseite** einer Fläche ist die Fläche mit gespiegeltem
Index (Standard-W6: 7 − Augen; W8 nach dem Former: 9 − Augen). Würfel, die ein Talisman bringt (Sechster Sinn), und
Phantom-Würfel zählen nicht gegen das Würfellimit; mehr als 7 Würfel gibt es nie.

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

**100 Talismane**: 42 gewöhnlich, 32 ungewöhnlich, 18 selten, 8 legendär. Nr. 1–48 stehen in
`src/game/content/talismans.js`, Nr. 49–100 („Teil 2“) in `src/game/content/talismans2.js`; beide landen im selben
`TALISMANS`/`TALISMAN_IDS`-Objekt (Laden, Beutel, Seelenstein, Doppelgänger, Sammlung und Erfolge nutzen es direkt).

Seltenheit im Laden 70 % gewöhnlich / 25 % ungewöhnlich / 5 % selten; legendär nur durch „Seelenstein“.
Preise: gewöhnlich $4–5, ungewöhnlich $6–7, selten $8–10, legendär $20 (nur Verkaufswert relevant: $10).
Verkaufswert = Hälfte des Grundpreises (abgerundet, min. $1), beim Sparschwein plus sein angesparter Bonus. Keine Duplikate im Laden, solange man den Talisman
besitzt (der Doppelgänger kann Duplikate erzeugen). Der genaue Preis jedes Talismans steht in
`src/game/content/talismans.js`.

Nicht kopierbar (Nachahmer): Sparstrumpf, Hamsterbecher, Rabatt, Würfelturm, Ausdauer, Nachahmer (kopiert aber
einen Nachahmer weiter), Zweiter Atem, Sechster Sinn, Glücksfee, Schicksalsweber, Goldader, Sparschwein,
Schutzsiegel, Stammkunde, Leuchtturm, Wühltisch, Zinsfuß, Sternenthron, Zeitschleife. Wachstum (Kerbholz, Schwung,
Kerbbrett, Pechvogel, Schneeball, Meilenstein, Scherbensammler) und Ladungsverbrauch (Zündschnur) werden vom
Nachahmer nicht kopiert – er nutzt den aktuellen Stand des Nachbarn. Wachsende Talismane wachsen
*vor* ihrem Effekt (die auslösende Hand zählt schon mit). Der Dieb deaktiviert einen Talisman für die ganze Partie.
Balancing-Änderungen gegenüber dem ersten Entwurf sind mit (B) markiert.

**Gewöhnlich**
1. `snake_eye` **Schlangenauge** – +8 Multi je gewerteter 1.
2. `sixpack` **Sechserpack** – +40 Punkte je gewerteter 6. (B, war +30)
3. `even_line` **Gerade Linie** – +10 Multi, wenn alle wertenden Würfel gerade sind.
4. `odd_bird` **Komischer Vogel** – +10 Multi, wenn alle wertenden Würfel ungerade sind.
5. `twin_bell` **Zwillingsglocke** – +8 Multi, wenn die Hand ein Paar enthält.
6. `triad` **Dreiklang** – +12 Multi, wenn die Hand einen Drilling enthält.
7. `ladder` **Leiter** – +12 Multi, wenn die Hand eine Straße enthält.
8. `pip_counter` **Augenzähler** – +Punkte = 3× Augensumme *aller* Würfel. (B, war 2×)
9. `deep_dive` **Tiefgang** – +15 Multi, wenn die Augensumme aller Würfel ≤ 12.
10. `high_tide` **Flut** – +80 Punkte, wenn die Augensumme aller Würfel ≥ 24. (B, war +50)
11. `patience` **Geduld** – +4 Multi je ungenutztem Nachwurf.
12. `lucky_penny` **Glückspfennig** – +$1 je gewerteter 6.
13. `center` **Mittelpunkt** – der mittlere Würfel der Schale (Index ⌊(n−1)/2⌋) wird 1× wiederholt (wenn er wertet).
14. `lucky_seven` **Glückssieben** – +7 Multi je Würfelpaar (unter allen Würfeln), dessen Summe 7 ist.
15. `tally` **Kerbholz** – gewinnt dauerhaft +5 Punkte, jedes Mal wenn eine Hand mit Paar gewertet wird. (B, war +3)
16. `prime` **Primzahl** – +5 Multi je gewerteter 2, 3 oder 5.
17. `cup` **Lederbecher** – +4 Multi.
18. `stocking` **Sparstrumpf** – +$2 am Ende jeder gewonnenen Partie.
19. `high_roller` **Hochstapler** – +30 Punkte je gewertetem Würfel mit 5 oder mehr Augen. (B, war +20)
20. `first_throw` **Erster Wurf** – ×2 Multi im ersten Wurf einer Partie, wenn kein Nachwurf benutzt wurde.

**Ungewöhnlich**
21. `echo_chamber` **Echokammer** – Würfel mit der häufigsten Augenzahl werden 1× wiederholt.
22. `loaded` **Gezinkt** – ×1,5 Multi; −1 Nachwurf pro Partie.
23. `domino` **Domino** – jeder wertende Würfel gibt +Multi in Höhe der Augen seines linken Nachbarn.
24. `momentum` **Schwung** – ×(1 + 0,2·n) Multi; n wächst um 1, wenn die Hand ranghöher als die zuletzt gewertete ist
    (über Partien hinweg), sonst n = 0.
25. `hoard` **Hamsterbecher** – ungenutzte Nachwürfe gehen in die nächste Partie über (max. +3).
26. `rebate` **Rabatt** – jeder Nachwurf gibt $1 (max. $3 pro Partie).
27. `collector` **Sammler** – +3 Multi je verschiedener Augenzahl unter allen Würfeln.
28. `tally_board` **Kerbbrett** – ×(1 + 0,25·n) Multi; n wächst um 1 pro gewertetem Vierling oder besser.
29. `gold_rush` **Goldrausch** – Gold-Prägungen geben zusätzlich +$1 und +8 Multi.
30. `sticky` **Klebrige Finger** – gehaltene Würfel geben +25 Punkte, wenn sie werten. (B, war +15)
31. `crown` **Bröckelnde Krone** – ×3 Multi; verliert ×0,25 nach jeder gewonnenen Partie, zerbricht bei ×1.
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

### Teil 2 (Nr. 49–100)
Neue Build-Richtungen: jede Augenzahl (2 Doppelnaht, 3 Dreiblatt, 4 Vierkant, 5 Handvoll, Hoch/Niedrig-Mischung
Spannweite), je ein Talisman für jede bisher unbediente Hand, Prägungs- und Material-Builds, W4/W8, Positionen in der
Schale (Anker links, Schlusslicht rechts, Treppe), Nachwurf-/Halten-Ökonomie (Sitzfleisch, Hasardeur, Schneeball,
Letzte Runde, Zeitschleife), Risiko (Zündschnur verglüht, Scherbensammler lässt Glas öfter zerspringen),
Geld/Laden (Sparschwein, Goldader, Stammkunde, Zinsfuß, Wühltisch), Verbrauchsgüter (Sterngucker, Meisterbrief),
Wächter (Recke, Schutzsiegel) und Talisman-Zusammenspiel (Leerstelle, Dirigent, Leuchtturm, Wunderkammer, Prunksaal).
Preis jeweils hinter dem Effekt. „Gehalten“ bei Sitzfleisch heißt: der Würfel war bei mindestens einem Nachwurf
gehalten (`Rolled.kept`), nicht nur kurz vor dem Werten. Das Schutzsiegel senkt das Ziel beim Start der
Wächter-Partie (die Partie-Übersicht zeigt vorher das volle Ziel). Der Sternenthron hebt beim Partiesieg die zuletzt
gewertete Hand. Zahlen mit (B) wurden nach der Bot-Auswertung (§14) angepasst.
**Gewöhnlich**
49. `twofold` **Doppelnaht** – +4 Multi je gewerteter 2; gewertete 2en werden 1× wiederholt · $5.
50. `trefoil` **Dreiblatt** – Jede gewertete 3 gibt +3 Multi je 3 unter den wertenden Würfeln · $5.
51. `foursquare` **Vierkant** – +44 Punkte je gewerteter 4 · $4.
52. `handful` **Handvoll** – +5 Multi und +15 Punkte je gewerteter 5 · $5.
53. `span` **Spannweite** – +2 Multi je Auge Unterschied zwischen höchstem und niedrigstem Würfel (alle Würfel) · $4.
54. `double_decker` **Doppeldecker** – +12 Multi, wenn die Hand Zwei Paare enthält (B, war +10) · $4.
55. `footpath` **Trampelpfad** – ×1,5 Multi, wenn die gewählte Hand genau „Kleine Straße“ ist · $5.
56. `cadence` **Taktgefühl** – +15 Multi, wenn die Hand Gleichklang ist · $5.
57. `loner` **Einzelgänger** – Bei Streuung: +4 Multi und +Punkte in Höhe der doppelten Augensumme aller Würfel · $4.
58. `deep_sea` **Tiefsee** – Gewertete Azur-Prägungen geben zusätzlich +30 Punkte und +3 Multi · $4.
59. `quarry` **Steinbruch** – Gewertete Stein-Flächen geben zusätzlich +40 Punkte und +4 Multi · $4.
60. `jinx` **Pechvogel** – Gewinnt dauerhaft +3 Multi, jedes Mal wenn eine Klee-Fläche kein Glück bringt · $5.
61. `gold_vein` **Goldader** – Abrechnung: +$1 je Gold-Prägung auf deinen Würfeln (max. $4) *(nicht kopierbar)* · $5.
62. `leadfoot` **Bleifuß** – Gewertete Blei-Würfel geben +40 Punkte und +2 Multi · $4.
63. `tetra` **Tetraeder** – +4 Multi je gewertetem W4 (B, war +5) · $4.
64. `octa` **Oktaeder** – Gewertete W8 geben +Punkte in Höhe ihrer fünffachen Augen · $5.
65. `anchor` **Anker** – Wertet der linke Würfel der Schale, gibt er +Multi in Höhe seiner dreifachen Augen · $5.
66. `stairs` **Treppe** – +3 Multi je Würfel, der mehr Augen zeigt als sein linker Nachbar · $4.
67. `sitter` **Sitzfleisch** – Wertende Würfel, die mindestens einen Nachwurf lang gehalten wurden, geben +4 Multi · $5.
68. `last_call` **Letzte Runde** – ×2 Multi im letzten Wurf einer Partie · $5.
69. `piggy` **Sparschwein** – Sein Verkaufswert steigt nach jeder gewonnenen Partie um $2 *(nicht kopierbar)* · $4.
70. `vacancy` **Leerstelle** – +3 Multi je freiem Talismanplatz · $4.

**Ungewöhnlich**
71. `topping_out` **Richtfest** – ×2 Multi, wenn die Hand ein Full House ist · $6.
72. `highway` **Schnellstraße** – ×2,5 Multi, wenn die Hand eine Große Straße enthält (B, war ×2) · $7.
73. `gang_of_four` **Viererbande** – Enthält die Hand einen Vierling, gibt jeder wertende Würfel +8 Multi (B, war +6) · $6.
74. `wisp` **Irrlicht** – Gewertete Stern-Flächen geben +20 Punkte und +8 Multi · $6.
75. `echo_well` **Brunnenecho** – Echo-Prägungen lösen eine zusätzliche Wiederholung aus · $6.
76. `ossuary` **Beinhaus** – Gewertete Knochen-Würfel werden 1× wiederholt · $6.
77. `burning_glass` **Brennglas** – Gewertete Prisma-Würfel geben zusätzlich ×1,5 Multi · $7.
78. `tail_light` **Schlusslicht** – Wertet der rechte Würfel der Schale, wird er 2× wiederholt · $6.
79. `gambler` **Hasardeur** – ×(1 + 0,25 je in diesem Wurf benutztem Nachwurf) Multi · $6.
80. `snowball` **Schneeball** – ×(1 + 0,1·n) Multi; n wächst um 1 je Wurf, der ohne Nachwurf gewertet wird – jeder Nachwurf setzt n auf 0 · $7.
81. `fuse` **Zündschnur** – ×3 Multi für die nächsten 6 Wertungen, dann verglüht sie · $6.
82. `astronomer` **Sterngucker** – Gewinnt dauerhaft +3 Multi je benutztem Sternbild und +1 Multi je benutztem Werkzeug oder Mystik-Gut · $6.
83. `champion` **Recke** – ×2 Multi in Wächter-Partien · $6.
84. `ward_seal` **Schutzsiegel** – Zu Beginn jeder Wächter-Partie sinkt ihr Ziel um 20 % *(nicht kopierbar)* · $6.
85. `regular` **Stammkunde** – Im Laden ist das erste Neu-mischen gratis; Talismane im Laden kosten $1 weniger *(nicht kopierbar)* · $6.
86. `alchemist` **Alchemist** – +5 Multi je Würfel mit Material in der Schale (Phantom zählt doppelt) · $6.
87. `master` **Meisterbrief** – +4 Multi je Stufe der gewerteten Hand über Stufe 1 · $6.

**Selten**
88. `crystal_ball` **Kristallkugel** – Gewertete Kristall-Würfel werden 1× wiederholt; nicht wertende Kristall-Würfel geben je ×1,5 Multi · $8.
89. `milestone` **Meilenstein** – ×(1 + 0,04·n) Multi; n wächst um 1 je gewertetem Wurf · $9.
90. `conductor` **Dirigent** – ×(1 + 0,15 je anderem Talisman, der in dieser Wertung schon ausgelöst hat) Multi (B, war 0,25) · $8.
91. `lighthouse` **Leuchtturm** – Der Talisman rechts daneben löst seine Effekte auf die Hand 2× aus *(nicht kopierbar)* · $9.
92. `curio` **Wunderkammer** – ×1,3 Multi je seltenem oder legendärem Talisman (auch sich selbst) · $8.
93. `ruby_heart` **Rubinherz** – Gewertete Rubin-Prägungen geben zusätzlich ×1,5 Multi · $8.
94. `shard_collector` **Scherbensammler** – Glas zerspringt doppelt so oft; ×(1 + 0,5 je seit dem Kauf zersprungener Glasfläche) Multi · $8.
95. `rummage` **Wühltisch** – Beutel bieten eine Auswahl mehr; jedes Öffnen eines Beutels gibt +$1 *(nicht kopierbar)* · $8.
96. `compound` **Zinsfuß** – Zinsen gibt es schon je $4 statt je $5, und die Zinsobergrenze steigt um $5 *(nicht kopierbar)* · $8.

**Legendär (nur durch Seelenstein)**
97. `eternal_echo` **Ewiges Echo** – Alle wertenden Würfel werden 1× wiederholt; jede Wiederholung („Nochmal!“) gibt ×1,2 Multi · $20.
98. `star_throne` **Sternenthron** – Nach jeder gewonnenen Partie steigt die zuletzt gewertete Hand um 1 Stufe *(nicht kopierbar)* · $20.
99. `grand_hall` **Prunksaal** – ×(1 + 0,5 je anderem Talisman) Multi · $20.
100. `time_loop` **Zeitschleife** – Der erste Nachwurf jedes Wurfs kostet keinen Nachwurf *(nicht kopierbar)* · $20.

---

## 5. Verbrauchsgüter (2 Plätze)

### Sternbilder (Hand-Stufe +1), $3
Aus Sternbeuteln gewählte Sternbilder wirken sofort; gekaufte landen im Verbrauchsplatz.
Je Hand eins: `c_scatter` Streulicht, `c_pair` Zwillinge, `c_twopair` Doppelstern, `c_triple` Dreigestirn,
`c_smallrun` Kleiner Pfad, `c_parity` Waage, `c_fullhouse` Haus der Sterne, `c_bigrun` Milchstraße,
`c_quad` Kreuz des Südens, `c_pasch` Polarstern; geheim (nur wenn die Hand schon gewertet wurde):
`c_sixer` Sechsgestirn, `c_skyladder` Himmelstor.

### Werkzeuge, $3 (ziel: Würfelfläche(n) im Würfel-Inspektor bzw. Würfel)
| ID | Name | Wirkung |
|---|---|---|
| `t_chisel` | Meißel | 1 Fläche auf einen gewählten Wert setzen (1 … Seitenzahl); entfernt Stein |
| `t_mirror` | Spiegel | 1 Fläche (Wert + Prägung) auf eine andere Fläche desselben Würfels kopieren |
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
| `t_nudge` | Stupser | *nur im Wurf*: ein geworfener Würfel zeigt ±1 (1 … Seitenzahl, nur dieser Wurf; Prägung bleibt) |
| `t_flip` | Wende | *nur im Wurf*: ein geworfener Würfel dreht auf die Gegenseite (gespiegelte Fläche) |

Werkzeuge wirken auch während einer Partie; ändert sich die gerade gezeigte Fläche, zeigt der Würfel sofort den neuen
Wert. Verdeckte Würfel können nicht gestupst/gewendet werden. Ein Fehlschlag (ungültiges Ziel, kein Platz) verbraucht
nichts.

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

Phantomhauch geht nur bis zu 7 Würfeln in der Schale; der Doppelgänger kopiert auch den Zustand (z. B. Kerbholz).

---

## 6. Wächter (Boss-Partien)

Am Anfang jedes Einsatzes wird der Wächter gezogen und **angezeigt** (Vorbereitung möglich). Kein Wächter zweimal
pro Lauf, solange Auswahl übrig ist.

| ID | Name | ab Einsatz | Wirkung |
|---|---|---|---|
| `leaden` | Der Bleierne | 2 | Einsen und Zweien zählen nicht (keine Punkte, keine Hände; Sterne bleiben wild) |
| `miser` | Der Geizhals | 2 | keine Nachwürfe |
| `lonely` | Der Einsame | 2 | nur 1 Wurf; Ziel ×1 statt ×2 |
| `echo` | Das Echo | 1 | keine Hand zweimal werten |
| `fixation` | Die Fixierung | 3 | danach sind nur Hände erlaubt, die die zuerst gewertete Hand enthalten |
| `fog` | Der Nebel | 1 | je Wurf landen 2 zufällige Würfel verdeckt („?“) – auch nach Nachwürfen – bis zum Werten |
| `toll` | Der Zöllner | 1 | −$1 je Nachwurf |
| `shackle` | Die Fessel | 1 | je Wurf ist ein zufälliger Würfel gefesselt: kann nicht gehalten werden (wird mitgewürfelt) |
| `turner` | Der Wender | 2 | nach jedem Nachwurf dreht ein zufälliger Würfel (auch ein gehaltener) auf die Gegenseite |
| `wall` | Die Mauer | 2 | Ziel ×4 |
| `thief` | Der Dieb | 2 | ein zufälliger Talisman ist in dieser Partie deaktiviert |
| `grudge` | Der Groll | 3 | gewertete Würfel geben für den Rest der Partie keine Augen-Punkte |
| `chill` | Die Kälte | 3 | Basis-Multi der Hand halbiert (abgerundet, min. 1) |
| `abyss` | **Der Abgrund** | nur 8 | Ziel ×6 |
| `eclipse` | **Die Finsternis** | nur 8 | alle Würfel landen verdeckt; nachgewürfelte Würfel werden aufgedeckt |

„Wächterbann“ (Privileg) erlaubt 1× pro Einsatz einen neuen Wächter zu ziehen (solange die Wächter-Partie nicht
gewonnen ist). Verdeckte Würfel zählen für Hände trotzdem mit (die Handliste kennzeichnet Hände mit verdeckten Würfeln).
Abweichungen vom ersten Entwurf (Balancing, §14): Der Bleierne erst ab Einsatz 2; die Fixierung erlaubt alle Hände, die
die erste Hand *enthalten* (sonst praktisch unschlagbar, wenn man nicht absichtlich ein Paar wertet). Wächter-Ziele
werden mit Stufe 3 (×1,2) und Stufe 5 (×1,25) multipliziert, der Einsame mit ×1, die Mauer ×4, der Abgrund ×6.

---

## 7. Laden

Nach jeder gewonnenen Partie (nach der Abrechnung). Inhalt:
- **2 Angebotsplätze** (Talisman 60 %, Sternbild 25 %, Werkzeug 15 %).
- **2 Beutel** (Gewichte: Stern 4, Werkzeug 4, Talisman 3, Würfel 2, Mystik 1, Großer Stern 1),
  **1 Privileg** pro Einsatz (bleibt bis gekauft oder neuer Einsatz; wird zu Beginn des Einsatzes gezogen).
- **Neu mischen**: $5, +$1 je weiteres Mal (Reset in jedem Laden). Mischt nur die Angebotsplätze.
- Kaufen, Verkaufen (Talismane, Verbrauchsgüter – jederzeit, außer nach Laufende), Verbrauchsgüter benutzen.
- Abrechnung: Belohnung + $1 je übrigem Wurf + Zinsen ($1 je $5 *vor* der Auszahlung, max. $5) + Sparstrumpf +
  Investition.

Beutel (Inhalt wird geöffnet, man wählt):
| ID | Name | Preis | Inhalt |
|---|---|---|---|
| `p_star` | Sternbeutel | $4 | wähle 1 aus 3 Sternbildern |
| `p_tool` | Werkzeugbeutel | $4 | wähle 1 aus 3 Werkzeugen (sofort benutzbar oder behalten) |
| `p_charm` | Talismanbeutel | $5 | wähle 1 aus 2 Talismanen |
| `p_dice` | Würfelbeutel | $5 | wähle 1 aus 3 besonderen Würfeln; er ersetzt einen gewählten Würfel |
| `p_mystic` | Mystikbeutel | $6 | wähle 1 aus 2 Mystik-Gütern |
| `p_mega_star` | Großer Sternbeutel | $8 | wähle 2 aus 5 Sternbildern |

Würfel im Würfelbeutel: zufällige Form (75 % W6, 15 % W4, 10 % W8), 1–3 Prägungen (Stern seltener), 30 % Material
(kein Phantom). Ist das Würfellimit nicht erreicht, darf er auch zusätzlich in die Schale.
Werkzeuge/Mystik aus Beuteln: sofort benutzen (Ziel wählen) oder in einen freien Platz legen. „Nur im Wurf“-Werkzeuge
können nur behalten werden. Talismane aus Beuteln brauchen einen freien Platz.

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
Beutel-Marken (Sternschnuppe, Werkstatt, Würfelmacher) öffnen ihren Beutel sofort nach dem Überspringen. Die angebotene
Marke jeder Kleinen/Großen Partie wird zu Beginn des Einsatzes gezogen und ist sichtbar.

## 10. Becher (Startvarianten, freischaltbar)
| ID | Name | Wirkung | Freischaltung |
|---|---|---|---|
| `wood` | Holzbecher | Standard | – |
| `red` | Roter Becher | +1 Nachwurf pro Partie | Einsatz 3 erreichen |
| `blue` | Blauer Becher | +1 Wurf, −1 Nachwurf pro Partie (B) | Einsatz 4 erreichen |
| `gold` | Goldbecher | Start mit $12, Zinsobergrenze $7 | 50 Würfe gewertet |
| `black` | Schwarzer Becher | +1 Talismanplatz, −1 Nachwurf (B) | einen Lauf gewinnen |
| `loaded` | Gezinkter Becher | jeder Würfel hat statt der 1 eine 6; alle Ziele ×1,5 | Pasch werten |
| `tiny` | Vierbecher | 6 W4 statt 5 W6 (Würfellimit 6), alle Ziele ×1,5 (B) | 5 Läufe beendet |
| `star` | Sternbecher | Start mit Sternkarte und 2 Sternbildern „Zwillinge“ | 10 Sternbilder benutzt |

## 11. Schwierigkeit (Stufen, kumulativ, je Becher nach Sieg freigeschaltet)
1 Normal · 2 Kleine Partie gibt kein Geld · 3 Ziele ×1,2 · 4 −1 Nachwurf · 5 Wächter-Ziele ×1,25 (Standard ×2,5 statt ×2).
Ein Sieg auf Stufe s mit Becher b schaltet Stufe s+1 für Becher b frei.

## 12. Meta
Profil in `localStorage`: Einstellungen, Statistik (Läufe, Siege, höchster Wurf, beste Hand, Würfe, …),
Sammlung (gesehene/besessene Talismane, Verbrauchsgüter, gewertete Hände, gesehene/besiegte Wächter), Freischaltungen,
laufender Lauf (Fortsetzen). **27 Erfolge** (`content/achievements.js`), sieben davon schalten Becher frei:

| Erfolg | Bedingung | schaltet frei |
|---|---|---|
| Erster Wurf | ersten Wurf werten | |
| Aufgewärmt | Einsatz 3 erreichen | Roter Becher |
| Halbzeit | Einsatz 4 erreichen | Blauer Becher |
| Hoch hinaus | Einsatz 6 erreichen | |
| Paschmeister | einen Lauf gewinnen | Schwarzer Becher |
| Kein Ende in Sicht | Einsatz 9 (Endlos) erreichen | |
| Hartgesotten | auf Stufe 3+ gewinnen | |
| Pasch! | einen Pasch werten | Gezinkter Becher |
| Freie Bahn / Sechs auf einen Streich / Himmelsstürmer | Große Straße / Sechsling / Himmelsleiter werten | |
| Fingerübung / Würfelwerk | 50 / 500 Würfe gewertet | Goldbecher (50) |
| Stammgast | 5 Läufe beendet | Vierbecher |
| Sterndeuter | 10 Sternbilder benutzt | Sternbecher |
| Tausender / Zehntausend / Hunderttausend / Millionenwurf | 1.000 / 10.000 / 100.000 / 1 Mio. in einem Wurf | |
| Volle Vitrine | 5 Talismane gleichzeitig | |
| Goldgrube | $50 auf einmal | |
| Scherben bringen Glück | eine Glasfläche zerspringt | |
| Echo im Tal | 5 Wiederholungen in einem Wurf | |
| Ruhige Hand | Wächter-Partie ohne Nachwurf gewinnen | |
| Legende | legendären Talisman besitzen | |
| Überflieger | 3 Partien in einem Lauf überspringen | |
| Meisterklasse | eine Hand auf Stufe 5 | |

## 13. Look & Feel (Kurzfassung – Details in ARCHITECTURE §6 und research_feel.md)
- **Neon-Nachtmarkt**: tiefviolett-blauer, wirbelnder Hintergrund (WebGL-Shader, 3 Farbbänder, beschleunigt beim
  Werten), Filz-Schale in der Mitte, CRT-Scanlines + Vignette (abschaltbar).
- Würfel: echte CSS-3D-Würfel (Elfenbein #f4ecd8, Augen #231a2e, dicke dunkle Kontur), tumbeln, springen, landen
  mit Klack. W4/W8 werden ebenfalls als Würfel mit passender Flächenzahl-Anzeige dargestellt (Würfelkörper W6-Form
  mit Formsymbol – Zahlen statt Augen bei Werten > 6).
- Alles federt (Federn statt linearer Tweens), alles wackelt beim Auslösen (juice_up), Zahlen zählen hoch,
  Tonhöhe steigt mit jedem Auslöser, Bildschirmwackeln skaliert mit der Punktzahl, Flammen wenn das Ziel fällt.
- Schrift: „Pixelify Sans“ (Google Fonts) mit Fallback, Zahlen tabellarisch.

## 14. Balance (Stand: Balance-Bot `tools/sim.mjs`)
Bot: Halten per Monte-Carlo-Erwartungswert, Nachwürfe solange sie sich lohnen, Talismankauf nach echtem Nutzen
(letzte Würfe neu gewertet), levelt seine Haupthand, legt bei der Fixierung bewusst ein Paar fest.

**Holzbecher, Stufe 1** (Seeds A/B/C/D/Z, 400/400/150/300/100 Läufe): Siegquote **21,8 % / 20,3 % / 23,3 % / 24,7 % /
11 %** (Streuung bei kleinen Stichproben; Mittel ≈ 21 %).

| Einsatz geschafft | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Seed B (400 Läufe) | 97 % | 90 % | 84 % | 75 % | 60 % | 41 % | 31 % | 20 % |

Punkte je Wurf (Median / Mittel): Einsatz 1 ≈ 370 / 590, 2 ≈ 1.130 / 1.510, 3 ≈ 2.700 / 3.300, 4 ≈ 5.000 / 6.600,
5 ≈ 7.600 / 11.800, 6 ≈ 12.600 / 22.700. Geld zu Beginn eines Einsatzes ≈ $4 → $3 → $10 → $19 → $21.
Häufigste Wächter-Niederlagen: Mauer, Abgrund, Fixierung, Geizhals, Dieb. Etwa 70 % aller Niederlagen passieren
in Wächter-Partien.

Andere Becher (150 Läufe, Seed C, nach Anpassung): Rot 31 %, Blau 34 %, Gold 33 %, Schwarz 24 %, Gezinkt 23 %,
Vier 29 %, Stern 37 %. Stufen (Holz): 2 ≈ 7 %, 3 ≈ 3 %, 5 ≈ 1 % (bewusst steil, für Könner).

**Nach Talisman-Erweiterung auf 100** (Bot kennt alle neuen Talismane: Neuwertung inkl. echter Würfe-/Nachwurf-
Reste und Wächter-Partien, Faktoren für Lauf-/Laden-Effekte, ordnet Nachahmer/Leuchtturm/Dirigent/Prunksaal per
Probe-Wertung an; `node tools/sim.mjs --by-talisman`):
Holzbecher Stufe 1, je 400 Läufe: Seed A 14,3 % · B 20,3 % · C 19,5 % · D 21,3 % (Mittel ≈ 19 %; vorher Seed B
200 Läufe 20,5 %). Einsatz 1 geschafft 96–98 %. Rot 23 %, Vier 32 % (je 150 Läufe, Seed C).

| Einsatz geschafft | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Seed B (400 Läufe, 100 Talismane) | 98 % | 89 % | 78 % | 61 % | 47 % | 34 % | 27 % | 20 % |

Ausreißer-Prüfung je Talisman: „Lift“ = Siegquote der Läufe, die den Talisman irgendwann besaßen, geteilt durch die
Siegquote aller Läufe, die den Einsatz seines ersten Besitzes erreicht haben (so zählen spät gekaufte Talismane nicht
automatisch als stark). Erste Messung (1.200 Läufe): Dirigent Lift 1,60 bei 62 % Siegen (beim Vierbecher sogar 2,2)
→ ×(1 + 0,15 je Talisman) statt 0,25; Tetraeder +4 statt +5 (Vierbecher 36 % → 32 %). Schwächste Hand-Talismane
gestärkt: Viererbande +8 (Lift 0,66), Schnellstraße ×2,5 (0,70), Doppeldecker +12 (0,78). Danach liegt kein neuer
Talisman über Lift 1,6 (höchste: Dirigent ≈ 1,35–1,55, Kristallkugel/Brennglas ≈ 1,3–1,5 bei kleinen Stichproben,
Recke/Anker/Spannweite ≈ 1,25); der Altbestand Würfelgeist (≈ 1,65) bleibt unverändert.

Änderungen gegenüber dem ersten Entwurf (alle oben eingetragen):
- Hände: Basis-Punkte und Punkte je Stufe ×2, Basis-Multi +1 (Einsatz 1 sonst nur ~55 % geschafft).
- Basisziele Einsatz 2–5: 700 / 1.800 / 4.500 / 10.000 statt 800 / 2.000 / 5.000 / 11.000.
- Punkte-Talismane gestärkt: Sechserpack +40, Augenzähler 3×, Flut +80, Kerbholz +5, Hochstapler +30,
  Klebrige Finger +25 (wegen der verdoppelten Hand-Punkte waren sie sonst zu schwach).
- Wächter: Bleierne ab Einsatz 2, Fixierung erlaubt Hände, die die erste Hand enthalten; Fehlwurf-Regel.
- Becher: Blau +1 Wurf/−1 Nachwurf (vorher 44 %), Schwarz −1 Nachwurf statt −1 Wurf (vorher 6 %),
  Vierbecher Ziele ×1,5 (vorher 59 %).
