import { describe, expect, it } from 'vitest';
import { FluxBarBuilder } from '../src/core/fluxbars';
import type { FluxBar, Trade } from '../src/core/types';
import { absorption, anchoredVwap, compositeProfile, cvd, efficiency, tempo } from '../src/indicators';

const tr = (t: number, price: number, qty: number, side: 1 | -1 = 1): Trade => ({ t, price, qty, side });

function barsFrom(trades: Trade[], size: number): FluxBar[] {
  const b = new FluxBarBuilder({ mode: 'volume', size }, 0.5);
  b.pushAll(trades);
  b.last();
  return b.bars;
}

describe('indicators', () => {
  it('CVD is the running sum of bar deltas', () => {
    const bars = barsFrom([tr(1, 10, 2, 1), tr(2, 10, 2, -1), tr(3, 10, 2, -1), tr(4, 10, 2, -1)], 2);
    expect(cvd(bars)).toEqual([2, 0, -2, -4]);
  });

  it('anchored VWAP equals the volume-weighted mean and SD of every trade', () => {
    const trades = [tr(1, 10, 1), tr(2, 12, 3), tr(3, 11, 2), tr(4, 15, 4)];
    const bars = barsFrom(trades, 5);
    const res = anchoredVwap(bars, 0);
    const last = bars.length - 1;
    const v = 10;
    const mean = (10 * 1 + 12 * 3 + 11 * 2 + 15 * 4) / v;
    const sd = Math.sqrt((1 * (10 - mean) ** 2 + 3 * (12 - mean) ** 2 + 2 * (11 - mean) ** 2 + 4 * (15 - mean) ** 2) / v);
    expect(res.vwap[last]).toBeCloseTo(mean, 10);
    expect(res.up1[last] - res.vwap[last]).toBeCloseTo(sd, 10);
    expect(anchoredVwap(bars, 1).vwap[0]).toBeNaN();
  });

  it('efficiency is 1 for a straight line and near 0 for a zigzag', () => {
    const line = barsFrom(Array.from({ length: 40 }, (_, i) => tr(i, 100 + i, 1)), 1);
    expect(efficiency(line, 14).at(-1)).toBeCloseTo(1, 10);
    const zig = barsFrom(Array.from({ length: 40 }, (_, i) => tr(i, 100 + (i % 2), 1)), 1);
    expect(efficiency(zig, 14).at(-1)!).toBeLessThan(0.1);
  });

  it('tempo reads +log2(speed-up)', () => {
    const trades: Trade[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      trades.push(tr(t, 100, 1), tr(t + 8_000, 100, 1));
      t += 10_000;
    }
    trades.push(tr(t, 100, 1), tr(t + 2_000, 100, 1)); // 4× faster
    const tv = tempo(barsFrom(trades, 2));
    expect(tv.at(-1)).toBeCloseTo(2, 10);
  });

  it('flags absorption when flow and price disagree', () => {
    // Heavy selling (sell 8 / buy 2) yet the bar closes at its high → bullish absorption.
    const bars = barsFrom([tr(1, 100, 1, 1), tr(2, 99, 8, -1), tr(3, 101, 1, 1)], 10);
    const marks = absorption(bars, 0.2);
    expect(marks).toEqual([{ index: 0, dir: 1, strength: 0.6 }]);
  });

  it('composite profile finds the POC, value area and nodes', () => {
    const trades: Trade[] = [];
    // Two accepted areas (98, 102) separated by a thin area (100).
    for (let i = 0; i < 50; i++) trades.push(tr(i, 98, 5), tr(i, 102, 4), tr(i, 100, 0.2), tr(i, 99, 1), tr(i, 101, 1));
    const bars = barsFrom(trades, 50);
    const p = compositeProfile(bars, 0, bars.length - 1, 0.5, 200)!;
    expect(p.poc).toBe(98);
    expect(p.vaLow).toBeLessThanOrEqual(98);
    expect(p.vaHigh).toBeGreaterThanOrEqual(98);
    expect(p.lvn.some((x) => x > 98 && x < 102)).toBe(true);
    expect(p.hvn).toContain(98);
  });
});
