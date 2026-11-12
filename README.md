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
| BTC, ETH, SOL, XRP, BNB | Binance — key ඕන නැහැ | Binance |
| XAUUSD, XAGUSD + Forex pairs 11 | Finnhub — free key (`FINNHUB_API_KEY`) | Twelve Data — free key |

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

## 📋 අද Signals
උඩ තියෙන **📋 අද Signals** button එක → Verified/Weak markets ඔක්කොම (හැම timeframe එකකම) check කරලා, දැනට valid BUY/SELL signals එක තැනකින් පෙන්නනවා (විනාඩි 5කට සැරයක් auto update). Card එක click කළාම ඒ chart එකට යනවා.

## 🤖 AI Tracker
හැම AI analysis එකක්ම පස්සේ මිල ගිය විදිහට check කරනවා (entry ආවද, SL/TP වැදුනද). AI signals, strategy signals, සහ "AI එකඟ වුණ (MATCH)" / "AI විරුද්ධ (CONFLICT)" strategy signals වල ප්‍රතිඵල වෙන වෙනම පෙන්නනවා. තීරණයකට ඉවර වුණු signals 30–50ක් ඕන.

## 💵 Backtest screen
🟢/🟡/🔴 තීරණය · "මගේ සල්ලි වලට මොකද වෙන්නේ" calculator (පටන් ගන්න මුදල + risk %) · පියවරෙන් පියවර ගණන · $ balance chart · දිනුම්/පැරදුම් කොටු + එක දිගට පැරදුණු උපරිමය · chart එකේ trade ලකුණු · trades list · advanced විස්තර.

## 🎯 Trade Modes (Signal card එකේ උඩ)
Research (`research/wr.py`, Gold 2014–2018 / EURUSD 2017–2021, costs එක්ක):

| Mode | කරන දේ | Gold 4h ප්‍රතිඵලය ($10 risk) |
|---|---|---|
| Normal | Signal මිලට entry, SL / 3R target | 33% win, 67% loss, +$329 |
| 🛡️ Breakeven | 1R වුණාම SL → entry | 24% win, 36% $0, 40% loss, +$349 |
| 🎯 High Win Rate | 0.5 ATR limit entry (candles 4), 1R දී 50% close + SL → entry, ඉතුරු භාගය 3R | **62% win**, 38% loss, එක දිගට පාඩු max 4, +$189 |

Gold 4h walk-forward (නොදැකපු 2016–2018): High Win Rate 61% win +20.8R vs Normal 33% +18.4R.
Signal card එකේ පියවරෙන් පියවර උපදෙස්, chart lines, 1R alert (browser notification), Demo trading එකේ limit order + auto 50% close + breakeven, Backtest එකේ "⚖️ Modes 3ම compare".

## 📅 Sessions tab
දින පරාසයක් (මේ සතිය / පහුගිය සතිය / සති 4 / මාස 3 / ඕනම දින) + session එකක් (London / New York / Asian / මුළු දවස) තෝරලා:
- හැම දවසකම session එක එක candle එකක් විදිහට chart එකක (▲▼ = ඒ දවස්වල strategy trades + $ ප්‍රතිඵලය)
- වැඩිම / අඩුම චලනය වුණ දවස, සාමාන්‍ය චලනය, UP/DOWN දවස්, High/Low වැඩියෙන්ම ආපු ලංකා වේලාව
- දවසින් දවස table: Open, High (වෙලාව), Low (වෙලාව), Close, චලනය, Low→High / High→Low, "උපරිම ඉඩ" (hindsight, 0.10 lot)
- ඒ කාලයේ strategy trades ගත්තා නම් ($ risk එකට) — signal වෙලාව, entry, SL, target, ඉවර වුණ වෙලාව, $ ප්‍රතිඵලය, මුළු එකතුව
(15m candles ≤31 දවස්, ඊට වැඩි නම් 1h; උපරිම දවස් 180)

## 🔬 Deep Analysis — අලුත් කොටස් (2026-11-10)
- **⚖️ ඔක්කොම එකට:** Strategy / දැන්ම trade / Indicators / ML / AI — දිශාව + success %, BUY vs SELL එකඟතාවය
- **📐 Strategy signal — mode 3ම:** signal එක (හෝ WAIT නම් signal එක එන මිල + කොන්දේසි), ✅ success / ⚪ $0 / ❌ loss % (backtest), ⚠️ risk (SL දුර, pips, $1,000ට 1% lots, R:R), 💰/🎯 badges
- **🧭 දැන්ම trade කළොත්:** indicators 13 × (තෝරපු timeframe + 4h + 1d) score එකෙන් BUY/SELL, entry (දැන් මිල) / SL 1.5 ATR / Target 2.5R; success/loss % **මනින ලද** — පහුගිය candles 5000 ඇතුළත ඒ තරම් ශක්තියක් තිබුණ වෙලාවල ප්‍රතිඵල (costs එක්ක). test නොකළ ක්‍රමයක් බව පෙන්නනවා. (`src/now.js`)

## 🔬 Deep Analysis (free — AI key ඕන නැහැ)
Signal card එකේ **🔬 Deep Analysis** button එක:
- Indicators 15 (EMA 200, EMA 20/50, ADX/DI, Ichimoku, Supertrend, RSI, MACD, Stochastic, Momentum, Bollinger, Support/Resistance, Market structure, Pivot, Fibonacci, Candlestick pattern) × timeframes 4 (15m, 1h, 4h, Daily) ඡන්ද table එක
- Weighted score එකෙන් Deep signal එක (BUY/SELL/WAIT) + Entry, SL, TP1 1.5R, TP2 2.5R — 4h/Daily විරුද්ධ නම්, RSI extreme නම් WAIT
- අලුත්ම news headlines (Finnhub) + ඉදිරි පැය 48 economic events (ForexFactory) + පැය 24 ඇතුළත high-impact news warning
- Strategy signal එක්ක MATCH/CONFLICT, AI Tracker එකේ වෙනම track වෙනවා

## 🧠 ML models (Deep Analysis එක ඇතුළේ)
Neural network (layers 4), LSTM (candles 32ක sequence), LightGBM — Gold 2014–2018 සහ EURUSD 2017–2021 1h data වලින් train කරලා (`research/ml_*.py`), app එකේම JavaScript වලින් run වෙනවා (Python ඕන නැහැ, `src/ml-models.json`).
- Walk-forward research ප්‍රතිඵලය: accuracy ~50–53% (දුර්වලයි). තනියම signals දුන්නොත් costs එක්ක පාඩුයි. ඒ නිසා Deep score එකේ බර indicator එකක් තරමයි.
- Strategy signal එකට ML filter එක (👍/👎). XAUUSD විතරයි — EURUSD models accuracy 50%ට අඩු නිසා off.

## 🏆 Signal Grade (A / B / C)
Strategy signal එකක් ආවම tools ඔක්කොම එකට බලලා:
- 🏆 **A** — Verified strategy + entry zone ඇතුළේ + Deep එකඟයි + ML 👎 නැහැ + ළඟ ලොකු news නැහැ → 1% risk
- 🥈 **B** — එක දුර්වල තැනක් → 0.5% risk
- ⚠️ **C** — signal නැහැ / MISSED / දුර්වල තැන් 2+ → trade කරන්න එපා

Signal card එකේ, Deep Analysis එකේ සහ "අද Signals" list එකේ (A උඩින්ම) පේනවා. Grades `data/grade-log.json` එකේ save වෙලා AI Tracker එකේ A/B/C ප්‍රතිඵල වෙන වෙනම track වෙනවා.

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
