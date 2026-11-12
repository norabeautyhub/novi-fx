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
  // Binance gives max 1000 per call → page backwards with endTime
  let rows = [], end = null;
  while (rows.length < limit) {
    const n = Math.min(1000, limit - rows.length);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_TF[tf]}&limit=${n}` + (end ? `&endTime=${end}` : '');
    const page = await getJSON(url);
    if (!page.length) break;
    rows = page.concat(rows);
    end = page[0][0] - 1;
    if (page.length < n) break;
  }
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
const BASE = { XAUUSD: 2400, EURUSD: 1.08, GBPUSD: 1.27, AUDUSD: 0.66, USDJPY: 150, USDCAD: 1.36, USDCHF: 0.88, BTCUSDT: 65000, ETHUSDT: 3200, SOLUSDT: 150, XAGUSD: 30, GBPJPY: 195, EURJPY: 165, NZDUSD: 0.6, EURGBP: 0.85, XRPUSDT: 2.2, BNBUSDT: 650 };
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

// Wait (instead of failing) until a Twelve Data slot is free — used by background scans
async function tdWait(maxWaitMs = 75_000) {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    try { return tdThrottle(); } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function getCandles(symbol, tf = '1h', limit = 500, maxAgeMs, wait = false) {
  const inst = INSTRUMENTS[symbol];
  if (!inst) throw new Error(`Unknown symbol ${symbol}`);
  if (!TD_TF[tf]) throw new Error(`Unknown timeframe ${tf}`);
  if (process.env.DATA_MODE === 'demo') return demoCandles(symbol, tf, limit);
  const key = `${symbol}|${tf}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (maxAgeMs ?? CACHE_MS[inst.provider])) return hit.data;
  if (inst.provider === 'twelvedata') {
    if (wait && !hit) await tdWait();
    else try { tdThrottle(); } catch (e) { if (hit) return hit.data; throw e; }
  }

  const data = inst.provider === 'binance'
    ? await fromBinance(symbol, tf, Math.min(limit, 5000))
    : await fromTwelveData(inst, tf, Math.min(limit, 5000));
  cache.set(key, { at: Date.now(), data });
  return data;
}

function demoLast(symbol) { const d = demoCandles(symbol, '1h', 2000); return d[d.length - 1].close; }

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

// Candles for a date range (seconds, UTC). Used by the Sessions tab.
async function getCandlesRange(symbol, tf, fromSec, toSec) {
  const inst = INSTRUMENTS[symbol];
  if (!inst) throw new Error(`Unknown symbol ${symbol}`);
  const key = `range|${symbol}|${tf}|${fromSec}|${toSec}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  let data;
  if (process.env.DATA_MODE === 'demo') {
    const step = TF_SEC[tf];
    const all = demoCandles(symbol, tf, Math.min(20000, Math.ceil((Date.now() / 1000 - fromSec) / step) + 10));
    data = all.filter((c) => c.time >= fromSec && c.time < toSec);
  } else if (inst.provider === 'binance') {
    data = [];
    let start = fromSec * 1000;
    while (start < toSec * 1000 && data.length < 20000) {
      const page = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_TF[tf]}&startTime=${start}&endTime=${toSec * 1000 - 1}&limit=1000`);
      if (!page.length) break;
      data = data.concat(page.map((r) => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })));
      start = page[page.length - 1][0] + 1;
      if (page.length < 1000) break;
    }
  } else {
    const key2 = process.env.TWELVEDATA_API_KEY;
    if (!key2) throw new Error('TWELVEDATA_API_KEY .env එකේ නැහැ');
    await tdWait();
    const fmt = (t) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(inst.tdSymbol)}&interval=${TD_TF[tf]}&start_date=${encodeURIComponent(fmt(fromSec))}&end_date=${encodeURIComponent(fmt(toSec))}&outputsize=5000&timezone=UTC&apikey=${key2}`;
    const j = await getJSON(url);
    if (j.status === 'error') throw new Error(`Twelve Data: ${j.message}`);
    data = (j.values || []).map((v) => ({ time: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000), open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0) }))
      .filter((c) => c.high !== c.low).reverse();
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getCandles, getPrice, demoLast, TF_SEC, getCandlesRange };
