import { barDeltaRatio, type FluxBar } from '../core/types';
import {
  absorption,
  anchoredVwap,
  compositeProfile,
  cvd,
  efficiency,
  tempo,
  type AbsorptionMark,
  type CompositeProfile,
  type VwapBands,
} from '../indicators';
import { THEME, deltaColor, rgba } from './theme';

export type Tool = 'none' | 'hline' | 'trend' | 'avwap' | 'erase';

export type Drawing =
  | { id: string; type: 'hline'; price: number }
  | { id: string; type: 'trend'; a: { t: number; p: number }; b: { t: number; p: number } }
  | { id: string; type: 'avwap'; t: number };

export interface ChartSettings {
  style: 'flux' | 'candle';
  vwap: boolean;
  profile: boolean;
  levels: boolean;
  absorption: boolean;
  cvd: boolean;
  tempo: boolean;
  eff: boolean;
}

interface Pane {
  id: 'main' | 'cvd' | 'tempo' | 'eff';
  top: number;
  h: number;
  min: number;
  max: number;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export class Chart {
  settings: ChartSettings = {
    style: 'flux',
    vwap: true,
    profile: true,
    levels: true,
    absorption: true,
    cvd: true,
    tempo: true,
    eff: true,
  };
  drawings: Drawing[] = [];
  onDrawingsChange: (d: Drawing[]) => void = () => {};
  onToolDone: () => void = () => {};
  title = '';

  private tool: Tool = 'none';
  private bars: readonly FluxBar[] = [];
  private decimals = 2;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private barW = 9;
  private offset = 4; // empty bars to the right of the latest one
  private yZoom = 1;
  private prevLen = 0;
  private panes: Pane[] = [];
  private plotW = 0;
  private profW = 0;
  private axisW = 64;
  private readonly timeH = 22;
  private mouse: { x: number; y: number } | null = null;
  private pending: { t: number; p: number } | null = null;
  private drag: { kind: 'pan' | 'axis'; x: number; y: number; offset: number; yZoom: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; barW: number } | null = null;
  private frame = 0;

  // Cached indicator results, recomputed only when data changes.
  private dataVersion = 0;
  private calcVersion = -1;
  private cvdVals: number[] = [];
  private tempoVals: number[] = [];
  private effVals: number[] = [];
  private marks: AbsorptionMark[] = [];
  private sessionAnchor = 0;
  private vwapBands: VwapBands | null = null;
  private avwaps = new Map<string, number[]>();
  private step = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.bindInput();
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.pending = null;
    this.canvas.style.cursor = t === 'none' ? 'default' : 'crosshair';
    this.invalidate();
  }

  /** Point the chart at a (possibly growing) bar array. */
  setData(bars: readonly FluxBar[], step: number, decimals: number): void {
    const grew = bars.length - this.prevLen;
    // If the user has scrolled back, keep their view still while new bars arrive.
    if (bars === this.bars && grew > 0 && this.offset > 6) this.offset += grew;
    if (bars !== this.bars) this.offset = Math.min(this.offset, 4);
    this.bars = bars;
    this.prevLen = bars.length;
    this.step = step;
    this.decimals = decimals;
    this.dataVersion++;
    this.invalidate();
  }

  resetView(): void {
    this.barW = 9;
    this.offset = 4;
    this.yZoom = 1;
    this.invalidate();
  }

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  // ---------------------------------------------------------------- geometry

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = Math.max(200, r.width);
    this.H = Math.max(200, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.invalidate();
  }

  private layout(): void {
    const narrow = this.W < 600;
    this.axisW = narrow ? 56 : 68;
    this.profW = this.settings.profile ? Math.round(Math.min(96, this.W * 0.14)) : 0;
    this.plotW = this.W - this.axisW - this.profW;
    const subs = (['cvd', 'tempo', 'eff'] as const).filter((k) => this.settings[k]);
    const avail = this.H - this.timeH;
    const subH = Math.round(Math.min(110, avail * (narrow ? 0.14 : 0.16)));
    const mainH = avail - subH * subs.length;
    const old = new Map(this.panes.map((p) => [p.id, p]));
    this.panes = [{ id: 'main', top: 0, h: mainH, min: old.get('main')?.min ?? 0, max: old.get('main')?.max ?? 1 }];
    let top = mainH;
    for (const s of subs) {
      this.panes.push({ id: s, top, h: subH, min: 0, max: 1 });
      top += subH;
    }
  }

  private last(): number {
    return this.bars.length - 1;
  }

  /** x of the centre of bar i (i may be fractional). */
  private xOf(i: number): number {
    return this.plotW - (this.last() - i + 0.5 + this.offset) * this.barW;
  }

  private iAt(x: number): number {
    return this.last() + 0.5 + this.offset - (this.plotW - x) / this.barW;
  }

  private yOf(p: Pane, v: number): number {
    const pad = 6;
    return p.top + pad + (1 - (v - p.min) / (p.max - p.min || 1)) * (p.h - 2 * pad);
  }

  private vAt(p: Pane, y: number): number {
    const pad = 6;
    return p.min + (1 - (y - p.top - pad) / (p.h - 2 * pad)) * (p.max - p.min);
  }

  private paneAt(y: number): Pane | undefined {
    return this.panes.find((p) => y >= p.top && y < p.top + p.h);
  }

  /** Fractional bar index for a timestamp (works for drawings saved in time coordinates). */
  private iOfTime(t: number): number {
    const b = this.bars;
    if (!b.length) return 0;
    if (t <= b[0].startT) return 0;
    const last = b[b.length - 1];
    if (t >= last.endT) {
      const avg = (last.endT - b[0].startT) / Math.max(1, b.length);
      return b.length - 1 + (t - last.endT) / Math.max(1, avg);
    }
    let lo = 0;
    let hi = b.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b[mid].startT <= t) lo = mid;
      else hi = mid - 1;
    }
    const bar = b[lo];
    const span = Math.max(1, bar.endT - bar.startT);
    return lo - 0.5 + Math.min(1, (t - bar.startT) / span);
  }

  private tOfIndex(i: number): number {
    const b = this.bars;
    if (!b.length) return Date.now();
    const k = Math.round(i);
    if (k < 0) return b[0].startT;
    if (k >= b.length) {
      const last = b[b.length - 1];
      const avg = (last.endT - b[0].startT) / Math.max(1, b.length);
      return last.endT + (i - (b.length - 1)) * avg;
    }
    const bar = b[k];
    return bar.startT + (bar.endT - bar.startT) * Math.min(1, Math.max(0, i - k + 0.5));
  }

  // ------------------------------------------------------------- indicators

  private compute(): void {
    if (this.calcVersion === this.dataVersion) return;
    this.calcVersion = this.dataVersion;
    const b = this.bars;
    this.cvdVals = cvd(b);
    this.tempoVals = tempo(b);
    this.effVals = efficiency(b);
    this.marks = absorption(b);
    // Session VWAP anchors at the first bar of the latest UTC day in the data.
    let anchor = 0;
    if (b.length) {
      const day = Math.floor(b[b.length - 1].endT / 86_400_000) * 86_400_000;
      for (let i = b.length - 1; i >= 0; i--) {
        if (b[i].startT < day) break;
        anchor = i;
      }
    }
    this.sessionAnchor = anchor;
    this.vwapBands = anchoredVwap(b, anchor);
    this.avwaps.clear();
    for (const d of this.drawings) {
      if (d.type === 'avwap') this.avwaps.set(d.id, anchoredVwap(b, Math.max(0, Math.round(this.iOfTime(d.t)))).vwap);
    }
  }

  // ----------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    this.layout();
    if (this.bars.length === 0) {
      ctx.fillStyle = THEME.muted;
      ctx.font = THEME.font;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for trades…', this.W / 2, this.H / 2);
      return;
    }
    this.compute();

    const from = Math.max(0, Math.floor(this.iAt(0)));
    const to = Math.min(this.last(), Math.ceil(this.iAt(this.plotW)));
    const profile =
      this.settings.profile || this.settings.levels ? compositeProfile(this.bars, from, to, this.step, 70) : null;
    this.scalePanes(from, to);

    for (const p of this.panes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, p.top, this.plotW, p.h);
      ctx.clip();
      this.drawGrid(p);
      if (p.id === 'main') this.drawMain(p, from, to, profile);
      else this.drawSub(p, from, to);
      ctx.restore();
      this.drawAxis(p);
      ctx.strokeStyle = THEME.border;
      ctx.beginPath();
      ctx.moveTo(0, p.top + p.h + 0.5);
      ctx.lineTo(this.W, p.top + p.h + 0.5);
      ctx.stroke();
    }
    const main = this.panes[0];
    if (profile && this.settings.profile) this.drawProfile(main, profile);
    this.drawTimeAxis(from, to);
    this.drawCrosshair();
    this.drawLegends();
  }

  private scalePanes(from: number, to: number): void {
    for (const p of this.panes) {
      let lo = Infinity;
      let hi = -Infinity;
      const take = (v: number) => {
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      };
      for (let i = from; i <= to; i++) {
        const b = this.bars[i];
        if (p.id === 'main') {
          take(b.low);
          take(b.high);
        } else if (p.id === 'cvd') take(this.cvdVals[i]);
        else if (p.id === 'tempo') {
          take(this.tempoVals[i]);
          take(-this.tempoVals[i]);
        }
      }
      if (p.id === 'eff') {
        lo = 0;
        hi = 1;
      }
      if (p.id === 'tempo') {
        hi = Math.max(1.5, Math.min(4, hi));
        lo = -hi;
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      if (hi === lo) {
        hi += 1;
        lo -= 1;
      }
      const pad = (hi - lo) * (p.id === 'main' ? 0.06 : 0.08);
      const mid = (hi + lo) / 2;
      const half = ((hi - lo) / 2 + pad) * (p.id === 'main' ? this.yZoom : 1);
      p.min = mid - half;
      p.max = mid + half;
    }
  }

  private niceTicks(min: number, max: number, count: number): number[] {
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  }

  private drawGrid(p: Pane): void {
    const ctx = this.ctx;
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of this.niceTicks(p.min, p.max, Math.max(2, Math.floor(p.h / 60)))) {
      const y = Math.round(this.yOf(p, v)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotW, y);
    }
    ctx.stroke();
  }

  private fmt(v: number, pane: Pane['id']): string {
    if (pane === 'main') return v.toFixed(this.decimals);
    if (pane === 'eff') return v.toFixed(2);
    if (pane === 'tempo') return (v >= 0 ? '+' : '') + v.toFixed(1);
    const a = Math.abs(v);
    return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(a < 10 ? 2 : 0);
  }

  private drawAxis(p: Pane): void {
    const ctx = this.ctx;
    const x0 = this.W - this.axisW;
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(x0, p.top, this.axisW, p.h);
    ctx.strokeStyle = THEME.border;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, p.top);
    ctx.lineTo(x0 + 0.5, p.top + p.h);
    ctx.stroke();
    ctx.font = THEME.font;
    ctx.fillStyle = THEME.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lastY = p.id === 'main' ? this.yOf(p, this.bars[this.last()].close) : NaN;
    for (const v of this.niceTicks(p.min, p.max, Math.max(2, Math.floor(p.h / 60)))) {
      const y = this.yOf(p, v);
      if (y < p.top + 8 || y > p.top + p.h - 8 || Math.abs(y - lastY) < 14) continue;
      ctx.fillText(this.fmt(v, p.id), x0 + 6, y);
    }
    if (p.id === 'main') {
      const lastBar = this.bars[this.last()];
      this.axisTag(p, lastBar.close, deltaColor(barDeltaRatio(lastBar)));
    }
  }

  private axisTag(p: Pane, v: number, color: string): void {
    const ctx = this.ctx;
    const y = Math.max(p.top + 8, Math.min(p.top + p.h - 8, this.yOf(p, v)));
    const x0 = this.W - this.axisW;
    ctx.fillStyle = color;
    ctx.fillRect(x0 + 1, y - 8, this.axisW - 1, 16);
    ctx.fillStyle = '#0d1015';
    ctx.font = THEME.fontBold;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.fmt(v, p.id), x0 + 5, y);
  }

  private line(p: Pane, vals: readonly number[], from: number, to: number, color: string, width = 1.4, dash: number[] = []): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (let i = from; i <= to; i++) {
      const v = vals[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const x = this.xOf(i);
      const y = this.yOf(p, v);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private hLevel(p: Pane, v: number, color: string, dash: number[], width = 1): void {
    const ctx = this.ctx;
    const y = Math.round(this.yOf(p, v)) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawMain(p: Pane, from: number, to: number, profile: CompositeProfile | null): void {
    const ctx = this.ctx;
    const s = this.settings;

    if (profile && s.levels) {
      for (const v of profile.hvn) this.hLevel(p, v, THEME.hvn, [], 1);
      for (const v of profile.lvn) this.hLevel(p, v, THEME.lvn, [2, 4], 1);
      this.hLevel(p, profile.vaHigh, 'rgba(245,215,110,0.45)', [6, 4]);
      this.hLevel(p, profile.vaLow, 'rgba(245,215,110,0.45)', [6, 4]);
      this.hLevel(p, profile.poc, 'rgba(245,215,110,0.8)', [], 1.2);
    }

    if (s.vwap && this.vwapBands) {
      const vb = this.vwapBands;
      // Shade between the ±1σ bands.
      ctx.fillStyle = THEME.vwapBandFill;
      ctx.beginPath();
      let started = false;
      const lo = Math.max(from, this.sessionAnchor);
      for (let i = lo; i <= to; i++) {
        const x = this.xOf(i);
        const y = this.yOf(p, vb.up1[i]);
        if (started) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        started = true;
      }
      for (let i = to; i >= lo; i--) ctx.lineTo(this.xOf(i), this.yOf(p, vb.dn1[i]));
      ctx.closePath();
      if (started) ctx.fill();
      this.line(p, vb.up2, from, to, THEME.vwapBand, 1, [3, 3]);
      this.line(p, vb.dn2, from, to, THEME.vwapBand, 1, [3, 3]);
      this.line(p, vb.up1, from, to, THEME.vwapBand, 1);
      this.line(p, vb.dn1, from, to, THEME.vwapBand, 1);
      this.line(p, vb.vwap, from, to, THEME.vwap, 1.6);
    }

    for (const [, vals] of this.avwaps) this.line(p, vals, from, to, THEME.avwap, 1.4);

    const w = this.barW;
    const bodyW = Math.max(1, Math.min(w * 0.72, w - 1.5));
    for (let i = from; i <= to; i++) {
      const b = this.bars[i];
      const x = Math.round(this.xOf(i)) + 0.5;
      if (s.style === 'candle') this.drawCandle(p, b, x, bodyW);
      else this.drawFlux(p, b, x, bodyW);
    }

    if (s.absorption && s.style === 'flux') {
      for (const m of this.marks) {
        if (m.index < from || m.index > to) continue;
        const b = this.bars[m.index];
        const x = this.xOf(m.index);
        const y = m.dir === 1 ? this.yOf(p, b.low) + 9 : this.yOf(p, b.high) - 9;
        const r = Math.max(2.5, Math.min(5, w * 0.35));
        ctx.fillStyle = m.dir === 1 ? rgba(THEME.buy, 0.95) : rgba(THEME.sell, 0.95);
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    this.drawDrawings(p);
  }

  /**
   * A Flux Bar:
   *   thin wick  = full high–low range
   *   body       = value area (where 70% of the bar's volume traded)
   *   body colour= delta ratio (who was aggressive, and how one-sided)
   *   gold tick  = point of control (the single busiest price)
   *   left tick  = open, right tick = close (so nothing from OHLC is lost)
   */
  private drawFlux(p: Pane, b: FluxBar, x: number, bodyW: number): void {
    const ctx = this.ctx;
    const color = deltaColor(barDeltaRatio(b));
    const yH = this.yOf(p, b.high);
    const yL = this.yOf(p, b.low);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yH);
    ctx.lineTo(x, yL);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (bodyW < 3) return;

    const yVH = this.yOf(p, b.vaHigh);
    const yVL = this.yOf(p, b.vaLow);
    const half = bodyW / 2;
    ctx.fillStyle = color;
    ctx.fillRect(x - half, yVH, bodyW, Math.max(1.5, yVL - yVH));

    const tick = Math.max(2, half * 0.9);
    ctx.lineWidth = Math.max(1, Math.min(2, bodyW / 6));
    ctx.strokeStyle = THEME.text;
    const yO = this.yOf(p, b.open);
    const yC = this.yOf(p, b.close);
    ctx.beginPath();
    ctx.moveTo(x - half - tick, yO);
    ctx.lineTo(x - half, yO);
    ctx.moveTo(x + half, yC);
    ctx.lineTo(x + half + tick, yC);
    ctx.stroke();

    const yP = Math.round(this.yOf(p, b.poc)) + 0.5;
    ctx.strokeStyle = THEME.poc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - half, yP);
    ctx.lineTo(x + half, yP);
    ctx.stroke();
    if (b.forming) {
      ctx.strokeStyle = THEME.muted;
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.strokeRect(x - half - 1.5, yH - 1.5, bodyW + 3, yL - yH + 3);
      ctx.setLineDash([]);
    }
  }

  private drawCandle(p: Pane, b: FluxBar, x: number, bodyW: number): void {
    const ctx = this.ctx;
    const up = b.close >= b.open;
    const color = up ? rgba(THEME.buy, 1) : rgba(THEME.sell, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, this.yOf(p, b.high));
    ctx.lineTo(x, this.yOf(p, b.low));
    ctx.stroke();
    const y1 = this.yOf(p, Math.max(b.open, b.close));
    const y2 = this.yOf(p, Math.min(b.open, b.close));
    ctx.fillStyle = color;
    ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1));
  }

  private drawSub(p: Pane, from: number, to: number): void {
    const ctx = this.ctx;
    if (p.id === 'cvd') {
      this.hLevel(p, this.cvdVals[Math.max(from, this.sessionAnchor)] ?? 0, 'rgba(255,255,255,0.08)', [4, 4]);
      this.line(p, this.cvdVals, from, to, THEME.cvd, 1.5);
    } else if (p.id === 'eff') {
      ctx.fillStyle = 'rgba(210,168,255,0.06)';
      const y6 = this.yOf(p, 0.6);
      ctx.fillRect(0, p.top, this.plotW, y6 - p.top);
      this.hLevel(p, 0.6, 'rgba(210,168,255,0.35)', [4, 4]);
      this.hLevel(p, 0.3, 'rgba(255,255,255,0.12)', [4, 4]);
      this.line(p, this.effVals, from, to, THEME.eff, 1.5);
    } else if (p.id === 'tempo') {
      const y0 = this.yOf(p, 0);
      this.hLevel(p, 1, 'rgba(255,166,87,0.3)', [4, 4]);
      const w = Math.max(1, this.barW * 0.7);
      for (let i = from; i <= to; i++) {
        const v = this.tempoVals[i];
        if (!Number.isFinite(v)) continue;
        const y = this.yOf(p, v);
        ctx.fillStyle = v >= 1 ? 'rgba(255,166,87,0.95)' : v >= 0 ? 'rgba(255,166,87,0.45)' : 'rgba(125,133,144,0.45)';
        ctx.fillRect(this.xOf(i) - w / 2, Math.min(y, y0), w, Math.max(1, Math.abs(y - y0)));
      }
    }
  }

  private drawProfile(p: Pane, prof: CompositeProfile): void {
    const ctx = this.ctx;
    const x0 = this.plotW;
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(x0, p.top, this.profW, p.h);
    const rowH = Math.max(1, Math.abs(this.yOf(p, 0) - this.yOf(p, prof.rowStep)) - 1);
    for (const r of prof.rows) {
      const y = this.yOf(p, r.price);
      if (y < p.top - rowH || y > p.top + p.h + rowH) continue;
      const w = (r.vol / prof.maxVol) * (this.profW - 6);
      const inVA = r.price >= prof.vaLow - 1e-9 && r.price <= prof.vaHigh + 1e-9;
      ctx.fillStyle = r.price === prof.poc ? THEME.poc : inVA ? 'rgba(88,166,255,0.55)' : 'rgba(125,133,144,0.4)';
      ctx.fillRect(x0 + 2, y - rowH / 2, w, rowH);
    }
    ctx.strokeStyle = THEME.border;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, p.top);
    ctx.lineTo(x0 + 0.5, p.top + p.h);
    ctx.stroke();
  }

  private drawTimeAxis(from: number, to: number): void {
    const ctx = this.ctx;
    const y0 = this.H - this.timeH;
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, y0, this.W, this.timeH);
    ctx.font = THEME.font;
    ctx.fillStyle = THEME.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const every = Math.max(1, Math.ceil(90 / this.barW));
    const start = Math.ceil(from / every) * every;
    for (let i = start; i <= to; i += every) {
      const x = this.xOf(i);
      if (x < 20 || x > this.plotW - 20) continue;
      ctx.fillText(this.timeLabel(this.bars[i].endT), x, y0 + this.timeH / 2);
    }
  }

  private timeLabel(t: number): string {
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private drawDrawings(p: Pane): void {
    const ctx = this.ctx;
    ctx.strokeStyle = THEME.drawing;
    ctx.fillStyle = THEME.drawing;
    ctx.lineWidth = 1.5;
    for (const d of this.drawings) {
      if (d.type === 'hline') {
        this.hLevel(p, d.price, THEME.drawing, [], 1.5);
        ctx.font = THEME.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = THEME.drawing;
        ctx.fillText(d.price.toFixed(this.decimals), 4, this.yOf(p, d.price) - 2);
      } else if (d.type === 'trend') {
        this.ray(p, d.a, d.b);
      } else if (d.type === 'avwap') {
        const x = this.xOf(this.iOfTime(d.t));
        ctx.fillStyle = THEME.avwap;
        ctx.beginPath();
        ctx.moveTo(x, p.top + p.h - 2);
        ctx.lineTo(x - 5, p.top + p.h - 10);
        ctx.lineTo(x + 5, p.top + p.h - 10);
        ctx.fill();
      }
    }
    if (this.pending && this.mouse && this.tool === 'trend') {
      const i = this.iAt(this.mouse.x);
      this.ray(p, this.pending, { t: this.tOfIndex(i), p: this.vAt(p, this.mouse.y) });
    }
  }

  /** Trend line from a through b, extended to the right edge. */
  private ray(p: Pane, a: { t: number; p: number }, b: { t: number; p: number }): void {
    const ctx = this.ctx;
    const x1 = this.xOf(this.iOfTime(a.t));
    const y1 = this.yOf(p, a.p);
    const x2 = this.xOf(this.iOfTime(b.t));
    const y2 = this.yOf(p, b.p);
    let xe = x2;
    let ye = y2;
    if (Math.abs(x2 - x1) > 0.5) {
      xe = this.plotW;
      ye = y1 + ((y2 - y1) * (xe - x1)) / (x2 - x1);
    }
    ctx.strokeStyle = THEME.drawing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(xe, ye);
    ctx.stroke();
    ctx.fillStyle = THEME.drawing;
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private hoverIndex(): number {
    if (!this.mouse || this.mouse.x > this.plotW) return this.last();
    return Math.max(0, Math.min(this.last(), Math.round(this.iAt(this.mouse.x))));
  }

  private drawCrosshair(): void {
    const m = this.mouse;
    if (!m || m.y > this.H - this.timeH) return;
    const ctx = this.ctx;
    const pane = this.paneAt(m.y);
    if (!pane) return;
    const i = this.hoverIndex();
    const x = m.x <= this.plotW ? Math.round(this.xOf(i)) + 0.5 : m.x;
    ctx.strokeStyle = THEME.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (m.x <= this.plotW) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.H - this.timeH);
    }
    ctx.moveTo(0, m.y + 0.5);
    ctx.lineTo(this.plotW + this.profW, m.y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    this.axisTag(pane, this.vAt(pane, m.y), '#c9d1d9');
    if (m.x <= this.plotW) {
      const label = this.timeLabel(this.bars[i].endT);
      ctx.font = THEME.font;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#c9d1d9';
      ctx.fillRect(x - tw / 2, this.H - this.timeH, tw, this.timeH);
      ctx.fillStyle = '#0d1015';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, this.H - this.timeH / 2);
    }
  }

  private drawLegends(): void {
    const ctx = this.ctx;
    const i = this.hoverIndex();
    const b = this.bars[i];
    const main = this.panes[0];
    ctx.font = THEME.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const dr = barDeltaRatio(b);
    const dur = (b.endT - b.startT) / 1000;
    const f = (v: number) => v.toFixed(this.decimals);
    const narrow = this.W < 600;
    const rows: [string, string][][] = [
      [[this.title, THEME.text]],
      [
        [`O ${f(b.open)}  H ${f(b.high)}  L ${f(b.low)}  C ${f(b.close)}`, THEME.text],
      ],
      [
        [`Δ ${this.fmt(b.delta, 'cvd')} (${(dr * 100).toFixed(0)}%)`, deltaColor(dr)],
        [`  POC ${f(b.poc)}  VA ${f(b.vaLow)}–${f(b.vaHigh)}`, THEME.poc],
      ],
      [[`Vol ${this.fmt(b.volume, 'cvd')}  ${b.trades} trades  ${dur < 90 ? dur.toFixed(1) + 's' : (dur / 60).toFixed(1) + 'm'}`, THEME.muted]],
    ];
    if (narrow) rows[2] = [rows[2][0]];
    let y = main.top + 6;
    for (const row of rows) {
      let x = 8;
      const width = row.reduce((w, [t]) => w + ctx.measureText(t).width, 0);
      ctx.fillStyle = 'rgba(13,16,21,0.7)';
      ctx.fillRect(x - 3, y - 2, width + 6, 15);
      for (const [text, color] of row) {
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        x += ctx.measureText(text).width;
      }
      y += 15;
    }
    const labels: Record<string, [string, number | undefined, string]> = {
      cvd: ['CVD', this.cvdVals[i], THEME.cvd],
      tempo: ['Tempo (log₂ speed vs median)', this.tempoVals[i], '#ffa657'],
      eff: ['Efficiency (trend 1 · range 0)', this.effVals[i], THEME.eff],
    };
    for (const p of this.panes.slice(1)) {
      const [name, v, color] = labels[p.id];
      ctx.fillStyle = color;
      ctx.fillText(`${name}  ${v === undefined || !Number.isFinite(v) ? '–' : this.fmt(v, p.id)}`, 8, p.top + 5);
    }
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pos = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      const m = pos(e);
      this.pointers.set(e.pointerId, m);
      c.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), barW: this.barW };
        this.drag = null;
        return;
      }
      this.mouse = m;
      if (this.tool !== 'none' && m.x < this.plotW && m.y < this.H - this.timeH) {
        this.applyTool(m);
        return;
      }
      this.drag = {
        kind: m.x > this.W - this.axisW ? 'axis' : 'pan',
        x: m.x,
        y: m.y,
        offset: this.offset,
        yZoom: this.yZoom,
      };
    });
    c.addEventListener('pointermove', (e) => {
      const m = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, m);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomTo(this.pinch.barW * (d / Math.max(1, this.pinch.dist)), (a.x + b.x) / 2);
        return;
      }
      this.mouse = m;
      if (this.drag?.kind === 'pan') {
        this.offset = Math.max(-this.plotW / this.barW + 5, this.drag.offset + (m.x - this.drag.x) / this.barW);
      } else if (this.drag?.kind === 'axis') {
        this.yZoom = Math.max(0.1, Math.min(20, this.drag.yZoom * Math.exp((m.y - this.drag.y) * 0.006)));
      }
      this.invalidate();
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      if (e.pointerType !== 'mouse') this.mouse = null;
      this.invalidate();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.mouse = null;
        this.invalidate();
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const m = pos(e);
        if (m.x > this.W - this.axisW) {
          this.yZoom = Math.max(0.1, Math.min(20, this.yZoom * Math.exp(e.deltaY * 0.001)));
          this.invalidate();
          return;
        }
        this.zoomTo(this.barW * Math.exp(-e.deltaY * 0.0015), m.x);
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => this.resetView());
  }

  private zoomTo(barW: number, anchorX: number): void {
    const i = this.iAt(anchorX);
    this.barW = Math.max(1.5, Math.min(60, barW));
    this.offset = i - this.last() - 0.5 + (this.plotW - anchorX) / this.barW;
    this.invalidate();
  }

  private applyTool(m: { x: number; y: number }): void {
    const main = this.panes[0];
    if (m.y >= main.top + main.h) return;
    const price = this.vAt(main, m.y);
    const t = this.tOfIndex(this.iAt(m.x));
    if (this.tool === 'hline') {
      this.drawings.push({ id: newId(), type: 'hline', price: Number(price.toFixed(this.decimals)) });
      this.finishTool();
    } else if (this.tool === 'avwap') {
      const i = Math.max(0, Math.min(this.last(), Math.round(this.iAt(m.x))));
      this.drawings.push({ id: newId(), type: 'avwap', t: this.bars[i].startT });
      this.finishTool();
    } else if (this.tool === 'trend') {
      if (!this.pending) {
        this.pending = { t, p: price };
        this.invalidate();
      } else {
        this.drawings.push({ id: newId(), type: 'trend', a: this.pending, b: { t, p: price } });
        this.finishTool();
      }
    } else if (this.tool === 'erase') {
      const hit = this.hitTest(m);
      if (hit) {
        this.drawings = this.drawings.filter((d) => d !== hit);
        this.finishTool();
      }
    }
  }

  private finishTool(): void {
    this.pending = null;
    this.dataVersion++;
    this.onDrawingsChange(this.drawings);
    this.setTool('none');
    this.onToolDone();
  }

  private hitTest(m: { x: number; y: number }): Drawing | undefined {
    const main = this.panes[0];
    let best: Drawing | undefined;
    let bestD = 8;
    for (const d of this.drawings) {
      let dist = Infinity;
      if (d.type === 'hline') dist = Math.abs(this.yOf(main, d.price) - m.y);
      else if (d.type === 'avwap') dist = Math.abs(this.xOf(this.iOfTime(d.t)) - m.x);
      else {
        const x1 = this.xOf(this.iOfTime(d.a.t));
        const y1 = this.yOf(main, d.a.p);
        const x2 = this.xOf(this.iOfTime(d.b.t));
        const y2 = this.yOf(main, d.b.p);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, ((m.x - x1) * dx + (m.y - y1) * dy) / len2);
        dist = Math.hypot(x1 + u * dx - m.x, y1 + u * dy - m.y);
      }
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  setDrawings(d: Drawing[]): void {
    this.drawings = d;
    this.dataVersion++;
    this.invalidate();
  }
}
