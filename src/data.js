// Market data providers.
//  - Crypto: Binance public API (free, no key)
//  - Forex + Gold: Twelve Data (free key: https://twelvedata.com — 800 calls/day, 8/min)
// Results are cached so the UI can poll without burning the API limit.

const { INSTRUMENTS } = require('./instruments');

const BINANCE_TF = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
const TD_TF = { '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day' };
// How long candles stay cached per provider (ms). Twelve Data free plan is 8 calls/min.
const CACHE_MS = { binance: 5_000, twelvedata: 60_000 };

const cache = new Map();

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'novi-fx/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function fromBinance(symbol, tf, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_TF[tf]}&limit=${limit}`;
  const rows = await getJSON(url);
  return rows.map((r) => ({
    time: Math.floor(r[0] / 1000),
    open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
  }));
}

async function fromTwelveData(inst, tf, limit) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY .env එකේ නැහැ (forex/gold data වලට ඕන)');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(inst.tdSymbol)}&interval=${TD_TF[tf]}&outputsize=${limit}&timezone=UTC&apikey=${key}`;
  const j = await getJSON(url);
  if (j.status === 'error') throw new Error(`Twelve Data: ${j.message}`);
  return j.values
    .map((v) => ({
      time: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000),
      open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0),
    }))
    // market closed (weekend/holiday) → flat candles with no movement; they distort EMA/ATR
    .filter((c) => c.high !== c.low)
    .reverse();
}

// DATA_MODE=demo → synthetic random-walk candles (for testing without internet/API keys)
const TF_SEC = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const BASE = { XAUUSD: 2400, EURUSD: 1.08, GBPUSD: 1.27, AUDUSD: 0.66, USDJPY: 150, USDCAD: 1.36, USDCHF: 0.88, BTCUSDT: 65000, ETHUSDT: 3200, SOLUSDT: 150 };
function demoCandles(symbol, tf, limit) {
  let seed = [...(symbol + tf)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const step = TF_SEC[tf];
  const now = Math.floor(Date.now() / 1000 / step) * step;
  let p = BASE[symbol], drift = 0;
  const out = [];
  for (let i = limit - 1; i >= 0; i--) {
    if (rnd() < 0.03) drift = (rnd() - 0.5) * 0.004;
    const vol = 0.004 * Math.sqrt(step / 3600);
    const o = p;
    const c = o * (1 + drift * Math.sqrt(step / 3600) + (rnd() - 0.5) * vol);
    const hi = Math.max(o, c) * (1 + rnd() * vol * 0.5);
    const lo = Math.min(o, c) * (1 - rnd() * vol * 0.5);
    out.push({ time: now - i * step, open: o, high: hi, low: lo, close: c, volume: Math.round(rnd() * 1000) });
    p = c;
  }
  return out;
}

// Twelve Data free plan: 8 requests/minute. Keep our own count so we fail clearly.
const tdCalls = [];
function tdThrottle() {
  const now = Date.now();
  while (tdCalls.length && now - tdCalls[0] > 60_000) tdCalls.shift();
  const max = +(process.env.TWELVEDATA_PER_MIN || 8);
  if (tdCalls.length >= max) {
    const wait = Math.ceil((60_000 - (now - tdCalls[0])) / 1000);
    throw new Error(`Twelve Data limit (${max}/min) — තත්පර ${wait} කින් ආයෙත් try කරන්න`);
  }
  tdCalls.push(now);
}

async function getCandles(symbol, tf = '1h', limit = 500, maxAgeMs) {
  const inst = INSTRUMENTS[symbol];
  if (!inst) throw new Error(`Unknown symbol ${symbol}`);
  if (!TD_TF[tf]) throw new Error(`Unknown timeframe ${tf}`);
  if (process.env.DATA_MODE === 'demo') return demoCandles(symbol, tf, limit);
  const key = `${symbol}|${tf}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (maxAgeMs ?? CACHE_MS[inst.provider])) return hit.data;
  if (inst.provider === 'twelvedata') {
    try { tdThrottle(); } catch (e) { if (hit) return hit.data; throw e; }
  }

  const data = inst.provider === 'binance'
    ? await fromBinance(symbol, tf, Math.min(limit, 1000))
    : await fromTwelveData(inst, tf, Math.min(limit, 5000));
  cache.set(key, { at: Date.now(), data });
  return data;
}

function demoLast(symbol) { const d = demoCandles(symbol, '1h', 500); return d[d.length - 1].close; }

async function getPrice(symbol) {
  const live = require('./stream').livePrice(symbol);
  if (live != null) return live;
  if (process.env.DATA_MODE === 'demo') return demoLast(symbol);
  // reuse the smallest cached series if present, else fetch a few 5m candles
  for (const [k, v] of cache) {
    if (k.startsWith(symbol + '|') && Date.now() - v.at < CACHE_MS[INSTRUMENTS[symbol].provider]) {
      return v.data[v.data.length - 1].close;
    }
  }
  const c = await getCandles(symbol, '5m', 5);
  return c[c.length - 1].close;
}

module.exports = { getCandles, getPrice, demoLast, TF_SEC };
