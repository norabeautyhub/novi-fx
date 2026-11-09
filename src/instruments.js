// Instrument list and contract specs used for lot-size / P&L maths.
// contractSize = units per 1.0 lot. pip = size of one pip in price terms.
// quote = currency the price is quoted in (P&L is in this currency before converting to USD).

const INSTRUMENTS = {
  XAUUSD: { name: 'Gold / USD', type: 'metal', provider: 'twelvedata', tdSymbol: 'XAU/USD', fhSymbol: 'OANDA:XAU_USD', contractSize: 100, pip: 0.1, digits: 2, quote: 'USD' },
  EURUSD: { name: 'Euro / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'EUR/USD', fhSymbol: 'OANDA:EUR_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  GBPUSD: { name: 'Pound / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'GBP/USD', fhSymbol: 'OANDA:GBP_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  AUDUSD: { name: 'Aussie / USD', type: 'forex', provider: 'twelvedata', tdSymbol: 'AUD/USD', fhSymbol: 'OANDA:AUD_USD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'USD' },
  USDJPY: { name: 'USD / Yen', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/JPY', fhSymbol: 'OANDA:USD_JPY', contractSize: 100000, pip: 0.01, digits: 3, quote: 'JPY' },
  USDCAD: { name: 'USD / CAD', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/CAD', fhSymbol: 'OANDA:USD_CAD', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'CAD' },
  USDCHF: { name: 'USD / Franc', type: 'forex', provider: 'twelvedata', tdSymbol: 'USD/CHF', fhSymbol: 'OANDA:USD_CHF', contractSize: 100000, pip: 0.0001, digits: 5, quote: 'CHF' },
  BTCUSDT: { name: 'Bitcoin', type: 'crypto', provider: 'binance', contractSize: 1, pip: 1, digits: 2, quote: 'USD' },
  ETHUSDT: { name: 'Ethereum', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.1, digits: 2, quote: 'USD' },
  SOLUSDT: { name: 'Solana', type: 'crypto', provider: 'binance', contractSize: 1, pip: 0.01, digits: 3, quote: 'USD' },
};

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

// Convert a P&L amount in the instrument's quote currency to USD.
// For USDxxx pairs the quote currency is xxx, so divide by the current price.
function toUSD(symbol, amountInQuote, price) {
  const inst = INSTRUMENTS[symbol];
  if (!inst || inst.quote === 'USD') return amountInQuote;
  return amountInQuote / price;
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
