// 🤖 Scalping bot (paper account) — runs until the user presses Stop.
//
// How it trades
//  • EVERY MINUTE all 12 trained markets are checked at once (takes well under a second).
//    For each market the bot builds the latest 15-minute candle that ends "now" (a rolling
//    15m candle from 1-minute data) and the trained model (src/scalpModel.js, ~57 inputs:
//    indicators, candlestick patterns, 1h/4h context) predicts a BUY and a SELL result.
//  • Better side above the level's threshold → order: SL = sl×ATR, TP = tp×ATR, time stop.
//    Spread cost is charged on every trade.
//  • Lot size: fixed % risk of current equity (lot changes with the stop distance).
//    After a loss the risk is NOT increased (no martingale).
// Protection (decided by the bot)
//  • max 4 open orders, max 2 sharing a currency, 1 per market, 15 min pause per market after a close
//  • no new orders 30 min before / after high-impact news for that market's currencies
//  • day loss −4% → pause until tomorrow (UTC); account −20% from start → full stop
//  • a market whose last 30 bot trades have PF < 0.8 is paused automatically
// Data: candles are cached on disk (fast restart); loading/refreshing runs in the background
// (Twelve Data free plan = 8 calls/min) and never blocks markets that are already ready.

const fs = require('fs');
const path = require('path');
const { INSTRUMENTS, positionSize, toUSD } = require('./instruments');
const scalp = require('./scalpModel');
const { makeAccount } = require('./paper');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'bot.json');
const CACHE = path.join(DATA, 'bot-candles.json');
const acct = makeAccount('bot-paper.json', 1000);
const BAR = 900;
const MARKETS = scalp.MODEL.pairs;
const RULES = { maxOpen: 1, maxPerCurrency: 1, newsMin: 30, dayLossPct: 4, maxDDPct: 20, pausePF: 0.8, pauseAfter: 30, cooldownMin: 15, resyncMs: 3 * 3600e3 };
const ACTIVE = { key: 'active', name: '♾ Always Active (නවත්වන්නේ නැතුව)', thr: 0, research: { perDay: 'සීමාවක් නැහැ', wr: '—', pf: '~1.0–1.1', years: 'මැනලා නැහැ — paper එකේ බලන්න' } };
const FORCE = { key: 'force', name: '🔁 Force — හැම විටම trade (score ඍණ වුණත්)', thr: -9, research: { perDay: 'ගොඩක් (slot එක නිදහස් වුණු ගමන්)', wr: '—', pf: '<1 (පාඩු බලාපොරොත්තු වෙන්න)', years: 'Paper එකේ විතරක් — research එකේ ඍණයි' } };
const ALL_LEVELS = [FORCE, ACTIVE, ...scalp.MODEL.levels];
const DEFAULTS = { riskPct: 1, level: 'force', threshold: -9, style: 'quick', recovery: true, v4: true };
const STYLES = { quick: { tp: 0.5, sl: 1.0, timeBars: 3 } /* 3×15m = 45 min max hold: a trade that gets stuck between TP and SL is closed so the bot keeps trading */, model: { ...scalp.MODEL.cfg, timeBars: scalp.MODEL.cfg.T } };

let deps = null;
let st = loadState();
const C = {};            // symbol → { c15: [], m1: [], seededAt, savedOk }
let busy = false, seeding = false;
const lastMark = {};
let openSet = new Set();

function loadState() {
  try { const x = { ...defaultState(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; x.settings = { ...DEFAULTS, ...x.settings }; if (!x.settings.v4) { x.settings.level = 'force'; x.settings.v4 = true; }
      x.settings.style = x.settings.style || 'quick'; if (x.settings.recovery == null) x.settings.recovery = true; const L = ALL_LEVELS.find((l) => l.key === x.settings.level); if (L) x.settings.threshold = L.thr; return x; }
  catch { return defaultState(); }
}
function defaultState() { return { running: false, startedAt: null, stoppedReason: null, settings: { ...DEFAULTS }, day: null, paused: {}, scan: {}, cool: {}, lastCheck: null, checks: 0, log: [] }; }
function save() { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st)); }
function log(msg, type = 'info', symbol = null) { st.log.unshift({ t: Date.now(), type, symbol, msg }); st.log = st.log.slice(0, 400); }
const parts = (s) => (s.length === 6 ? [s.slice(0, 3), s.slice(3)] : [s]);
const refreshOpen = () => { openSet = new Set(acct.symbolsOpen()); };

// ---------- candles: disk cache + background loading + live ticks ----------
function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    for (const s of MARKETS) if (j[s]?.c15?.length) C[s] = { c15: j[s].c15, m1: j[s].m1 || [], seededAt: j[s].seededAt || 0 };
  } catch {}
}
function saveCache() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(Object.fromEntries(Object.entries(C).map(([s, v]) => [s, { c15: v.c15.slice(-2000), m1: v.m1.slice(-300), seededAt: v.seededAt }])))); } catch {}
}
function mergeInto(oldArr, fresh, keep) {
  const last = fresh.length ? fresh[fresh.length - 1].time : 0;
  return fresh.map((c) => ({ ...c })).concat((oldArr || []).filter((c) => c.time > last)).slice(-keep);
}
async function seedOne(s) {
  const c15 = await deps.getCandles(s, '15m', 2000, 0, true);
  const cur = C[s] || { c15: [], m1: [] };
  cur.c15 = mergeInto(cur.c15, c15, 2000);
  // 1-minute candles (for the every-minute rolling candle) — only when we don't have recent ones
  const m1last = cur.m1.length ? cur.m1[cur.m1.length - 1].time : 0;
  if (Date.now() / 1000 - m1last > 1800) { try { cur.m1 = mergeInto(cur.m1, await deps.getCandles(s, '1m', 300, 0, true), 300); } catch {} }
  cur.seededAt = Date.now();
  C[s] = cur;
}
const failedAt = {};
async function seedLoop() {
  if (seeding) return;
  seeding = true;
  try {
    // freshest-needed first: missing → stale → due for refresh
    const need = MARKETS.filter((s) => !(failedAt[s] && Date.now() - failedAt[s] < 10 * 60e3))
      .map((s) => ({ s, age: C[s] ? Date.now() - (C[s].seededAt || 0) : Infinity, stale: !ready(s) }))
      .filter((x) => x.stale || x.age > RULES.resyncMs)
      .sort((a, b) => (b.stale - a.stale) || (b.age - a.age));
    for (const { s } of need) {
      try { await seedOne(s); delete failedAt[s]; }
      catch (e) { if (!failedAt[s]) log(`${s} data ගන්න බැහැ: ${e.message} (විනාඩි 10කින් ආයෙත්)`, 'error', s); failedAt[s] = Date.now(); }
    }
    if (need.length) saveCache();
  } finally { seeding = false; }
}
function onTick({ s, p, t }) {
  const cur = C[s];
  if (!cur) return;
  const sec = t / 1000;
  for (const [arr, step, keep] of [[cur.c15, BAR, 2000], [cur.m1, 60, 300]]) {
    const b = Math.floor(sec / step) * step;
    const last = arr[arr.length - 1];
    if (last && b === last.time) { last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.close = p; }
    else if (!last || b > last.time) { arr.push({ time: b, open: p, high: p, low: p, close: p, volume: 0 }); if (arr.length > keep + 100) arr.splice(0, arr.length - keep); }
  }
}
// market data is usable: latest 15m candle is recent
function ready(s) {
  const a = C[s]?.c15; if (!a || a.length < 1000) return false;
  return Date.now() / 1000 - a[a.length - 1].time < 2 * BAR;
}
// candle series whose LAST candle is the 15 minutes ending at the current minute
function rollingSeries(s) {
  const { c15, m1 } = C[s];
  const nowMin = Math.floor(Date.now() / 60000) * 60;
  const offset = nowMin % BAR;
  const closedAligned = c15.filter((c) => c.time + BAR <= nowMin);
  if (offset === 0) return { series: closedAligned, rolling: false };
  const K = 8, starts = [];
  for (let k = K - 1; k >= 0; k--) starts.push(nowMin - BAR * (k + 1));
  const wins = [];
  for (const ws of starts) {
    const ms = m1.filter((c) => c.time >= ws && c.time < ws + BAR);
    if (ms.length < 5) return { series: null };
    wins.push({ time: ws, open: ms[0].open, high: Math.max(...ms.map((x) => x.high)), low: Math.min(...ms.map((x) => x.low)), close: ms[ms.length - 1].close, volume: 0 });
  }
  const base = closedAligned.filter((c) => c.time + BAR <= starts[0]);
  return { series: base.concat(wins), rolling: true };
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

// ---------- every minute: check all markets ----------
let lastMinute = 0;
async function tick(force = false) {
  if (!st.running || busy) return;
  const minute = Math.floor(Date.now() / 60000);
  if (!force && minute === lastMinute) return;
  busy = true;
  try {
    lastMinute = minute;
    seedLoop().catch(() => {});
    let A = account();
    for (const pos of A.positions) {
      let bars = pos.meta && pos.meta.timeBars === 0 ? 0 : (pos.meta?.timeBars || scalp.MODEL.cfg.T);
      if (st.settings.style !== 'model') bars = Math.min(bars || 99, STYLES.quick.timeBars); // quick style: also applies to older open orders
      if (bars && pos.price != null && Date.now() - pos.openedAt > bars * BAR * 1000) {
        acct.close(pos.id, pos.price, `TIME ${Math.round((bars * BAR) / 60)}min`);
        st.cool[pos.symbol] = Date.now();
      }
    }
    A = account();
    const today = new Date().toISOString().slice(0, 10);
    if (!st.day || st.day.date !== today) st.day = { date: today, equity: A.equity, paused: false };
    if (A.equity <= A.startBalance * (1 - RULES.maxDDPct / 100)) {
      st.running = false; st.stoppedReason = `Account එක −${RULES.maxDDPct}% ආවා ($${A.equity}) — bot එක නැවැත්තුවා.`;
      log(st.stoppedReason, 'stop'); save(); return;
    }
    if (!st.day.paused && A.equity <= st.day.equity * (1 - RULES.dayLossPct / 100)) { st.day.paused = true; log(`අද පාඩුව −${RULES.dayLossPct}% ආවා — හෙට (UTC) වෙනකම් අලුත් orders නැහැ`, 'pause'); }

    // 1) score every ready market (fast, no waiting)
    const cands = [];
    let readyN = 0, bestNow = null;
    for (const s of MARKETS) {
      if (!ready(s)) { st.scan[s] = { t: Date.now(), note: C[s] ? 'data update වෙනවා / market වහලා' : 'data load වෙනවා' }; continue; }
      readyN++;
      const { series } = rollingSeries(s);
      if (!series || series.length < 1000) { st.scan[s] = { t: Date.now(), note: '1m data එකතු වෙනවා' }; continue; }
      const pr = scalp.predict(s, series, series.length - 1);
      if (!pr) continue;
      st.scan[s] = { t: Date.now(), buy: +pr.long.toFixed(3), sell: +pr.short.toFixed(3), best: pr.best, score: +pr.score.toFixed(3) };
      if (pr.score > st.settings.threshold) cands.push({ s, pr });
      if (!bestNow || pr.score > bestNow.score) bestNow = { s, score: +pr.score.toFixed(3), side: pr.best };
    }
    st.lastCheck = Date.now(); st.checks = (st.checks || 0) + 1; st.readyN = readyN; st.bestNow = bestNow;

    // 2) best opportunities first
    cands.sort((a, b) => b.pr.score - a.pr.score);
    for (const { s, pr } of cands) {
      const open = account().positions;
      const nb = await newsBlock(s);
      const why = (() => {
        if (st.day?.paused) return 'day pause';
        if (st.paused[s]) return 'market pause';
        if (open.some((p) => p.symbol === s)) return 'already open';
        if (st.cool[s] && Date.now() - st.cool[s] < RULES.cooldownMin * 60e3) return 'cooldown';
        if (open.length >= RULES.maxOpen) return 'max open';
        for (const c of parts(s)) if (open.filter((p) => parts(p.symbol).includes(c)).length >= RULES.maxPerCurrency) return `${c} limit`;
        if (nb) return `news ${nb.country} ${nb.title}`;
        return null;
      })();
      if (why) { st.scan[s].skip = why; st.lastSkip = `${s} ${pr.best} score ${pr.score.toFixed(3)} — ${why}`; continue; }
      const digits = INSTRUMENTS[s].digits;
      const price = +(deps.livePrice(s, 60_000) ?? pr.price).toFixed(digits);
      const d = pr.best === 'BUY' ? 1 : -1;
      const { tp, sl } = STYLES[st.settings.style] || STYLES.quick;
      const stop = +(price - d * sl * pr.atr).toFixed(digits), target = +(price + d * tp * pr.atr).toFixed(digits);
      const eq = account().equity;
      const lastT = botTrades()[0];
      const recov = st.settings.recovery && lastT && lastT.pnl < 0 ? 1.5 : 1; // safe recovery: after a loss risk ×1.5 once, back to normal after
      const wantRisk = eq * (st.settings.riskPct / 100) * recov;
      let size = positionSize(s, price, stop, wantRisk);
      if (size && !(size.lots > 0)) {
        // $1000 account: 0.01 lot (the smallest lot) can risk a bit more than 1% on wide-ATR markets (Gold). Allow up to 2× the target.
        const one = positionSize(s, price, stop, 1e9), unit = INSTRUMENTS[s].type === 'crypto' ? 0.001 : 0.01;
        const riskMin = one ? +(unit * (one.riskUSD / one.lots)).toFixed(2) : Infinity;
        if (riskMin <= wantRisk * 2) size = { ...one, lots: unit, riskUSD: riskMin };
        else { st.scan[s].skip = `lot too small (min lot risk $${riskMin} > 2×$${wantRisk.toFixed(0)})`; st.lastSkip = `${s} ${pr.best} score ${pr.score.toFixed(3)} — ${st.scan[s].skip}`; continue; }
      }
      if (!size || !(size.lots > 0)) { st.scan[s].skip = 'lot too small'; continue; }
      const inst = INSTRUMENTS[s];
      const costUSD = toUSD(s, inst.cost * size.lots * inst.contractSize, price);
      const pos = acct.open({ symbol: s, side: pr.best, lots: size.lots, stopLoss: stop, takeProfit: target, price, costUSD,
        note: `Bot · score ${pr.score.toFixed(2)}`, meta: { bot: true, score: +pr.score.toFixed(3), why: pr.why, timeBars: (STYLES[st.settings.style] || STYLES.quick).timeBars, recovery: recov > 1, riskUSD: size.riskUSD } });
      openSet.add(s);
      log(`#${pos.id} ${s} ${pr.best} ${size.lots} lots @ ${price} · SL ${stop} · TP ${target} · risk $${size.riskUSD} — ${pr.why}`, 'open', s);
    }

    // 3) self-check: pause markets that keep losing
    const hist = botTrades();
    for (const s of MARKETS) {
      const last = hist.filter((h) => h.symbol === s).slice(0, RULES.pauseAfter);
      if (last.length >= RULES.pauseAfter && !st.paused[s]) {
        const f = pf(last.map((h) => h.pnl));
        if (f < RULES.pausePF) { st.paused[s] = `අන්තිම trades ${RULES.pauseAfter} PF ${f.toFixed(2)}`; log(`${s} pause කළා — අන්තිම trades ${RULES.pauseAfter}ේ PF ${f.toFixed(2)}`, 'pause', s); }
      }
    }
    save();
  } catch (e) { log(`Error: ${e.message}`, 'error'); save(); }
  finally { busy = false; }
}

// log closes made by the live SL/TP check (+ cooldown)
let knownHist = null;
function watchCloses() {
  const h = acct.raw().history;
  if (knownHist == null) { knownHist = new Set(h.map((x) => x.id + '|' + x.closedAt)); return; }
  for (const x of h) {
    const k = x.id + '|' + x.closedAt;
    if (knownHist.has(k)) continue;
    knownHist.add(k);
    st.cool[x.symbol] = x.closedAt;
    log(`#${x.id} ${x.symbol} ${x.side} close — ${x.reason} · ${x.pnl >= 0 ? '+' : ''}$${x.pnl}`, x.pnl >= 0 ? 'win' : 'loss', x.symbol);
  }
}

// ---------- public ----------
function init(d) {
  deps = d;
  loadCache(); refreshOpen();
  d.bus.on('tick', (t) => {
    if (!MARKETS.includes(t.s)) return;
    onTick(t);
    if (openSet.has(t.s) && Date.now() - (lastMark[t.s] || 0) >= 1000) { lastMark[t.s] = Date.now(); try { acct.mark({ [t.s]: t.p }); } catch {} }
  });
  setInterval(() => { try { refreshOpen(); watchCloses(); } catch {} }, 2000);
  setInterval(() => tick(), 5000);          // runs once per new minute
  setInterval(saveCache, 5 * 60e3);
  if (st.running) { log('Server restart — bot එක ආයෙත් පටන් ගත්තා', 'start'); save(); seedLoop().catch(() => {}); }
}
function start() {
  if (st.running) return status();
  st.running = true; st.startedAt = Date.now(); st.stoppedReason = null; st.paused = {};
  if (!fs.existsSync(path.join(DATA, 'bot-paper.json'))) acct.reset(1000);
  log(`▶ Bot start — risk ${st.settings.riskPct}% · ${ALL_LEVELS.find((l) => l.key === st.settings.level)?.name || ''} · markets ${MARKETS.length} · හැම විනාඩියකම check කරනවා`, 'start');
  save(); seedLoop().catch(() => {}); setTimeout(() => tick(true), 300);
  return status();
}
function stop(reason = 'ඔයා Stop කළා') {
  st.running = false; st.stoppedReason = reason;
  log(`⏹ Bot stop — ${reason}. Open orders SL/TP එක්ක දිගටම manage වෙනවා.`, 'stop');
  save(); return status();
}
function settings(s) {
  if (s.riskPct != null) st.settings.riskPct = Math.min(3, Math.max(0.25, +s.riskPct));
  if (s.style && STYLES[s.style]) st.settings.style = s.style;
  if (s.recovery != null) st.settings.recovery = !!s.recovery;
  if (s.level) { const L = ALL_LEVELS.find((x) => x.key === s.level); if (L) { st.settings.level = L.key; st.settings.threshold = L.thr; } }
  log(`Settings: risk ${st.settings.riskPct}% · ${ALL_LEVELS.find((l) => l.key === st.settings.level)?.name}`, 'info'); save();
  return status();
}
function resetAccount(balance = 1000) {
  if (st.running) throw new Error('මුලින් bot එක Stop කරන්න');
  acct.reset(+balance || 1000); st.paused = {}; st.day = null; st.cool = {}; knownHist = null;
  log(`Bot account reset — $${+balance || 1000}`, 'info'); save(); return status();
}
function closeOne(id) {
  const pos = acct.raw().positions.find((p) => p.id === +id);
  if (!pos) throw new Error('Order එක හම්බුනේ නැහැ');
  const p = deps.livePrice(pos.symbol, 120_000) ?? C[pos.symbol]?.c15?.at(-1)?.close;
  acct.close(pos.id, p, 'MANUAL'); st.cool[pos.symbol] = Date.now();
  return status();
}
function unpause(symbol) { delete st.paused[symbol]; log(`${symbol} ආයෙත් on කළා`, 'info', symbol); save(); return status(); }

function status() {
  const A = account();
  const hist = botTrades();
  const per = {};
  for (const h of hist) { const p = (per[h.symbol] = per[h.symbol] || { n: 0, wins: 0, pnl: 0 }); p.n++; if (h.pnl > 0) p.wins++; p.pnl += h.pnl; }
  const today = new Date().toISOString().slice(0, 10);
  const todayH = hist.filter((h) => new Date(h.closedAt).toISOString().slice(0, 10) === today);
  let bal = A.startBalance; const curve = [{ t: Math.floor((hist.at(-1)?.closedAt || Date.now()) / 1000) - 60, v: bal }];
  for (const h of [...hist].reverse()) { bal += h.pnl; curve.push({ t: Math.floor(h.closedAt / 1000), v: +bal.toFixed(2) }); }
  const wins = hist.filter((h) => h.pnl > 0).length;
  return {
    running: st.running, startedAt: st.startedAt, stoppedReason: st.stoppedReason, settings: st.settings, rules: RULES, dayPaused: !!st.day?.paused,
    scanning: { lastCheck: st.lastCheck, ready: MARKETS.filter(ready).length, total: MARKETS.length, checks: st.checks || 0, loading: seeding, best: st.bestNow || null, lastSkip: st.lastSkip || null, candidates: Object.values(st.scan).filter((x) => x.score != null && x.score > st.settings.threshold).length },
    account: { balance: A.balance, equity: A.equity, floating: A.floating, start: A.startBalance, total: +(A.equity - A.startBalance).toFixed(2) },
    stats: { trades: hist.length, wins, winRate: hist.length ? +((wins / hist.length) * 100).toFixed(1) : null, pf: hist.length ? +pf(hist.map((h) => h.pnl)).toFixed(2) : null,
      today: { trades: todayH.length, pnl: +todayH.reduce((a, h) => a + h.pnl, 0).toFixed(2) } },
    byMarket: Object.entries(per).map(([s, p]) => ({ symbol: s, trades: p.n, winRate: +((p.wins / p.n) * 100).toFixed(1), pnl: +p.pnl.toFixed(2), paused: st.paused[s] || null })).sort((a, b) => b.pnl - a.pnl),
    paused: st.paused,
    positions: A.positions, history: hist.slice(0, 100), log: st.log.filter((l) => l.type !== 'info' || /reset|Settings|on කළා/.test(l.msg)).slice(0, 150), curve,
    model: { version: scalp.MODEL.version, trainedOn: scalp.MODEL.trainedOn, cfg: scalp.MODEL.cfg, research: scalp.MODEL.research, nFeatures: scalp.MODEL.nFeatures }, levels: ALL_LEVELS,
  };
}

module.exports = { init, start, stop, settings, status, resetAccount, closeOne, unpause, _tick: tick, _C: C };
