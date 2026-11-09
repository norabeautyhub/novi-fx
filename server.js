require('dotenv').config();
const express = require('express');
const path = require('path');
const { INSTRUMENTS, TIMEFRAMES, positionSize } = require('./src/instruments');
const { getCandles, getPrice } = require('./src/data');
const { computeAll } = require('./src/indicators');
const { liveSignal, signalStatus } = require('./src/signals');
const { TF_SEC } = require('./src/data');
const stream = require('./src/stream');
const { backtest } = require('./src/backtest');
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
  const candles = await getCandles(sym(req), tfOf(req), 500);
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
  const candles = await getCandles(symbol, tf, 500);
  const sig = liveSignal(candles, {}, TF_SEC[tf]);
  sig.livePrice = await getPrice(symbol);
  sig.status = signalStatus(sig, sig.livePrice, Date.now() / 1000);
  sig.tfSec = TF_SEC[tf];
  res.json(sig);
}));

// Same symbol on several timeframes → confluence
async function mtfFor(symbol) {
  const out = {};
  for (const tf of ['15m', '1h', '4h']) {
    try {
      const s = liveSignal(await getCandles(symbol, tf, 500, 3 * 60_000), {}, TF_SEC[tf]);
      const st = signalStatus(s, await getPrice(symbol), Date.now() / 1000);
      out[tf] = { action: s.action, score: s.score, status: st?.code || null };
    } catch (e) { out[tf] = { error: e.message }; }
  }
  return out;
}
app.get('/api/mtf', wrap(async (req, res) => res.json(await mtfFor(sym(req)))));

// Scan all instruments on one timeframe
app.get('/api/scan', wrap(async (req, res) => {
  const tf = tfOf(req);
  const results = [];
  for (const s of Object.keys(INSTRUMENTS)) {
    try {
      const sig = liveSignal(await getCandles(s, tf, 500, 5 * 60_000), {}, TF_SEC[tf]);
      const price = await getPrice(s);
      const st = signalStatus(sig, price, Date.now() / 1000);
      results.push({ symbol: s, action: sig.action, score: sig.score, confidence: sig.confidence, price, entry: sig.entry, stopLoss: sig.stopLoss, tp1: sig.tp1, tp2: sig.tp2, zone: sig.zone, status: st?.code || null, live: stream.isLive(s) });
    } catch (e) { results.push({ symbol: s, error: e.message }); }
  }
  results.sort((a, b) => Math.abs(b.score || 0) - Math.abs(a.score || 0));
  res.json(results);
}));

app.get('/api/backtest', wrap(async (req, res) => {
  const candles = await getCandles(sym(req), tfOf(req), 1000);
  res.json(backtest(candles, { tpR: req.query.tpR ? +req.query.tpR : 2 }));
}));

app.post('/api/explain', wrap(async (req, res) => {
  const symbol = sym(req), tf = tfOf(req);
  const candles = await getCandles(symbol, tf, 500);
  const signal = liveSignal(candles, {}, TF_SEC[tf]);
  signal.livePrice = await getPrice(symbol);
  signal.status = signalStatus(signal, signal.livePrice, Date.now() / 1000);
  const mtf = await mtfFor(symbol);
  res.json(await ai.explain({ symbol, tf, signal, candles, mtf }));
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
