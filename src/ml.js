// ML models (trained offline in research/ml_export.py on real tick data) — pure JS inference.
//  Neural network (MLP 4 layers), LSTM (32-candle sequence), LightGBM (gradient boosted trees)
//  Each predicts P(win) for a LONG and a SHORT trade (SL 1.5 ATR, TP 1R, 48h) on 1h candles.
// Research verdict: weak (≈50–53% accuracy). Shown as one extra opinion only.

const path = require('path');
const S = require('./strategy');

let MODELS = null;
function models() {
  if (!MODELS) MODELS = require(path.join(__dirname, 'ml-models.json'));
  return MODELS;
}

// ---------- pandas-compatible helpers ----------
const ewm = (x, alpha) => { const o = new Array(x.length); let y = x[0]; for (let i = 0; i < x.length; i++) { y = i === 0 ? x[0] : alpha * x[i] + (1 - alpha) * y; o[i] = y; } return o; };
const ema = (x, n) => ewm(x, 2 / (n + 1));
function rolling(x, n, fn) { return x.map((_, i) => (i < n - 1 ? NaN : fn(x.slice(i - n + 1, i + 1)))); }
const rmean = (x, n) => rolling(x, n, (w) => w.reduce((a, b) => a + b, 0) / n);
const rstd = (x, n) => rolling(x, n, (w) => { const m = w.reduce((a, b) => a + b, 0) / n; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); });
const rmax = (x, n) => rolling(x, n, (w) => Math.max(...w));
const rmin = (x, n) => rolling(x, n, (w) => Math.min(...w));
const lag = (x, n) => x.map((_, i) => (i < n ? NaN : x[i - n]));

// value of fn(higher-TF candles) for each base candle, from COMPLETED higher candles only
function htf(candles, sec, fn) {
  const B = [];
  for (const c of candles) {
    const b = Math.floor(c.time / sec);
    const last = B[B.length - 1];
    if (!last || last.b !== b) B.push({ b, open: c.open, high: c.high, low: c.low, close: c.close });
    else { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; }
  }
  const vals = fn(B);
  let k = -1;
  return candles.map((c) => {
    const b = Math.floor(c.time / sec);
    while (k + 1 < B.length && B[k + 1].b < b) k++;
    return k >= 0 ? vals[k] : NaN;
  });
}

// ---------- the 41 features (same as research/ml_features.py) ----------
function featureMatrix(candles) {
  const F = S.features(candles);
  const { o, h, l, c } = F, a = F.atr, n = c.length;
  const X = {};
  for (const k of [1, 3, 6, 12, 24, 48]) { const cl = lag(c, k); X[`ret${k}`] = c.map((v, i) => (v - cl[i]) / a[i]); }
  for (const k of [20, 50, 200]) {
    const e = F[`ema${k}`], el = lag(e, 5);
    X[`dist_ema${k}`] = c.map((v, i) => (v - e[i]) / a[i]);
    X[`slope_ema${k}`] = e.map((v, i) => (v - el[i]) / a[i]);
  }
  X.rsi = F.rsi; const rl = lag(F.rsi, 3); X.rsi_d3 = F.rsi.map((v, i) => v - rl[i]);
  const e26 = ema(c, 26), e12 = ema(c, 12), mline = e12.map((v, i) => v - e26[i]), msig = ema(mline, 9);
  X.macd = mline.map((v, i) => (v - msig[i]) / a[i]);
  X.adx = F.adx; X.di = F.pdi.map((v, i) => v - F.ndi[i]);
  const hh14 = rmax(h, 14), ll14 = rmin(l, 14);
  const k = c.map((v, i) => (100 * (v - ll14[i])) / (hh14[i] - ll14[i] === 0 ? 1e-12 : hh14[i] - ll14[i]));
  const k3 = rmean(k, 3), d3 = rmean(k3, 3);
  X.stoch_k = k3; X.stoch_kd = k3.map((v, i) => v - d3[i]);
  const m20 = rmean(c, 20), sd = rstd(c, 20);
  X.bb_pb = c.map((v, i) => (v - (m20[i] - 2 * sd[i])) / (sd[i] === 0 ? 1e-12 : 4 * sd[i]));
  X.bb_w = sd.map((v, i) => (4 * v) / a[i]);
  const a100 = rmean(a, 100);
  X.atr_pct = a.map((v, i) => (v / c[i]) * 100); X.atr_ratio = a.map((v, i) => v / a100[i]);
  for (const nn of [20, 55]) { const H = rmax(h, nn), L = rmin(l, nn); X[`don${nn}`] = c.map((v, i) => (v - L[i]) / (H[i] - L[i] === 0 ? 1e-12 : H[i] - L[i])); }
  X.htf4 = F.htf4; X.htfD = F.htfD;
  const rng = h.map((v, i) => (v - l[i] === 0 ? 1e-12 : v - l[i]));
  X.body = c.map((v, i) => (v - o[i]) / rng[i]);
  X.upw = h.map((v, i) => (v - Math.max(o[i], c[i])) / rng[i]);
  X.low = l.map((v, i) => (Math.min(o[i], c[i]) - v) / rng[i]);
  const dirs = c.map((v, i) => Math.sign(v - o[i]));
  for (const j of [1, 2, 3]) X[`dir${j}`] = lag(dirs, j);
  const hr = F.hour, dw = candles.map((x) => (new Date(x.time * 1000).getUTCDay() + 6) % 7);
  X.hr_s = hr.map((v) => Math.sin((2 * Math.PI * v) / 24)); X.hr_c = hr.map((v) => Math.cos((2 * Math.PI * v) / 24)); X.dow = dw;
  const H4 = 4 * 3600, D1 = 86400;
  const cl = (B) => B.map((x) => x.close), hi_ = (B) => B.map((x) => x.high), lo_ = (B) => B.map((x) => x.low);
  X.rsi_4h = htf(candles, H4, (B) => S.rsiSeries(cl(B)));
  X.dist_ema50_4h = htf(candles, H4, (B) => { const e = ema(cl(B), 50), at = S.atrSeries(hi_(B), lo_(B), cl(B)); return cl(B).map((v, i) => (v - e[i]) / at[i]); });
  X.adx_4h = htf(candles, H4, (B) => S.adxSeries(hi_(B), lo_(B), cl(B)).adx);
  X.rsi_d = htf(candles, D1, (B) => S.rsiSeries(cl(B)));
  X.dist_ema20_d = htf(candles, D1, (B) => { const e = ema(cl(B), 20), at = S.atrSeries(hi_(B), lo_(B), cl(B)); return cl(B).map((v, i) => (v - e[i]) / at[i]); });
  return X;
}

// ---------- model inference ----------
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
function mlp(layers, x) {
  let v = x;
  layers.forEach((L, li) => {
    v = L.W.map((row, r) => row.reduce((s, w, j) => s + w * v[j], L.b[r]));
    if (li < layers.length - 1) v = v.map((z) => Math.max(0, z));
  });
  return sigmoid(v[0]);
}
function lstm(P, seq) {
  const Hn = P.Whh[0].length; let h = new Array(Hn).fill(0), c = new Array(Hn).fill(0);
  for (const x of seq) {
    const g = P.Wih.map((row, r) => row.reduce((s, w, j) => s + w * x[j], P.bih[r]) + P.Whh[r].reduce((s, w, j) => s + w * h[j], P.bhh[r]));
    const nh = new Array(Hn), nc = new Array(Hn);
    for (let u = 0; u < Hn; u++) {
      const ig = sigmoid(g[u]), fg = sigmoid(g[Hn + u]), gg = Math.tanh(g[2 * Hn + u]), og = sigmoid(g[3 * Hn + u]);
      nc[u] = fg * c[u] + ig * gg; nh[u] = og * Math.tanh(nc[u]);
    }
    h = nh; c = nc;
  }
  return sigmoid(h.reduce((s, v, j) => s + v * P.Wo[j], P.bo));
}
function tree(node, x) {
  while (node.leaf_value === undefined) {
    const v = x[node.split_feature];
    let left;
    if (v == null || Number.isNaN(v)) left = node.missing_type === 'NaN' ? node.default_left : node.missing_type === 'None' ? 0 <= node.threshold : node.default_left;
    else left = v <= node.threshold;
    node = left ? node.left_child : node.right_child;
  }
  return node.leaf_value;
}
const lgbm = (M, x) => sigmoid(M.trees.reduce((s, t) => s + tree(t.tree_structure, x), 0));

function predictAt(symbol, candles, i, Xopt) {
  const M = models()[symbol];
  if (!M) return null;
  const X = Xopt || featureMatrix(candles);
  const at = (j) => M.cols.map((cname) => X[cname][j]);
  const x = at(i);
  if (x.some((v) => v == null || Number.isNaN(v))) return { error: 'features ගණනය කරන්න candles මදි' };
  const xn = x.map((v, j) => (v - M.mu[j]) / M.sd[j]);
  const sf = M.seqFeats.map((f) => M.cols.indexOf(f));
  const seq = [];
  for (let j = i - M.seqLen + 1; j <= i; j++) seq.push(sf.map((ci) => { const v = (X[M.cols[ci]][j] - M.mu[ci]) / M.sd[ci]; return Number.isFinite(v) ? v : 0; }));
  const out = {};
  for (const side of ['long', 'short']) {
    const md = M.models[side];
    const p = { lgb: lgbm(md.lgb, x), mlp: mlp(md.mlp, xn), lstm: lstm(md.lstm, seq) };
    p.ens = (p.lgb + p.mlp + p.lstm) / 3;
    out[side] = p;
  }
  return { ...out, x, time: candles[i].time };
}

// latest closed 1h candle → per-model direction + filter verdict for a strategy direction
function analyze(symbol, candles1h, strategyAction) {
  const M = models()[symbol];
  if (!M) return { available: false, reason: 'ML models train කළේ XAUUSD සහ EURUSD වලට විතරයි' };
  const ens = (M.valAcc.long.ens + M.valAcc.short.ens) / 2;
  if (ens < 0.505) return { available: false, reason: `${symbol} එකට ML models වල accuracy ${(ens * 100).toFixed(1)}% (coin එකට වඩා අඩුයි) — ML off` };
  const L = candles1h.length - 2;
  const p = predictAt(symbol, candles1h, L);
  if (!p || p.error) return { available: false, reason: p?.error || 'error' };
  const view = (k) => { const pl = p.long[k], ps = p.short[k]; return pl >= ps ? { dir: 'BUY', prob: pl } : { dir: 'SELL', prob: ps }; };
  const res = { available: true, trainedOn: M.trainedOn, valAcc: +(ens * 100).toFixed(1), models: { mlp: view('mlp'), lstm: view('lstm'), lgb: view('lgb'), ens: view('ens') } };
  res.vote = res.models.ens.dir === 'BUY' ? 1 : -1;
  if (['BUY', 'SELL'].includes(strategyAction)) {
    const side = strategyAction === 'BUY' ? 'long' : 'short';
    res.filter = { ok: p[side].ens >= M.median[side].ens, prob: p[side].ens, median: M.median[side].ens };
  }
  return res;
}

module.exports = { featureMatrix, predictAt, analyze, models };
