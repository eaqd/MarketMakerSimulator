import type { Trade } from '../core/types';

export type FeedStatus =
  | { kind: 'connecting' }
  | { kind: 'backfilling'; loaded: number }
  | { kind: 'live' }
  | { kind: 'error'; message: string }
  | { kind: 'closed' };

export interface FeedHandlers {
  /** Historical trades, oldest first, delivered once before live data. */
  onBackfill(trades: Trade[]): void;
  onTrade(trade: Trade): void;
  onStatus(status: FeedStatus): void;
}

export interface Feed {
  readonly label: string;
  start(h: FeedHandlers): void;
  stop(): void;
}

export interface FeedOption {
  id: string;
  label: string;
  /** Example symbols shown in the UI. */
  symbols: string[];
  create(symbol: string, opts: { backfillPages: number }): Feed;
}

/**
 * Keep a WebSocket alive: reconnect with exponential backoff (1s → 30s) when it drops.
 */
export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly onMessage: (data: string) => void,
    private readonly onStatus: (s: FeedStatus) => void,
    private readonly onOpen?: (ws: WebSocket) => void,
  ) {}

  open(): void {
    if (this.stopped) return;
    this.onStatus({ kind: 'connecting' });
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onOpen?.(ws);
      this.onStatus({ kind: 'live' });
    };
    ws.onmessage = (ev) => this.onMessage(typeof ev.data === 'string' ? ev.data : '');
    ws.onerror = () => this.onStatus({ kind: 'error', message: `connection error (${new URL(this.url).host})` });
    ws.onclose = () => {
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
      this.onStatus({ kind: 'error', message: `disconnected, retrying in ${Math.round(delay / 1000)}s` });
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.onStatus({ kind: 'closed' });
  }
}
