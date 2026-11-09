# Novi FX — Phase 1

Forex, Gold සහ Crypto analyze කරලා **entry signals** දෙන, **backtest** කරන, **demo (paper) trading** කරන්න පුළුවන් system එක.

## තියෙන දේවල්
- **Chart:** candles, volume, EMA 20/50/200, Bollinger, RSI, timeframes 5m–1d
- **Watchlist + Scanner:** symbols 10ම එක click එකෙන් scan කරලා BUY/SELL/WAIT
- **Signal engine:** trend, momentum (MACD), RSI, EMA pullback, support/resistance → score එකක් → Entry, Stop Loss, TP1, TP2 සහ හේතු සිංහලෙන්
- **Multi-timeframe:** 15m / 1h / 4h එකට බලනවා
- **AI analysis:** Claude එකෙන් සිංහලෙන් පැහැදිලි කිරීම (ANTHROPIC_API_KEY ඕන)
- **Backtest:** පරණ candles 1000 උඩ strategy එක test කරලා win rate, profit factor, drawdown
- **Paper trading:** $10,000 demo account, SL/TP auto close, history, lot size calculator (risk % අනුව)

## Markets සහ data
| Market | Live prices (WebSocket) | Chart history (candles) |
|---|---|---|
| BTC, ETH, SOL | Binance — key ඕන නැහැ | Binance |
| XAUUSD + Forex pairs 6 | Finnhub — free key (`FINNHUB_API_KEY`) | Twelve Data — free key |

- Live මිල තත්පරයෙන් තත්පරයට chart එකේ අන්තිම candle එක, watchlist එක, P&L සහ signal status update කරනවා.
- Watchlist එකේ කොළ පාට තිත (●) = LIVE. අළු පාට = delayed (විනාඩියකට සැරයක්).
- Node.js **22 හෝ අලුත්** ඕන (built-in WebSocket).

## Strategies (research කරලා තෝරපු)
ඇත්ත tick data (Gold 2014–2018, EURUSD 2017–2021) උඩ strategies 4ක් + settings 550+ ක් spread costs එක්ක, walk-forward ක්‍රමයට test කළා (`research/` folder එක).

| Symbol / TF | Strategy | Research result | Status |
|---|---|---|---|
| XAUUSD 1h | Trend Pullback | 91 trades · PF 1.3 · අවුරුදු 5/5 ලාභ | ✅ Verified |
| XAUUSD 4h | Trend Breakout (55, London/NY) | 117 trades · PF 1.4 · 4/5 | ✅ Verified |
| XAUUSD 15m | Trend Breakout (55) | 720 trades · PF 1.11 · 4/5 | ⚠️ Weak |
| EURUSD 4h | Trend Pullback | 61 trades · PF 1.51 · 5/5 | ✅ Verified |
| EURUSD 1h, 15m | — | කිසිම strategy එකක් ලාභ නැහැ | ⛔ Disabled |
| අනිත් ඒවා | Trend Pullback (default) | test කරලා නැහැ | ❔ Unverified → Optimizer run කරන්න |

- **Trend Pullback:** ලොකු (4H/Daily) trend එක + EMA 20>50>200 + ADX ශක්තිය → මිල EMA20 ට pullback වෙලා RSI 50 cross කරනකොට entry. SL = 1.5–2 ATR, Target = 3R.
- **Trend Breakout:** trend පැත්තට candles 55 ක high/low එක break වෙනකොට entry.
- **Optimizer (Backtest tab):** ඔයාගේ machine එකේ අලුත්ම candles 5000 ගෙන, 60% එකේ settings 112 න් හොඳම එක තෝරලා, ඉතුරු 40% (නොදැකපු) කොටසේ test කරනවා. Research profile නැති symbols වලට ප්‍රතිඵලය save වෙනවා.
- Backtests වල trading cost (spread + commission) අඩු කරලා තියෙන්නේ: gold $0.60, EURUSD 1.5 pips, crypto 0.2%.

## 🤖 AI Analysis + News check
Signal card එකේ button එක click කරාම (ANTHROPIC_API_KEY ඕන):
1. Claude web එකේ අද news search කරනවා (Fed, inflation, USD, geopolitics, ඉදිරි පැය 48 high-impact events)
2. Chart data + indicators analyze කරලා **AI එකේම signal එකක්** දෙනවා (BUY/SELL/WAIT, entry, SL, TP, confidence)
3. Strategy signal එකයි AI signal එකයි side-by-side: ✅ MATCH / ⚠️ PARTIAL / ❌ CONFLICT
4. ඉදිරි පැය 24 ඇතුළත high-impact news තියෙනවා නම් රතු warning එකක්
5. හැම analysis එකක්ම `data/ai-log.json` එකේ save වෙනවා (පස්සේ AI එක ඇත්තටම උදව් වෙනවද කියලා මනින්න)

AI signal එක backtest කරලා නැහැ — ප්‍රධාන signal එක strategy එකයි. Cost: analysis එකකට ~$0.03–0.08.

## Signals වැඩ කරන විදිහ
- Signal හදන්නේ **close වුණු candles** වලින් විතරයි. Candle එක මැද්දේ BUY එක WAIT වෙන්නේ නැහැ.
- හැම signal එකකටම **entry zone** එකක් තියෙනවා. Live මිල අනුව status එක:
  - **ACTIVE** — zone එක ඇතුළේ, entry ගන්න පුළුවන්
  - **MISSED** — මිල ඉස්සරහට ගිහින්, chase කරන්න එපා
  - **CAUTION** — zone එකට එහා පැත්තේ, SL ළඟයි
  - **INVALID** — SL වැදුනා · **DONE** — TP1 වැදුනා · **EXPIRED** — candles 3ක් පහු වුණා
- Signal එකෙන් fill කරලා order දාද්දී මිල zone එකෙන් එළියේ නම් system එක නවත්තනවා.
- Paper trades වල SL/TP live මිලට check වෙනවා.

## Run කරන හැටි
```bash
npm install
cp .env.example .env      # keys දාන්න
npm start                 # http://localhost:3000
npm run demo              # fake prices එක්ක test කරන්න
```

## වැදගත්
- Signals **probability** එකක් විතරයි. හැම symbol + timeframe එකකම මුලින් **Backtest** එක බලන්න — profitable නැති ඒවායේ signals පාවිච්චි කරන්න එපා.
- Twelve Data free plan එකේ විනාඩියට calls 8යි. Forex charts විනාඩියකට සැරයක් update වෙනවා. Scan එක ගොඩක් එබුවොත් "limit" message එක එනවා — විනාඩියක් ඉන්න.
- Online දානවා නම් `APP_PASSWORD` දාන්න.

## ඊළඟ Phases
- Phase 2: Broker connect (MT5 / OANDA) → system එකෙන්ම ඇත්ත trades
- WhatsApp / Telegram signal alerts
- Multi-user + subscriptions (විකුණන්න)
