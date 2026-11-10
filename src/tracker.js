// AI Signal Tracker: checks every saved AI analysis (data/ai-log.json) against what the
// price did afterwards. Same rules as the backtest: entry must be touched, SL checked
// before TP inside a candle, trading cost subtracted, max hold 7 days.
// Also tracks the strategy signal saved with each analysis, so we can see whether
// "AI agrees" (MATCH) signals do better than "AI disagrees" (CONFLICT/PARTIAL) ones.

const fs = require('fs');
const path = require('path');
const { INSTRUMENTS } = require('./instruments');

const LOG = path.join(__dirname, '..', 'data', 'ai-log.json');
const DEEP_LOG = path.join(__dirname, '..', 'data', 'deep-log.json');
const GRADE_LOG = path.join(__dirname, '..', 'data', 'grade-log.json');
const FILL_HOURS = 24;   // entry price must be touched within 24h, else "not filled"
const MAX_HOLD_H = 168;  // close after 7 days at market

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } }
function readLog() {
  return [...readJSON(LOG).map((e) => ({ ...e, kind: e.kind || 'ai' })), ...readJSON(DEEP_LOG).map((e) => ({ ...e, kind: 'deep' }))];
}

function costOf(symbol, price) {
  const inst = INSTRUMENTS[symbol] || {};
  return inst.costPct ? inst.costPct * price : inst.cost || 0;
}

// candles: 1h candles covering the period. t0 = analysis time (sec)
function evalTrade(symbol, t, t0, candles) {
  if (!t || !['BUY', 'SELL'].includes(t.action) || !(t.entry > 0) || !(t.sl > 0) || !(t.tp > 0)) return null;
  const d = t.action === 'BUY' ? 1 : -1;
  const risk = Math.abs(t.entry - t.sl);
  if (!(risk > 0) || d * (t.tp - t.entry) <= 0) return null;
  const costR = costOf(symbol, t.entry) / risk;
  const rr = Math.abs(t.tp - t.entry) / risk;
  // only candles that START after the analysis (no peeking at price action before it)
  const start = candles.findIndex((c) => c.time >= t0);
  if (start < 0) return { result: 'WAITING', text: 'තාම data නැහැ' };
  let fillAt = -1;
  for (let i = start; i < candles.length; i++) {
    if (candles[i].time - t0 > FILL_HOURS * 3600) break;
    if (candles[i].low <= t.entry && candles[i].high >= t.entry) { fillAt = i; break; }
  }
  if (fillAt < 0) {
    const last = candles[candles.length - 1];
    return last.time - t0 > FILL_HOURS * 3600 ? { result: 'NOT_FILLED', text: 'Entry මිලට ආවේ නැහැ' } : { result: 'PENDING', text: 'Entry මිලට එනකම්' };
  }
  for (let i = fillAt; i < candles.length; i++) {
    const c = candles[i];
    if (d === 1 ? c.low <= t.sl : c.high >= t.sl) return { result: 'LOSS', r: +(-1 - costR).toFixed(2), closedAt: c.time };
    if (d === 1 ? c.high >= t.tp : c.low <= t.tp) return { result: 'WIN', r: +(rr - costR).toFixed(2), closedAt: c.time };
    if (c.time - candles[fillAt].time > MAX_HOLD_H * 3600) {
      const r = (d * (c.close - t.entry)) / risk - costR;
      return { result: r > 0 ? 'WIN' : 'LOSS', r: +r.toFixed(2), closedAt: c.time, timeout: true };
    }
  }
  const last = candles[candles.length - 1];
  return { result: 'OPEN', r: +((d * (last.close - t.entry)) / risk).toFixed(2), text: 'තාම open' };
}

function score(rows) {
  const closed = rows.filter((x) => x && (x.result === 'WIN' || x.result === 'LOSS'));
  const wins = closed.filter((x) => x.result === 'WIN').length;
  const netR = closed.reduce((a, x) => a + x.r, 0);
  return {
    signals: rows.filter(Boolean).length,
    closed: closed.length, wins, losses: closed.length - wins,
    open: rows.filter((x) => x && x.result === 'OPEN').length,
    notFilled: rows.filter((x) => x && x.result === 'NOT_FILLED').length,
    pending: rows.filter((x) => x && (x.result === 'PENDING' || x.result === 'WAITING')).length,
    winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : null,
    netR: +netR.toFixed(2),
  };
}

async function track(getCandles) {
  const log = readLog();
  const bySymbol = {};
  for (const e of log) (bySymbol[e.symbol] ||= []).push(e);
  const rows = [];
  for (const [symbol, entries] of Object.entries(bySymbol)) {
    let candles;
    try { candles = await getCandles(symbol); } catch (err) { candles = null; }
    entries.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const seenAI = new Set(), seenStrat = new Set();
    for (const e of entries) {
      const t0 = Math.floor(Date.parse(e.time) / 1000);
      const ai = e.ai || {};
      const st = e.strategy || {};
      const aiT = { action: ai.action, entry: ai.entry, sl: ai.stop_loss, tp: ai.take_profit };
      const stT = { action: st.action, entry: st.entry, sl: st.stopLoss, tp: st.target };
      // the same signal analysed twice should count once
      const aiKey = `${e.kind}|${ai.action}|${ai.entry}|${Math.floor(t0 / 7200)}`;
      const stKey = `${e.tf}|${st.action}|${st.entry}`;
      const aiDup = seenAI.has(aiKey); seenAI.add(aiKey);
      const stDup = seenStrat.has(stKey); seenStrat.add(stKey);
      rows.push({
        kind: e.kind, time: e.time, symbol, tf: e.tf, match: e.match, newsBias: e.newsBias,
        ai: { action: ai.action, entry: ai.entry, sl: ai.stop_loss, tp: ai.take_profit, confidence: ai.confidence, outcome: candles && !aiDup ? evalTrade(symbol, aiT, t0, candles) : null, dup: aiDup },
        strategy: { action: st.action, entry: st.entry, sl: st.stopLoss, tp: st.target, status: st.status, outcome: candles && !stDup ? evalTrade(symbol, stT, t0, candles) : null, dup: stDup },
        dataError: !candles,
      });
    }
  }
  rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const group = (kind, codes) => {
    const g = {};
    for (const code of codes) {
      const rs = rows.filter((r) => r.kind === kind && r.match === code);
      g[code] = { ai: score(rs.map((r) => r.ai.outcome)), strategy: score(rs.map((r) => r.strategy.outcome)) };
    }
    return g;
  };
  // Signal grades: strategy signal outcome grouped by the grade it had when first seen
  const grades = readJSON(GRADE_LOG);
  const gradeRows = [];
  const candleCache = {};
  for (const g of grades) {
    if (!(g.symbol in candleCache)) { try { candleCache[g.symbol] = await getCandles(g.symbol); } catch { candleCache[g.symbol] = null; } }
    const cs = candleCache[g.symbol];
    const t0 = Math.floor(Date.parse(g.time) / 1000);
    const st = g.strategy || {};
    gradeRows.push({ ...g, outcome: cs ? evalTrade(g.symbol, { action: st.action, entry: st.entry, sl: st.stopLoss, tp: st.target }, t0, cs) : null });
  }
  const byGrade = {};
  for (const G of ['A', 'B', 'C']) byGrade[G] = score(gradeRows.filter((r) => r.grade === G).map((r) => r.outcome));

  return {
    byGrade, gradeCount: grades.length, gradeRows: gradeRows.slice(0, 100),
    time: Date.now(), analyses: log.length,
    aiCount: log.filter((e) => e.kind === 'ai').length, deepCount: log.filter((e) => e.kind === 'deep').length,
    ai: score(rows.filter((r) => r.kind === 'ai').map((r) => r.ai.outcome)),
    deep: score(rows.filter((r) => r.kind === 'deep').map((r) => r.ai.outcome)),
    strategy: score(rows.map((r) => r.strategy.outcome)),
    byMatch: group('ai', ['MATCH', 'PARTIAL', 'AI_ONLY', 'CONFLICT']),
    deepByMatch: group('deep', ['MATCH', 'PARTIAL', 'DEEP_ONLY', 'CONFLICT']),
    rows: rows.slice(0, 200),
  };
}

module.exports = { track, evalTrade, score };
