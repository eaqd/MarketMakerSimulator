export const THEME = {
  bg: '#0d1015',
  paneBg: '#0d1015',
  grid: 'rgba(255,255,255,0.045)',
  border: 'rgba(255,255,255,0.09)',
  text: '#c9d1d9',
  muted: '#7d8590',
  crosshair: 'rgba(201,209,217,0.45)',
  buy: [22, 199, 154] as const,
  sell: [242, 64, 88] as const,
  neutral: [110, 118, 129] as const,
  poc: '#f5d76e',
  vwap: '#58a6ff',
  vwapBand: 'rgba(88,166,255,0.35)',
  vwapBandFill: 'rgba(88,166,255,0.05)',
  avwap: '#d2a8ff',
  hvn: 'rgba(245,215,110,0.28)',
  lvn: 'rgba(125,133,144,0.4)',
  drawing: '#ffa657',
  cvd: '#58a6ff',
  eff: '#d2a8ff',
  font: '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontBold: 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

type RGB = readonly [number, number, number];

const mix = (a: RGB, b: RGB, t: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

/**
 * Continuous colour for a delta ratio in [-1, 1]: sell red ← grey → buy green.
 * A ratio of ±0.4 (70% of volume from one side) is already full colour.
 */
export function deltaColor(ratio: number): string {
  const x = Math.max(-1, Math.min(1, ratio / 0.4));
  return x >= 0 ? mix(THEME.neutral, THEME.buy, x) : mix(THEME.neutral, THEME.sell, -x);
}

export const rgba = (c: RGB, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
