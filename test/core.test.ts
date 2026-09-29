import { describe, expect, it } from 'vitest';
import { FluxBarBuilder, calibrateVolumeClock } from '../src/core/fluxbars';
import { autoStep, niceStep, valueArea } from '../src/core/profile';
import type { Trade } from '../src/core/types';
import { MarketSim } from '../src/data/simulator';

const tr = (t: number, price: number, qty: number, side: 1 | -1 = 1): Trade => ({ t, price, qty, side });

describe('profile', () => {
  it('rounds steps to 1/2/2.5/5 × 10^n', () => {
    expect(niceStep(0.013)).toBe(0.01);
    expect(niceStep(0.021)).toBe(0.02);
    expect(niceStep(27)).toBe(25);
    expect(niceStep(60)).toBe(50);
    expect(autoStep(100_000)).toBe(20);
  });

  it('computes POC and a 70% value area', () => {
    // Volumes at prices 1..7 (step 1): the peak is at 4.
    const p = new Map([
      [1, 1],
      [2, 2],
      [3, 10],
      [4, 20],
      [5, 12],
      [6, 3],
      [7, 2],
    ]);
    const va = valueArea(p, 1, 0.7)!;
    expect(va.poc).toBe(4);
    expect(va.total).toBe(50);
    // 20 → +12 (5) = 32 → +10 (3) = 42 ≥ 35.
    expect(va.vaLow).toBe(3);
    expect(va.vaHigh).toBe(5);
  });
});

describe('FluxBarBuilder', () => {
  it('volume clock: every closed bar has exactly the target volume, trades split across bars', () => {
    const b = new FluxBarBuilder({ mode: 'volume', size: 10 }, 1);
    b.pushAll([tr(1, 100, 4), tr(2, 101, 9, -1), tr(3, 102, 12), tr(4, 99, 1)]);
    const closed = b.bars.filter((x) => !x.forming);
    expect(closed.map((x) => x.volume)).toEqual([10, 10]);
    // Bar 1: 4 buy @100 + 6 sell @101.
    expect(closed[0]).toMatchObject({ open: 100, close: 101, high: 101, low: 100, buyVol: 4, sellVol: 6, delta: -2 });
    // Bar 2: 3 sell @101 + 7 buy @102.
    expect(closed[1]).toMatchObject({ open: 101, close: 102, buyVol: 7, sellVol: 3, delta: 4 });
    // Remainder: 5 @102 + 1 @99 is still forming.
    expect(b.bars[2]).toMatchObject({ volume: 6, forming: true, low: 99 });
    const total = b.bars.reduce((s, x) => s + x.volume, 0);
    expect(total).toBe(26);
  });

  it('time clock reproduces candlestick OHLCV exactly (Flux Bars lose nothing)', () => {
    const sim = new MarketSim({ seed: 3, startPrice: 50, tick: 0.01, startT: 0, rate: 5 });
    const trades = Array.from({ length: 5000 }, () => sim.next());
    const b = new FluxBarBuilder({ mode: 'time', size: 60_000 }, 0.01);
    b.pushAll(trades);
    const candles = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
    for (const t of trades) {
      const k = Math.floor(t.t / 60_000);
      const c = candles.get(k);
      if (!c) candles.set(k, { o: t.price, h: t.price, l: t.price, c: t.price, v: t.qty });
      else {
        c.h = Math.max(c.h, t.price);
        c.l = Math.min(c.l, t.price);
        c.c = t.price;
        c.v += t.qty;
      }
    }
    const expected = [...candles.values()];
    expect(b.bars.length).toBe(expected.length);
    b.bars.forEach((bar, i) => {
      const c = expected[i];
      expect([bar.open, bar.high, bar.low, bar.close]).toEqual([c.o, c.h, c.l, c.c]);
      expect(bar.volume).toBeCloseTo(c.v, 6);
      expect(bar.buyVol + bar.sellVol).toBeCloseTo(bar.volume, 9);
      // Value area and POC always sit inside the bar's range.
      expect(bar.vaLow).toBeGreaterThanOrEqual(bar.low);
      expect(bar.vaHigh).toBeLessThanOrEqual(bar.high);
      expect(bar.poc).toBeGreaterThanOrEqual(bar.vaLow);
      expect(bar.poc).toBeLessThanOrEqual(bar.vaHigh);
    });
  });

  it('calibrates volume per bar to a target duration', () => {
    // 1 unit per second for 100 s → 60 units per "1 minute" bar.
    const trades = Array.from({ length: 101 }, (_, i) => tr(i * 1000, 10, 1));
    const size = calibrateVolumeClock(trades, 60_000)!;
    expect(size).toBeGreaterThan(55);
    expect(size).toBeLessThan(65);
  });
});

describe('MarketSim', () => {
  it('is deterministic, time-ordered and on the tick grid', () => {
    const a = new MarketSim({ seed: 9, startPrice: 100, tick: 0.01, startT: 0, rate: 4 });
    const b = new MarketSim({ seed: 9, startPrice: 100, tick: 0.01, startT: 0, rate: 4 });
    let prev = -1;
    for (let i = 0; i < 20_000; i++) {
      const x = a.next();
      expect(b.next()).toEqual(x);
      expect(x.t).toBeGreaterThan(prev);
      expect(Math.abs(x.price / 0.01 - Math.round(x.price / 0.01))).toBeLessThan(1e-6);
      expect(x.qty).toBeGreaterThan(0);
      prev = x.t;
    }
  });
});
