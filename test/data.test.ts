import { describe, expect, it } from 'vitest';
import { parseBinanceAggTrade } from '../src/data/binance';
import { parseCoinbaseMatch } from '../src/data/coinbase';
import { parseTradesCsv } from '../src/data/csv';

describe('feed parsers', () => {
  it('Binance: m=true means the buyer was the maker, so the aggressor sold', () => {
    const base = { a: 1, p: '64000.10', q: '0.015', T: 1_700_000_000_000 };
    expect(parseBinanceAggTrade({ ...base, m: true })).toEqual({ t: 1_700_000_000_000, price: 64000.1, qty: 0.015, side: -1 });
    expect(parseBinanceAggTrade({ ...base, m: false }).side).toBe(1);
  });

  it('Coinbase: side is the maker side, so "sell" means an aggressive buy', () => {
    const m = { type: 'match', trade_id: 5, side: 'sell' as const, size: '0.5', price: '3000.5', time: '2024-01-02T03:04:05.678Z' };
    expect(parseCoinbaseMatch(m)).toEqual({ t: Date.parse(m.time), price: 3000.5, qty: 0.5, side: 1 });
    expect(parseCoinbaseMatch({ ...m, side: 'buy' }).side).toBe(-1);
  });
});

describe('CSV import', () => {
  it('reads explicit sides and second/millisecond timestamps', () => {
    const t = parseTradesCsv('Time,Price,Size,Side\n1700000000,10,1,buy\n1700000001000,11,2,S\n');
    expect(t).toEqual([
      { t: 1_700_000_000_000, price: 10, qty: 1, side: 1 },
      { t: 1_700_000_001_000, price: 11, qty: 2, side: -1 },
    ]);
  });

  it('infers sides with the tick rule when there is no side column', () => {
    const t = parseTradesCsv('time,price,qty\n2024-01-01T00:00:00Z,10,1\n2024-01-01T00:00:01Z,11,1\n2024-01-01T00:00:02Z,11,1\n2024-01-01T00:00:03Z,10.5,1\n');
    expect(t.map((x) => x.side)).toEqual([1, 1, 1, -1]);
  });

  it('rejects files without the required columns', () => {
    expect(() => parseTradesCsv('a,b\n1,2')).toThrow();
  });
});
