import type { Trade } from '../core/types';
import { ReconnectingSocket, type Feed, type FeedHandlers } from './feed';

/**
 * Bybit public spot feed (v5). Free, no API key. `S` is the taker's side.
 * Bybit closes idle sockets, so we send a ping every 20 seconds.
 */

interface RawBybitTrade {
  T: number; // trade time (ms)
  s: string; // symbol
  S: 'Buy' | 'Sell'; // taker side
  v: string; // size
  p: string; // price
  i: string; // trade id
}

export function parseBybitTrade(raw: RawBybitTrade): Trade {
  return { t: raw.T, price: Number(raw.p), qty: Number(raw.v), side: raw.S === 'Buy' ? 1 : -1 };
}

interface RestTrade {
  execId: string;
  time: string;
  price: string;
  size: string;
  side: 'Buy' | 'Sell';
}

export class BybitFeed implements Feed {
  readonly label: string;
  private socket: ReconnectingSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  /** Trade ids already delivered from history; the live stream can overlap it. */
  private seen = new Set<string>();
  private stopped = false;

  constructor(private readonly symbol: string) {
    this.label = `Bybit ${symbol.toUpperCase()}`;
  }

  start(h: FeedHandlers): void {
    const symbol = this.symbol.toUpperCase();
    let buffering = true;
    const buffer: [string, Trade][] = [];
    this.socket = new ReconnectingSocket(
      'wss://stream.bybit.com/v5/public/spot',
      (data) => {
        const msg = JSON.parse(data) as { topic?: string; data?: RawBybitTrade[] };
        if (!msg.topic?.startsWith('publicTrade.') || !msg.data) return;
        for (const raw of msg.data) {
          const t = parseBybitTrade(raw);
          if (buffering) buffer.push([raw.i, t]);
          else this.emit(raw.i, t, h);
        }
      },
      h.onStatus,
      (ws) => {
        ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol}`] }));
        if (this.ping) clearInterval(this.ping);
        this.ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 20_000);
      },
    );
    this.socket.open();

    this.backfill(symbol)
      .catch((e: unknown) => {
        h.onStatus({ kind: 'error', message: `history unavailable (${String(e)}), streaming live only` });
        return [] as RestTrade[];
      })
      .then((hist) => {
        if (this.stopped) return;
        for (const r of hist) this.seen.add(r.execId);
        h.onBackfill(
          hist.map((r) => ({ t: Number(r.time), price: Number(r.price), qty: Number(r.size), side: r.side === 'Buy' ? 1 : -1 }) as Trade),
        );
        buffering = false;
        for (const [id, t] of buffer) this.emit(id, t, h);
        buffer.length = 0;
        h.onStatus({ kind: 'live' });
      });
  }

  private emit(id: string, t: Trade, h: FeedHandlers): void {
    if (this.seen.has(id)) return;
    h.onTrade(t);
  }

  /** Bybit only serves the last ~60 spot trades over REST; the rest builds up live. */
  private async backfill(symbol: string): Promise<RestTrade[]> {
    const res = await fetch(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=60`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { retCode: number; retMsg: string; result?: { list: RestTrade[] } };
    if (body.retCode !== 0) throw new Error(body.retMsg);
    return (body.result?.list ?? []).sort((a, b) => Number(a.time) - Number(b.time));
  }

  stop(): void {
    this.stopped = true;
    if (this.ping) clearInterval(this.ping);
    this.socket?.close();
  }
}
