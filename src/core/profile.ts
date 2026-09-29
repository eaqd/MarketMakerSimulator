/** Helpers for volume-at-price profiles. Buckets are integer keys; price = key * step. */

export const toBucket = (price: number, step: number): number => Math.round(price / step);
export const fromBucket = (key: number, step: number): number => key * step;

/** Round a raw step to a "nice" 1/2/2.5/5 × 10^n number so price levels look sensible. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
  return nice * base;
}

/** Default bucket size: about 1/5000th of price (≈ 2 bps), which suits liquid markets. */
export const autoStep = (price: number): number => niceStep(Math.abs(price) / 5000);

export interface ValueArea {
  poc: number;
  vaLow: number;
  vaHigh: number;
  total: number;
}

/**
 * Standard market-profile value area: start at the POC and repeatedly add
 * whichever neighbouring bucket (above or below) carries more volume until
 * `pct` of total volume is enclosed.
 */
export function valueArea(profile: Map<number, number>, step: number, pct = 0.7): ValueArea | null {
  if (profile.size === 0) return null;
  const keys = [...profile.keys()].sort((a, b) => a - b);
  let total = 0;
  let pocIdx = 0;
  let pocVol = -Infinity;
  keys.forEach((k, i) => {
    const v = profile.get(k)!;
    total += v;
    if (v > pocVol) {
      pocVol = v;
      pocIdx = i;
    }
  });
  let lo = pocIdx;
  let hi = pocIdx;
  let inside = pocVol;
  const target = total * pct;
  while (inside < target && (lo > 0 || hi < keys.length - 1)) {
    const below = lo > 0 ? profile.get(keys[lo - 1])! : -1;
    const above = hi < keys.length - 1 ? profile.get(keys[hi + 1])! : -1;
    if (above >= below) {
      hi++;
      inside += above;
    } else {
      lo--;
      inside += below;
    }
  }
  return {
    poc: fromBucket(keys[pocIdx], step),
    vaLow: fromBucket(keys[lo], step),
    vaHigh: fromBucket(keys[hi], step),
    total,
  };
}

/** Merge several profiles into one (a composite profile). */
export function mergeProfiles(profiles: Iterable<Map<number, number>>): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of profiles) for (const [k, v] of p) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}
