// Trained scalping model v2 (LightGBM, research/scalp_ml2.py + scalp_export2.py).
// The bot "studies" ~57 inputs on every check: trend & momentum indicators (EMA 9/20/21/50/200/800,
// RSI 7/14, Stochastic, Williams %R, CCI, MACD, ADX/DI, Supertrend, Bollinger, Donchian, ATR),
// candlestick patterns (engulfing, hammer / shooting star, morning / evening star, doji,
// inside bar, wicks, runs of same-colour candles) and the bigger picture (1h / 4h trend & RSI,
// last-24h high/low, session hour).
// For a 15m candle it predicts the expected result (R, after costs) of a BUY and a SELL with
// TP = tp×ATR, SL = sl×ATR, time stop T candles. Indicators match the Python versions exactly.

const M = require('./scalp-model.json');

const emaA = (x, a) => { const y = new Array(x.length); let p = x[0]; for (let i = 0; i < x.length; i++) { p = i ? a * x[i] + (1 - a) * p : x[0]; y[i] = p; } return y; };
const ema = (x, n) => emaA(x, 2 / (n + 1));
const wilder = (x, n) => emaA(x, 1 / n);
function atr(h, l, c, n = 14) {
  const tr = c.map((_, i) => { const pc = i ? c[i - 1] : c[0]; return Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); });
  return wilder(tr, n);
}
function rsi(c, n = 14) {
  const d = c.map((v, i) => (i ? v - c[i - 1] : 0));
  const g = wilder(d.map((v) => Math.max(v, 0)), n), l = wilder(d.map((v) => Math.max(-v, 0)), n);
  return g.map((v, i) => 100 - 100 / (1 + v / (l[i] === 0 ? 1e-12 : l[i])));
}
function adx(h, l, c, n = 14) {
  const up = h.map((v, i) => (i ? v - h[i - 1] : 0)), dn = l.map((v, i) => (i ? l[i - 1] - v : 0));
  const pdm = up.map((u, i) => (u > dn[i] && u > 0 ? u : 0)), ndm = dn.map((d, i) => (d > up[i] && d > 0 ? d : 0));
  const a = atr(h, l, c, n), wp = wilder(pdm, n), wn = wilder(ndm, n);
  const pdi = wp.map((v, i) => (100 * v) / a[i]), ndi = wn.map((v, i) => (100 * v) / a[i]);
  const dx = pdi.map((p, i) => { const s = p + ndi[i]; return (100 * Math.abs(p - ndi[i])) / (s === 0 ? 1e-12 : s); });
  return { adx: wilder(dx, n), pdi, ndi };
}
// pandas-style rolling (NaN until the window is full, NaN if any NaN inside)
function rolling(x, n, fn) {
  const out = new Array(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    const w = x.slice(i - n + 1, i + 1);
    if (w.some((v) => Number.isNaN(v))) continue;
    out[i] = fn(w);
  }
  return out;
}
const mean = (w) => w.reduce((a, b) => a + b, 0) / w.length;
const sma = (x, n) => rolling(x, n, mean);
const rstd = (x, n) => rolling(x, n, (w) => { const m = mean(w); return Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / (w.length - 1)); });
const rmax = (x, n) => rolling(x, n, (w) => Math.max(...w));
const rmin = (x, n) => rolling(x, n, (w) => Math.min(...w));
const shift = (x, k, fill = NaN) => x.map((_, i) => (i - k >= 0 ? x[i - k] : fill));

function supertrend(h, l, c, n = 10, m = 3) {
  const a = atr(h, l, c, n), N = c.length;
  const ub = h.map((v, i) => (v + l[i]) / 2 + m * a[i]), lb = h.map((v, i) => (v + l[i]) / 2 - m * a[i]);
  const fu = ub.slice(), fl = lb.slice(), d = new Array(N).fill(1);
  for (let i = 1; i < N; i++) {
    fu[i] = ub[i] < fu[i - 1] || c[i - 1] > fu[i - 1] ? ub[i] : fu[i - 1];
    fl[i] = lb[i] > fl[i - 1] || c[i - 1] < fl[i - 1] ? lb[i] : fl[i - 1];
    d[i] = c[i] > fu[i - 1] ? 1 : c[i] < fl[i - 1] ? -1 : d[i - 1];
  }
  return { dir: d, line: d.map((v, i) => (v > 0 ? fl[i] : fu[i])) };
}

// spread for the atr/spread input: research median, scaled to today's price level
const spreadFor = (symbol, price) => M.spreadMedian[symbol] * (price / M.refPrice[symbol]);

// All inputs for every candle (arrays). candles: 15m, oldest → newest.
function allFeatures(symbol, candles, spreadsArr) {
  const c = candles.map((x) => x.close), h = candles.map((x) => x.high), l = candles.map((x) => x.low), o = candles.map((x) => x.open);
  const N = c.length;
  const a = atr(h, l, c), r = rsi(c), A = adx(h, l, c);
  const e = Object.fromEntries([9, 20, 21, 50, 80, 200, 800].map((n) => [n, ema(c, n)]));
  const e12 = ema(c, 12), e26 = ema(c, 26), ml = e12.map((v, i) => v - e26[i]), sig = ema(ml, 9), mh = ml.map((v, i) => v - sig[i]);
  const rng = h.map((v, i) => (v - l[i] === 0 ? 1e-12 : v - l[i]));
  const hh14 = rmax(h, 14), ll14 = rmin(l, 14);
  const kraw = c.map((v, i) => { const d = hh14[i] - ll14[i]; if (Number.isNaN(d)) return NaN; return d === 0 ? 50 : (100 * (v - ll14[i])) / d; });
  const stk = sma(kraw, 3), std_ = sma(stk, 3);
  const tp = c.map((v, i) => (h[i] + l[i] + v) / 3), smtp = sma(tp, 20);
  const mad = rolling(tp, 20, (w) => { const m = mean(w); return mean(w.map((v) => Math.abs(v - m))); });
  const cci = tp.map((v, i) => (v - smtp[i]) / (0.015 * (mad[i] === 0 ? 1e-12 : mad[i])));
  const ST = supertrend(h, l, c);
  const hh55 = rmax(h, 55), ll55 = rmin(l, 55);
  const A56 = adx(h, l, c, 56), r56 = rsi(c, 56), r224 = rsi(c, 224), r7 = rsi(c, 7);
  const a7 = atr(h, l, c, 7), a28 = atr(h, l, c, 28), sma_a96 = sma(a, 96);
  const smac = sma(c, 20), stdc = rstd(c, 20), hi20c = rmax(c, 20), lo20c = rmin(c, 20), hh96 = rmax(h, 96), ll96 = rmin(l, 96);
  const po = shift(o, 1), pc = shift(c, 1), o2 = shift(o, 2), c2 = shift(c, 2), a1 = shift(a, 1);
  const runlen = new Array(N).fill(0);
  for (let i = 0; i < N; i++) { const s = Math.sign(c[i] - o[i]); runlen[i] = s === 0 ? 0 : i && Math.sign(runlen[i - 1]) === s ? runlen[i - 1] + s : s; }
  const shiftK = (x, k) => x.map((v, i) => (i >= k ? x[i - k] : x[i]));
  const e20s = shiftK(e[20], 4), e200s = shiftK(e[200], 16);
  return (i) => {
    const t = new Date(candles[i].time * 1000);
    const sp = spreadsArr ? spreadsArr[i] : spreadFor(symbol, c[i]);
    const bull = c[i] > o[i], bear = c[i] < o[i];
    const bodyabs = Math.abs(c[i] - o[i]), uw = h[i] - Math.max(o[i], c[i]), lw = Math.min(o[i], c[i]) - l[i];
    const engulf = bull && pc[i] < po[i] && c[i] >= po[i] && o[i] <= pc[i] ? 1 : bear && pc[i] > po[i] && c[i] <= po[i] && o[i] >= pc[i] ? -1 : 0;
    const pin = lw >= 2 * bodyabs && uw <= bodyabs + 1e-12 && lw > 0 ? 1 : uw >= 2 * bodyabs && lw <= bodyabs + 1e-12 && uw > 0 ? -1 : 0;
    const small1 = Math.abs(pc[i] - po[i]) < 0.3 * a1[i];
    const star = c2[i] < o2[i] && small1 && bull && c[i] > (o2[i] + c2[i]) / 2 ? 1 : c2[i] > o2[i] && small1 && bear && c[i] < (o2[i] + c2[i]) / 2 ? -1 : 0;
    const inside = i > 0 ? (h[i] <= h[i - 1] && l[i] >= l[i - 1] ? 1 : 0) : 1;
    const ai = a[i];
    return {
      hour: t.getUTCHours(), dow: (t.getUTCDay() + 6) % 7,
      atr_sp: ai / Math.max(sp, 1e-9), atr_rel: ai / sma_a96[i],
      rsi: r[i], rsi7: r7[i], adx: A.adx[i], di: A.pdi[i] - A.ndi[i],
      d20: (c[i] - e[20][i]) / ai, d50: (c[i] - e[50][i]) / ai, d200: (c[i] - e[200][i]) / ai,
      tr1h: Math.sign(e[80][i] - e[200][i]), s20: (e[20][i] - e20s[i]) / ai,
      macd: mh[i] / ai, r1: (c[i] - (i >= 1 ? c[i - 1] : NaN)) / ai, r4: (c[i] - (i >= 4 ? c[i - 4] : NaN)) / ai,
      r16: (c[i] - (i >= 16 ? c[i - 16] : NaN)) / ai, r96: (c[i] - (i >= 96 ? c[i - 96] : NaN)) / ai,
      rng: (h[i] - l[i]) / ai, body: (c[i] - o[i]) / ai,
      hi20: (hi20c[i] - c[i]) / ai, lo20: (c[i] - lo20c[i]) / ai, bbz: (c[i] - smac[i]) / stdc[i],
      stk: stk[i], std_: std_[i], wr: kraw[i], cci: cci[i],
      x921: Math.sign(e[9][i] - e[21][i]), g921: (e[9][i] - e[21][i]) / ai, bbw: (4 * stdc[i]) / ai,
      st_dir: ST.dir[i], st_dist: (c[i] - ST.line[i]) / ai,
      don: (c[i] - ll55[i]) / (hh55[i] - ll55[i] === 0 ? 1e-12 : hh55[i] - ll55[i]),
      macdl: ml[i] / ai, atr7_28: a7[i] / a28[i],
      rsi56: r56[i], rsi224: r224[i], adx56: A56.adx[i], di56: A56.pdi[i] - A56.ndi[i],
      d800: (c[i] - e[800][i]) / ai, s200: (e[200][i] - e200s[i]) / ai, tr4h: Math.sign(e[200][i] - e[800][i]),
      hh96: (hh96[i] - c[i]) / ai, ll96: (c[i] - ll96[i]) / ai,
      engulf, pin, star, inside, doji: bodyabs / rng[i] < 0.1 ? 1 : 0,
      uw: uw / rng[i], lw: lw / rng[i], bodyr: bodyabs / rng[i], runlen: runlen[i],
      body1: (pc[i] - po[i]) / ai, body2: (c2[i] - o2[i]) / ai,
      _atr: ai, _price: c[i],
    };
  };
}

// apply BUY / SELL view of the same inputs (metadata from training)
function directional(f, d, pairIdx) {
  const z = { ...f };
  for (const k of M.dirMeta.signed) z[k] = f[k] * d;
  for (const k of M.dirMeta.flip100) z[k] = d > 0 ? f[k] : 100 - f[k];
  for (const k of M.dirMeta.flip1) z[k] = d > 0 ? f[k] : 1 - f[k];
  if (d < 0) for (const [x, y] of M.dirMeta.swap) { z[x] = f[y]; z[y] = f[x]; }
  z.dir = d; z.pair = pairIdx;
  return M.feats.map((k) => z[k]);
}

function featuresAt(symbol, candles, i, spreadsArr) {
  const f = allFeatures(symbol, candles, spreadsArr)(i);
  const p = M.pairs.indexOf(symbol);
  return { long: directional(f, 1, p), short: directional(f, -1, p), atr: f._atr, price: f._price, raw: f };
}

function tree(node, x) {
  while (node.leaf_value === undefined) {
    const v = x[node.split_feature];
    let left;
    if (v == null || Number.isNaN(v)) left = node.missing_type === 'None' ? 0 <= node.threshold : node.default_left;
    else left = v <= node.threshold;
    node = left ? node.left_child : node.right_child;
  }
  return node.leaf_value;
}
const predictVec = (x) => M.trees.reduce((s, t) => s + tree(t.tree_structure, x), 0);

// short human summary of what the bot "saw" (for the log)
function reasons(f, side) {
  const d = side === 'BUY' ? 1 : -1, out = [];
  out.push(`trend ${f.tr1h * d > 0 ? '✓' : '✗'} 1h / ${f.tr4h * d > 0 ? '✓' : '✗'} 4h`);
  out.push(`RSI ${f.rsi.toFixed(0)}`);
  out.push(`Stoch ${f.stk.toFixed(0)}`);
  if (f.st_dir * d > 0) out.push('Supertrend ✓');
  if (f.engulf * d > 0) out.push('Engulfing');
  if (f.pin * d > 0) out.push(d > 0 ? 'Hammer' : 'Shooting star');
  if (f.star * d > 0) out.push(d > 0 ? 'Morning star' : 'Evening star');
  if (f.inside) out.push('Inside bar');
  if (f.doji) out.push('Doji');
  return out.join(' · ');
}

// → { long, short, best, score, atr, price, why }   i = candle to evaluate (default: last)
function predict(symbol, candles, i = candles.length - 1) {
  if (!supported(symbol) || i < 900) return null;
  const F = featuresAt(symbol, candles, i);
  const pl = predictVec(F.long), ps = predictVec(F.short);
  const best = pl >= ps ? 'BUY' : 'SELL';
  return { long: pl, short: ps, best, score: Math.max(pl, ps), atr: F.atr, price: F.price, time: candles[i].time, why: reasons(F.raw, best) };
}

const supported = (s) => M.pairs.includes(s);

module.exports = { predict, featuresAt, predictVec, supported, MODEL: { version: M.version, cfg: M.cfg, threshold: M.threshold, levels: M.levels, research: M.research, trainedOn: M.trainedOn, pairs: M.pairs, nFeatures: M.feats.length } };
