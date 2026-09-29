import { toBucket, valueArea } from './profile';
import type { ClockConfig, FluxBar, Trade } from './types';

const EPS = 1e-12;

function newBar(index: number, t: Trade): FluxBar {
  return {
    index,
    startT: t.t,
    endT: t.t,
    open: t.price,
    high: t.price,
    low: t.price,
    close: t.price,
    volume: 0,
    buyVol: 0,
    sellVol: 0,
    delta: 0,
    trades: 0,
    sumPV: 0,
    sumP2V: 0,
    profile: new Map(),
    poc: t.price,
    vaLow: t.price,
    vaHigh: t.price,
    forming: true,
  };
}

/**
 * Turns a stream of trades into Flux Bars.
 *
 * In volume mode every bar holds exactly `clock.size` volume; a trade that
 * straddles the boundary is split across the two bars, so bars stay
 * comparable to each other.
 */
export class FluxBarBuilder {
  readonly bars: FluxBar[] = [];
  private dirty = false;

  constructor(
    readonly clock: ClockConfig,
    readonly step: number,
    readonly valueAreaPct = 0.7,
  ) {
    if (!(clock.size > 0)) throw new Error('clock size must be positive');
    if (!(step > 0)) throw new Error('price step must be positive');
  }

  /** Add one trade. Returns the number of bars that closed as a result. */
  push(trade: Trade): number {
    if (!(trade.qty > 0) || !Number.isFinite(trade.price)) return 0;
    return this.clock.mode === 'volume' ? this.pushVolume(trade) : this.pushTime(trade);
  }

  pushAll(trades: Iterable<Trade>): number {
    let closed = 0;
    for (const t of trades) closed += this.push(t);
    return closed;
  }

  /** The most recent bar with its value area brought up to date. */
  last(): FluxBar | undefined {
    const b = this.bars[this.bars.length - 1];
    if (b && this.dirty) {
      this.finalizeProfile(b);
      this.dirty = false;
    }
    return b;
  }

  private pushVolume(trade: Trade): number {
    let remaining = trade.qty;
    let closed = 0;
    while (remaining > EPS) {
      let bar = this.bars[this.bars.length - 1];
      if (!bar || !bar.forming) {
        bar = newBar(this.bars.length, trade);
        this.bars.push(bar);
      }
      const room = this.clock.size - bar.volume;
      const fill = Math.min(room, remaining);
      this.apply(bar, trade, fill);
      remaining -= fill;
      if (bar.volume >= this.clock.size - EPS) {
        this.close(bar);
        closed++;
      }
    }
    return closed;
  }

  private pushTime(trade: Trade): number {
    const slot = Math.floor(trade.t / this.clock.size) * this.clock.size;
    let bar = this.bars[this.bars.length - 1];
    let closed = 0;
    if (bar && bar.forming && trade.t >= bar.startT + this.clock.size) {
      this.close(bar);
      closed++;
    }
    bar = this.bars[this.bars.length - 1];
    if (!bar || !bar.forming) {
      bar = newBar(this.bars.length, trade);
      bar.startT = slot;
      this.bars.push(bar);
    }
    this.apply(bar, trade, trade.qty);
    return closed;
  }

  private apply(bar: FluxBar, trade: Trade, qty: number): void {
    const p = trade.price;
    if (bar.volume === 0) bar.open = p;
    bar.high = Math.max(bar.high, p);
    bar.low = Math.min(bar.low, p);
    bar.close = p;
    bar.endT = trade.t;
    bar.volume += qty;
    if (trade.side === 1) bar.buyVol += qty;
    else bar.sellVol += qty;
    bar.delta = bar.buyVol - bar.sellVol;
    bar.trades++;
    bar.sumPV += p * qty;
    bar.sumP2V += p * p * qty;
    const k = toBucket(p, this.step);
    bar.profile.set(k, (bar.profile.get(k) ?? 0) + qty);
    this.dirty = true;
  }

  private close(bar: FluxBar): void {
    bar.forming = false;
    this.finalizeProfile(bar);
  }

  private finalizeProfile(bar: FluxBar): void {
    const va = valueArea(bar.profile, this.step, this.valueAreaPct);
    if (!va) return;
    // Clamp to the traded range: bucket rounding can push a level just outside high/low.
    const clamp = (x: number) => Math.min(bar.high, Math.max(bar.low, x));
    bar.poc = clamp(va.poc);
    bar.vaLow = clamp(va.vaLow);
    bar.vaHigh = clamp(va.vaHigh);
  }
}

/**
 * Pick a volume-per-bar so that, at the observed average trading rate, one bar
 * forms roughly every `targetMs` milliseconds. This keeps bar counts familiar
 * ("about a 1-minute bar") while the bars themselves stay volume-based.
 */
export function calibrateVolumeClock(trades: readonly Trade[], targetMs: number): number | null {
  if (trades.length < 2) return null;
  const span = trades[trades.length - 1].t - trades[0].t;
  if (span <= 0) return null;
  let vol = 0;
  for (const t of trades) vol += t.qty;
  const perBar = (vol / span) * targetMs;
  if (!(perBar > 0)) return null;
  // Round to 2 significant figures so the number is readable in the UI.
  const mag = 10 ** (Math.floor(Math.log10(perBar)) - 1);
  return Math.max(mag, Math.round(perBar / mag) * mag);
}
