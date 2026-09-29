import type { Trade } from '../core/types';
import { ReconnectingSocket, type Feed, type FeedHandlers } from './feed';

/**
 * Binance public market data. Free, no API key.
 * Aggregate trades carry `m` ("buyer is maker"): when true the seller was the
 * aggressor, so every trade comes with a real buy/sell side, not a guessed one.
 */

interface RawAggTrade {
  a: number; // aggregate trade id
  p: string; // price
  q: string; // quantity
  T: number; // trade time (ms)
  m: boolean; // buyer is the maker
}

export function parseBinanceAggTrade(raw: RawAggTrade): Trade {
  return { t: raw.T, price: Number(raw.p), qty: Number(raw.q), side: raw.m ? -1 : 1 };
}

export class BinanceFeed implements Feed {
  readonly label: string;
  private socket: ReconnectingSocket | null = null;
  private lastId = -1;
  private stopped = false;

  constructor(
    private readonly symbol: string,
    private readonly hosts: { rest: string; ws: string },
    private readonly backfillPages: number,
    venue: string,
  ) {
    this.label = `${venue} ${symbol.toUpperCase()}`;
  }

  start(h: FeedHandlers): void {
    const sym = this.symbol.toLowerCase();
    // Buffer live trades until the backfill lands, then replay only the newer ones.
    let buffering = true;
    const buffer: RawAggTrade[] = [];
    this.socket = new ReconnectingSocket(
      `${this.hosts.ws}/ws/${sym}@aggTrade`,
      (data) => {
        const raw = JSON.parse(data) as RawAggTrade & { e?: string };
        if (raw.e !== 'aggTrade') return;
        if (buffering) buffer.push(raw);
        else this.emit(raw, h);
      },
      h.onStatus,
    );
    this.socket.open();

    this.backfill(h)
      .catch((e: unknown) => {
        h.onStatus({ kind: 'error', message: `history unavailable (${String(e)}), streaming live only` });
        return [] as RawAggTrade[];
      })
      .then((hist) => {
        if (this.stopped) return;
        h.onBackfill(hist.map(parseBinanceAggTrade));
        if (hist.length) this.lastId = hist[hist.length - 1].a;
        buffering = false;
        for (const raw of buffer) this.emit(raw, h);
        buffer.length = 0;
        h.onStatus({ kind: 'live' });
      });
  }

  private emit(raw: RawAggTrade, h: FeedHandlers): void {
    if (raw.a <= this.lastId) return;
    this.lastId = raw.a;
    h.onTrade(parseBinanceAggTrade(raw));
  }

  /** Page backwards through recent aggregate trades (1000 per request). */
  private async backfill(h: FeedHandlers): Promise<RawAggTrade[]> {
    const sym = this.symbol.toUpperCase();
    const pages: RawAggTrade[][] = [];
    let fromId: number | null = null;
    for (let i = 0; i < this.backfillPages && !this.stopped; i++) {
      const url: string =
        fromId === null
          ? `${this.hosts.rest}/api/v3/aggTrades?symbol=${sym}&limit=1000`
          : `${this.hosts.rest}/api/v3/aggTrades?symbol=${sym}&limit=1000&fromId=${fromId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as RawAggTrade[];
      if (!page.length) break;
      pages.unshift(page);
      h.onStatus({ kind: 'backfilling', loaded: pages.reduce((n, p) => n + p.length, 0) });
      const first = page[0].a;
      if (first === 0) break;
      fromId = Math.max(0, first - 1000);
    }
    // Pages can overlap at the seams; de-duplicate by id.
    const seen = new Set<number>();
    return pages.flat().filter((r) => (seen.has(r.a) ? false : (seen.add(r.a), true)));
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }
}
