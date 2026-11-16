// Trained scalping model (LightGBM, research/scalp_ml.py + scalp_export.py).
// For every closed 15m candle it predicts the expected result (in R, after costs) of a
// LONG and a SHORT trade with TP = 1.5×ATR, SL = 1.0×ATR, time stop 32 candles (8h).
// The bot trades the better side only when the prediction is above the threshold.
// Indicators are written to match the Python (pandas) versions exactly — see test/scalp-parity.

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
function macdHist(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26), m = e12.map((v, i) => v - e26[i]), s = ema(m, 9);
  return m.map((v, i) => v - s[i]);
}
const rollMean = (x, n, i) => { if (i < n - 1) return NaN; let s = 0; for (let k = i - n + 1; k <= i; k++) s += x[k]; return s / n; };
const rollStd = (x, n, i) => { if (i < n - 1) return NaN; const m = rollMean(x, n, i); let s = 0; for (let k = i - n + 1; k <= i; k++) s += (x[k] - m) ** 2; return Math.sqrt(s / (n - 1)); };
const rollMax = (x, n, i) => { if (i < n - 1) return NaN; let m = -Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.max(m, x[k]); return m; };
const rollMin = (x, n, i) => { if (i < n - 1) return NaN; let m = Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.min(m, x[k]); return m; };

// spread used for the atr/spread feature: research median, scaled to today's price level
function spreadFor(symbol, price, spreads) {
  if (spreads) return spreads;
  const med = M.spreadMedian[symbol], ref = M.refPrice[symbol];
  return med * (price / ref);
}

// candles: 15m candles, oldest→newest; i = index of the CLOSED candle to evaluate (default: last closed)
// spreadsArr (optional, for parity tests) = real spread per candle
function featuresAt(symbol, candles, i, spreadsArr) {
  const c = candles.map((x) => x.close), h = candles.map((x) => x.high), l = candles.map((x) => x.low), o = candles.map((x) => x.open);
  const a = atr(h, l, c), r = rsi(c), r7 = rsi(c, 7), A = adx(h, l, c), m = macdHist(c);
  const e20 = ema(c, 20), e50 = ema(c, 50), e80 = ema(c, 80), e200 = ema(c, 200);
  const t = new Date(candles[i].time * 1000);
  const sp = spreadsArr ? spreadsArr[i] : spreadFor(symbol, c[i]);
  const sh = (k) => (i - k >= 0 ? c[i - k] : NaN);
  const base = {
    hour: t.getUTCHours(), dow: (t.getUTCDay() + 6) % 7,
    atr_sp: a[i] / Math.max(sp, 1e-9), atr_rel: a[i] / rollMean(a, 96, i),
    adx: A.adx[i], di: A.pdi[i] - A.ndi[i],
    d20: (c[i] - e20[i]) / a[i], d50: (c[i] - e50[i]) / a[i], d200: (c[i] - e200[i]) / a[i],
    tr1h: Math.sign(e80[i] - e200[i]), s20: (e20[i] - (i >= 4 ? e20[i - 4] : e20[i])) / a[i],
    macd: m[i] / a[i], r1: (c[i] - sh(1)) / a[i], r4: (c[i] - sh(4)) / a[i], r16: (c[i] - sh(16)) / a[i], r96: (c[i] - sh(96)) / a[i],
    rng: (h[i] - l[i]) / a[i], body: (c[i] - o[i]) / a[i],
    bbz: (c[i] - rollMean(c, 20, i)) / rollStd(c, 20, i),
    rsi: r[i], rsi7: r7[i], hi20: (rollMax(c, 20, i) - c[i]) / a[i], lo20: (c[i] - rollMin(c, 20, i)) / a[i],
  };
  const DIRF = ['d20', 'd50', 'd200', 'tr1h', 's20', 'macd', 'r1', 'r4', 'r16', 'r96', 'body', 'bbz', 'di'];
  const pairIdx = M.pairs.indexOf(symbol);
  const vec = (d) => {
    const f = { ...base, dir: d, pair: pairIdx };
    for (const k of DIRF) f[k] = base[k] * d;
    f.rsi_d = d > 0 ? base.rsi : 100 - base.rsi; f.rsi7_d = d > 0 ? base.rsi7 : 100 - base.rsi7;
    f.hi_d = d > 0 ? base.hi20 : base.lo20; f.lo_d = d > 0 ? base.lo20 : base.hi20;
    return M.feats.map((k) => f[k]);
  };
  return { long: vec(1), short: vec(-1), atr: a[i], price: c[i], info: { rsi: base.rsi, adx: base.adx, trend: base.tr1h, atrRel: base.atr_rel } };
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

// → { long, short, best: 'BUY'|'SELL', score, atr, price }
function predict(symbol, candles, i = candles.length - 2) {
  if (!supported(symbol)) return null;
  if (i < 300) return null;
  const F = featuresAt(symbol, candles, i);
  const pl = predictVec(F.long), ps = predictVec(F.short);
  return { long: pl, short: ps, best: pl >= ps ? 'BUY' : 'SELL', score: Math.max(pl, ps), atr: F.atr, price: F.price, time: candles[i].time, info: F.info };
}

const supported = (s) => M.pairs.includes(s);

module.exports = { predict, featuresAt, predictVec, supported, MODEL: { cfg: M.cfg, threshold: M.threshold, levels: M.levels, research: M.research, trainedOn: M.trainedOn, pairs: M.pairs } };
