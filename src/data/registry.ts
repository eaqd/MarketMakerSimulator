import { BinanceFeed } from './binance';
import { CoinbaseFeed } from './coinbase';
import type { FeedOption } from './feed';
import { SimFeed } from './simulator';

/** Every data source the platform can use. All of them are free and need no account. */
export const FEEDS: FeedOption[] = [
  {
    id: 'binance',
    label: 'Binance (live)',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'],
    create: (s, o) =>
      new BinanceFeed(s, { rest: 'https://api.binance.com', ws: 'wss://stream.binance.com:9443' }, o.backfillPages, 'Binance'),
  },
  {
    id: 'binanceus',
    label: 'Binance US (live)',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    create: (s, o) =>
      new BinanceFeed(s, { rest: 'https://api.binance.us', ws: 'wss://stream.binance.us:9443' }, o.backfillPages, 'Binance US'),
  },
  {
    id: 'coinbase',
    label: 'Coinbase (live)',
    symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
    create: (s, o) => new CoinbaseFeed(s, o.backfillPages),
  },
  {
    id: 'sim',
    label: 'Simulator (offline)',
    symbols: ['SIM'],
    create: () => new SimFeed(720, 5),
  },
];
