import type { Trade } from '../core/types';
import { ReconnectingSocket, type Feed, type FeedHandlers } from './feed';

/**
 * Coinbase Exchange public feed. Free, no API key.
 * Coinbase reports the *maker's* side, so a "sell" match means a resting sell
 * order was lifted, i.e. the aggressor was a buyer.
 */

interface RawMatch {
  type?: string;
  trade_id: number;
  side: 'buy' | 'sell';
  size: string;
  price: string;
  time: string;
}

export function parseCoinbaseMatch(raw: RawMatch): Trade {
  return {
    t: Date.parse(raw.time),
    price: Number(raw.price),
    qty: Number(raw.size),
    side: raw.side === 'sell' ? 1 : -1,
  };
}

const REST = 'https://api.exchange.coinbase.com';
const WS = 'wss://ws-feed.exchange.coinbase.com';

export class CoinbaseFeed implements Feed {
  readonly label: string;
  private socket: ReconnectingSocket | null = null;
  private lastId = -1;
  private stopped = false;

  constructor(
    private readonly product: string,
    private readonly backfillPages: number,
  ) {
    this.label = `Coinbase ${product.toUpperCase()}`;
  }

  start(h: FeedHandlers): void {
    const product = this.product.toUpperCase();
    let buffering = true;
    const buffer: RawMatch[] = [];
    this.socket = new ReconnectingSocket(
      WS,
      (data) => {
        const raw = JSON.parse(data) as RawMatch;
        if (raw.type !== 'match' && raw.type !== 'last_match') return;
        if (buffering) buffer.push(raw);
        else this.emit(raw, h);
      },
      h.onStatus,
      (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [product], channels: ['matches'] })),
    );
    this.socket.open();

    this.backfill(product, h)
      .catch((e: unknown) => {
        h.onStatus({ kind: 'error', message: `history unavailable (${String(e)}), streaming live only` });
        return [] as RawMatch[];
      })
      .then((hist) => {
        if (this.stopped) return;
        h.onBackfill(hist.map(parseCoinbaseMatch));
        if (hist.length) this.lastId = hist[hist.length - 1].trade_id;
        buffering = false;
        for (const raw of buffer) this.emit(raw, h);
        buffer.length = 0;
        h.onStatus({ kind: 'live' });
      });
  }

  private emit(raw: RawMatch, h: FeedHandlers): void {
    if (raw.trade_id <= this.lastId) return;
    this.lastId = raw.trade_id;
    h.onTrade(parseCoinbaseMatch(raw));
  }

  /** REST returns newest first, 1000 per page; `after` pages to older trades. */
  private async backfill(product: string, h: FeedHandlers): Promise<RawMatch[]> {
    const all: RawMatch[] = [];
    let after: number | null = null;
    for (let i = 0; i < this.backfillPages && !this.stopped; i++) {
      const url: string = `${REST}/products/${product}/trades?limit=1000${after !== null ? `&after=${after}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as RawMatch[];
      if (!page.length) break;
      all.push(...page);
      h.onStatus({ kind: 'backfilling', loaded: all.length });
      after = Math.min(...page.map((r) => r.trade_id));
    }
    const seen = new Set<number>();
    return all
      .filter((r) => (seen.has(r.trade_id) ? false : (seen.add(r.trade_id), true)))
      .sort((a, b) => a.trade_id - b.trade_id);
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }
}
