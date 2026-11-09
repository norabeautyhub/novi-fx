// Backtest the signal engine on historical candles.
// Entry: next candle's open after a signal. Exit: stop loss or take profit.
// If SL and TP are both touched in the same candle we assume SL (conservative).

const { computeAll } = require('./indicators');
const { evaluateAt } = require('./signals');

function backtest(candles, opts = {}) {
  const tpR = opts.tpR ?? 2;
  const ind = computeAll(candles);
  const trades = [];
  let open = null;

  for (let i = 200; i < candles.length; i++) {
    const c = candles[i];

    if (open) {
      const { dir, stop, target } = open;
      const hitSL = dir === 1 ? c.low <= stop : c.high >= stop;
      const hitTP = dir === 1 ? c.high >= target : c.low <= target;
      if (hitSL || hitTP) {
        const r = hitSL ? -1 : tpR;
        trades.push({ ...open, exitTime: c.time, exitPrice: hitSL ? stop : target, result: hitSL ? 'LOSS' : 'WIN', r });
        open = null;
      }
      continue;
    }

    if (i >= candles.length - 1) break;
    const sig = evaluateAt(candles, ind, i, opts);
    if (sig.action === 'WAIT') continue;

    const dir = sig.action === 'BUY' ? 1 : -1;
    const entry = candles[i + 1].open;
    // same rule as live: only enter if the next open is still inside the entry zone
    if (entry < sig.zone[0] || entry > sig.zone[1]) continue;
    const riskDist = Math.abs(sig.entry - sig.stopLoss);
    const stop = entry - dir * riskDist;
    open = { side: sig.action, dir, entryTime: candles[i + 1].time, entry, stop, target: entry + dir * tpR * riskDist, score: sig.score };
    // next iteration (candle i+1, the entry candle) checks SL/TP against its range
  }

  // stats
  let equity = 0, peak = 0, maxDD = 0, grossWin = 0, grossLoss = 0;
  const curve = [];
  for (const t of trades) {
    equity += t.r;
    if (t.r > 0) grossWin += t.r; else grossLoss += -t.r;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    curve.push({ time: t.exitTime, value: +equity.toFixed(2) });
  }
  const wins = trades.filter((t) => t.r > 0).length;
  return {
    stats: {
      trades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0,
      netR: +equity.toFixed(2),
      profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : null,
      maxDrawdownR: +maxDD.toFixed(2),
      breakEvenWinRate: +((1 / (1 + tpR)) * 100).toFixed(1),
      tpR,
      from: candles[0]?.time,
      to: candles[candles.length - 1]?.time,
    },
    trades: trades.slice(-100),
    curve,
  };
}

module.exports = { backtest };
