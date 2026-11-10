// "Trade right now" signal with a MEASURED success rate.
// Score = average vote of 13 indicators on the chosen timeframe and every higher one (4h, 1d),
// computed for EVERY past candle (no look-ahead). Then: how often did a trade in the score's
// direction, entered when the score was at least this strong, hit the target (2.5R) before the
// stop (1.5 ATR)? Costs included. This is what the success / loss rate means.

const S = require('./strategy');
const I = require('./indicators');
const { INSTRUMENTS, positionSize } = require('./instruments');

const SL_ATR = 1.5, TP_R = 2.5, MAX_HOLD = 120;

const rmax = (x, n) => x.map((_, i) => (i < n - 1 ? NaN : Math.max(...x.slice(i - n + 1, i + 1))));
const rmin = (x, n) => x.map((_, i) => (i < n - 1 ? NaN : Math.min(...x.slice(i - n + 1, i + 1))));
const rmean = (x, n) => x.map((_, i) => (i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));

// vector of scores (−1…+1) for every candle of one timeframe
function scoreSeries(candles) {
  const n = candles.length;
  const F = S.features(candles);
  const { o, h, l, c } = F, a = F.atr;
  const mac = I.macd(c), bb = I.bollinger(c, 20, 2);
  const hh9 = rmax(h, 9), ll9 = rmin(l, 9), hh26 = rmax(h, 26), ll26 = rmin(l, 26), hh52 = rmax(h, 52), ll52 = rmin(l, 52);
  const hh14 = rmax(h, 14), ll14 = rmin(l, 14);
  const k = c.map((v, i) => (hh14[i] === ll14[i] ? 50 : (100 * (v - ll14[i])) / (hh14[i] - ll14[i])));
  const kS = rmean(k, 3), dS = rmean(kS, 3);
  const hh100 = rmax(h, 100), ll100 = rmin(l, 100);
  // supertrend
  const st = []; { let up = 0, dn = 0, dir = 1; for (let i = 0; i < n; i++) { const mid = (h[i] + l[i]) / 2, bu = mid + 3 * a[i], bl = mid - 3 * a[i], pc = i ? c[i - 1] : c[0]; up = i && (bu < up || pc > up) ? bu : i ? up : bu; dn = i && (bl > dn || pc < dn) ? bl : i ? dn : bl; if (c[i] > up) dir = 1; else if (c[i] < dn) dir = -1; st.push(dir); } }
  const out = new Array(n).fill(NaN);
  for (let i = 210; i < n; i++) {
    const p = c[i], v = [];
    v.push(p > F.ema200[i] && F.ema50[i] > F.ema200[i] ? 1 : p < F.ema200[i] && F.ema50[i] < F.ema200[i] ? -1 : 0);
    v.push(F.ema20[i] > F.ema50[i] ? 1 : -1);
    v.push(F.adx[i] < 20 ? 0 : F.pdi[i] > F.ndi[i] ? 1 : -1);
    const j = i - 26;
    if (j >= 52) {
      const tenkan = (hh9[i] + ll9[i]) / 2, kijun = (hh26[i] + ll26[i]) / 2;
      const sA = ((hh9[j] + ll9[j]) / 2 + (hh26[j] + ll26[j]) / 2) / 2, sB = (hh52[j] + ll52[j]) / 2;
      v.push(p > Math.max(sA, sB) && tenkan > kijun ? 1 : p < Math.min(sA, sB) && tenkan < kijun ? -1 : 0);
    } else v.push(0);
    v.push(st[i]);
    const r = F.rsi[i]; v.push(r > 75 || r < 25 ? 0 : r > 55 ? 1 : r < 45 ? -1 : 0);
    v.push(mac.hist[i] > 0 ? 1 : mac.hist[i] < 0 ? -1 : 0);
    v.push(kS[i] > dS[i] && kS[i] < 80 ? 1 : kS[i] < dS[i] && kS[i] > 20 ? -1 : 0);
    const roc = ((p - c[i - 10]) / c[i - 10]) * 100; v.push(Math.abs(roc) < 0.05 ? 0 : roc > 0 ? 1 : -1);
    const pb = (p - bb.lower[i]) / (bb.upper[i] - bb.lower[i]); v.push(pb > 1 || pb < 0 ? 0 : pb > 0.55 ? 1 : pb < 0.45 ? -1 : 0);
    const up = hh100[i] - p, dn = p - ll100[i]; v.push(up > 1.5 * dn ? 1 : dn > 1.5 * up ? -1 : 0); // room to move (range position)
    const iH = h.lastIndexOf(hh100[i], i), iL = l.lastIndexOf(ll100[i], i), upLeg = iL < iH;
    const ret = upLeg ? (hh100[i] - p) / (hh100[i] - ll100[i]) : (p - ll100[i]) / (hh100[i] - ll100[i]);
    v.push(ret >= 0.382 && ret <= 0.618 ? (upLeg ? 1 : -1) : 0);
    const body = Math.abs(c[i] - o[i]), rng = h[i] - l[i] || 1e-9, upW = h[i] - Math.max(o[i], c[i]), loW = Math.min(o[i], c[i]) - l[i], pB = Math.abs(c[i - 1] - o[i - 1]);
    v.push(c[i] > o[i] && c[i - 1] < o[i - 1] && c[i] >= o[i - 1] && o[i] <= c[i - 1] && body > pB ? 1
      : c[i] < o[i] && c[i - 1] > o[i - 1] && c[i] <= o[i - 1] && o[i] >= c[i - 1] && body > pB ? -1
        : loW > 2 * body && upW < body && body / rng < 0.35 ? 1 : upW > 2 * body && loW < body && body / rng < 0.35 ? -1 : 0);
    out[i] = v.reduce((x, y) => x + y, 0) / v.length;
  }
  return { score: out, F };
}

// map a higher-TF score series onto base candles (completed higher candles only)
function mapHigher(base, higher, hScore, sec) {
  let k = -1;
  return base.map((c) => {
    while (k + 1 < higher.length && higher[k + 1].time + sec <= c.time) k++; // only higher candles already closed
    return k >= 0 ? hScore[k] : NaN;
  });
}

const W = { '5m': 0.7, '15m': 1, '1h': 1.5, '4h': 2, '1d': 2 };
const SEC = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const ORDER = ['5m', '15m', '1h', '4h', '1d'];

// candlesBy: { tf: candles } for the base tf (long history) and higher tfs
function nowSignal(symbol, tf, candlesBy, livePrice) {
  const base = candlesBy[tf];
  const tfs = ORDER.slice(ORDER.indexOf(tf)).filter((t) => candlesBy[t]);
  const { score: s0, F } = scoreSeries(base);
  let num = s0.map((v) => W[tf] * v), den = W[tf];
  const used = [tf];
  for (const t of tfs.slice(1)) {
    const { score } = scoreSeries(candlesBy[t]);
    const m = mapHigher(base, candlesBy[t], score, SEC[t]);
    if (!m.some((x) => Number.isFinite(x))) continue;
    num = num.map((v, i) => v + W[t] * m[i]);
    den += W[t]; used.push(t);
  }
  const score = num.map((v) => v / den);
  const L = base.length - 2;
  const now = score[L];
  if (!Number.isFinite(now)) return { error: 'Candles මදි' };
  const dir = now >= 0 ? 1 : -1;
  const strength = Math.abs(now);

  // measure: past occasions with the same direction and at least this strength (one trade at a time)
  const inst = INSTRUMENTS[symbol];
  const cost = (e) => (inst.costPct ? inst.costPct * e : inst.cost || 0);
  const thr = Math.max(0.05, strength - 0.05);
  const res = [];
  let i = 250;
  while (i < L - 1) {
    const sc = score[i];
    if (!Number.isFinite(sc) || Math.sign(sc) !== dir || Math.abs(sc) < thr) { i++; continue; }
    const e = F.o[i + 1], risk = SL_ATR * F.atr[i];
    const stop = e - dir * risk, tp = e + dir * TP_R * risk, cR = cost(e) / risk;
    let out = null, j = i + 1;
    for (; j < base.length && j <= i + MAX_HOLD; j++) {
      if (dir === 1 ? F.l[j] <= stop : F.h[j] >= stop) { out = -1; break; }
      if (dir === 1 ? F.h[j] >= tp : F.l[j] <= tp) { out = TP_R; break; }
    }
    if (out == null) { if (j >= base.length) break; out = (dir * (F.c[Math.min(j, base.length - 1)] - e)) / risk; }
    res.push(out - cR);
    i = j;
  }
  const n = res.length, wins = res.filter((r) => r > 0).length;
  const days = (base[L].time - base[250].time) / 86400;
  const price = livePrice ?? F.c[L], a = F.atr[L];
  const sl = price - dir * SL_ATR * a, target = price + dir * TP_R * SL_ATR * a;
  return {
    action: strength < 0.1 ? 'WEAK' : dir === 1 ? 'BUY' : 'SELL',
    direction: dir === 1 ? 'BUY' : 'SELL',
    score: +now.toFixed(3), strength: Math.round(strength * 100), timeframes: used,
    entry: price, stopLoss: sl, target, rr: TP_R,
    risk: { distance: Math.abs(price - sl), pips: Math.abs(price - sl) / inst.pip, lots1pct1000: positionSize(symbol, price, sl, 10)?.lots ?? null },
    measured: { occasions: n, winRate: n ? Math.round((wins / n) * 100) : null, lossRate: n ? Math.round(((n - wins) / n) * 100) : null, netR: +res.reduce((x, y) => x + y, 0).toFixed(2), days: Math.round(days), threshold: Math.round(thr * 100) },
  };
}

module.exports = { nowSignal, scoreSeries };
