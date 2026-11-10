// Deep Analysis (no AI key needed):
//  - 15 indicators × 4 timeframes (15m, 1h, 4h, 1d) vote BUY / SELL / neutral
//  - weighted score → Deep signal (BUY/SELL/WAIT) with entry, SL, TP
//  - latest news headlines (Finnhub, free key already used for live prices)
//  - high-impact economic events (ForexFactory free weekly calendar)
// The Deep signal is NOT backtested — it is logged so the Tracker can measure it.

const fs = require('fs');
const path = require('path');
const S = require('./strategy');
const I = require('./indicators');
const { INSTRUMENTS } = require('./instruments');

const TFS = ['15m', '1h', '4h', '1d'];
const TF_WEIGHT = { '15m': 1, '1h': 1.5, '4h': 2, '1d': 2 };
const LOG = path.join(__dirname, '..', 'data', 'deep-log.json');

// ---------- extra indicators ----------
const sma = (x, n) => x.map((_, i) => (i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
const hi = (h, i, n) => Math.max(...h.slice(Math.max(0, i - n + 1), i + 1));
const lo = (l, i, n) => Math.min(...l.slice(Math.max(0, i - n + 1), i + 1));

function ichimoku(h, l, c, i) {
  const tenkan = (hi(h, i, 9) + lo(l, i, 9)) / 2;
  const kijun = (hi(h, i, 26) + lo(l, i, 26)) / 2;
  // cloud that applies NOW was computed 26 candles ago
  const j = i - 26;
  if (j < 52) return null;
  const spanA = ((hi(h, j, 9) + lo(l, j, 9)) / 2 + (hi(h, j, 26) + lo(l, j, 26)) / 2) / 2;
  const spanB = (hi(h, j, 52) + lo(l, j, 52)) / 2;
  return { tenkan, kijun, top: Math.max(spanA, spanB), bottom: Math.min(spanA, spanB) };
}

function supertrend(h, l, c, atr, mult = 3) {
  let up = 0, dn = 0, dir = 1;
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const mid = (h[i] + l[i]) / 2;
    const bu = mid + mult * atr[i], bl = mid - mult * atr[i];
    const pc = i ? c[i - 1] : c[0];
    up = i && (bu < up || pc > up) ? bu : i ? up : bu;
    dn = i && (bl > dn || pc < dn) ? bl : i ? dn : bl;
    if (c[i] > up) dir = 1; else if (c[i] < dn) dir = -1;
    out.push(dir);
  }
  return out;
}

function stochastic(h, l, c, i, n = 14) {
  const k = (j) => { const H = hi(h, j, n), L = lo(l, j, n); return H === L ? 50 : (100 * (c[j] - L)) / (H - L); };
  const ks = [k(i - 4), k(i - 3), k(i - 2), k(i - 1), k(i)];
  const slowK = (j) => (ks[j] + ks[j + 1] + ks[j + 2]) / 3; // %K smoothed 3
  const K = [slowK(0), slowK(1), slowK(2)];
  return { k: K[2], d: (K[0] + K[1] + K[2]) / 3 };
}

function candlePattern(o, h, l, c, i) {
  const body = Math.abs(c[i] - o[i]), range = h[i] - l[i] || 1e-9;
  const upper = h[i] - Math.max(o[i], c[i]), lower = Math.min(o[i], c[i]) - l[i];
  const pBody = Math.abs(c[i - 1] - o[i - 1]);
  if (c[i] > o[i] && c[i - 1] < o[i - 1] && c[i] >= o[i - 1] && o[i] <= c[i - 1] && body > pBody) return { v: 1, name: 'Bullish engulfing' };
  if (c[i] < o[i] && c[i - 1] > o[i - 1] && c[i] <= o[i - 1] && o[i] >= c[i - 1] && body > pBody) return { v: -1, name: 'Bearish engulfing' };
  if (lower > 2 * body && upper < body && body / range < 0.35) return { v: 1, name: 'Hammer / pin bar (යටින් වලිගය)' };
  if (upper > 2 * body && lower < body && body / range < 0.35) return { v: -1, name: 'Shooting star (උඩින් වලිගය)' };
  if (body / range < 0.1) return { v: 0, name: 'Doji (තීරණයක් නැහැ)' };
  return { v: 0, name: 'විශේෂ pattern එකක් නැහැ' };
}

// ---------- votes for one timeframe ----------
function votesFor(candles, digits) {
  const f = (v) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(digits));
  const L = candles.length - 2; // last CLOSED candle
  if (L < 210) return { error: 'Candles මදි' };
  const F = S.features(candles);
  const { o, h, l, c } = F;
  const p = c[L], a = F.atr[L];
  const mac = I.macd(c);
  const bb = I.bollinger(c, 20, 2);
  const st = supertrend(h, l, c, F.atr);
  const ich = ichimoku(h, l, c, L);
  const sto = stochastic(h, l, c, L);
  const sw = I.swings(candles.slice(0, L + 1), 5, 5);
  const rsi = F.rsi[L];
  const v = [];
  const add = (key, name, vote, why) => v.push({ key, name, vote, why });

  // Trend
  add('ema200', 'EMA 200 trend', p > F.ema200[L] && F.ema50[L] > F.ema200[L] ? 1 : p < F.ema200[L] && F.ema50[L] < F.ema200[L] ? -1 : 0,
    `මිල ${f(p)} · EMA50 ${f(F.ema50[L])} · EMA200 ${f(F.ema200[L])}`);
  add('ema2050', 'EMA 20/50', F.ema20[L] > F.ema50[L] ? 1 : -1, `EMA20 ${f(F.ema20[L])} ${F.ema20[L] > F.ema50[L] ? '>' : '<'} EMA50`);
  add('adx', 'ADX / DI', F.adx[L] < 20 ? 0 : F.pdi[L] > F.ndi[L] ? 1 : -1, `ADX ${F.adx[L].toFixed(0)}${F.adx[L] < 20 ? ' (trend දුර්වලයි)' : ''} · +DI ${F.pdi[L].toFixed(0)} / −DI ${F.ndi[L].toFixed(0)}`);
  add('ichimoku', 'Ichimoku Cloud', !ich ? 0 : p > ich.top && ich.tenkan > ich.kijun ? 1 : p < ich.bottom && ich.tenkan < ich.kijun ? -1 : 0,
    ich ? `${p > ich.top ? 'Cloud එකට උඩින්' : p < ich.bottom ? 'Cloud එකට යටින්' : 'Cloud එක ඇතුළේ'} · Tenkan ${f(ich.tenkan)} / Kijun ${f(ich.kijun)}` : 'data මදි');
  add('supertrend', 'Supertrend (10,3)', st[L], st[L] === 1 ? 'UP' : 'DOWN');
  // Momentum
  add('rsi', 'RSI (14)', rsi > 75 || rsi < 25 ? 0 : rsi > 55 ? 1 : rsi < 45 ? -1 : 0, `${rsi.toFixed(0)}${rsi > 75 ? ' — overbought (buy අවදානම්)' : rsi < 25 ? ' — oversold (sell අවදානම්)' : ''}`);
  add('macd', 'MACD', mac.hist[L] > 0 ? 1 : mac.hist[L] < 0 ? -1 : 0, `Histogram ${mac.hist[L] > 0 ? '+' : ''}${(+mac.hist[L]).toPrecision(3)}`);
  add('stoch', 'Stochastic (14,3)', sto.k > sto.d && sto.k < 80 ? 1 : sto.k < sto.d && sto.k > 20 ? -1 : 0, `%K ${sto.k.toFixed(0)} / %D ${sto.d.toFixed(0)}`);
  const roc = ((p - c[L - 10]) / c[L - 10]) * 100;
  add('roc', 'Momentum (10)', Math.abs(roc) < 0.05 ? 0 : roc > 0 ? 1 : -1, `${roc > 0 ? '+' : ''}${roc.toFixed(2)}%`);
  // Volatility
  const pb = (p - bb.lower[L]) / (bb.upper[L] - bb.lower[L]);
  add('bb', 'Bollinger Bands', pb > 1 || pb < 0 ? 0 : pb > 0.55 ? 1 : pb < 0.45 ? -1 : 0, `%B ${(pb * 100).toFixed(0)}%${pb > 1 ? ' — band එකෙන් උඩ (දිගු වෙලා)' : pb < 0 ? ' — band එකෙන් යට (දිගු වෙලා)' : ''}`);
  // Structure
  const highs = sw.highs.map((x) => x.price), lows = sw.lows.map((x) => x.price);
  const res = highs.filter((x) => x > p).sort((x, y) => x - y)[0];
  const sup = lows.filter((x) => x < p).sort((x, y) => y - x)[0];
  const roomUp = res ? res - p : 3 * a, roomDn = sup ? p - sup : 3 * a;
  add('sr', 'Support / Resistance', roomUp > 1.5 * roomDn ? 1 : roomDn > 1.5 * roomUp ? -1 : 0, `Support ${f(sup)} · Resistance ${f(res)}`);
  const hh = highs.slice(-2), ll = lows.slice(-2);
  add('structure', 'Market structure (HH/HL)', hh.length === 2 && ll.length === 2 ? (hh[1] > hh[0] && ll[1] > ll[0] ? 1 : hh[1] < hh[0] && ll[1] < ll[0] ? -1 : 0) : 0,
    hh.length === 2 && ll.length === 2 ? (hh[1] > hh[0] && ll[1] > ll[0] ? 'Higher highs + higher lows' : hh[1] < hh[0] && ll[1] < ll[0] ? 'Lower highs + lower lows' : 'මිශ්‍රයි') : 'data මදි');
  // Pivot (previous day's H/L/C)
  const dayKey = (t) => Math.floor(t / 86400);
  const today = dayKey(candles[L].time);
  const prev = candles.filter((x) => dayKey(x.time) === today - 1 || dayKey(x.time) === today - 3 /* Fri for Mon */);
  const pd = prev.length ? prev.filter((x) => dayKey(x.time) === dayKey(prev[prev.length - 1].time)) : [];
  if (pd.length) {
    const PH = Math.max(...pd.map((x) => x.high)), PL = Math.min(...pd.map((x) => x.low)), PC = pd[pd.length - 1].close;
    const piv = (PH + PL + PC) / 3;
    add('pivot', 'Pivot point (daily)', p > piv ? 1 : -1, `Pivot ${f(piv)} · R1 ${f(2 * piv - PL)} · S1 ${f(2 * piv - PH)}`);
  } else add('pivot', 'Pivot point (daily)', 0, 'Daily candle එකට pivot නැහැ');
  // Fibonacci pullback zone of the last 100 candles' swing
  const H100 = hi(h, L, 100), L100 = lo(l, L, 100);
  const iH = h.lastIndexOf(H100, L), iL = l.lastIndexOf(L100, L);
  const upLeg = iL < iH; // low came first → up move
  const ret = upLeg ? (H100 - p) / (H100 - L100) : (p - L100) / (H100 - L100);
  add('fib', 'Fibonacci (100 candles)', ret >= 0.382 && ret <= 0.618 ? (upLeg ? 1 : -1) : 0,
    `${upLeg ? 'Up' : 'Down'} move එකේ ${(ret * 100).toFixed(0)}% retracement${ret >= 0.382 && ret <= 0.618 ? ' — golden zone (හොඳ entry ප්‍රදේශය)' : ''}`);
  const cp = candlePattern(o, h, l, c, L);
  add('candle', 'Candlestick pattern', cp.v, cp.name);

  return { votes: v, price: p, atr: a, support: sup, resistance: res, rsi, closedTime: candles[L].time };
}

// ---------- news & calendar ----------
const KEYWORDS = {
  XAU: ['gold', 'bullion', 'precious', 'xau'], XAG: ['silver', 'precious', 'xag'],
  USD: ['dollar', 'fed', 'powell', 'treasury', 'inflation', 'cpi', 'payroll', 'jobs', 'fomc', 'yields', 'u.s.'],
  EUR: ['euro', 'ecb', 'lagarde', 'eurozone'], GBP: ['pound', 'sterling', 'boe', 'bank of england', 'uk '], JPY: ['yen', 'boj', 'bank of japan', 'japan'],
  AUD: ['aussie', 'rba', 'australia'], NZD: ['kiwi', 'rbnz', 'new zealand'], CAD: ['loonie', 'canada', 'boc', 'oil'], CHF: ['franc', 'snb', 'swiss'],
  BTC: ['bitcoin', 'btc', 'crypto'], ETH: ['ether', 'ethereum', 'crypto'], SOL: ['solana', 'crypto'], XRP: ['xrp', 'ripple', 'crypto'], BNB: ['bnb', 'binance', 'crypto'],
};
function parts(symbol) {
  const inst = INSTRUMENTS[symbol];
  if (inst.type === 'crypto') return [symbol.replace('USDT', ''), 'USD'];
  return [symbol.slice(0, 3), symbol.slice(3, 6)];
}

const cache = {};
async function cached(key, ms, fn) {
  const c = cache[key];
  if (c && Date.now() - c.at < ms) return c.v;
  const v = await fn();
  cache[key] = { at: Date.now(), v };
  return v;
}

async function news(symbol) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { error: 'FINNHUB_API_KEY නැහැ' };
  const inst = INSTRUMENTS[symbol];
  const cat = inst.type === 'crypto' ? 'crypto' : 'forex';
  const all = await cached(`news-${cat}`, 5 * 60_000, async () => {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`);
    if (!r.ok) throw new Error(`Finnhub news HTTP ${r.status}`);
    return r.json();
  });
  const words = parts(symbol).flatMap((p) => KEYWORDS[p] || []);
  const pick = all.filter((n) => words.some((w) => (n.headline + ' ' + n.summary).toLowerCase().includes(w)));
  const list = (pick.length >= 3 ? pick : all).slice(0, 8).map((n) => ({ time: n.datetime, headline: n.headline, source: n.source, url: n.url }));
  return { items: list, filtered: pick.length >= 3 };
}

async function calendar(symbol) {
  const all = await cached('ffcal', 30 * 60_000, async () => {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': 'novi-fx/1.0' } });
    if (!r.ok) throw new Error(`Calendar HTTP ${r.status}`);
    return r.json();
  });
  const cur = new Set(parts(symbol));
  const now = Date.now();
  return all
    .filter((e) => cur.has(e.country) && (e.impact === 'High' || e.impact === 'Medium'))
    .map((e) => ({ time: Date.parse(e.date), title: e.title, country: e.country, impact: e.impact, forecast: e.forecast, previous: e.previous }))
    .filter((e) => e.time > now - 2 * 3600e3 && e.time < now + 48 * 3600e3)
    .sort((a, b) => a.time - b.time);
}

// ---------- main ----------
async function deepAnalyze({ symbol, tf, getCandles, getPrice, strategySignal }) {
  const digits = INSTRUMENTS[symbol].digits;
  const frames = {};
  for (const t of TFS) {
    try { frames[t] = votesFor(await getCandles(symbol, t), digits); } catch (e) { frames[t] = { error: e.message }; }
  }
  // weighted score: +1 (all BUY) … −1 (all SELL)
  let num = 0, den = 0;
  const tfScore = {};
  for (const t of TFS) {
    const fr = frames[t];
    if (!fr.votes) continue;
    const s = fr.votes.reduce((x, v) => x + v.vote, 0);
    tfScore[t] = { buy: fr.votes.filter((v) => v.vote > 0).length, sell: fr.votes.filter((v) => v.vote < 0).length, neutral: fr.votes.filter((v) => v.vote === 0).length, score: s / fr.votes.length };
    num += TF_WEIGHT[t] * s; den += TF_WEIGHT[t] * fr.votes.length;
  }
  const score = den ? num / den : 0;
  const price = await getPrice(symbol);
  const main = frames[tf] && frames[tf].votes ? frames[tf] : frames['1h'];
  const big = (tfScore['4h']?.score ?? 0) + (tfScore['1d']?.score ?? 0);

  let action = 'WAIT', why = [];
  const dir = score > 0 ? 1 : -1;
  if (Math.abs(score) < 0.3) why.push(`Indicators එකඟ නැහැ (score ${(score * 100).toFixed(0)}%) — පැහැදිලි දිශාවක් නැහැ`);
  else if (tfScore[tf] && Math.sign(tfScore[tf].score) !== dir) why.push(`ඔයාගේ timeframe එක (${tf}) අනිත් ඒවට විරුද්ධයි`);
  else if (Math.sign(big) !== dir) why.push('4h / Daily trend එක මේ දිශාවට එකඟ නැහැ');
  else if (dir === 1 && main.rsi > 75) why.push('RSI ගොඩක් උඩයි (overbought) — pullback එකකට ඉන්න');
  else if (dir === -1 && main.rsi < 25) why.push('RSI ගොඩක් පහළයි (oversold) — pullback එකකට ඉන්න');
  else action = dir === 1 ? 'BUY' : 'SELL';

  let levels = null;
  if (action !== 'WAIT' && main.atr) {
    const a = main.atr, d = dir;
    let sl = price - d * 1.5 * a;
    const sw = d === 1 ? main.support : main.resistance;
    if (sw) { const s2 = sw - d * 0.2 * a; const dist = d * (price - s2); if (dist >= 1 * a && dist <= 3 * a) sl = s2; }
    const risk = Math.abs(price - sl);
    levels = { entry: price, stopLoss: sl, tp1: price + d * 1.5 * risk, tp2: price + d * 2.5 * risk, rr: 2.5, nextLevel: d === 1 ? main.resistance : main.support };
  }

  let newsRes, cal;
  try { newsRes = await news(symbol); } catch (e) { newsRes = { error: e.message }; }
  try { cal = await calendar(symbol); } catch (e) { cal = { error: e.message }; }
  const soon = Array.isArray(cal) ? cal.filter((e) => e.impact === 'High' && e.time < Date.now() + 24 * 3600e3) : [];

  const sa = strategySignal?.action;
  const st = ['BUY', 'SELL'].includes(sa), dt = ['BUY', 'SELL'].includes(action);
  const match = st && dt ? (sa === action ? 'MATCH' : 'CONFLICT') : !st && !dt ? 'MATCH_WAIT' : st ? 'PARTIAL' : 'DEEP_ONLY';

  const out = {
    ok: true, time: new Date().toISOString(), symbol, tf, price, score: +score.toFixed(3), confidence: Math.round(Math.abs(score) * 100),
    action, why, levels, frames, tfScore, news: newsRes, calendar: cal, soonHighImpact: soon, match,
    strategy: strategySignal ? { action: sa, entry: strategySignal.entry, stopLoss: strategySignal.stopLoss, target: strategySignal.tp2, status: strategySignal.profile?.status } : null,
  };
  // log for the Tracker (same shape as ai-log, kind: 'deep')
  try {
    let all = [];
    try { all = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch {}
    all.unshift({ kind: 'deep', time: out.time, symbol, tf, price, match,
      strategy: out.strategy, ai: { action, entry: levels?.entry, stop_loss: levels?.stopLoss, take_profit: levels?.tp2, confidence: out.confidence } });
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, JSON.stringify(all.slice(0, 1000), null, 2));
  } catch {}
  return out;
}

module.exports = { deepAnalyze, votesFor, TFS };
