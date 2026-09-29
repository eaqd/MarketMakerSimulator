import type { Side, Trade } from '../core/types';

/**
 * Parse a trades CSV so you can load any market you have tick data for.
 *
 * Columns (header required, any order, case-insensitive):
 *   time   — epoch milliseconds, epoch seconds, or an ISO date string
 *   price
 *   qty    — also accepted: size, volume, amount, quantity
 *   side   — optional: buy/sell, b/s, 1/-1. When it is missing, the side is
 *            inferred with the tick rule (uptick = buy, downtick = sell,
 *            unchanged = same as the previous trade).
 */
export function parseTradesCsv(text: string): Trade[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one trade');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iT = col('time', 'timestamp', 't', 'date', 'datetime');
  const iP = col('price', 'p');
  const iQ = col('qty', 'size', 'volume', 'amount', 'quantity', 'q');
  const iS = col('side', 'aggressor', 's');
  if (iT < 0 || iP < 0 || iQ < 0) throw new Error('CSV must have time, price and qty columns');

  const out: Trade[] = [];
  let prevPrice = NaN;
  let prevSide: Side = 1;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map((x) => x.trim());
    const t = parseTime(c[iT]);
    const price = Number(c[iP]);
    const qty = Number(c[iQ]);
    if (!Number.isFinite(t) || !Number.isFinite(price) || !(qty > 0)) continue;
    let side = iS >= 0 ? parseSide(c[iS]) : null;
    if (side === null) {
      side = price > prevPrice ? 1 : price < prevPrice ? -1 : prevSide;
    }
    out.push({ t, price, qty, side });
    prevPrice = price;
    prevSide = side;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function parseTime(s: string): number {
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n < 1e11 ? n * 1000 : n; // seconds vs milliseconds
  }
  return Date.parse(s);
}

function parseSide(s: string | undefined): Side | null {
  const v = (s ?? '').toLowerCase();
  if (['buy', 'b', '1', '+1'].includes(v)) return 1;
  if (['sell', 's', '-1'].includes(v)) return -1;
  return null;
}
