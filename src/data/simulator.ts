import type { Side, Trade } from '../core/types';
import type { Feed, FeedHandlers } from './feed';

/** Small, fast, seedable PRNG (mulberry32) so simulations are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Regime = 'range' | 'up' | 'down';

export interface SimOptions {
  seed: number;
  startPrice: number;
  tick: number;
  startT: number;
  /** Mean trades per second in normal conditions. */
  rate: number;
}

/**
 * An agent-based market:
 *  - a hidden fair value drifts through trending and ranging regimes;
 *  - informed traders trade toward fair value, noise traders trade randomly;
 *  - a market maker quotes around its mid, moves it with order flow, and
 *    skews against its own inventory;
 *  - large passive "walls" sometimes sit at round prices and soak up
 *    aggression without letting price through (absorption).
 * None of this is real market data. It exists to test and learn the chart
 * offline, where the "truth" is known.
 */
export class MarketSim {
  private r: () => number;
  private t: number;
  private fair: number;
  private mid: number;
  private inventory = 0;
  private regime: Regime = 'range';
  private regimeLeft = 0;
  private anchor: number;
  private wall: { price: number; side: Side; remaining: number } | null = null;
  readonly tick: number;
  private rate: number;

  constructor(opts: SimOptions) {
    this.r = rng(opts.seed);
    this.t = opts.startT;
    this.fair = opts.startPrice;
    this.mid = opts.startPrice;
    this.anchor = opts.startPrice;
    this.tick = opts.tick;
    this.rate = opts.rate;
  }

  get time(): number {
    return this.t;
  }

  private gauss(): number {
    let u = 0;
    while (u === 0) u = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.r());
  }

  private evolveRegime(): void {
    if (--this.regimeLeft > 0) return;
    const x = this.r();
    this.regime = x < 0.5 ? 'range' : x < 0.75 ? 'up' : 'down';
    this.regimeLeft = 2000 + Math.floor(this.r() * 6000);
    this.anchor = this.fair;
  }

  private maybeWall(): void {
    if (this.wall || this.r() > 0.0015) return;
    // Walls sit at a nearby round number, on the side price is heading toward.
    const round = this.tick * 25;
    const side: Side = this.r() < 0.5 ? 1 : -1;
    const price =
      side === 1 ? Math.floor(this.mid / round) * round : Math.ceil(this.mid / round) * round;
    if (Math.abs(price - this.mid) > this.mid * 0.004) return;
    this.wall = { price, side, remaining: 300 + this.r() * 900 };
    // The wall belongs to a well-informed player: fair value leans away from it.
    this.regime = 'range';
    this.regimeLeft = 1500 + Math.floor(this.r() * 1500);
    this.anchor = price - side * this.mid * 0.003;
  }

  next(): Trade {
    this.evolveRegime();
    this.maybeWall();

    // Fair value: noise plus regime drift (or pull back to the range anchor).
    const vol = this.fair * 0.00002;
    let drift = 0;
    if (this.regime === 'up') drift = vol * 0.25;
    else if (this.regime === 'down') drift = -vol * 0.25;
    else drift = (this.anchor - this.fair) * 0.002;
    this.fair += drift + vol * this.gauss();

    // Order arrival: faster when price is far from fair value (urgency).
    const gap = (this.fair - this.mid) / (this.fair * 0.001);
    const lambda = this.rate * (1 + Math.min(4, Math.abs(gap)));
    this.t += Math.max(1, Math.round((-Math.log(1 - this.r()) / lambda) * 1000));

    const informed = this.r() < Math.min(0.75, 0.3 + Math.abs(gap) * 0.2);
    // Noise traders partly chase: they lean toward the side the market is already moving.
    const lean = 0.5 + 0.15 * Math.tanh(gap);
    const side: Side = informed ? (gap > 0 ? 1 : -1) : this.r() < lean ? 1 : -1;
    const qty = Math.max(0.001, Math.exp(this.gauss() * 0.9) * (informed ? 1.6 : 1));

    const spread = this.tick * (1 + Math.floor(this.r() * 2));
    let price = side === 1 ? this.mid + spread / 2 : this.mid - spread / 2;

    // A passive wall absorbs aggression into it and pins price at its level.
    const w = this.wall;
    const hitsWall = w && ((w.side === -1 && side === 1 && price >= w.price) || (w.side === 1 && side === -1 && price <= w.price));
    if (w && hitsWall) {
      price = w.price;
      w.remaining -= qty;
      this.mid = w.price - w.side * spread;
      if (w.remaining <= 0) this.wall = null;
    } else {
      const impact = this.tick * 0.35 * qty;
      this.inventory -= side * qty;
      this.mid += side * impact - this.inventory * this.tick * 0.002;
    }
    if (w && Math.abs(this.mid - w.price) > this.mid * 0.006) this.wall = null;

    price = Math.round(price / this.tick) * this.tick;
    return { t: this.t, price: Number(price.toFixed(8)), qty: Number(qty.toFixed(4)), side };
  }
}

/** Streams simulated trades in (optionally sped-up) real time. */
export class SimFeed implements Feed {
  readonly label = 'Simulator (synthetic data)';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly historyMinutes = 240,
    private readonly speed = 1,
    private readonly seed = 7,
  ) {}

  start(h: FeedHandlers): void {
    const now = Date.now();
    const sim = new MarketSim({
      seed: this.seed,
      startPrice: 100,
      tick: 0.01,
      startT: now - this.historyMinutes * 60_000,
      rate: 4,
    });
    const hist: Trade[] = [];
    let pending = sim.next();
    while (pending.t <= now) {
      hist.push(pending);
      pending = sim.next();
    }
    h.onBackfill(hist);
    h.onStatus({ kind: 'live' });
    // Simulated time runs `speed`× faster than the wall clock from here on.
    let simNow = now;
    let wall = performance.now();
    this.timer = setInterval(() => {
      const w = performance.now();
      simNow += (w - wall) * this.speed;
      wall = w;
      while (pending.t <= simNow) {
        h.onTrade(pending);
        pending = sim.next();
      }
    }, 50);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
