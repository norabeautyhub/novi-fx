// Live price streams (WebSocket) → one in-memory price book + EventEmitter.
//  - Crypto: Binance trade stream (free, no key)
//  - Forex + Gold: Finnhub WebSocket (free key: https://finnhub.io) using OANDA symbols
// Needs Node 22+ (built-in WebSocket).

const { EventEmitter } = require('events');
const { INSTRUMENTS } = require('./instruments');

const bus = new EventEmitter();
bus.setMaxListeners(100);
const book = {}; // SYMBOL -> { price, time (ms), source }
const status = { binance: 'off', finnhub: 'off', finnhubError: null };

function tick(symbol, price, timeMs, source) {
  if (!(price > 0)) return;
  book[symbol] = { price, time: timeMs || Date.now(), source };
  bus.emit('tick', { s: symbol, p: price, t: book[symbol].time });
}

function connect(name, url, onOpen, onMessage) {
  let retry = 1000;
  const open = () => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { status[name] = 'error'; return; }
    ws.onopen = () => { status[name] = 'live'; retry = 1000; onOpen && onOpen(ws); console.log(`[stream] ${name} connected`); };
    ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data), ws); } catch {} };
    ws.onerror = () => {};
    ws.onclose = () => {
      status[name] = 'reconnecting';
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 60_000);
    };
  };
  open();
}

function startBinance() {
  const syms = Object.entries(INSTRUMENTS).filter(([, i]) => i.provider === 'binance').map(([s]) => s);
  if (!syms.length) return;
  const streams = syms.map((s) => `${s.toLowerCase()}@aggTrade`).join('/');
  connect('binance', `wss://stream.binance.com:9443/stream?streams=${streams}`, null, (m) => {
    const d = m.data;
    if (d && d.e === 'aggTrade') tick(d.s, +d.p, d.T, 'binance');
  });
}

function startFinnhub() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return;
  const map = {}; // OANDA:EUR_USD -> EURUSD
  for (const [s, i] of Object.entries(INSTRUMENTS)) if (i.fhSymbol) map[i.fhSymbol] = s;
  connect('finnhub', `wss://ws.finnhub.io?token=${key}`, (ws) => {
    for (const fh of Object.keys(map)) ws.send(JSON.stringify({ type: 'subscribe', symbol: fh }));
  }, (m) => {
    if (m.type === 'trade' && Array.isArray(m.data)) {
      for (const t of m.data) if (map[t.s]) tick(map[t.s], +t.p, t.t, 'finnhub');
    } else if (m.type === 'error') {
      status.finnhubError = m.msg;
      console.log('[stream] finnhub error:', m.msg);
    }
  });
}

function start() {
  if (process.env.DATA_MODE === 'demo') return startDemo();
  startBinance();
  startFinnhub();
}

// DATA_MODE=demo: random ticks around the demo candle prices
function startDemo() {
  const { demoLast } = require('./data');
  status.binance = 'demo'; status.finnhub = 'demo';
  const last = {};
  setInterval(() => {
    for (const s of Object.keys(INSTRUMENTS)) {
      const base = last[s] ?? demoLast(s);
      const p = base * (1 + (Math.random() - 0.5) * 0.0004);
      last[s] = p;
      tick(s, p, Date.now(), 'demo');
    }
  }, 1000);
}

// Live price if we have a fresh one (default: last 30s)
function livePrice(symbol, maxAgeMs = 30_000) {
  const b = book[symbol];
  return b && Date.now() - b.time < maxAgeMs ? b.price : null;
}

function isLive(symbol) {
  const inst = INSTRUMENTS[symbol];
  if (process.env.DATA_MODE === 'demo') return true;
  if (inst.provider === 'binance') return status.binance === 'live';
  return status.finnhub === 'live' && !!inst.fhSymbol;
}

module.exports = { start, bus, book, status, livePrice, isLive };
