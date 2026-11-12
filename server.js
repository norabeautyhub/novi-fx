require('dotenv').config();
const express = require('express');
const path = require('path');
const { INSTRUMENTS, TIMEFRAMES, positionSize } = require('./src/instruments');
const { getCandles, getPrice } = require('./src/data');
const { computeAll } = require('./src/indicators');
const { liveSignal, signalStatus, setupPlan } = require('./src/signals');
const { TF_SEC } = require('./src/data');
const stream = require('./src/stream');
const { backtest, optimize } = require('./src/backtest');
const N = 2000; // candles for chart + signals
const paper = require('./src/paper');
const ai = require('./src/ai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/lightweight-charts/dist')));

// Optional simple password (set APP_PASSWORD in .env when you put it online)
app.use('/api', (req, res, next) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw || req.get('x-app-password') === pw || req.query.pw === pw) return next();
  res.status(401).json({ error: 'Password වැරදියි' });
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message }));
const sym = (req) => {
  const s = String(req.query.symbol || req.body?.symbol || 'XAUUSD').toUpperCase();
  if (!INSTRUMENTS[s]) throw new Error('Unknown symbol');
  return s;
};
const { MODES } = require('./src/strategy');
const modeOf = (req) => { const m = String(req.query.mode || req.body?.mode || 'normal'); return MODES[m] ? m : 'normal'; };
const tfOf = (req) => {
  const tf = String(req.query.tf || req.body?.tf || '1h');
  if (!TIMEFRAMES.includes(tf)) throw new Error('Unknown timeframe');
  return tf;
};

app.get('/api/config', (req, res) => {
  res.json({
    instruments: INSTRUMENTS,
    timeframes: TIMEFRAMES,
    demoData: process.env.DATA_MODE === 'demo',
    hasTwelveData: !!process.env.TWELVEDATA_API_KEY,
    hasAI: !!process.env.ANTHROPIC_API_KEY,
    needsPassword: !!process.env.APP_PASSWORD,
    hasFinnhub: !!process.env.FINNHUB_API_KEY,
  });
});

app.get('/api/status', (req, res) => {
  const live = {};
  for (const s of Object.keys(INSTRUMENTS)) live[s] = { live: stream.isLive(s), lastTick: stream.book[s]?.time || null };
  res.json({ streams: stream.status, live });
});

// Live prices to the browser (Server-Sent Events). Max ~4 updates/sec per symbol.
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const lastSent = {};
  const send = (t) => res.write(`data: ${JSON.stringify(t)}\n\n`);
  for (const [s, b] of Object.entries(stream.book)) send({ s, p: b.price, t: b.time });
  const onTick = (t) => {
    const now = Date.now();
    if (now - (lastSent[t.s] || 0) < 250) return;
    lastSent[t.s] = now;
    send(t);
  };
  stream.bus.on('tick', onTick);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { stream.bus.off('tick', onTick); clearInterval(ping); });
});

// Server-side live SL/TP check for paper positions (once per second per symbol)
let openSyms = new Set(paper.symbolsOpen());
const lastMark = {};
stream.bus.on('tick', (t) => {
  if (!openSyms.has(t.s) || Date.now() - (lastMark[t.s] || 0) < 1000) return;
  lastMark[t.s] = Date.now();
  try { paper.mark({ [t.s]: t.p }); openSyms = new Set(paper.symbolsOpen()); } catch {}
});

// Candles + indicators for the chart
app.get('/api/candles', wrap(async (req, res) => {
  const candles = await getCandles(sym(req), tfOf(req), N);
  const ind = computeAll(candles);
  const series = (arr) => arr.map((v, i) => (v == null ? null : { time: candles[i].time, value: v })).filter(Boolean);
  res.json({
    candles,
    ema20: series(ind.ema20), ema50: series(ind.ema50), ema200: series(ind.ema200),
    rsi: series(ind.rsi), macdHist: series(ind.macd.hist),
    bbUpper: series(ind.bb.upper), bbLower: series(ind.bb.lower),
  });
}));

app.get('/api/signal', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const candles = await getCandles(symbol, tf, N);
  const sig = liveSignal(candles, symbol, tf, TF_SEC[tf], INSTRUMENTS[symbol].digits, modeOf(req));
  if (sig.action === 'WAIT') { try { sig.setup = setupPlan(candles, symbol, tf, modeOf(req), INSTRUMENTS[symbol].digits); } catch {} }
  sig.livePrice = await getPrice(symbol);
  sig.status = signalStatus(sig, sig.livePrice, Date.now() / 1000);
  sig.tfSec = TF_SEC[tf];
  res.json(sig);
}));

// Same symbol on several timeframes → confluence
async function mtfFor(symbol, mode = 'normal') {
  const out = {};
  for (const tf of ['15m', '1h', '4h']) {
    try {
      const s = liveSignal(await getCandles(symbol, tf, N, 3 * 60_000), symbol, tf, TF_SEC[tf], INSTRUMENTS[symbol].digits, mode);
      const st = signalStatus(s, await getPrice(symbol), Date.now() / 1000);
      out[tf] = { action: s.action, status: st?.code || null, profile: s.profile.status };
    } catch (e) { out[tf] = { error: e.message }; }
  }
  return out;
}
app.get('/api/mtf', wrap(async (req, res) => res.json(await mtfFor(sym(req), modeOf(req)))));

// Scan all instruments on one timeframe
// "Today's verified signals": every symbol × timeframe whose profile is verified/weak,
// only BUY/SELL signals that are still valid. Waits for Twelve Data slots instead of failing.
const { getProfile } = require('./src/profiles');
const TODAY_AGE = { '5m': 2 * 60_000, '15m': 5 * 60_000, '1h': 10 * 60_000, '4h': 20 * 60_000, '1d': 60 * 60_000 };
const todayCache = {}, todayRunning = {};
async function buildToday(mode) {
  const signals = [], checked = [], errors = [];
  for (const s of Object.keys(INSTRUMENTS)) {
    for (const tf of TIMEFRAMES) {
      const prof = getProfile(s, tf);
      if (!['verified', 'weak'].includes(prof.status)) continue;
      checked.push({ symbol: s, tf, status: prof.status });
      try {
        const candles = await getCandles(s, tf, N, TODAY_AGE[tf], true);
        const sig = liveSignal(candles, s, tf, TF_SEC[tf], INSTRUMENTS[s].digits, mode);
        if (!['BUY', 'SELL'].includes(sig.action)) continue;
        const price = await getPrice(s);
        const st = signalStatus(sig, price, Date.now() / 1000);
        if (['INVALID', 'EXPIRED', 'DONE', 'FILLED'].includes(st?.code)) continue;
        let g = null;
        try { g = await gradeFor(s, tf, sig, mode); } catch (e) { g = { grade: '?', reasons: [{ ok: false, text: e.message }] }; }
        signals.push({ symbol: s, tf, action: sig.action, profile: prof.status, strategy: prof.strategy, status: st?.code, statusText: st?.text,
          price, entry: sig.entry, stopLoss: sig.stopLoss, target: sig.tp2, zone: sig.zone, signalTime: sig.signalTime, expiresAt: sig.expiresAt, grade: g, mode, plan: sig.plan, tp1: sig.tp1 });
      } catch (e) { errors.push({ symbol: s, tf, error: e.message }); }
    }
  }
  const order = { ACTIVE: 0, CAUTION: 1, MISSED: 2 };
  const gOrder = { A: 0, B: 1, C: 2 };
  signals.sort((a, b) => (gOrder[a.grade?.grade] ?? 3) - (gOrder[b.grade?.grade] ?? 3) || (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.signalTime - a.signalTime);
  todayCache[mode] = { time: Date.now(), mode, signals, checked, errors };
  return todayCache[mode];
}
app.get('/api/today', wrap(async (req, res) => {
  const mode = modeOf(req);
  const c = todayCache[mode];
  if (c && Date.now() - c.time < 4 * 60_000 && !req.query.force) return res.json(c);
  if (!todayRunning[mode]) todayRunning[mode] = buildToday(mode).finally(() => { todayRunning[mode] = null; });
  res.json(await todayRunning[mode]);
}));

// Deep Analysis (no AI key): 15 indicators × 4 timeframes + news headlines + calendar
const { deepAnalyze } = require('./src/deep');
const DEEP_AGE = { '15m': 3 * 60_000, '1h': 5 * 60_000, '4h': 15 * 60_000, '1d': 60 * 60_000 };
const deepCandles = (s, t) => getCandles(s, t, t === '1d' ? 600 : N, DEEP_AGE[t], true);
app.post('/api/deep', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  let strategySignal = null;
  try { strategySignal = liveSignal(await getCandles(symbol, tf, N), symbol, tf, TF_SEC[tf], INSTRUMENTS[symbol].digits, modeOf(req)); } catch {}
  const out = await deepAnalyze({ symbol, tf, strategySignal, getPrice, getCandles: deepCandles });
  try { out.modes = await compareModes(symbol, tf); } catch (e) { out.modes = { error: e.message }; }
  try { out.now = await nowFor(symbol, tf); } catch (e) { out.now = { error: e.message }; }
  res.json(out);
}));

const getProfileTp = (s, tf) => getProfile(s, tf).exits.tpR;
const { nowSignal } = require('./src/now');
const nowCache = new Map();
async function nowFor(symbol, tf) {
  const key = `${symbol}|${tf}`, hit = nowCache.get(key);
  const price = await getPrice(symbol);
  if (hit && Date.now() - hit.at < 5 * 60_000) return { ...hit.v, entry: price };
  const by = { [tf]: await getCandles(symbol, tf, 5000, 10 * 60_000, true) };
  for (const t of ['15m', '1h', '4h', '1d']) {
    if (TIMEFRAMES.indexOf(t) <= TIMEFRAMES.indexOf(tf)) continue;
    try { by[t] = await getCandles(symbol, t, t === '1d' ? 600 : N, DEEP_AGE[t], true); } catch {}
  }
  const v = nowSignal(symbol, tf, by, price);
  nowCache.set(key, { at: Date.now(), v });
  return v;
}
// Separate result for Deep: the strategy signal in all 3 trade modes + each mode's backtest on this market.
// Does NOT change the main signal — only shows which mode was best (profit / win rate) here.
async function compareModes(symbol, tf) {
  const digits = INSTRUMENTS[symbol].digits;
  const live = await getCandles(symbol, tf, N);
  const hist = await getCandles(symbol, tf, 5000, 10 * 60_000, true);
  const price = await getPrice(symbol);
  const modes = {};
  for (const m of Object.keys(MODES)) {
    const sig = liveSignal(live, symbol, tf, TF_SEC[tf], digits, m);
    const st = signalStatus(sig, price, Date.now() / 1000);
    const bt = backtest(hist, symbol, tf, m);
    const tr = bt.trades, n = Math.max(1, tr.length);
    let L = 0, maxL = 0;
    for (const t of tr) { if (t.r < -0.1) { L++; maxL = Math.max(maxL, L); } else if (t.r > 0.1) L = 0; }
    const trade = ['BUY', 'SELL'].includes(sig.action);
    const setup = trade ? null : setupPlan(live, symbol, tf, m, digits);
    const e = trade ? sig.entry : setup?.entry, s2 = trade ? sig.stopLoss : setup?.stopLoss;
    const risk = e && s2 ? { distance: Math.abs(e - s2), pips: Math.abs(e - s2) / INSTRUMENTS[symbol].pip, lots1pct1000: positionSize(symbol, e, s2, 10)?.lots ?? null, rr: getProfileTp(symbol, tf) } : null;
    modes[m] = {
      signal: trade
        ? { action: sig.action, entry: sig.entry, stopLoss: sig.stopLoss, tp1: sig.tp1, target: sig.tp2, plan: sig.plan, limitExpires: sig.limitExpires, status: st?.code, statusText: st?.text }
        : { action: sig.action, setup },
      risk,
      stats: {
        trades: tr.length, win: Math.round((tr.filter((t) => t.r > 0.1).length / n) * 100), be: Math.round((tr.filter((t) => Math.abs(t.r) <= 0.1).length / n) * 100),
        loss: Math.round((tr.filter((t) => t.r < -0.1).length / n) * 100), netR: bt.stats.netR, maxL, from: bt.stats.from, to: bt.stats.to,
      },
    };
  }
  const keys = Object.keys(modes);
  const bestProfit = keys.reduce((a, k) => (modes[k].stats.netR > modes[a].stats.netR ? k : a));
  const profitable = keys.filter((k) => modes[k].stats.netR > 0);
  const bestWin = profitable.length ? profitable.reduce((a, k) => (modes[k].stats.win > modes[a].stats.win ? k : a)) : null;
  return { modes, bestProfit: modes[bestProfit].stats.netR > 0 ? bestProfit : null, bestWin };
}

// Signal Grade (A/B/C) for the current strategy signal — light Deep run (no headlines, not logged as Deep)
const gradeCache = new Map();
async function gradeFor(symbol, tf, strategySignal, mode = 'normal') {
  const key = `${symbol}|${tf}|${mode}|${strategySignal?.signalTime || 'none'}`;
  const hit = gradeCache.get(key);
  if (hit && Date.now() - hit.at < 3 * 60_000) return hit.v;
  const d = await deepAnalyze({ symbol, tf, strategySignal, getPrice, getCandles: deepCandles, log: false, headlines: false });
  const v = { ...d.grade, deepAction: d.action, ml: d.ml?.available ? { dir: d.ml.models.ens.dir, filter: d.ml.filter } : null, soonHighImpact: d.soonHighImpact };
  gradeCache.set(key, { at: Date.now(), v });
  return v;
}
app.get('/api/grade', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const mode = modeOf(req);
  const sig = liveSignal(await getCandles(symbol, tf, N), symbol, tf, TF_SEC[tf], INSTRUMENTS[symbol].digits, mode);
  res.json(await gradeFor(symbol, tf, sig, mode));
}));

// AI Signal Tracker
const tracker = require('./src/tracker');
app.get('/api/ai-tracker', wrap(async (req, res) => {
  res.json(await tracker.track((symbol) => getCandles(symbol, '1h', N, 10 * 60_000, true)));
}));

app.get('/api/scan', wrap(async (req, res) => {
  const tf = tfOf(req);
  const results = [];
  for (const s of Object.keys(INSTRUMENTS)) {
    try {
      const sig = liveSignal(await getCandles(s, tf, N, 5 * 60_000, true), s, tf, TF_SEC[tf], INSTRUMENTS[s].digits, modeOf(req));
      const price = await getPrice(s);
      const st = signalStatus(sig, price, Date.now() / 1000);
      results.push({ symbol: s, action: sig.action, profile: sig.profile.status, strategy: sig.profile.strategy, price, entry: sig.entry, stopLoss: sig.stopLoss, tp1: sig.tp1, tp2: sig.tp2, zone: sig.zone, status: st?.code || null, live: stream.isLive(s) });
    } catch (e) { results.push({ symbol: s, error: e.message }); }
  }
  const rank = (r) => (['BUY', 'SELL'].includes(r.action) ? 0 : 2) + (r.profile === 'verified' ? 0 : r.profile === 'weak' ? 0.5 : 1);
  results.sort((a, b) => rank(a) - rank(b));
  res.json(results);
}));

app.get('/api/backtest', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const candles = await getCandles(symbol, tf, 5000, 10 * 60_000);
  res.json(backtest(candles, symbol, tf, modeOf(req)));
}));

// Walk-forward optimizer (train on first 60%, judge on last 40%) — saved to data/profiles.json
app.post('/api/optimize', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const candles = await getCandles(symbol, tf, 5000, 10 * 60_000);
  res.json(optimize(candles, symbol, tf));
}));

app.post('/api/explain', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const candles = await getCandles(symbol, tf, N);
  const signal = liveSignal(candles, symbol, tf, TF_SEC[tf], INSTRUMENTS[symbol].digits, modeOf(req));
  signal.livePrice = await getPrice(symbol);
  signal.status = signalStatus(signal, signal.livePrice, Date.now() / 1000);
  res.json(await ai.analyze({ symbol, tf, signal, candles, livePrice: signal.livePrice, digits: INSTRUMENTS[symbol].digits }));
}));

app.get('/api/size', wrap(async (req, res) => {
  const { entry, stop, balance, riskPct } = req.query;
  const riskUSD = (+balance * +riskPct) / 100;
  res.json(positionSize(sym(req), +entry, +stop, riskUSD));
}));

// Paper trading
async function pricesFor(symbols) {
  const prices = {};
  for (const s of symbols) { try { prices[s] = await getPrice(s); } catch {} }
  return prices;
}
app.get('/api/paper', wrap(async (req, res) => {
  res.json(paper.mark(await pricesFor(paper.symbolsOpen())));
}));
app.post('/api/paper/open', wrap(async (req, res) => {
  const symbol = sym(req);
  const price = await getPrice(symbol);
  const z = req.body.zone;
  if (Array.isArray(z) && !req.body.force && (price < z[0] || price > z[1])) {
    return res.status(409).json({ error: `මිල (${price}) entry zone එකෙන් (${z[0].toFixed(5)} – ${z[1].toFixed(5)}) එළියේ. Chase කරන්න එපා.`, code: 'ZONE' });
  }
  const pos = paper.open({ ...req.body, symbol, price });
  openSyms.add(symbol);
  res.json(pos);
}));
app.post('/api/paper/close', wrap(async (req, res) => {
  const all = paper.mark(await pricesFor(paper.symbolsOpen()));
  const pos = all.positions.find((p) => p.id === +req.body.id);
  if (!pos) throw new Error('Position එක හම්බුනේ නැහැ');
  paper.close(pos.id, pos.price ?? (await getPrice(pos.symbol)));
  res.json({ ok: true });
}));
app.post('/api/paper/reset', wrap(async (req, res) => { paper.reset(); res.json({ ok: true }); }));

stream.start();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Novi FX running → http://localhost:${PORT}`));
