/** Aggressor side of a trade: +1 = buyer lifted the offer, -1 = seller hit the bid. */
export type Side = 1 | -1;

/** A single executed trade (the atomic unit everything is built from). */
export interface Trade {
  /** Exchange timestamp in milliseconds. */
  t: number;
  price: number;
  qty: number;
  side: Side;
}

/**
 * How bars are cut.
 * - `volume`: a bar closes after a fixed amount of traded volume (the "information clock").
 * - `time`:   a bar closes on a fixed wall-clock interval (what candlesticks use).
 */
export type ClockMode = 'volume' | 'time';

export interface ClockConfig {
  mode: ClockMode;
  /** Volume per bar (volume mode) or milliseconds per bar (time mode). */
  size: number;
}

/**
 * A Flux Bar. It is a strict superset of an OHLC candle: it keeps open, high,
 * low and close, and adds where volume traded inside the bar and who was aggressive.
 */
export interface FluxBar {
  index: number;
  startT: number;
  endT: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVol: number;
  sellVol: number;
  /** buyVol - sellVol */
  delta: number;
  trades: number;
  /** Σ price·qty and Σ price²·qty, used for VWAP and its standard deviation. */
  sumPV: number;
  sumP2V: number;
  /** Volume traded at each price bucket, keyed by bucket index (price = key * step). */
  profile: Map<number, number>;
  /** Point of control: the price with the most volume in this bar. */
  poc: number;
  /** Value area: the tightest price range around the POC holding `valueAreaPct` of volume. */
  vaLow: number;
  vaHigh: number;
  /** True while the bar is still forming. */
  forming: boolean;
}

export const barVwap = (b: FluxBar): number => (b.volume > 0 ? b.sumPV / b.volume : b.close);
export const barDeltaRatio = (b: FluxBar): number => (b.volume > 0 ? b.delta / b.volume : 0);
