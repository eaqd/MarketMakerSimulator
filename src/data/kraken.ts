import type { Trade } from '../core/types';
import { ReconnectingSocket, type Feed, type FeedHandlers } from './feed';

/**
 * Kraken public feed (WebSocket v2). Free, no API key, available in most
 * regions. `side` is the taker's side, so it is the aggressor directly.
 */

interface RawKrakenTrade {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  trade_id: number;
  timestamp: string;
}

export function parseKrakenTrade(raw: RawKrakenTrade): Trade {
  return { t: Date.parse(raw.timestamp), price: Number(raw.price), qty: Number(raw.qty), side: raw.side === 'buy' ? 1 : -1 };
}

/** REST rows are [price, volume, time(s), "b"|"s", ordertype, misc, trade_id]. */
type RestRow = [string, string, number, 'b' | 's', string, string, number];

export function parseKrakenRest(row: RestRow): Trade {
  return { t: Math.round(row[2] * 1000), price: Number(row[0]), qty: Number(row[1]), side: row[3] === 'b' ? 1 : -1 };
}

export class KrakenFeed implements Feed {
  readonly label: string;
  private socket: ReconnectingSocket | null = null;
  private lastId = -1;
  private stopped = false;

  /** `symbol` in Kraken v2 form, e.g. BTC/USD. */
  constructor(private readonly symbol: string) {
    this.label = `Kraken ${symbol.toUpperCase()}`;
  }

  start(h: FeedHandlers): void {
    const symbol = this.symbol.toUpperCase();
    let buffering = true;
    const buffer: [number, Trade][] = [];
    const deliver = (id: number, t: Trade) => {
      if (buffering) buffer.push([id, t]);
      else this.emit(id, t, h);
    };
    this.socket = new ReconnectingSocket(
      'wss://ws.kraken.com/v2',
      (data) => {
        const msg = JSON.parse(data) as { channel?: string; data?: RawKrakenTrade[] };
        if (msg.channel !== 'trade' || !msg.data) return;
        for (const raw of msg.data) deliver(raw.trade_id, parseKrakenTrade(raw));
      },
      h.onStatus,
      (ws) => ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: [symbol], snapshot: true } })),
    );
    this.socket.open();

    this.backfill(symbol)
      .catch((e: unknown) => {
        h.onStatus({ kind: 'error', message: `history unavailable (${String(e)}), streaming live only` });
        return [] as RestRow[];
      })
      .then((hist) => {
        if (this.stopped) return;
        h.onBackfill(hist.map(parseKrakenRest));
        if (hist.length) this.lastId = hist[hist.length - 1][6];
        buffering = false;
        for (const [id, t] of buffer) this.emit(id, t, h);
        buffer.length = 0;
        h.onStatus({ kind: 'live' });
      });
  }

  private emit(id: number, t: Trade, h: FeedHandlers): void {
    // The subscription snapshot overlaps the REST history; trade ids are increasing.
    if (id <= this.lastId) return;
    this.lastId = id;
    h.onTrade(t);
  }

  /** The last 1000 trades from REST (Kraken's pair name drops the slash: BTC/USD → BTCUSD). */
  private async backfill(symbol: string): Promise<RestRow[]> {
    const pair = symbol.replace('/', '');
    const res = await fetch(`https://api.kraken.com/0/public/Trades?pair=${pair}&count=1000`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { error: string[]; result: Record<string, RestRow[] | string> };
    if (body.error?.length) throw new Error(body.error.join(', '));
    const rows = Object.values(body.result).find((v): v is RestRow[] => Array.isArray(v)) ?? [];
    return rows.sort((a, b) => a[6] - b[6]);
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }
}
