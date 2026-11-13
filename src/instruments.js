// Instrument list and contract specs used for lot-size / P&L maths.
// contractSize = units per 1.0 lot. pip = size of one pip in price terms.
// cost / costPct = round-trip trading cost (spread + commission) used in backtests.
// quote = currency the price is quoted in (P&L is in this currency before converting to USD).

const INSTRUMENTS = {
  XAUUSD: { cost: 0.6, name: 'Gold / USD', type: 'metal', provider: 'twelvedata', tdSymbol: 'XAU/USD', fhSymbol: 'OANDA:XAU_USD', contractSize: 100, pip: 0.1, digits: 2, quote: 'USD' },
  EURUSD: { cost: 0.00015, name: 'Euro / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'EUR/USD', fhSymbol: 'OANDA:EUR_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  GBPUSD: { cost: 0.0002, name: 'Pound / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'GBP/USD', fhSymbol: 'OANDA:GBP_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  AUDUSD: { cost: 0.00018, name: 'Aussie / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'AUD/USD', fhSymbol: 'OANDA:AUD_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  USDJPY: { cost: 0.02, name: 'USD / Yen', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/JPY', fhSymbol: 'OANDA:USD_JPY', contractSize: 100000, pip: 0.01, digits: 3, quote: 'JPY' },
  USDCAD: { cost: 0.00022, name: 'USD / CAD', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/CAD', fhSymbol: 'OANDA:USD_CAD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'CAD' },
  USDCHF: { cost: 0.00022, name: 'USD / Franc', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/CHF', fhSymbol: 'OANDA:USD_CHF', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'CHF' },
  XAGUSD: { cost: 0.035, name: 'Silver / USD', type: 'metal', provider: 'twelvedata', tdSymbol: 'XAG/USD', fhSymbol: 'OANDA:XAG_USD', fallback: { binanceFutures: 'XAGUSDT' }, contractSize: 5000, pip: 0.01, digits: 3, quote: 'USD' },
  GBPJPY: { cost: 0.035, name: 'Pound / Yen', type: 'forex', provider: 'twelvedata', tdSymbol: 'GBP/JPY', fhSymbol: 'OANDA:GBP_JPY', contractSize: 100000, pip: 0.01, digits: 3, quote: 'JPY' },
  EURJPY: { cost: 0.03, name: 'Euro / Yen', type: 'forex', provider: 'twelvedata', tdSymbol: 'EUR/JPY', fhSymbol: 'OANDA:EUR_JPY', contractSize: 100000, pip: 0.01, digits: 3, quote: 'JPY' },
  NZDUSD: { cost: 0.0002, name: 'Kiwi / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'NZD/USD', fhSymbol: 'OANDA:NZD_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  EURGBP: { cost: 0.0002, name: 'Euro / Pound', type: 'forex', provider: 'twelvedata', tdSymbol: 'EUR/GBP', fhSymbol: 'OANDA:EUR_GBP', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'GBP' },
  BTCUSDT: { costPct: 0.002, name: 'Bitcoin', type: 'crypto', provider: 'binance', contractSize: 1, pip: 1, digits: 2, quote: 'USD' },
  ETHUSDT: { costPct: 0.002, name: 'Ethereum', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.1, digits: 2, quote: 'USD' },
  SOLUSDT: { costPct: 0.002, name: 'Solana', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.01, digits: 3, quote: 'USD' },
  XRPUSDT: { costPct: 0.002, name: 'XRP', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.0001, digits: 4, quote: 'USD' },
  BNBUSDT: { costPct: 0.002, name: 'BNB', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.01, digits: 2, quote: 'USD' },
};

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

// Rough fallback rates (USD per 1 unit of currency) if no live price is available
const FALLBACK_USD_PER = { JPY: 1 / 150, CAD: 1 / 1.37, CHF: 1 / 0.88, GBP: 1.3 };

// USD value of 1 unit of currency `q`, using live prices (e.g. GBPUSD, USDJPY) when possible
function usdPer(q, hint) {
  if (q === 'USD') return 1;
  if (hint && hint.symbol === `USD${q}`) return 1 / hint.price;
  if (hint && hint.symbol === `${q}USD`) return hint.price;
  let live = null;
  try { live = require('./stream').livePrice; } catch {}
  const direct = live && live(`${q}USD`, 10 * 60_000);
  if (direct) return direct;
  const inv = live && live(`USD${q}`, 10 * 60_000);
  if (inv) return 1 / inv;
  return FALLBACK_USD_PER[q] ?? 1;
}

// Convert a P&L amount in the instrument's quote currency to USD.
// USDxxx pairs: divide by own price. Crosses (GBPJPY, EURGBP): use the live USD rate of the quote currency.
function toUSD(symbol, amountInQuote, price) {
  const inst = INSTRUMENTS[symbol];
  if (!inst || inst.quote === 'USD') return amountInQuote;
  return amountInQuote * usdPer(inst.quote, { symbol, price });
}

// Lot size so that hitting the stop loses `riskUSD`.
function positionSize(symbol, entry, stop, riskUSD) {
  const inst = INSTRUMENTS[symbol];
  const dist = Math.abs(entry - stop);
  if (!inst || !dist) return null;
  const lossPerLotQuote = dist * inst.contractSize;
  const lossPerLotUSD = toUSD(symbol, lossPerLotQuote, entry);
  const lots = riskUSD / lossPerLotUSD;
  const step = inst.type === 'crypto' ? 0.001 : 0.01;
  const rounded = Math.floor(lots / step) * step;
  return {
    lots: +rounded.toFixed(3),
    units: +(rounded * inst.contractSize).toFixed(4),
    pips: +(dist / inst.pip).toFixed(1),
    riskUSD: +(rounded * lossPerLotUSD).toFixed(2),
  };
}

module.exports = { INSTRUMENTS, TIMEFRAMES, toUSD, positionSize };
