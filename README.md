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
