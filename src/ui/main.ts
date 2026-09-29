import { Chart, type ChartSettings, type Drawing, type Tool } from '../chart/chart';
import { FluxBarBuilder, calibrateVolumeClock } from '../core/fluxbars';
import { autoStep } from '../core/profile';
import type { ClockConfig, Trade } from '../core/types';
import { parseTradesCsv } from '../data/csv';
import type { Feed, FeedStatus } from '../data/feed';
import { FEEDS } from '../data/registry';

const MAX_TRADES = 1_500_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`fluxchart:${key}`);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`fluxchart:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  },
};

class App {
  private chart = new Chart($<HTMLCanvasElement>('chart'));
  private feed: Feed | null = null;
  private trades: Trade[] = [];
  private builder: FluxBarBuilder | null = null;
  private step = 1;
  private decimals = 2;
  private sourceKey = '';
  private firstTradeTimer: ReturnType<typeof setTimeout> | null = null;

  private feedSel = $<HTMLSelectElement>('feed');
  private symbolIn = $<HTMLInputElement>('symbol');
  private clockSel = $<HTMLSelectElement>('clock');
  private styleSel = $<HTMLSelectElement>('style');
  private statusEl = $<HTMLSpanElement>('status');

  constructor() {
    for (const f of FEEDS) this.feedSel.add(new Option(f.label, f.id));
    const params = new URLSearchParams(location.hash.slice(1));
    const saved = store.get('source', { feed: 'binance', symbol: 'BTCUSDT', clock: 'v:300000' });
    this.feedSel.value = params.get('feed') ?? saved.feed;
    this.symbolIn.value = params.get('symbol') ?? saved.symbol;
    this.clockSel.value = params.get('clock') ?? saved.clock;
    this.fillSymbols();

    this.chart.settings = { ...this.chart.settings, ...store.get<Partial<ChartSettings>>('settings', {}) };
    this.styleSel.value = this.chart.settings.style;
    this.buildToggles();
    this.bindUi();
    this.load();
    // Keep the trade/bar counts in the status line fresh while streaming.
    setInterval(() => {
      if (this.feed && this.builder && this.lastStatus === 'live') this.setStatus({ kind: 'live' });
    }, 1000);
  }

  private lastStatus: FeedStatus['kind'] = 'closed';

  private fillSymbols(): void {
    const opt = FEEDS.find((f) => f.id === this.feedSel.value)!;
    const dl = $<HTMLDataListElement>('symbols');
    dl.innerHTML = '';
    for (const s of opt.symbols) dl.append(new Option(s));
    if (!opt.symbols.includes(this.symbolIn.value.toUpperCase())) this.symbolIn.value = opt.symbols[0];
  }

  private buildToggles(): void {
    const items: [keyof ChartSettings, string][] = [
      ['vwap', 'VWAP'],
      ['profile', 'Profile'],
      ['levels', 'Levels'],
      ['absorption', 'Absorption'],
      ['cvd', 'CVD'],
      ['tempo', 'Tempo'],
      ['eff', 'Efficiency'],
    ];
    const box = $('toggles');
    for (const [key, label] of items) {
      const l = document.createElement('label');
      l.className = 'toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(this.chart.settings[key]);
      cb.addEventListener('change', () => {
        (this.chart.settings[key] as boolean) = cb.checked;
        store.set('settings', this.chart.settings);
        this.chart.invalidate();
      });
      l.append(cb, label);
      box.append(l);
    }
  }

  private bindUi(): void {
    this.feedSel.addEventListener('change', () => {
      this.fillSymbols();
      this.load();
    });
    this.symbolIn.addEventListener('change', () => this.load());
    $('go').addEventListener('click', () => this.load());
    this.clockSel.addEventListener('change', () => {
      this.saveSource();
      this.rebuild();
    });
    this.styleSel.addEventListener('change', () => {
      this.chart.settings.style = this.styleSel.value as ChartSettings['style'];
      store.set('settings', this.chart.settings);
      this.chart.invalidate();
    });

    const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
    const setTool = (t: Tool) => {
      this.chart.setTool(t);
      for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === t);
    };
    for (const b of toolButtons) {
      b.addEventListener('click', () => setTool(b.classList.contains('active') ? 'none' : (b.dataset.tool as Tool)));
    }
    this.chart.onToolDone = () => setTool('none');
    this.chart.onDrawingsChange = (d) => store.set(`drawings:${this.sourceKey}`, d);
    $('clear').addEventListener('click', () => {
      if (this.chart.drawings.length && confirm('Remove all drawings on this chart?')) {
        this.chart.setDrawings([]);
        store.set(`drawings:${this.sourceKey}`, []);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const map: Record<string, Tool> = { h: 'hline', t: 'trend', a: 'avwap', e: 'erase', Escape: 'none' };
      if (map[e.key]) setTool(map[e.key]);
    });

    const guide = $<HTMLDialogElement>('guide');
    $('help').addEventListener('click', () => guide.showModal());

    $<HTMLInputElement>('csv').addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const trades = parseTradesCsv(await file.text());
        this.stopFeed();
        this.useSource(`csv:${file.name}`, `CSV ${file.name}`);
        this.trades = trades;
        this.rebuild();
        this.setStatus({ kind: 'live' }, `${trades.length.toLocaleString()} trades from ${file.name}`);
      } catch (err) {
        this.setStatus({ kind: 'error', message: String(err) });
      }
    });
  }

  private saveSource(): void {
    const src = { feed: this.feedSel.value, symbol: this.symbolIn.value.trim(), clock: this.clockSel.value };
    store.set('source', src);
    history.replaceState(null, '', `#${new URLSearchParams(src)}`);
  }

  private stopFeed(): void {
    this.feed?.stop();
    this.feed = null;
    if (this.firstTradeTimer) clearTimeout(this.firstTradeTimer);
  }

  private useSource(key: string, title: string): void {
    this.sourceKey = key;
    this.chart.title = title;
    this.chart.setDrawings(store.get<Drawing[]>(`drawings:${key}`, []));
  }

  private load(): void {
    this.stopFeed();
    this.saveSource();
    const opt = FEEDS.find((f) => f.id === this.feedSel.value)!;
    const symbol = this.symbolIn.value.trim().toUpperCase() || opt.symbols[0];
    this.trades = [];
    this.builder = null;
    this.chart.setData([], 1, 2);
    const feed = opt.create(symbol, { backfillPages: 20 });
    this.feed = feed;
    this.useSource(`${opt.id}:${symbol}`, feed.label);

    this.firstTradeTimer = setTimeout(() => {
      if (this.feed === feed && this.trades.length === 0) {
        this.setStatus(
          { kind: 'error', message: 'no trades yet' },
          'No data yet. This venue may be blocked where you are, or the symbol is wrong. Try another source.',
        );
      }
    }, 12_000);

    feed.start({
      onBackfill: (trades) => {
        if (this.feed !== feed) return;
        this.trades = trades;
        this.rebuild();
      },
      onTrade: (t) => {
        if (this.feed !== feed) return;
        this.trades.push(t);
        if (this.trades.length > MAX_TRADES) {
          this.trades = this.trades.slice(-Math.floor(MAX_TRADES * 0.8));
          this.rebuild();
          return;
        }
        if (!this.builder) {
          this.rebuild();
          return;
        }
        this.builder.push(t);
        this.builder.last();
        this.chart.setData(this.builder.bars, this.step, this.decimals);
      },
      onStatus: (s) => {
        if (this.feed === feed) this.setStatus(s);
      },
    });
  }

  private clock(): ClockConfig | null {
    const [mode, ms] = this.clockSel.value.split(':');
    const target = Number(ms);
    if (mode === 't') return { mode: 'time', size: target };
    // Volume clock: calibrate to the observed trading rate. Needs a little history first.
    const tr = this.trades;
    if (tr.length < 50 || tr[tr.length - 1].t - tr[0].t < 15_000) return null;
    const size = calibrateVolumeClock(tr, target);
    return size ? { mode: 'volume', size } : null;
  }

  /** Rebuild every bar from the stored trades (after a clock change or new history). */
  private rebuild(): void {
    if (this.trades.length === 0) {
      this.builder = null;
      this.chart.setData([], 1, 2);
      return;
    }
    const clock = this.clock();
    if (!clock) {
      this.builder = null;
      this.chart.setData([], 1, 2);
      this.setStatus({ kind: 'backfilling', loaded: this.trades.length }, `Collecting trades to calibrate the volume clock (${this.trades.length})…`);
      return;
    }
    this.step = autoStep(this.trades[this.trades.length - 1].price);
    const s = String(Number(this.step.toPrecision(6)));
    this.decimals = s.includes('.') ? s.split('.')[1].length : 0;
    this.builder = new FluxBarBuilder(clock, this.step);
    this.builder.pushAll(this.trades);
    this.builder.last();
    this.chart.setData(this.builder.bars, this.step, this.decimals);
    this.clockInfo = clock.mode === 'volume' ? `${fmtNum(clock.size)} per bar` : `${clock.size / 60000} min bars`;
    if (this.feed) this.setStatus({ kind: 'live' });
  }

  private clockInfo = '';

  private setStatus(s: FeedStatus, text?: string): void {
    const el = this.statusEl;
    el.className = 'status';
    this.lastStatus = text ? 'error' : s.kind;
    let msg = text;
    switch (s.kind) {
      case 'connecting':
        el.classList.add('busy');
        msg ??= 'connecting…';
        break;
      case 'backfilling':
        el.classList.add('busy');
        msg ??= `loading history: ${s.loaded.toLocaleString()} trades`;
        break;
      case 'live':
        el.classList.add('live');
        msg ??= `live · ${this.trades.length.toLocaleString()} trades · ${this.builder?.bars.length ?? 0} bars · ${this.clockInfo}`;
        break;
      case 'error':
        el.classList.add('error');
        msg ??= s.message;
        break;
      case 'closed':
        msg ??= 'stopped';
        break;
    }
    el.textContent = msg ?? '';
  }
}

function fmtNum(v: number): string {
  return v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Number(v.toPrecision(3)));
}

new App();
