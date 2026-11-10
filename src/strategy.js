// Researched strategies (ported 1:1 from the Python research engine).
// All series use pandas-style ewm(adjust=False) so results match the research.
//
//  pullback  — trend pullback: higher-TF trend + EMA20>50>200 stack + ADX strength,
//              price touched EMA20 recently, RSI crosses back through 50 → entry
//  breakout  — Donchian breakout of the last N candles in the higher-TF trend direction
//
// Everything at index i only uses data up to and including candle i (no look-ahead).

function ewm(x, alpha) {
  const out = new Array(x.length);
  let y = x[0];
  for (let i = 0; i < x.length; i++) { y = i === 0 ? x[0] : alpha * x[i] + (1 - alpha) * y; out[i] = y; }
  return out;
}
const ema = (x, n) => ewm(x, 2 / (n + 1));
const wilder = (x, n) => ewm(x, 1 / n);

function atrSeries(h, l, c, n = 14) {
  const tr = c.map((_, i) => {
    const pc = i === 0 ? c[0] : c[i - 1];
    return Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
  });
  return wilder(tr, n);
}

function rsiSeries(c, n = 14) {
  const d = c.map((v, i) => (i === 0 ? 0 : v - c[i - 1]));
  const g = wilder(d.map((v) => Math.max(v, 0)), n);
  const l = wilder(d.map((v) => Math.max(-v, 0)), n);
  return g.map((gv, i) => 100 - 100 / (1 + gv / (l[i] === 0 ? 1e-12 : l[i])));
}

function adxSeries(h, l, c, n = 14) {
  const pdm = [], ndm = [];
  for (let i = 0; i < h.length; i++) {
    const up = i === 0 ? 0 : h[i] - h[i - 1];
    const dn = i === 0 ? 0 : l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  const a = atrSeries(h, l, c, n);
  const sp = wilder(pdm, n), sn = wilder(ndm, n);
  const pdi = sp.map((v, i) => (100 * v) / a[i]);
  const ndi = sn.map((v, i) => (100 * v) / a[i]);
  const dx = pdi.map((p, i) => { const s = p + ndi[i]; return (100 * Math.abs(p - ndi[i])) / (s === 0 ? 1e-12 : s); });
  return { adx: wilder(dx, n), pdi, ndi };
}

function rollingMin(x, n) { return x.map((_, i) => (i < n - 1 ? NaN : Math.min(...x.slice(i - n + 1, i + 1)))); }
function rollingMax(x, n) { return x.map((_, i) => (i < n - 1 ? NaN : Math.max(...x.slice(i - n + 1, i + 1)))); }

// Higher-timeframe trend from COMPLETED higher candles (UTC buckets of `sec` seconds).
// +1 = price above EMA(n) and EMA rising, -1 = below and falling, 0 = mixed.
function htfTrend(candles, sec, n) {
  const buckets = []; // {b, close}
  for (const c of candles) {
    const b = Math.floor(c.time / sec);
    if (!buckets.length || buckets[buckets.length - 1].b !== b) buckets.push({ b, close: c.close });
    else buckets[buckets.length - 1].close = c.close;
  }
  const e = ema(buckets.map((x) => x.close), n);
  const vals = buckets.map((x, k) => {
    const side = Math.sign(x.close - e[k]);
    const slope = k === 0 ? NaN : e[k] - e[k - 1];
    return slope * side > 0 ? side : 0;
  });
  // a candle in bucket b only knows completed buckets (the latest one before b)
  let k = -1;
  return candles.map((c) => {
    const b = Math.floor(c.time / sec);
    while (k + 1 < buckets.length && buckets[k + 1].b < b) k++;
    return k >= 0 ? vals[k] : 0;
  });
}

function features(candles) {
  const o = candles.map((c) => c.open), h = candles.map((c) => c.high), l = candles.map((c) => c.low), c = candles.map((x) => x.close);
  const F = { o, h, l, c, time: candles.map((x) => x.time) };
  F.atr = atrSeries(h, l, c);
  F.rsi = rsiSeries(c);
  Object.assign(F, adxSeries(h, l, c));
  F.ema20 = ema(c, 20); F.ema50 = ema(c, 50); F.ema200 = ema(c, 200);
  F.hour = candles.map((x) => new Date(x.time * 1000).getUTCHours());
  F.htf4 = htfTrend(candles, 4 * 3600, 50);
  F.htfD = htfTrend(candles, 86400, 20);
  return F;
}

// ---------- strategies → { sig: [-1|0|1], sl: [stop distance] } ----------
function pullback(F, p) {
  const n = F.c.length, lb = p.lookback || 5, htf = F[p.htf || 'htf4'];
  const dLow = F.l.map((v, i) => v - F.ema20[i]);
  const dHigh = F.h.map((v, i) => F.ema20[i] - v);
  const minLow = rollingMin(dLow, lb), maxHigh = rollingMax(dHigh, lb);
  const sig = new Array(n).fill(0), sl = F.atr.map((a) => p.sl * a);
  for (let i = 0; i < n; i++) {
    const r = F.rsi[i], rp = i === 0 ? 50 : F.rsi[i - 1];
    const strong = F.adx[i] > p.adx;
    const up = htf[i] > 0 && F.ema20[i] > F.ema50[i] && F.ema50[i] > F.ema200[i] && strong;
    const dn = htf[i] < 0 && F.ema20[i] < F.ema50[i] && F.ema50[i] < F.ema200[i] && strong;
    const touchedDn = minLow[i] <= p.touch * F.atr[i];
    const touchedUp = maxHigh[i] <= p.touch * F.atr[i];
    if (up && touchedDn && r > p.rsi && rp <= p.rsi && F.c[i] > F.ema20[i]) sig[i] = 1;
    else if (dn && touchedUp && r < 100 - p.rsi && rp >= 100 - p.rsi && F.c[i] < F.ema20[i]) sig[i] = -1;
  }
  return { sig, sl };
}

function breakout(F, p) {
  const n = F.c.length, htf = F[p.htf || 'htf4'];
  const hh = rollingMax(F.h, p.n), ll = rollingMin(F.l, p.n);
  const sig = new Array(n).fill(0), sl = F.atr.map((a) => p.sl * a);
  for (let i = 1; i < n; i++) {
    const H = hh[i - 1], L = ll[i - 1];
    if (!Number.isFinite(H)) continue;
    const sess = !p.hours || p.hours.includes(F.hour[i]);
    const strong = F.adx[i] > (p.adx || 0);
    const cp = F.c[i - 1];
    if (F.c[i] > H && cp <= H && htf[i] > 0 && sess && strong) sig[i] = 1;
    else if (F.c[i] < L && cp >= L && htf[i] < 0 && sess && strong) sig[i] = -1;
  }
  return { sig, sl };
}

const STRATEGIES = { pullback, breakout };

// ---------- simulator (same rules as research) ----------
// Enter at next candle open; SL checked before TP inside a candle (conservative);
// cost (spread+commission, round trip, price units) subtracted in R.
function simulate(F, sig, sl, ex = {}, costAt = () => 0, start = 250) {
  const tpR = ex.tpR ?? 3, beR = ex.beR ?? null, trail = ex.trailAtr ?? null, maxBars = ex.maxBars ?? null;
  const n = F.c.length, trades = [];
  let i = start;
  while (i < n - 1) {
    const d = sig[i], risk = sl[i];
    if (!d || !(risk > 0)) { i++; continue; }
    const e = F.o[i + 1];
    let stop = e - d * risk; const tp = e + d * tpR * risk;
    const costR = costAt(i, e) / risk;
    let moved = false, j = i + 1, out = null, reason = '';
    for (; j < n; j++) {
      if (d === 1) {
        if (F.l[j] <= stop) { out = (stop - e) / risk; reason = moved ? 'BE/TRAIL' : 'SL'; break; }
        if (F.h[j] >= tp) { out = tpR; reason = 'TP'; break; }
      } else {
        if (F.h[j] >= stop) { out = (e - stop) / risk; reason = moved ? 'BE/TRAIL' : 'SL'; break; }
        if (F.l[j] <= tp) { out = tpR; reason = 'TP'; break; }
      }
      const fav = d * ((d === 1 ? F.h[j] : F.l[j]) - e) / risk;
      if (beR != null && !moved && fav >= beR) { stop = e; moved = true; }
      if (trail != null && fav >= 1) {
        const cand = d === 1 ? F.c[j] - trail * F.atr[j] : F.c[j] + trail * F.atr[j];
        stop = d === 1 ? Math.max(stop, cand) : Math.min(stop, cand); moved = true;
      }
      if (maxBars != null && j - i >= maxBars) { out = (d * (F.c[j] - e)) / risk; reason = 'TIME'; break; }
    }
    if (out == null) break; // still open at the end of data
    trades.push({ i, side: d === 1 ? 'BUY' : 'SELL', entryTime: F.time[i + 1], exitTime: F.time[j], entry: e, stop: e - d * risk, target: tp, r: out - costR, gross: out, cost: costR, reason });
    i = j;
  }
  return trades;
}

function stats(trades, tpR = 3) {
  const r = trades.map((t) => t.r);
  let eq = 0, peak = 0, dd = 0, gw = 0, gl = 0;
  const curve = [];
  for (const t of trades) {
    eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    if (t.r > 0) gw += t.r; else gl -= t.r;
    curve.push({ time: t.exitTime, value: +eq.toFixed(2) });
  }
  const wins = r.filter((x) => x > 0).length;
  return {
    trades: r.length, wins, losses: r.length - wins,
    winRate: r.length ? +((wins / r.length) * 100).toFixed(1) : 0,
    netR: +eq.toFixed(2),
    profitFactor: gl ? +(gw / gl).toFixed(2) : (gw ? 99 : null),
    maxDrawdownR: +dd.toFixed(2),
    expectancy: r.length ? +(eq / r.length).toFixed(3) : 0,
    breakEvenWinRate: +((1 / (1 + tpR)) * 100).toFixed(1),
    tpR, curve,
  };
}

module.exports = { features, STRATEGIES, simulate, stats, ema, rsiSeries, atrSeries, adxSeries };
