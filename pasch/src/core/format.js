// Zahlenformatierung (deutsch).

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** n mit max. `digits` Nachkommastellen, deutsches Komma, ohne überflüssige Nullen */
function shortDe(n, digits) {
  let s = n.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

export function formatNumber(n) {
  if (n === Infinity) return '∞';
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  const neg = n < 0;
  const a = Math.abs(n);
  let s;
  if (a >= 1e12) {
    let e = Math.floor(Math.log10(a));
    let m = Math.round((a / Math.pow(10, e)) * 10) / 10;
    if (m >= 10) {
      m = 1;
      e += 1;
    }
    s = `${m.toFixed(1).replace('.', ',')}e${e}`;
  } else if (a >= 1e9) {
    s = `${shortDe(a / 1e9, 2)} Mrd.`;
  } else if (a >= 1e6) {
    s = `${shortDe(a / 1e6, 2)} Mio.`;
  } else {
    s = groupThousands(String(Math.floor(a)));
  }
  return neg ? `−${s}` : s;
}

export function formatMoney(n) {
  return n < 0 ? `−$${Math.abs(n)}` : `$${n}`;
}

export function formatMult(x) {
  return `×${shortDe(x, 2)}`;
}
