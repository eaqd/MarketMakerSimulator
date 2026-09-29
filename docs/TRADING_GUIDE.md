# Trading with Flux Bars: the playbook

This guide explains how to trade with FluxChart: reading the bars, drawing
support and resistance, and turning that into entries, stops and targets.

> **Honest starting point.** No chart type predicts the market. A chart is a
> picture of what already happened. Flux Bars show *more* of what happened
> than candlesticks do, and they show it in a way that is easier to compare
> from bar to bar. Any edge comes from rules you test, not from the picture.
> Treat every setup below as a hypothesis to test on the simulator,
> then on history, then with paper trades, and only then with money.

---

## 1. Why this beats candles, bars, line and Heikin Ashi

| What you want to know | Line | OHLC bar / Candle | Heikin Ashi | **Flux Bar** |
|---|---|---|---|---|
| Open, high, low, close | close only | ✅ | ❌ averaged, not real prices | ✅ (side ticks + wick) |
| Where most trading happened inside the bar | ❌ | ❌ | ❌ | ✅ body = value area, gold tick = POC |
| Who was aggressive (buyers or sellers) | ❌ | ❌ (colour only means close > open) | ❌ | ✅ colour = delta ratio |
| How strong that aggression was | ❌ | ❌ | ❌ | ✅ colour saturation |
| Do bars carry equal information? | ❌ time-based | ❌ time-based | ❌ time-based | ✅ volume clock: each bar = same volume |
| Urgency (how fast the market is trading) | ❌ | ❌ | ❌ | ✅ Tempo pane |
| Exact prices for stops and entries | ✅ | ✅ | ❌ | ✅ |

The main idea: **a candle shows you the result. A Flux Bar shows you the
result, the cause (aggressive flow), and the acceptance (where volume
traded).** When cause and result disagree, you are looking at the most
useful information on the chart. That disagreement is *absorption*, the ◆
marker.

On a time clock, a quiet lunchtime bar and a news-spike bar are drawn the
same width and treated as equals. On the volume clock, every bar holds the same
volume: quiet periods compress into a few bars and busy periods expand
into many. Research going back to Clark (1973) and Ané & Geman (2000), and
popularised by López de Prado (2018), finds that returns measured on volume or
dollar bars are closer to well-behaved (less fat-tailed, less volatility
clustering) than time-bar returns. That makes
patterns and levels more consistent. In FluxChart you choose "Volume ≈ 5 min" and
the platform calibrates the volume per bar so bar counts feel familiar.

---

## 2. Anatomy: what to look at, in order

```
      │        ← wick: full high–low (little volume traded out here: rejection)
     ─┤        ← left tick: open
    ┌─┴─┐
    │███│      ← body: VALUE AREA (70% of the bar's volume traded here: acceptance)
    │▀▀▀│      ← gold tick: POC (the busiest single price)
    │███├─     ← right tick: close
    └─┬─┘
      │
   body colour: green = aggressive buyers, red = aggressive sellers, grey = balanced
```

Read every bar with three questions:

1. **Who pushed?** Colour. Saturated green or red means one side was in control.
2. **Where was it accepted?** Body position. A body sitting high in the wick range means
   trading was accepted at higher prices. A long wick with no body is a rejected
   probe.
3. **Did it work?** Close tick versus body. A close above the value area means the
   pushing side won the bar. A close back inside or on the other side means they
   were absorbed.

Special cases:

- **Colour and close disagree** (red body, close near the high): absorption.
  Someone passive soaked up the selling. The platform marks it with a green ◆ below the bar.
  The mirror case (green body, closes low) gets a red ◆ above.
- **Thin body, long wicks**: the bar traded mostly at one price and probed both
  sides. That is balance, so don't expect follow-through.
- **POC at the edge of the body**: volume piled up at an extreme. That extreme is
  where the next bar's fight will likely be.

---

## 3. The three-step process for every trade

### Step 1: Pick the playbook with **Efficiency**

| Efficiency (14 bars) | Market state | Playbook |
|---|---|---|
| **> 0.6** | Trending: price moving in a straight line | Trade *with* it on pullbacks (Setup B) |
| **0.3 – 0.6** | Transitioning | Only A+ setups, half size, or wait |
| **< 0.3** | Ranging: price going back and forth | *Fade* the edges (Setup A) and watch for breakouts (Setup C) |

Most losing trades come from using a range playbook in a trend or the
reverse. This one number helps prevent that.

### Step 2: Map the levels (support and resistance)

With candles, you draw support and resistance by eye through wicks and closes. With
Flux Bars, most levels are measured from volume, so they are objective:

| Level | Where it comes from | How it tends to behave |
|---|---|---|
| **Composite POC** (thick gold line) | Busiest price of everything on screen | Magnet: price returns to it in ranges |
| **VAH / VAL** (dashed gold) | Edges of where 70% of volume traded | Range edges: fade them in ranges, trade acceptance beyond them as breakouts |
| **HVN** (thin gold) | Volume peaks in the profile | Support and resistance: price slows and stalls there |
| **LVN** (dotted grey) | Volume valleys in the profile | Air pockets: price moves *through* them fast, so never place targets inside them |
| **VWAP** (blue) | Volume-weighted average price since the session started | Fair value: the trend is "up" while price holds above it |
| **±1σ / ±2σ bands** | Volume-weighted standard deviation around VWAP | ±1σ = normal pullback zone in trends. ±2σ = stretched: fade it in ranges |
| **Anchored VWAP** (⚓ tool) | VWAP from a bar you choose (a swing low, a news bar) | The average price of everyone who bought since that event. Holding above it means they are in profit and likely to defend it |

**Drawing your own lines with the — Level and ╱ Trend tools:**

- **Draw support and resistance at the edge of stacked bodies, not at wick extremes.** Wicks
  are rejected prices where little volume traded. Where several bodies line up at a
  similar level, that is where the market actually accepted price.
- **Draw trendlines through value-area edges or bar POCs, not through wicks.**
  In an uptrend, connect the *value area lows* of the pullback bars. This line
  moves less on single spikes and gives cleaner touches.
- **A level is broken when a bar's whole body forms beyond it**, not
  when a wick pokes through. A wick through the level followed by a body back
  inside is a failed break, which is often the best trade of the day (see Setup C, failure
  version).
- **Anchor a VWAP at the start of every major swing.** The level where two or more anchored
  VWAPs, an HVN and one of your lines meet is a high-quality zone.

### Step 3: Wait for the bar to confirm at the level

Price reaching a level is not a signal. Wait for one or more of these confirmations:

| Confirmation | Long at support | Short at resistance |
|---|---|---|
| **Absorption ◆** | Green ◆ (sellers absorbed) at or just through support | Red ◆ (buyers absorbed) at or just through resistance |
| **Delta flip** | Red bars into the level, then a green-bodied bar | Green bars into the level, then a red-bodied bar |
| **Close vs body** | Close tick above the value area | Close tick below the value area |
| **CVD divergence** | Price makes a lower low, CVD makes a higher low | Price makes a higher high, CVD makes a lower high |
| **Tempo spike then stall** | Fast bar (orange ≥ +1) into support that fails to go lower | Same at resistance |

Two confirmations are better than one. Absorption plus a delta flip at a
mapped level is the core pattern this chart was built to show.

---

## 4. Four concrete setups

Each setup has fixed rules so you can test it and keep a journal. "R" = the
distance from entry to stop, so a 2R target is twice as far as the stop.

### Setup A: Absorption reversal at the edge of a range

- **Context:** Efficiency < 0.4. Price at VAL, an HVN, VWAP −2σ, or one of your
  support lines (shorts: mirror everything).
- **Trigger:** a bar at the level prints a **green ◆** (sellers pushed but price
  closed up). The *next* bar closes above the ◆ bar's POC.
- **Entry:** on the close of that confirming bar.
- **Stop:** a little below the ◆ bar's low.
- **Targets:** T1 = VWAP or the composite POC (take half). T2 = the opposite
  value-area edge.
- **Cancel it** if a bar's whole body forms below the level (acceptance below means the support failed).

### Setup B: Trend pullback to value

- **Context:** Efficiency > 0.6. Price above VWAP. CVD making higher highs.
- **Wait:** for a pullback into VWAP / +1σ band / an HVN / your rising trendline.
  Pullback bars should look *weak*: grey or pale red, low tempo, meaning nobody is
  urgently selling.
- **Trigger:** a green-bodied bar with its close tick above its POC.
- **Entry:** close of the trigger bar.
- **Stop:** below the pullback low, or below VWAP −1σ if that's tighter and
  still beyond the structure.
- **Exit:** trail the stop to the *value area low* of each new completed bar,
  or target the prior high and then +2σ.
- **Warning sign:** saturated red bars with orange tempo during the pullback.
  That is real, urgent selling, not a pullback. Skip the trade.

### Setup C: Acceptance breakout, and its failure

- **Context:** a range with clear VAH/VAL (Efficiency was < 0.3).
- **Breakout:** a bar with tempo ≥ +1 and saturated colour *in the breakout
  direction* closes beyond VAH. The **next bar's whole body forms above
  VAH**, which means acceptance.
- **Entry:** on a retest of VAH from above, or on the close of the acceptance bar.
- **Stop:** back inside the range, below the breakout bar's POC.
- **Target:** the next HVN above. Price usually crosses LVNs quickly and stalls at HVNs.
- **Failure version (often the better trade):** the breakout bar is followed
  by a **red ◆** above VAH and the next body forms back inside the range.
  Buyers who broke out are now trapped. Short on the close back inside, stop above the
  breakout high, target the composite POC.

### Setup D: CVD divergence fade (lower confidence, only with confirmation)

- **Context:** price at ±2σ from VWAP, making a new high (or low).
- **Signal:** CVD fails to make the matching new high (or low).
- **Only act** when Setup A's trigger (◆ + confirming close) also appears.
  A divergence alone can last a long time.
- **Target:** VWAP. **Stop:** beyond the extreme.

---

## 5. Risk rules (the part that makes money, whatever the chart)

1. **Risk a fixed fraction per trade**, e.g. 0.5–1% of the account.
   Position size = (account × risk%) ÷ (entry − stop).
2. **Skip anything with a first target under 1.5R.** Levels on this chart
   give you a natural target, so use it to judge whether the trade is worth
   taking before you enter.
3. **Stops go beyond structure**: beyond the ◆ bar, the pullback low, or the
   value area. Never place them in the middle of a thin LVN, where price
   passes through quickly.
4. **Stop for the day after 3 losses in a row.**
5. **Don't trade the first bar after a tempo spike ≥ +2.** Something is
   happening (news, liquidations). Let the bars show you who won first.

---

## 6. Pre-trade checklist

```
[ ] Efficiency says:  TREND (>0.6)  /  RANGE (<0.3)  /  UNCLEAR → wait
[ ] Setup:            A / B / C / D, and does it match the regime?
[ ] Level:            which one(s)?  POC / VAH / VAL / HVN / VWAP band / AVWAP / my line
[ ] Confirmation:     ◆ absorption / delta flip / close vs body / CVD divergence / tempo stall
[ ] Entry  ______  Stop ______  T1 ______   → R:R ≥ 1.5 ?
[ ] Size = risk$ ÷ (entry − stop) = ______
[ ] Nothing ≥ +2 tempo in the last bar?
```

---

## 7. How to prove (or disprove) it for yourself

The only way to know whether this chart makes *you* more accurate is to measure it.

1. **Learn the visuals on the simulator** (Source → Simulator). The
   simulated market has hidden passive "walls" at round prices, trending and
   ranging regimes, and informed versus noise traders. Watch how ◆ absorption appears
   when price runs into a wall, and what happens when the wall breaks. (It's
   synthetic, so use it to train your eye, not to measure an edge.)
2. **Paper-trade live data** (Binance, Binance US or Coinbase, free, no account).
   For every trade, write down: setup letter, regime, level, confirmation, entry,
   stop, exit, and result in R.
3. **Load your own history** with the CSV button (`time,price,qty[,side]`) and
   step through it.
4. After **50+ trades per setup**, compute win rate and average R. A setup is
   worth keeping when *win rate × average win − loss rate × average loss > 0*
   after fees.
5. **Compare fairly**: switch Style to *Candles (compare)* and see whether you
   would have seen the same trades without the flow and volume information.

---

## 8. Limits you should know

- **Delta needs trade-by-trade data with the aggressor side.** Crypto exchanges
  give this away for free, which is why the built-in feeds are crypto. For stocks and
  futures you need a tick-data provider (usually paid). Spot forex has no
  central volume at all. The CSV importer accepts any tick data. If there's no
  side column it estimates one with the tick rule (uptick = buy), which is a
  known approximation.
- **Volume-clock bars depend on the venue.** One exchange's volume is not the whole
  market. Levels are still useful because large players trade where liquidity is,
  but treat single-venue flow as a sample.
- **Absorption is a clue, not a guarantee.** Walls get pulled and levels break,
  so every setup above has a stop.
