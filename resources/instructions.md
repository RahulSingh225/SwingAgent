# Agent Task: Arpan Sengupta Trade Pattern Correlation

## Objective
Correlate Arpan Sengupta’s (profile_id: 1458f757) strongest profit/loss days and highest-impact instruments with underlying price action to extract tradable patterns for directional option buying and commodity trading.

## Available Data Assets
1. `/resources/Arpan Sengupta (Blu_Dragon) – Verified P&L Trades.xlsx`
   - All instrument-level aggregated trades (Symbol, Qty, Buy/Sell Avg & Value, Gross P&L, P&L %, Segment)
2. `/resources/Arpan_Analysis_Summary.xlsx`
   - Top F&O / Commodity profit & loss days
   - Top instruments by absolute P&L and by %
3. Daily segment PnL from `POST https://console.zerodha.com/api/verified/calculate` with body `{"profile_id":"1458f757"}`
   - Fields: trade_date, amount, buy_value, sell_value per segment (FO / EQ / COM)

## Constraints
- No exact trade-date ↔ symbol mapping exists.
- We only have:
  - Daily aggregated buy/sell/PnL per segment
  - Instrument-level lifetime aggregates (with expiry encoded in symbol)

## Required Operations

### Step 1 – Select Focus Windows
- Take the top 10 F&O profit days and top 6 F&O loss days.
- Take the top 6 Commodity profit days.
- Record the dates clearly.

### Step 2 – Instrument Shortlist
From the instrument Excel, extract:
- Top 12 instruments by absolute Gross P&L (winners)
- Top 8 instruments by P&L % (where |Gross P&L| > ₹2,000)
- Top 8 biggest absolute losers
- Note the underlying (Nifty, Sensex, Bankex, Crude Oil, individual stocks) and expiry month from the symbol.

### Step 3 – Price Action Context
For each selected high-PnL day:
- Pull daily (and 15-min / 5-min if available) OHLC + volume for the major underlyings that appear in the shortlist (Nifty, Bank Nifty / Bankex, Sensex, Crude Oil).
- Compute:
  - Gap % from previous close
  - Intraday range (High-Low)/Open
  - Close location in the day’s range
  - Prior 3–5 day trend / ATR expansion
  - Any obvious volatility expansion

### Step 4 – Correlation Logic
For each major profit day, ask:
- Was the underlying already in a clear directional move, or did the move start that day?
- Did range expand significantly vs recent ATR?
- Did the day favour option buyers (large directional move + rising realised vol)?
- Which of Arpan’s high-P&L instruments (by expiry) could realistically have been active?

Do the same for the largest loss days (look for trapped premium, IV crush, or wrong direction).

### Step 5 – Output Deliverables
Produce a markdown report containing:

1. **Filtered Pattern Hypotheses** (3–6 clear statements)
2. **Supporting Evidence** (specific dates + instruments + price behaviour)
3. **Risk Observations** (what characterised the big losing days)
4. **Actionable Rules** that a directional option buyer or commodity trader could test
5. Open questions / data gaps still remaining

## Success Criteria
- Patterns must be specific enough to be tested on new data.
- Distinguish between “move already underway” vs “anticipation” entries.
- Explicitly link findings back to Greeks (Delta capture vs Vega expansion vs Theta decay).