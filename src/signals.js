// Rule-based signal engine.
// evaluateAt() only looks at data up to index i, so the same function is used
// for the live signal and for the backtest (no look-ahead).

const { computeAll } = require('./indicators');

const DEFAULTS = {
  threshold: 4,      // |score| needed for BUY/SELL
  atrStopMult: 1.5,  // stop distance in ATRs (if no good swing level)
  tp1R: 1.5,         // take profit 1 in R multiples
  tp2R: 3,           // take profit 2 in R multiples
  zoneFwd: 0.25,     // entry zone: ATRs in the trade direction (beyond = "missed, don't chase")
  zoneBack: 0.3,     // entry zone: ATRs against the trade direction
  validBars: 3,      // signal stays valid for this many candles after it closes
};

const MAX_SCORE = 8;

function nearestLevels(swingsList, i, price) {
  // Confirmed swings only (confirmedAt <= i), most recent 30 bars-worth of levels
  const highs = swingsList.highs.filter((s) => s.confirmedAt <= i).slice(-8).map((s) => s.price);
  const lows = swingsList.lows.filter((s) => s.confirmedAt <= i).slice(-8).map((s) => s.price);
  const all = [...highs, ...lows];
  const above = all.filter((p) => p > price).sort((a, b) => a - b);
  const below = all.filter((p) => p < price).sort((a, b) => b - a);
  return {
    resistance: above[0] ?? null,
    support: below[0] ?? null,
    lastSwingLow: lows.length ? lows[lows.length - 1] : null,
    lastSwingHigh: highs.length ? highs[highs.length - 1] : null,
  };
}

function evaluateAt(candles, ind, i, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const c = candles[i];
  const price = c.close;
  const e20 = ind.ema20[i], e50 = ind.ema50[i], e200 = ind.ema200[i];
  const r = ind.rsi[i], rPrev = ind.rsi[i - 1];
  const h = ind.macd.hist[i], hPrev = ind.macd.hist[i - 1];
  const a = ind.atr[i];

  if ([e20, e50, e200, r, rPrev, h, hPrev, a].some((v) => v == null)) {
    return { action: 'WAIT', score: 0, confidence: 0, reasons: ['දත්ත මදි (candles 200+ ඕන)'], price };
  }

  let score = 0;
  const reasons = [];
  const add = (pts, text) => { score += pts; reasons.push({ pts, text }); };

  // 1. Big trend (EMA 200) — ±2
  if (price > e200 && e50 > e200) add(2, 'ලොකු trend එක UP (මිල සහ EMA50, EMA200 ට උඩින්)');
  else if (price < e200 && e50 < e200) add(-2, 'ලොකු trend එක DOWN (මිල සහ EMA50, EMA200 ට යටින්)');
  else reasons.push({ pts: 0, text: 'ලොකු trend එක පැහැදිලි නැහැ (EMA200 වටේ)' });

  // 2. Short trend (EMA20 vs EMA50) — ±1
  if (e20 > e50) add(1, 'කෙටි trend එක UP (EMA20 > EMA50)');
  else add(-1, 'කෙටි trend එක DOWN (EMA20 < EMA50)');

  // 3. Momentum (MACD histogram) — ±1, extra ±1 on fresh cross
  if (h > 0) add(1, 'MACD momentum එක buy පැත්තට');
  else add(-1, 'MACD momentum එක sell පැත්තට');
  if (h > 0 && hPrev <= 0) add(1, 'MACD අලුතින් bullish cross වුණා');
  if (h < 0 && hPrev >= 0) add(-1, 'MACD අලුතින් bearish cross වුණා');

  // 4. RSI — healthy zone in trend direction, penalty at extremes
  if (r > 70) add(-1, `RSI ${r.toFixed(0)} — overbought, buy කරන්න අවදානම්`);
  else if (r < 30) add(1, `RSI ${r.toFixed(0)} — oversold, sell කරන්න අවදානම්`);
  else if (r > 50 && r > rPrev) add(1, `RSI ${r.toFixed(0)} — 50 ට උඩ සහ නගිනවා`);
  else if (r < 50 && r < rPrev) add(-1, `RSI ${r.toFixed(0)} — 50 ට යට සහ බහිනවා`);

  // 5. Pullback entry: price near EMA20/EMA50 (within 0.6 ATR) in trend direction
  const nearEma = Math.min(Math.abs(c.low - e20), Math.abs(c.low - e50), Math.abs(c.high - e20), Math.abs(c.high - e50)) < 0.6 * a;
  if (nearEma && score > 0 && price > e20) add(1, 'EMA එකට pullback එකක් වෙලා ආයෙත් උඩට — හොඳ buy entry zone');
  if (nearEma && score < 0 && price < e20) add(-1, 'EMA එකට pullback එකක් වෙලා ආයෙත් පහළට — හොඳ sell entry zone');

  // 6. Support/resistance room
  const lv = nearestLevels(ind.swings, i, price);
  if (score > 0 && lv.resistance && lv.resistance - price < 1 * a) add(-1, `ළඟින්ම resistance එකක් (${lv.resistance}) — buy කරන්න ඉඩ අඩුයි`);
  if (score < 0 && lv.support && price - lv.support < 1 * a) add(1, `ළඟින්ම support එකක් (${lv.support}) — sell කරන්න ඉඩ අඩුයි`);

  let action = 'WAIT';
  if (score >= o.threshold) action = 'BUY';
  else if (score <= -o.threshold) action = 'SELL';

  const result = {
    action,
    score,
    confidence: Math.round((Math.min(Math.abs(score), MAX_SCORE) / MAX_SCORE) * 100),
    price,
    time: c.time,
    atr: a,
    rsi: r,
    levels: lv,
    reasons,
  };

  if (action !== 'WAIT') {
    const dir = action === 'BUY' ? 1 : -1;
    let stop = price - dir * o.atrStopMult * a;
    // Prefer a stop just beyond the last swing if it is between 1 and 3 ATR away
    const swing = dir === 1 ? lv.lastSwingLow : lv.lastSwingHigh;
    if (swing != null) {
      const buffered = swing - dir * 0.2 * a;
      const dist = dir * (price - buffered);
      if (dist >= 1 * a && dist <= 3 * a) stop = buffered;
    }
    const risk = Math.abs(price - stop);
    result.entry = price;
    result.stopLoss = stop;
    result.tp1 = price + dir * o.tp1R * risk;
    result.tp2 = price + dir * o.tp2R * risk;
    result.riskReward = o.tp2R;
    result.zone = dir === 1
      ? [price - o.zoneBack * a, price + o.zoneFwd * a]
      : [price - o.zoneFwd * a, price + o.zoneBack * a];
  }
  return result;
}

// Where is the live price relative to a signal?
//  ACTIVE  – inside the entry zone → entry ගන්න පුළුවන්
//  MISSED  – ran past the zone toward TP → chase කරන්න එපා
//  CAUTION – below/above the zone but stop not hit → SL ළඟයි
//  INVALID – stop loss hit, DONE – TP1 hit, EXPIRED – too many candles passed
// (same logic is copied in public/app.js for live updates)
function signalStatus(sig, price, nowSec) {
  if (!sig || sig.action === 'WAIT' || price == null) return null;
  const dir = sig.action === 'BUY' ? 1 : -1;
  if (sig.outcome === 'SL') return { code: 'INVALID', text: 'Stop loss එක වැදුනා — signal එක cancel' };
  if (sig.outcome === 'TP1') return { code: 'DONE', text: 'TP1 දක්වා ගිහින් ඉවරයි — අලුතෙන් entry ගන්න එපා' };
  if (dir * (price - sig.stopLoss) <= 0) return { code: 'INVALID', text: 'මිල SL එක පහු කළා — signal එක cancel' };
  if (dir * (price - sig.tp1) >= 0) return { code: 'DONE', text: 'TP1 දක්වා ගිහින් ඉවරයි — අලුතෙන් entry ගන්න එපා' };
  if (nowSec > sig.expiresAt) return { code: 'EXPIRED', text: 'Signal එක පරණයි (expired)' };
  const [lo, hi] = sig.zone;
  if (price >= lo && price <= hi) return { code: 'ACTIVE', text: 'මිල entry zone එක ඇතුළේ — entry ගන්න පුළුවන්' };
  if (dir * (price - (dir === 1 ? hi : lo)) > 0) return { code: 'MISSED', text: 'මිල zone එකෙන් ඉස්සරහට ගිහින් — chase කරන්න එපා, zone එකට එනකම් ඉන්න' };
  return { code: 'CAUTION', text: 'මිල zone එකට එහා පැත්තේ, SL එකට ළඟයි — ප්‍රවේශමෙන්' };
}

// Signal from CLOSED candles only (the last candle is still forming, so it is ignored).
// Looks back `validBars` closed candles for the most recent BUY/SELL and checks
// whether SL / TP1 was already touched after it.
function liveSignal(candles, opts = {}, tfSec = 3600) {
  const o = { ...DEFAULTS, ...opts };
  const ind = computeAll(candles);
  const L = candles.length - 2; // last closed candle
  let found = null, k = L;
  for (; k >= Math.max(0, L - o.validBars + 1); k--) {
    const s = evaluateAt(candles, ind, k, o);
    if (s.action !== 'WAIT') { found = s; break; }
  }
  const sig = found || evaluateAt(candles, ind, L, o);
  sig.closedCandleTime = candles[L]?.time;
  if (!found) return sig;

  const dir = sig.action === 'BUY' ? 1 : -1;
  sig.signalTime = candles[k].time + tfSec;               // when that candle closed
  sig.expiresAt = candles[k].time + (o.validBars + 1) * tfSec;
  sig.barsAgo = L - k;
  for (let j = k + 1; j < candles.length; j++) {
    const c = candles[j];
    if (dir === 1 ? c.low <= sig.stopLoss : c.high >= sig.stopLoss) { sig.outcome = 'SL'; break; }
    if (dir === 1 ? c.high >= sig.tp1 : c.low <= sig.tp1) { sig.outcome = 'TP1'; break; }
  }
  return sig;
}

module.exports = { evaluateAt, liveSignal, signalStatus, DEFAULTS, MAX_SCORE };
