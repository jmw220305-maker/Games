// Talismane, Teil 2 (52 weitere). Gleiche Hook-Schnittstelle wie talismans.js, plus die neuen generischen Hooks
// (siehe Kopf von talismans.js und ARCHITECTURE §2):
//   Wertung: onRetrigger(ctx, d, t), echoRight (Flag), glassShatterMul (Zahl), onScored darf {type:'break'} liefern.
//   Run: onRoundStart, onConsumable, onPackOpen, onShopEnter, freeReroll, priceMod, sellBonus, modifyEconomy, modifyPack.
//   Anzeige: badge(t) -> kurzer Text auf der Karte (Zähler, Ladungen) oder null.
// Wird von talismans.js eingebunden; TALISMANS wird als Nachschlage-Objekt übergeben (keine Zirkel-Imports).

import { HANDS } from '../hands.js';
import { formatMult } from '../../core/format.js';

const mult = (amount) => ({ type: 'mult', amount });
const chips = (amount) => ({ type: 'chips', amount });
const xmult = (factor) => ({ type: 'xmult', factor });
const money = (amount) => ({ type: 'money', amount });
const grow = (text) => ({ type: 'grow', text });
const xs = (x) => formatMult(Math.round(x * 100) / 100);
const scoringValues = (ctx) => ctx.scoring.filter((i) => ctx.values[i] > 0).map((i) => ctx.values[i]);
const isWardenRound = (round) => !!(round && round.kind === 'warden');

export function makeExtraTalismans(TALISMANS) {
  return [
    // ================================================================ gewöhnlich (22)
    {
      id: 'twofold', name: 'Doppelnaht', rarity: 'common', price: 5, glyph: '⚁', hue: 160,
      desc: '+4 Multi je gewerteter 2; gewertete 2en werden 1× wiederholt.',
      onDie: (ctx, d) => (d.value === 2 ? [mult(4)] : null),
      retrigger: (ctx, d) => (d.value === 2 ? 1 : 0),
    },
    {
      id: 'trefoil', name: 'Dreiblatt', rarity: 'common', price: 5, glyph: '⚂', hue: 120,
      desc: 'Jede gewertete 3 gibt +3 Multi je 3 unter den wertenden Würfeln.',
      onDie: (ctx, d) => {
        if (d.value !== 3) return null;
        const n = scoringValues(ctx).filter((v) => v === 3).length;
        return [mult(3 * n)];
      },
    },
    {
      id: 'foursquare', name: 'Vierkant', rarity: 'common', price: 4, glyph: '⚃', hue: 210,
      desc: '+44 Punkte je gewerteter 4.',
      onDie: (ctx, d) => (d.value === 4 ? [chips(44)] : null),
    },
    {
      id: 'handful', name: 'Handvoll', rarity: 'common', price: 5, glyph: '⚄', hue: 50,
      desc: '+5 Multi und +15 Punkte je gewerteter 5.',
      onDie: (ctx, d) => (d.value === 5 ? [chips(15), mult(5)] : null),
    },
    {
      id: 'span', name: 'Spannweite', rarity: 'common', price: 4, glyph: '⟷', hue: 280,
      desc: '+2 Multi je Auge Unterschied zwischen höchstem und niedrigstem Würfel (alle Würfel).',
      onHand: (ctx) => {
        const v = ctx.values.filter((x) => x > 0);
        if (v.length < 2) return null;
        const d = Math.max(...v) - Math.min(...v);
        return d > 0 ? [mult(2 * d)] : null;
      },
    },
    {
      id: 'double_decker', name: 'Doppeldecker', rarity: 'common', price: 4, glyph: '∷', hue: 165,
      desc: '+12 Multi, wenn die Hand Zwei Paare enthält.',
      onHand: (ctx) => (ctx.contains('twopair') ? [mult(12)] : null),
    },
    {
      id: 'footpath', name: 'Trampelpfad', rarity: 'common', price: 5, glyph: '⋰', hue: 35,
      desc: '×1,5 Multi, wenn die gewählte Hand genau „Kleine Straße“ ist.',
      onHand: (ctx) => (ctx.handId === 'smallrun' ? [xmult(1.5)] : null),
    },
    {
      id: 'cadence', name: 'Taktgefühl', rarity: 'common', price: 5, glyph: '≣', hue: 255,
      desc: '+15 Multi, wenn die Hand Gleichklang ist.',
      onHand: (ctx) => (ctx.contains('parity') ? [mult(15)] : null),
    },
    {
      id: 'loner', name: 'Einzelgänger', rarity: 'common', price: 4, glyph: '⁘', hue: 215,
      desc: 'Bei Streuung: +4 Multi und +Punkte in Höhe der doppelten Augensumme aller Würfel.',
      onHand: (ctx) => (ctx.handId === 'scatter' ? [chips(2 * ctx.sumAll), mult(4)] : null),
    },
    {
      id: 'deep_sea', name: 'Tiefsee', rarity: 'common', price: 4, glyph: '≀', hue: 200,
      desc: 'Gewertete Azur-Prägungen geben zusätzlich +30 Punkte und +3 Multi.',
      onDie: (ctx, d) => (d.mark === 'azure' ? [chips(30), mult(3)] : null),
    },
    {
      id: 'quarry', name: 'Steinbruch', rarity: 'common', price: 4, glyph: '▩', hue: 30,
      desc: 'Gewertete Stein-Flächen geben zusätzlich +40 Punkte und +4 Multi.',
      onDie: (ctx, d) => (d.mark === 'stone' ? [chips(40), mult(4)] : null),
    },
    {
      id: 'jinx', name: 'Pechvogel', rarity: 'common', price: 5, glyph: '♧', hue: 100, init: { n: 0 },
      desc: 'Gewinnt dauerhaft +3 Multi, jedes Mal wenn eine Klee-Fläche kein Glück bringt.',
      preHand: (ctx, t) => {
        if (!ctx.unlucky) return null;
        t.state.n = (t.state.n || 0) + 3 * ctx.unlucky;
        return [grow(`+${t.state.n} Multi`)];
      },
      onHand: (ctx, t) => (t.state.n > 0 ? [mult(t.state.n)] : null),
      describe: (t) => `Gewinnt dauerhaft +3 Multi, jedes Mal wenn eine Klee-Fläche kein Glück bringt (derzeit +${t.state.n || 0} Multi).`,
      badge: (t) => (t.state.n ? `+${t.state.n}` : null),
    },
    {
      id: 'gold_vein', name: 'Goldader', rarity: 'common', price: 5, glyph: '$$', hue: 48, copyable: false,
      desc: 'Abrechnung: +$1 je Gold-Prägung auf deinen Würfeln (max. $4).',
      cashout: (run) => Math.min(4, goldFaces(run)),
      describe: (t, run) => (run ? `Abrechnung: +$1 je Gold-Prägung auf deinen Würfeln, max. $4 (derzeit $${Math.min(4, goldFaces(run))}).` : null),
    },
    {
      id: 'leadfoot', name: 'Bleifuß', rarity: 'common', price: 4, glyph: '⊥', hue: 220,
      desc: 'Gewertete Blei-Würfel geben +40 Punkte und +2 Multi.',
      onDie: (ctx, d) => (d.material === 'lead' ? [chips(40), mult(2)] : null),
    },
    {
      id: 'tetra', name: 'Tetraeder', rarity: 'common', price: 4, glyph: '▲', hue: 15,
      desc: '+5 Multi je gewertetem W4.',
      onDie: (ctx, d) => (d.die.sides === 4 && d.value > 0 ? [mult(5)] : null),
    },
    {
      id: 'octa', name: 'Oktaeder', rarity: 'common', price: 5, glyph: '◊', hue: 190,
      desc: 'Gewertete W8 geben +Punkte in Höhe ihrer fünffachen Augen.',
      onDie: (ctx, d) => (d.die.sides === 8 && d.value > 0 ? [chips(5 * d.value)] : null),
    },
    {
      id: 'anchor', name: 'Anker', rarity: 'common', price: 5, glyph: '⊢', hue: 205,
      desc: 'Wertet der linke Würfel der Schale, gibt er +Multi in Höhe seiner dreifachen Augen.',
      onDie: (ctx, d) => (d.index === 0 && d.value > 0 ? [mult(3 * d.value)] : null),
    },
    {
      id: 'stairs', name: 'Treppe', rarity: 'common', price: 4, glyph: '⊿', hue: 70,
      desc: '+3 Multi je Würfel, der mehr Augen zeigt als sein linker Nachbar.',
      onHand: (ctx) => {
        let n = 0;
        const v = ctx.values;
        for (let i = 1; i < v.length; i++) if (v[i] > 0 && v[i - 1] > 0 && v[i] > v[i - 1]) n++;
        return n ? [mult(3 * n)] : null;
      },
    },
    {
      id: 'sitter', name: 'Sitzfleisch', rarity: 'common', price: 5, glyph: '▣', hue: 330,
      desc: 'Wertende Würfel, die mindestens einen Nachwurf lang gehalten wurden, geben +4 Multi.',
      onDie: (ctx, d) => (d.kept ? [mult(4)] : null),
    },
    {
      id: 'last_call', name: 'Letzte Runde', rarity: 'common', price: 5, glyph: '⧖', hue: 0,
      desc: '×2 Multi im letzten Wurf einer Partie.',
      onHand: (ctx) => (ctx.throwsLeft === 1 ? [xmult(2)] : null),
    },
    {
      id: 'piggy', name: 'Sparschwein', rarity: 'common', price: 4, glyph: '◍', hue: 340, copyable: false, init: { bonus: 0 },
      desc: 'Sein Verkaufswert steigt nach jeder gewonnenen Partie um $2.',
      onRoundEnd: (run, t) => {
        t.state.bonus = (t.state.bonus || 0) + 2;
        return [{ type: 'talismanGrow', uid: t.uid, text: `Wert $${2 + t.state.bonus}` }];
      },
      sellBonus: (t) => t.state.bonus || 0,
      describe: (t) => `Sein Verkaufswert steigt nach jeder gewonnenen Partie um $2 (derzeit $${2 + (t.state.bonus || 0)}).`,
      badge: (t) => (t.state.bonus ? `$${2 + t.state.bonus}` : null),
    },
    {
      id: 'vacancy', name: 'Leerstelle', rarity: 'common', price: 4, glyph: '□', hue: 180,
      desc: '+3 Multi je freiem Talismanplatz.',
      onHand: (ctx) => {
        const free = Math.max(0, ctx.run.limits.talismans - ctx.run.talismans.length);
        return free ? [mult(3 * free)] : null;
      },
      describe: (t, run) => (run ? `+3 Multi je freiem Talismanplatz (derzeit +${3 * Math.max(0, run.limits.talismans - run.talismans.length)} Multi).` : null),
    },

    // ================================================================ ungewöhnlich (17)
    {
      id: 'topping_out', name: 'Richtfest', rarity: 'uncommon', price: 6, glyph: '⌂', hue: 25,
      desc: '×2 Multi, wenn die Hand ein Full House ist.',
      onHand: (ctx) => (ctx.handId === 'fullhouse' ? [xmult(2)] : null),
    },
    {
      id: 'highway', name: 'Schnellstraße', rarity: 'uncommon', price: 7, glyph: '⇶', hue: 55,
      desc: '×2,5 Multi, wenn die Hand eine Große Straße enthält.',
      onHand: (ctx) => (ctx.contains('bigrun') ? [xmult(2.5)] : null),
    },
    {
      id: 'gang_of_four', name: 'Viererbande', rarity: 'uncommon', price: 6, glyph: '⁜', hue: 330,
      desc: 'Enthält die Hand einen Vierling, gibt jeder wertende Würfel +8 Multi.',
      onDie: (ctx, d) => (ctx.contains('quad') && d.value > 0 ? [mult(8)] : null),
    },
    {
      id: 'wisp', name: 'Irrlicht', rarity: 'uncommon', price: 6, glyph: '✵', hue: 285,
      desc: 'Gewertete Stern-Flächen geben +20 Punkte und +8 Multi.',
      onDie: (ctx, d) => (d.mark === 'star' ? [chips(20), mult(8)] : null),
    },
    {
      id: 'echo_well', name: 'Brunnenecho', rarity: 'uncommon', price: 6, glyph: '⟳', hue: 170,
      desc: 'Echo-Prägungen lösen eine zusätzliche Wiederholung aus.',
      retrigger: (ctx, d) => (d.mark === 'echo' ? 1 : 0),
    },
    {
      id: 'ossuary', name: 'Beinhaus', rarity: 'uncommon', price: 6, glyph: '⌬', hue: 40,
      desc: 'Gewertete Knochen-Würfel werden 1× wiederholt.',
      retrigger: (ctx, d) => (d.material === 'bone' ? 1 : 0),
    },
    {
      id: 'burning_glass', name: 'Brennglas', rarity: 'uncommon', price: 7, glyph: '◉', hue: 300,
      desc: 'Gewertete Prisma-Würfel geben zusätzlich ×1,5 Multi.',
      onDie: (ctx, d) => (d.material === 'prism' ? [xmult(1.5)] : null),
    },
    {
      id: 'tail_light', name: 'Schlusslicht', rarity: 'uncommon', price: 6, glyph: '⊣', hue: 10,
      desc: 'Wertet der rechte Würfel der Schale, wird er 2× wiederholt.',
      retrigger: (ctx, d) => (d.index === ctx.rolled.length - 1 ? 2 : 0),
    },
    {
      id: 'gambler', name: 'Hasardeur', rarity: 'uncommon', price: 6, glyph: '‽', hue: 350,
      desc: '×(1 + 0,25 je in diesem Wurf benutztem Nachwurf) Multi.',
      onHand: (ctx) => (ctx.rerollsUsedThisThrow > 0 ? [xmult(1 + 0.25 * ctx.rerollsUsedThisThrow)] : null),
      describe: (t, run) => {
        const n = run && run.round && run.round.rolled ? run.round.rerollsUsedThisThrow : null;
        return n === null ? null : `×(1 + 0,25 je in diesem Wurf benutztem Nachwurf) Multi (derzeit ${xs(1 + 0.25 * n)}).`;
      },
    },
    {
      id: 'snowball', name: 'Schneeball', rarity: 'uncommon', price: 7, glyph: '○', hue: 195, init: { n: 0 },
      desc: '×(1 + 0,1·n) Multi; n wächst um 1 je Wurf, der ohne Nachwurf gewertet wird – jeder Nachwurf setzt n auf 0.',
      onReroll: (run, t) => {
        if (!(t.state.n > 0)) return [];
        t.state.n = 0;
        return [{ type: 'talismanGrow', uid: t.uid, text: 'Geschmolzen!' }];
      },
      preHand: (ctx, t) => {
        if (ctx.rerollsUsedThisThrow > 0) return null;
        t.state.n = (t.state.n || 0) + 1;
        return [grow(xs(1 + 0.1 * t.state.n))];
      },
      onHand: (ctx, t) => (t.state.n > 0 ? [xmult(1 + 0.1 * t.state.n)] : null),
      describe: (t) => `×(1 + 0,1·n) Multi; n wächst um 1 je Wurf ohne Nachwurf, jeder Nachwurf setzt n auf 0 (derzeit ${xs(1 + 0.1 * (t.state.n || 0))}).`,
      badge: (t) => (t.state.n ? xs(1 + 0.1 * t.state.n) : null),
    },
    {
      id: 'fuse', name: 'Zündschnur', rarity: 'uncommon', price: 6, glyph: '∽', hue: 20, init: { charges: 6 },
      desc: '×3 Multi für die nächsten 6 Wertungen, dann verglüht sie.',
      onHand: () => [xmult(3)],
      onScored: (ctx, t) => {
        t.state.charges = (t.state.charges === undefined ? 6 : t.state.charges) - 1;
        if (t.state.charges <= 0) return [{ type: 'break', text: 'Verglüht!' }];
        return [{ type: 'text', text: `Noch ${t.state.charges}` }];
      },
      describe: (t) => `×3 Multi für die nächsten ${t.state.charges === undefined ? 6 : t.state.charges} Wertungen, dann verglüht sie.`,
      badge: (t) => `${t.state.charges === undefined ? 6 : t.state.charges}`,
    },
    {
      id: 'astronomer', name: 'Sterngucker', rarity: 'uncommon', price: 6, glyph: '☆', hue: 240, init: { n: 0 },
      desc: 'Gewinnt dauerhaft +3 Multi je benutztem Sternbild und +1 Multi je benutztem Werkzeug oder Mystik-Gut.',
      onConsumable: (run, t, def) => {
        t.state.n = (t.state.n || 0) + (def.kind === 'star' ? 3 : 1);
        return [{ type: 'talismanGrow', uid: t.uid, text: `+${t.state.n} Multi` }];
      },
      onHand: (ctx, t) => (t.state.n > 0 ? [mult(t.state.n)] : null),
      describe: (t) => `Gewinnt dauerhaft +3 Multi je benutztem Sternbild und +1 Multi je anderem Verbrauchsgut (derzeit +${t.state.n || 0} Multi).`,
      badge: (t) => (t.state.n ? `+${t.state.n}` : null),
    },
    {
      id: 'champion', name: 'Recke', rarity: 'uncommon', price: 6, glyph: '†', hue: 0,
      desc: '×2 Multi in Wächter-Partien.',
      onHand: (ctx) => (isWardenRound(ctx.round) ? [xmult(2)] : null),
    },
    {
      id: 'ward_seal', name: 'Schutzsiegel', rarity: 'uncommon', price: 6, glyph: '⊕', hue: 160, copyable: false,
      desc: 'Zu Beginn jeder Wächter-Partie sinkt ihr Ziel um 20 %.',
      onRoundStart: (run, t, round) => {
        if (!isWardenRound(round)) return [];
        round.target = Math.max(1, Math.round(round.target * 0.8));
        return [{ type: 'talismanGrow', uid: t.uid, text: 'Ziel −20 %' }];
      },
    },
    {
      id: 'regular', name: 'Stammkunde', rarity: 'uncommon', price: 5, glyph: '∮', hue: 90, copyable: false,
      desc: 'Im Laden ist das erste Neu-mischen gratis; Talismane im Laden kosten $1 weniger.',
      onShopEnter: (run, t) => {
        run.shop.freeRerolls += 1;
        return [];
      },
      priceMod: (price, kind) => (kind === 'talisman' ? price - 1 : price),
    },
    {
      id: 'alchemist', name: 'Alchemist', rarity: 'uncommon', price: 6, glyph: '♁', hue: 260,
      desc: '+5 Multi je Würfel mit Material in der Schale (Phantom zählt doppelt).',
      onHand: (ctx) => {
        const n = materialCount(ctx.run);
        return n ? [mult(5 * n)] : null;
      },
      describe: (t, run) => (run ? `+5 Multi je Würfel mit Material in der Schale, Phantom zählt doppelt (derzeit +${5 * materialCount(run)} Multi).` : null),
    },
    {
      id: 'master', name: 'Meisterbrief', rarity: 'uncommon', price: 6, glyph: '§', hue: 45,
      desc: '+4 Multi je Stufe der gewerteten Hand über Stufe 1.',
      onHand: (ctx) => (ctx.level > 1 ? [mult(4 * (ctx.level - 1))] : null),
    },

    // ================================================================ selten (9)
    {
      id: 'crystal_ball', name: 'Kristallkugel', rarity: 'rare', price: 8, glyph: '❍', hue: 265,
      desc: 'Gewertete Kristall-Würfel werden 1× wiederholt; nicht wertende Kristall-Würfel geben je ×1,5 Multi.',
      retrigger: (ctx, d) => (d.material === 'crystal' ? 1 : 0),
      onHand: (ctx) => {
        let k = 0;
        ctx.run.dice.forEach((die, i) => {
          if (die.material === 'crystal' && !ctx.scoring.includes(i)) k++;
        });
        return k ? [xmult(Math.pow(1.5, k))] : null;
      },
    },
    {
      id: 'milestone', name: 'Meilenstein', rarity: 'rare', price: 9, glyph: '⌖', hue: 145, init: { n: 0 },
      desc: '×(1 + 0,04·n) Multi; n wächst um 1 je gewertetem Wurf.',
      preHand: (ctx, t) => {
        t.state.n = (t.state.n || 0) + 1;
        return [grow(xs(1 + 0.04 * t.state.n))];
      },
      onHand: (ctx, t) => (t.state.n > 0 ? [xmult(1 + 0.04 * t.state.n)] : null),
      describe: (t) => `×(1 + 0,04·n) Multi; n wächst um 1 je gewertetem Wurf (derzeit ${xs(1 + 0.04 * (t.state.n || 0))}).`,
      badge: (t) => (t.state.n ? xs(1 + 0.04 * t.state.n) : null),
    },
    {
      id: 'conductor', name: 'Dirigent', rarity: 'rare', price: 8, glyph: '♩', hue: 300,
      desc: '×(1 + 0,2 je anderem Talisman, der in dieser Wertung schon ausgelöst hat) Multi.',
      onHand: (ctx) => {
        const seen = new Set();
        for (const s of ctx.steps) if (s.source.kind === 'talisman' && s.source.index !== ctx.currentIndex) seen.add(s.source.index);
        return seen.size ? [xmult(1 + 0.2 * seen.size)] : null;
      },
    },
    {
      id: 'lighthouse', name: 'Leuchtturm', rarity: 'rare', price: 9, glyph: '⟰', hue: 50, copyable: false, echoRight: true,
      desc: 'Der Talisman rechts daneben löst seine Effekte auf die Hand 2× aus.',
      describe: (t, run) => {
        if (!run) return null;
        const i = run.talismans.findIndex((x) => x.uid === t.uid);
        const right = i >= 0 ? run.talismans[i + 1] : null;
        const def = right ? TALISMANS[right.id] : null;
        return `Der Talisman rechts daneben löst seine Effekte auf die Hand 2× aus (derzeit: ${def ? def.name : 'nichts'}).`;
      },
    },
    {
      id: 'curio', name: 'Wunderkammer', rarity: 'rare', price: 8, glyph: '⌺', hue: 30,
      desc: '×1,3 Multi je seltenem oder legendärem Talisman (auch sich selbst).',
      onHand: (ctx) => {
        const k = rareCount(ctx.run, TALISMANS);
        return k ? [xmult(Math.round(Math.pow(1.3, k) * 1000) / 1000)] : null;
      },
      describe: (t, run) => (run && run.talismans.length ? `×1,3 Multi je seltenem oder legendärem Talisman, auch sich selbst (derzeit ${xs(Math.pow(1.3, Math.max(1, rareCount(run, TALISMANS))))}).` : null),
    },
    {
      id: 'ruby_heart', name: 'Rubinherz', rarity: 'rare', price: 8, glyph: '♡', hue: 345,
      desc: 'Gewertete Rubin-Prägungen geben zusätzlich ×1,5 Multi.',
      onDie: (ctx, d) => (d.mark === 'ruby' ? [xmult(1.5)] : null),
    },
    {
      id: 'shard_collector', name: 'Scherbensammler', rarity: 'rare', price: 8, glyph: '⟡', hue: 190, init: { n: 0 }, glassShatterMul: 2,
      desc: 'Glas zerspringt doppelt so oft; ×(1 + 0,5 je seit dem Kauf zersprungener Glasfläche) Multi.',
      onHand: (ctx, t) => (t.state.n > 0 ? [xmult(1 + 0.5 * t.state.n)] : null),
      onScored: (ctx, t) => {
        if (!ctx.shattered) return null;
        t.state.n = (t.state.n || 0) + ctx.shattered;
        return [grow(xs(1 + 0.5 * t.state.n))];
      },
      describe: (t) => `Glas zerspringt doppelt so oft; ×(1 + 0,5 je seit dem Kauf zersprungener Glasfläche) Multi (derzeit ${xs(1 + 0.5 * (t.state.n || 0))}).`,
      badge: (t) => (t.state.n ? xs(1 + 0.5 * t.state.n) : null),
    },
    {
      id: 'rummage', name: 'Wühltisch', rarity: 'rare', price: 8, glyph: '⊍', hue: 120, copyable: false,
      desc: 'Beutel bieten eine Auswahl mehr; jedes Öffnen eines Beutels gibt +$1.',
      modifyPack: (p) => {
        p.size += 1;
      },
      onPackOpen: (run, t) => {
        run.money += 1;
        return [{ type: 'money', amount: 1, reason: 'Wühltisch', uid: t.uid }];
      },
    },
    {
      id: 'compound', name: 'Zinsfuß', rarity: 'rare', price: 8, glyph: '‰', hue: 48, copyable: false,
      desc: 'Zinsen gibt es schon je $4 statt je $5, und die Zinsobergrenze steigt um $5.',
      modifyEconomy: (eco) => {
        eco.interestStep = Math.min(eco.interestStep, 4);
        eco.interestCap += 5;
      },
    },

    // ================================================================ legendär (4)
    {
      id: 'eternal_echo', name: 'Ewiges Echo', rarity: 'legendary', price: 20, glyph: '∰', hue: 175,
      desc: 'Alle wertenden Würfel werden 1× wiederholt; jede Wiederholung („Nochmal!“) gibt ×1,2 Multi.',
      retrigger: () => 1,
      onRetrigger: () => [xmult(1.2)],
    },
    {
      id: 'star_throne', name: 'Sternenthron', rarity: 'legendary', price: 20, glyph: '♔', hue: 250, copyable: false,
      desc: 'Nach jeder gewonnenen Partie steigt die zuletzt gewertete Hand um 1 Stufe.',
      onRoundEnd: (run, t) => {
        const played = run.round ? run.round.playedHands : [];
        const last = played[played.length - 1];
        if (!last) return [];
        run.handLevels[last] = (run.handLevels[last] || 1) + 1;
        run.stats.maxHandLevel = Math.max(run.stats.maxHandLevel || 1, run.handLevels[last]);
        return [
          { type: 'levelUp', handId: last, level: run.handLevels[last] },
          { type: 'talismanGrow', uid: t.uid, text: `${HANDS[last].name} Stufe ${run.handLevels[last]}` },
        ];
      },
    },
    {
      id: 'grand_hall', name: 'Prunksaal', rarity: 'legendary', price: 20, glyph: '♕', hue: 40,
      desc: '×(1 + 0,5 je anderem Talisman) Multi.',
      onHand: (ctx) => {
        const others = Math.max(0, ctx.run.talismans.length - 1);
        return others ? [xmult(1 + 0.5 * others)] : null;
      },
      describe: (t, run) => (run && run.talismans.length ? `×(1 + 0,5 je anderem Talisman) Multi (derzeit ${xs(1 + 0.5 * Math.max(0, run.talismans.length - 1))}).` : null),
    },
    {
      id: 'time_loop', name: 'Zeitschleife', rarity: 'legendary', price: 20, glyph: '⥁', hue: 200, copyable: false,
      desc: 'Der erste Nachwurf jedes Wurfs kostet keinen Nachwurf.',
      freeReroll: (run, t, round) => round.rerollsUsedThisThrow === 0,
    },
  ];
}

function goldFaces(run) {
  let n = 0;
  for (const d of run.dice) for (const f of d.faces) if (f.mark === 'gold') n++;
  return n;
}

function materialCount(run) {
  let n = 0;
  for (const d of run.dice) if (d.material) n += d.material === 'phantom' ? 2 : 1;
  return n;
}

function rareCount(run, TALISMANS) {
  let n = 0;
  for (const t of run.talismans) {
    const def = TALISMANS[t.id];
    if (def && (def.rarity === 'rare' || def.rarity === 'legendary') && !t.disabled) n++;
  }
  return n;
}
