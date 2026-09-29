import { fromBucket, mergeProfiles, toBucket, valueArea } from '../core/profile';
import { barDeltaRatio, type FluxBar } from '../core/types';

/**
 * Cumulative Volume Delta: running sum of (aggressive buys - aggressive sells).
 * If price makes a new high but CVD does not, the push came from something other
 * than aggressive buying (e.g. sellers stepping away), which is a weaker move.
 */
export function cvd(bars: readonly FluxBar[]): number[] {
  const out = new Array<number>(bars.length);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    acc += bars[i].delta;
    out[i] = acc;
  }
  return out;
}

export interface VwapBands {
  vwap: number[];
  up1: number[];
  dn1: number[];
  up2: number[];
  dn2: number[];
}

/**
 * Anchored VWAP with volume-weighted standard-deviation bands, starting at bar
 * `anchor`. Values before the anchor are NaN. It uses every trade's price (via
 * Σp·v and Σp²·v), not just bar closes, so the bands are exact.
 */
export function anchoredVwap(bars: readonly FluxBar[], anchor: number): VwapBands {
  const n = bars.length;
  const mk = () => new Array<number>(n).fill(NaN);
  const res: VwapBands = { vwap: mk(), up1: mk(), dn1: mk(), up2: mk(), dn2: mk() };
  let v = 0;
  let pv = 0;
  let p2v = 0;
  for (let i = Math.max(0, anchor); i < n; i++) {
    const b = bars[i];
    v += b.volume;
    pv += b.sumPV;
    p2v += b.sumP2V;
    if (v <= 0) continue;
    const mean = pv / v;
    const sd = Math.sqrt(Math.max(0, p2v / v - mean * mean));
    res.vwap[i] = mean;
    res.up1[i] = mean + sd;
    res.dn1[i] = mean - sd;
    res.up2[i] = mean + 2 * sd;
    res.dn2[i] = mean - 2 * sd;
  }
  return res;
}

/**
 * Kaufman efficiency ratio over `n` bars: |net move| / total distance travelled.
 * Near 1 means price is moving in a straight line (trend); near 0 means it is
 * going back and forth (range).
 */
export function efficiency(bars: readonly FluxBar[], n = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = n; i < bars.length; i++) {
    const net = Math.abs(bars[i].close - bars[i - n].close);
    let path = 0;
    for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].close - bars[j - 1].close);
    out[i] = path > 0 ? net / path : 0;
  }
  return out;
}

/**
 * Tempo: how fast each bar formed compared with the median of the previous
 * `lookback` bars, on a log2 scale. +1 means the bar filled twice as fast as usual.
 * On a volume clock this measures urgency: the market is suddenly trading a lot.
 */
export function tempo(bars: readonly FluxBar[], lookback = 50): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  const durs = bars.map((b) => Math.max(1, b.endT - b.startT));
  for (let i = 5; i < bars.length; i++) {
    // A bar that is still filling has not had its full time yet; don't call it fast.
    if (bars[i].forming) continue;
    const window = durs.slice(Math.max(0, i - lookback), i).sort((a, b) => a - b);
    const med = window[window.length >> 1];
    out[i] = Math.log2(med / durs[i]);
  }
  return out;
}

export interface AbsorptionMark {
  index: number;
  /** +1 = bullish (sellers were absorbed), -1 = bearish (buyers were absorbed). */
  dir: 1 | -1;
  strength: number;
}

/**
 * Absorption: aggressive flow went one way but price closed the other way.
 * Heavy selling that still closes up means a passive buyer soaked it all up,
 * and the reverse. These bars often mark where a level is being defended.
 */
export function absorption(bars: readonly FluxBar[], threshold = 0.2): AbsorptionMark[] {
  const marks: AbsorptionMark[] = [];
  for (const b of bars) {
    if (b.forming) continue;
    const dr = barDeltaRatio(b);
    const range = b.high - b.low;
    if (range <= 0) continue;
    const move = (b.close - b.open) / range;
    if (dr <= -threshold && move > 0.1) marks.push({ index: b.index, dir: 1, strength: -dr });
    else if (dr >= threshold && move < -0.1) marks.push({ index: b.index, dir: -1, strength: dr });
  }
  return marks;
}

export interface ProfileRow {
  price: number;
  vol: number;
}

export interface CompositeProfile {
  rows: ProfileRow[];
  rowStep: number;
  poc: number;
  vaLow: number;
  vaHigh: number;
  maxVol: number;
  /** High-volume nodes: prices the market accepted. They tend to act as support and resistance. */
  hvn: number[];
  /** Low-volume nodes: prices the market rejected. Price tends to move through them quickly. */
  lvn: number[];
}

/**
 * Composite volume profile of bars[from..to], re-binned so the profile has
 * about `rows` rows (fine buckets would make HVN/LVN detection noisy).
 * Returns at most `maxNodes` of the strongest high- and low-volume nodes.
 */
export function compositeProfile(
  bars: readonly FluxBar[],
  from: number,
  to: number,
  step: number,
  rows = 60,
  maxNodes = 4,
): CompositeProfile | null {
  const slice = bars.slice(Math.max(0, from), Math.min(bars.length, to + 1));
  if (slice.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of slice) {
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  const factor = Math.max(1, Math.round((hi - lo) / step / rows));
  const rowStep = step * factor;
  const merged = mergeProfiles(slice.map((b) => b.profile));
  const coarse = new Map<number, number>();
  for (const [k, v] of merged) {
    const ck = toBucket(fromBucket(k, step), rowStep);
    coarse.set(ck, (coarse.get(ck) ?? 0) + v);
  }
  const va = valueArea(coarse, rowStep, 0.7);
  if (!va) return null;
  const keys = [...coarse.keys()].sort((a, b) => a - b);
  // Fill gaps with zero rows so LVNs inside the range are visible.
  const full: ProfileRow[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
    full.push({ price: fromBucket(k, rowStep), vol: coarse.get(k) ?? 0 });
  }
  const maxVol = Math.max(...full.map((r) => r.vol));
  const smooth = full.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = i - 1; j <= i + 1; j++) {
      if (j >= 0 && j < full.length) {
        s += full[j].vol;
        c++;
      }
    }
    return s / c;
  });
  const mean = smooth.reduce((a, b) => a + b, 0) / Math.max(1, smooth.length);
  const hvn: number[] = [];
  const lvn: number[] = [];
  for (let i = 0; i < smooth.length; i++) {
    const s = smooth[i];
    const prev = smooth[i - 1] ?? -Infinity;
    const next = smooth[i + 1] ?? -Infinity;
    // A peak at the edge of the range still counts as a node; a thin edge is just a tail.
    if (s >= prev && s > next && s > mean * 1.3) hvn.push(full[i].price);
    if (i > 0 && i < smooth.length - 1 && s <= prev && s < next && s < mean * 0.6) lvn.push(full[i].price);
  }
  // Keep only the strongest nodes; a chart covered in lines is no help.
  const volAt = (price: number) => smooth[Math.round((price - full[0].price) / rowStep)];
  hvn.sort((a, b) => volAt(b) - volAt(a)).splice(maxNodes);
  lvn.sort((a, b) => volAt(a) - volAt(b)).splice(maxNodes);
  return { rows: full, rowStep, poc: va.poc, vaLow: va.vaLow, vaHigh: va.vaHigh, maxVol, hvn, lvn };
}
