# FluxChart

A standalone trading-chart platform built around **Flux Bars**, a chart type
that carries strictly more information than candlesticks, OHLC bars, line
charts or Heikin Ashi, with a small set of indicators designed to go with it.
It streams free live market data and includes a market-maker simulator for
offline practice.

**How to trade it:** [docs/TRADING_GUIDE.md](docs/TRADING_GUIDE.md)

## The Flux Bar

| Element | Meaning |
|---|---|
| Thin wick | High–low range (same as a candle) |
| Left / right tick | Open / close (same as an OHLC bar, so nothing is lost) |
| **Body** | **Value area**: the price zone where 70% of the bar's volume traded |
| **Gold tick** | **Point of control**: the busiest price in the bar |
| **Colour** | **Delta ratio** = (aggressive buys − aggressive sells) ÷ volume, on a continuous red ↔ grey ↔ green scale |
| ◆ marker | **Absorption**: aggressive flow went one way, price closed the other way |
| **Clock** | Bars close on equal **volume** (default, auto-calibrated to ≈ 1/5/15/60 min) or on time (for comparison with candles) |

The *Style → Candles (compare)* switch draws the same data as ordinary candles,
so you can compare the two side by side.

## Indicators

Each indicator uses information that only this chart has (volume at price, trade side, volume clock).

- **VWAP ± 1σ / 2σ**: session-anchored, with exact volume-weighted bands computed from every trade.
- **Anchored VWAP**: from any bar you click (⚓ tool).
- **Composite profile**: volume at price for the visible bars, with POC, value area, and the strongest high- and low-volume nodes drawn as levels.
- **CVD**: cumulative volume delta.
- **Tempo**: log₂ of how much faster than usual each bar filled (urgency).
- **Efficiency**: Kaufman efficiency ratio. It tells you whether the market is trending or ranging.

## Data (all free, no account or API key)

| Source | Notes |
|---|---|
| Binance | `aggTrade` WebSocket and REST history. Aggressor side comes from the `m` flag. |
| Binance US | Same API, for regions where binance.com is blocked |
| Coinbase | `matches` WebSocket and REST history. Aggressor side is derived from the maker side. |
| Simulator | Offline, agent-based market (market maker, informed and noise traders, regime switches, passive walls) |
| CSV import | Any tick data: `time,price,qty[,side]`. A missing side is inferred with the tick rule. |

The app loads recent trade history, then streams live. It reconnects automatically,
and the status line shows what's happening.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ — host it anywhere (GitHub Pages, Vercel, Netlify…)
npm test           # unit tests for the bar builder, indicators and data parsers
```

Controls: drag to pan, scroll or pinch to zoom, drag or scroll the price axis to
stretch it, double-click to reset. Keyboard shortcuts: `h` level, `t` trendline, `a` anchored
VWAP, `e` erase, `Esc` cancel. Drawings and settings are saved in your browser
for each symbol. The URL hash stores the source, symbol and clock, so you can bookmark a chart.

## Layout

```
src/core/        Trade & FluxBar types, bar builder (volume/time clocks), value-area math
src/indicators/  CVD, anchored VWAP bands, efficiency, tempo, absorption, composite profile
src/data/        Binance / Coinbase / simulator feeds, CSV import, reconnecting socket
src/chart/       Canvas renderer, panes, drawing tools, pan/zoom/pinch
src/ui/          App shell and styles
docs/            Trading guide
```

There are no runtime dependencies: the app is TypeScript, Canvas 2D and Vite.

## Disclaimer

This is a charting and research tool, not financial advice. No chart predicts
prices. Test any strategy on the simulator, on history, and with paper trades
before you risk money.
