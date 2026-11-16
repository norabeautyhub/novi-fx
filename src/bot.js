// 🤖 Scalping bot (paper account) — runs until the user presses Stop.
//
// How it trades
//  • Every closed 15m candle, for each of the 12 trained markets, the trained model
//    (src/scalpModel.js) predicts the expected result of a BUY and a SELL.
//  • If the better side is above the threshold → order: SL 1.0×ATR, TP 1.5×ATR,
//    closed after 8h if neither is hit. Spread cost is charged on every trade.
//  • Lot size: fixed 1% risk of current equity (lots change with the stop distance).
//    After a loss the risk is NOT increased (no martingale).
// Protection (decided by the bot, shown in the Bot tab)
//  • max 4 open orders, max 2 open orders sharing a currency (e.g. EUR), 1 per market
//  • no new orders 30 min before / after high-impact news for that market's currencies
//  • day loss −4% → pause until tomorrow (UTC);  account −20% from start → full stop
//  • a market whose last 30 bot trades have PF < 0.8 is paused automatically
// Candles: loaded once from the data provider, then built live from ticks (saves API calls),
// re-synced every 3 hours.

const fs = require('fs');
const path = require('path');
const { INSTRUMENTS, positionSize, toUSD } = require('./instruments');
const scalp = require('./scalpModel');
const { makeAccount } = require('./paper');

const FILE = path.join(__dirname, '..', 'data', 'bot.json');
const acct = makeAccount('bot-paper.json', 1000);
const BAR = 900; // 15m
const MARKETS = scalp.MODEL.pairs;
const RULES = { maxOpen: 4, maxPerCurrency: 2, newsMin: 30, dayLossPct: 4, maxDDPct: 20, pausePF: 0.8, pauseAfter: 30, resyncMs: 3 * 3600e3 };
const DEFAULTS = { riskPct: 1, level: 'normal', threshold: scalp.MODEL.threshold };

let deps = null; // { getCandles, livePrice, isLive, calendar }
let st = loadState();
const candles = {};      // symbol → 15m candles
const seededAt = {};
const lastSeen = {};     // last tick ms
const failedAt = {};
const lastMark = {};
let openSet = new Set();
function refreshOpen() { openSet = new Set(acct.symbolsOpen()); }
let timer = null, busy = false;

function loadState() {
  try { const x = { ...defaultState(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; x.settings = { ...DEFAULTS, ...x.settings }; return x; } catch { return defaultState(); }
}
function defaultState() {
  return { running: false, startedAt: null, stoppedReason: null, settings: { ...DEFAULTS }, day: null, paused: {}, lastEval: {}, scan: {}, log: [] };
}
function save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1)); }
function log(msg, type = 'info', symbol = null) {
  st.log.unshift({ t: Date.now(), type, symbol, msg });
  st.log = st.log.slice(0, 400);
}
const parts = (s) => (s.length === 6 ? [s.slice(0, 3), s.slice(3)] : [s]);

// ---------- candles ----------
async function seed(symbol) {
  const cs = await deps.getCandles(symbol, '15m', 2000, 0, true);
  const now = Date.now() / 1000;
  // keep the tick-built candle that is still forming
  const live = (candles[symbol] || []).filter((c) => c.time > cs[cs.length - 1].time && c.time <= now);
  candles[symbol] = cs.map((c) => ({ ...c })).concat(live).slice(-2000);
  seededAt[symbol] = Date.now();
}
function onTick({ s, p, t }) {
  lastSeen[s] = t;
  const arr = candles[s];
  if (!arr || !arr.length) return;
  const b = Math.floor(t / 1000 / BAR) * BAR;
  const last = arr[arr.length - 1];
  if (b === last.time) { last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.close = p; }
  else if (b > last.time) { arr.push({ time: b, open: p, high: p, low: p, close: p, volume: 0 }); if (arr.length > 2100) arr.splice(0, arr.length - 2000); }
}

// ---------- account helpers ----------
const prices = () => Object.fromEntries(MARKETS.map((s) => [s, deps.livePrice(s, 120_000)]).filter(([, p]) => p != null));
function account() { return acct.mark(prices()); }
function botTrades() { return acct.raw().history.filter((h) => h.reason !== 'NOT FILLED'); }

function pf(arr) { const g = arr.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -arr.filter((x) => x < 0).reduce((a, b) => a + b, 0); return l ? g / l : g ? 99 : 0; }

async function newsBlock(symbol) {
  let cal = null;
  try { cal = deps.calendar ? await deps.calendar(symbol) : null; } catch {}
  if (!Array.isArray(cal)) return null;
  const now = Date.now();
  return cal.find((e) => e.impact === 'High' && Math.abs(e.time - now) < RULES.newsMin * 60e3) || null;
}

// ---------- main loop ----------
async function tick() {
  if (!st.running || busy) return;
  busy = true;
  try {
    const A = account();
    // time stop (8h) + day / drawdown protection
    for (const pos of A.positions) {
      const bars = pos.meta?.timeBars || scalp.MODEL.cfg.T;
      if (pos.price != null && Date.now() - pos.openedAt > bars * BAR * 1000) {
        acct.close(pos.id, pos.price, 'TIME 8h');
        log(`#${pos.id} ${pos.symbol} ${pos.side} — පැය 8ක් ගියා, TP/SL නැති නිසා close කළා`, 'close', pos.symbol);
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    if (!st.day || st.day.date !== today) { st.day = { date: today, equity: A.equity, paused: false }; }
    const start = A.startBalance;
    if (A.equity <= start * (1 - RULES.maxDDPct / 100)) {
      st.running = false; st.stoppedReason = `Account එක −${RULES.maxDDPct}% ආවා ($${A.equity}) — bot එක නැවැත්තුවා. Settings බලලා ආයෙත් Start කරන්න.`;
      log(st.stoppedReason, 'stop'); save(); return;
    }
    if (!st.day.paused && A.equity <= st.day.equity * (1 - RULES.dayLossPct / 100)) {
      st.day.paused = true; log(`අද පාඩුව −${RULES.dayLossPct}% ආවා — හෙට (UTC) වෙනකම් අලුත් orders නැහැ`, 'pause');
    }

    for (const s of MARKETS) {
      try {
        if (!candles[s] || Date.now() - (seededAt[s] || 0) > RULES.resyncMs) {
          if (failedAt[s] && Date.now() - failedAt[s] < 10 * 60e3) { if (!candles[s]) continue; }
          else { await seed(s); delete failedAt[s]; }
        }
      } catch (e) {
        if (!failedAt[s]) log(`${s} data ගන්න බැහැ: ${e.message} (විනාඩි 10කින් ආයෙත් try කරනවා)`, 'error', s);
        failedAt[s] = Date.now(); st.scan[s] = { t: Date.now(), note: `Data error: ${e.message}` }; if (!candles[s]) continue;
      }
      const arr = candles[s];
      const nowB = Math.floor(Date.now() / 1000 / BAR) * BAR;
      const closedIdx = arr[arr.length - 1].time >= nowB ? arr.length - 2 : arr.length - 1;
      const closed = arr[closedIdx];
      if (!closed || st.lastEval[s] === closed.time) continue;
      if (Date.now() / 1000 - closed.time > 3 * BAR) { st.scan[s] = { t: Date.now(), note: 'Market වහලා / live data නැහැ' }; st.lastEval[s] = closed.time; continue; }
      st.lastEval[s] = closed.time;
      const pr = scalp.predict(s, arr, closedIdx);
      if (!pr) continue;
      const thr = st.settings.threshold;
      const scan = { t: Date.now(), candle: closed.time, buy: +pr.long.toFixed(3), sell: +pr.short.toFixed(3), best: pr.best, score: +pr.score.toFixed(3) };
      st.scan[s] = scan;
      if (pr.score <= thr) { scan.decision = `skip — score ${pr.score.toFixed(2)} < ${thr}`; continue; }

      // filters
      const A2 = account();
      const open = A2.positions;
      const nb = await newsBlock(s);
      const why = (() => {
        if (st.day?.paused) return 'අද loss limit එක නිසා pause';
        if (st.paused[s]) return `market pause: ${st.paused[s]}`;
        if (open.some((p) => p.symbol === s)) return 'මේ market එකේ order එකක් දැනටමත් open';
        if (open.length >= RULES.maxOpen) return `open orders ${RULES.maxOpen}ක් තියෙනවා (උපරිම)`;
        const cur = parts(s);
        for (const c of cur) if (open.filter((p) => parts(p.symbol).includes(c)).length >= RULES.maxPerCurrency) return `${c} තියෙන orders ${RULES.maxPerCurrency}ක් දැනටමත් open`;
        if (nb) return `ලොකු news: ${nb.country} ${nb.title}`;
        return null;
      })();
      if (why) { scan.decision = `signal ${pr.best} (${pr.score.toFixed(2)}) — skip: ${why}`; continue; }

      const digits = INSTRUMENTS[s].digits;
      const price = +(deps.livePrice(s, 60_000) ?? closed.close).toFixed(digits);
      const d = pr.best === 'BUY' ? 1 : -1;
      const { tp, sl } = scalp.MODEL.cfg;
      const stop = +(price - d * sl * pr.atr).toFixed(digits), target = +(price + d * tp * pr.atr).toFixed(digits);
      const riskUSD = A2.equity * (st.settings.riskPct / 100);
      const size = positionSize(s, price, stop, riskUSD);
      if (!size || !(size.lots > 0)) { scan.decision = `signal ${pr.best} — skip: account එකට lot එක ගොඩක් පොඩියි (risk $${riskUSD.toFixed(2)})`; continue; }
      const inst = INSTRUMENTS[s];
      const costUSD = toUSD(s, inst.cost * size.lots * inst.contractSize, price);
      const pos = acct.open({ symbol: s, side: pr.best, lots: size.lots, stopLoss: stop, takeProfit: target, price, costUSD,
        note: `Bot · score ${pr.score.toFixed(2)}`, meta: { bot: true, score: +pr.score.toFixed(3), atr: pr.atr, timeBars: scalp.MODEL.cfg.T, riskUSD: size.riskUSD } });
      scan.decision = `✅ ${pr.best} order #${pos.id}`;
      openSet.add(s);
      log(`#${pos.id} ${s} ${pr.best} ${size.lots} lots @ ${price} · SL ${stop} · TP ${target} · risk $${size.riskUSD} · score ${pr.score.toFixed(2)} (BUY ${pr.long.toFixed(2)} / SELL ${pr.short.toFixed(2)})`, 'open', s);
    }

    // self-check: pause markets that keep losing
    const hist = botTrades();
    for (const s of MARKETS) {
      const last = hist.filter((h) => h.symbol === s).slice(0, RULES.pauseAfter);
      if (last.length >= RULES.pauseAfter && !st.paused[s]) {
        const f = pf(last.map((h) => h.pnl));
        if (f < RULES.pausePF) { st.paused[s] = `අන්තිම trades ${RULES.pauseAfter} PF ${f.toFixed(2)}`; log(`${s} pause කළා — අන්තිම trades ${RULES.pauseAfter}ේ PF ${f.toFixed(2)} (< ${RULES.pausePF})`, 'pause', s); }
      }
    }
    save();
  } catch (e) { log(`Error: ${e.message}`, 'error'); save(); }
  finally { busy = false; }
}

// log closes made by the live SL/TP check
let knownHist = null;
function watchCloses() {
  const h = acct.raw().history;
  if (knownHist == null) { knownHist = new Set(h.map((x) => x.id + '|' + x.closedAt)); return; }
  for (const x of h) {
    const k = x.id + '|' + x.closedAt;
    if (knownHist.has(k)) continue;
    knownHist.add(k);
    if (x.reason !== 'TIME 8h') log(`#${x.id} ${x.symbol} ${x.side} close — ${x.reason} · ${x.pnl >= 0 ? '+' : ''}$${x.pnl}`, x.pnl >= 0 ? 'win' : 'loss', x.symbol);
  }
}

// ---------- public ----------
function init(d) {
  deps = d;
  d.bus.on('tick', (t) => {
    if (!MARKETS.includes(t.s)) return;
    onTick(t);
    // live SL/TP check for open bot orders (max once per second per market)
    if (openSet.has(t.s) && Date.now() - (lastMark[t.s] || 0) >= 1000) {
      lastMark[t.s] = Date.now();
      try { acct.mark({ [t.s]: t.p }); } catch {}
    }
  });
  setInterval(() => { try { refreshOpen(); watchCloses(); } catch {} }, 2000);
  timer = setInterval(tick, 15_000);
  if (st.running) { log('Server restart — bot එක ආයෙත් පටන් ගත්තා', 'start'); save(); setTimeout(tick, 3000); }
}
function start() {
  if (st.running) return status();
  st.running = true; st.startedAt = Date.now(); st.stoppedReason = null; st.paused = {};
  if (!fs.existsSync(path.join(__dirname, '..', 'data', 'bot-paper.json'))) acct.reset(1000);
  log(`▶ Bot start — risk ${st.settings.riskPct}% · threshold ${st.settings.threshold} · markets ${MARKETS.length}`, 'start');
  save(); setTimeout(tick, 500);
  return status();
}
function stop(reason = 'ඔයා Stop කළා') {
  st.running = false; st.stoppedReason = reason;
  log(`⏹ Bot stop — ${reason}. Open orders SL/TP එක්ක දිගටම manage වෙනවා (ඕන නම් Close කරන්න).`, 'stop');
  save(); return status();
}
function settings(s) {
  if (s.riskPct != null) st.settings.riskPct = Math.min(3, Math.max(0.25, +s.riskPct));
  if (s.level) { const L = scalp.MODEL.levels.find((x) => x.key === s.level); if (L) { st.settings.level = L.key; st.settings.threshold = L.thr; } }
  log(`Settings: risk ${st.settings.riskPct}% · level ${st.settings.level} (threshold ${st.settings.threshold})`, 'info'); save();
  return status();
}
function resetAccount(balance = 1000) {
  if (st.running) throw new Error('මුලින් bot එක Stop කරන්න');
  acct.reset(+balance || 1000); st.paused = {}; st.day = null; knownHist = null;
  log(`Bot account reset — $${+balance || 1000}`, 'info'); save(); return status();
}
function closeOne(id) {
  const pos = acct.raw().positions.find((p) => p.id === +id);
  if (!pos) throw new Error('Order එක හම්බුනේ නැහැ');
  const p = deps.livePrice(pos.symbol, 120_000) ?? candles[pos.symbol]?.at(-1)?.close;
  acct.close(pos.id, p, 'MANUAL');
  return status();
}
function unpause(symbol) { delete st.paused[symbol]; log(`${symbol} ආයෙත් on කළා`, 'info', symbol); save(); return status(); }

function status() {
  const A = account();
  const hist = botTrades();
  const per = {};
  for (const h of hist) { const p = (per[h.symbol] = per[h.symbol] || { n: 0, wins: 0, pnl: 0, arr: [] }); p.n++; if (h.pnl > 0) p.wins++; p.pnl += h.pnl; p.arr.push(h.pnl); }
  const markets = MARKETS.map((s) => ({ symbol: s, scan: st.scan[s] || null, paused: st.paused[s] || null, trades: per[s]?.n || 0, winRate: per[s] ? +((per[s].wins / per[s].n) * 100).toFixed(1) : null, pnl: per[s] ? +per[s].pnl.toFixed(2) : 0, pf: per[s] ? +pf(per[s].arr).toFixed(2) : null, live: !!deps?.isLive(s) }));
  const today = new Date().toISOString().slice(0, 10);
  const todayH = hist.filter((h) => new Date(h.closedAt).toISOString().slice(0, 10) === today);
  // equity curve from closed trades (oldest → newest)
  let bal = A.startBalance; const curve = [{ t: Math.floor((hist.at(-1)?.closedAt || Date.now()) / 1000) - 60, v: bal }];
  for (const h of [...hist].reverse()) { bal += h.pnl; curve.push({ t: Math.floor(h.closedAt / 1000), v: +bal.toFixed(2) }); }
  return {
    running: st.running, startedAt: st.startedAt, stoppedReason: st.stoppedReason, settings: st.settings, rules: RULES, dayPaused: !!st.day?.paused,
    account: { balance: A.balance, equity: A.equity, floating: A.floating, start: A.startBalance, total: +(A.equity - A.startBalance).toFixed(2) },
    stats: { trades: hist.length, wins: hist.filter((h) => h.pnl > 0).length, winRate: hist.length ? +((hist.filter((h) => h.pnl > 0).length / hist.length) * 100).toFixed(1) : null,
      pf: hist.length ? +pf(hist.map((h) => h.pnl)).toFixed(2) : null, today: { trades: todayH.length, pnl: +todayH.reduce((a, h) => a + h.pnl, 0).toFixed(2) } },
    positions: A.positions, history: hist.slice(0, 100), markets, log: st.log.slice(0, 150), curve,
    model: { trainedOn: scalp.MODEL.trainedOn, cfg: scalp.MODEL.cfg, research: scalp.MODEL.research }, levels: scalp.MODEL.levels,
  };
}

module.exports = { init, start, stop, settings, status, resetAccount, closeOne, unpause, _tick: tick };
