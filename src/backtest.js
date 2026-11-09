// Backtest + walk-forward Optimizer using the same strategy code as live signals.

const S = require('./strategy');
const { INSTRUMENTS } = require('./instruments');
const { getProfile, saveOptimized, LONDON_NY, PRESETS } = require('./profiles');

// round-trip trading cost in price units (spread + commission, a bit pessimistic)
function costFn(symbol) {
  const inst = INSTRUMENTS[symbol];
  return (i, entry) => (inst.costPct ? inst.costPct * entry : inst.cost || 0);
}

function runConfig(F, symbol, strategy, params, exits, start = 250, end = null) {
  const { sig, sl } = S.STRATEGIES[strategy](F, params);
  if (end != null) for (let i = end; i < sig.length; i++) sig[i] = 0; // no new entries after `end`
  return S.simulate(F, sig, sl, exits, costFn(symbol), start);
}

function backtest(candles, symbol, tf) {
  const prof = getProfile(symbol, tf);
  const F = S.features(candles);
  const trades = runConfig(F, symbol, prof.strategy, prof.params, prof.exits);
  const st = S.stats(trades, prof.exits.tpR);
  return {
    profile: { status: prof.status, strategy: prof.strategy, params: prof.params, exits: prof.exits, research: prof.research, optimizer: prof.optimizer, source: prof.source },
    stats: { ...st, from: candles[250]?.time, to: candles[candles.length - 1]?.time, cost: INSTRUMENTS[symbol].costPct ? `${INSTRUMENTS[symbol].costPct * 100}%` : INSTRUMENTS[symbol].cost },
    trades: trades.slice(-100).map(({ i, ...t }) => ({ ...t, r: +t.r.toFixed(2) })),
    curve: st.curve,
  };
}

function* grid() {
  for (const adx of [15, 20, 25]) for (const touch of [0, 0.3]) for (const sl of [1.5, 2]) for (const htf of ['htf4', 'htfD']) for (const tpR of [2, 3])
    yield { strategy: 'pullback', params: { adx, htf, rsi: 50, sl, touch }, exits: { tpR } };
  for (const n of [20, 55]) for (const sl of [1.5, 2.5]) for (const htf of ['htf4', 'htfD']) for (const hours of [null, LONDON_NY]) for (const adx of [0, 20]) for (const tpR of [2, 3])
    yield { strategy: 'breakout', params: { n, sl, htf, hours, adx }, exits: { tpR } };
}

// Walk-forward: choose the best settings on the first 60% (train),
// then judge them ONLY on the last 40% (test) which they have never seen.
function optimize(candles, symbol, tf) {
  const F = S.features(candles);
  const split = Math.floor(250 + (candles.length - 250) * 0.6);
  const rows = [];
  for (const cfg of grid()) {
    const train = runConfig(F, symbol, cfg.strategy, cfg.params, cfg.exits, 250, split);
    const ts = S.stats(train, cfg.exits.tpR);
    rows.push({ cfg, train: ts });
  }
  const eligible = rows.filter((r) => r.train.trades >= 15).sort((a, b) => b.train.expectancy - a.train.expectancy);
  const best = eligible[0];
  const result = {
    date: new Date().toISOString().slice(0, 10),
    candles: candles.length, splitTime: candles[split].time, from: candles[250].time, to: candles[candles.length - 1].time,
    tested: rows.length,
  };
  if (!best) {
    return { ...result, status: 'unverified', decisive: false, note: 'Train කොටසේ trades මදි — data වැඩිපුර ඕන (timeframe එක පොඩි කරලා බලන්න).' };
  }
  const test = S.stats(runConfig(F, symbol, best.cfg.strategy, best.cfg.params, best.cfg.exits, split), best.cfg.exits.tpR);
  // also: how does the current preset do on the same test window?
  const prof = getProfile(symbol, tf);
  const presetTest = S.stats(runConfig(F, symbol, prof.strategy, prof.params, prof.exits, split), prof.exits.tpR);

  let status, note;
  const decisive = test.trades >= 15;
  if (!decisive) { status = 'unverified'; note = `Test කොටසේ trades ${test.trades} යි — තීරණයකට මදි (15+ ඕන).`; }
  else if (best.train.profitFactor >= 1.1 && test.profitFactor >= 1.15 && test.netR > 0) { status = 'verified'; note = 'අලුත් data එකේත් (කවදාවත් නොදැකපු කොටසේ) ලාභයි.'; }
  else if (test.profitFactor >= 1.0 && test.netR > 0) { status = 'weak'; note = 'Test කොටසේ ලාභය පොඩියි — ප්‍රවේශමෙන්.'; }
  else { status = 'noedge'; note = 'Train එකේ හොඳ වුණාට test කොටසේ පාඩුයි — මේකේ signals පාවිච්චි කරන්න එපා.'; }

  const hasPreset = !!PRESETS[`${symbol}|${tf}`];
  if (hasPreset) {
    const pt = presetTest;
    if (pt.trades < 15) note = `Research profile එක තියාගත්තා. පහුගිය මාස කීපයේ trades ${pt.trades} යි — recent data එකෙන් තීරණයකට මදි.`;
    else if (pt.profitFactor >= 1.15 && pt.netR > 0) note = 'Research profile එක පහුගිය මාස කීපයේත් ලාභයි ✓';
    else if (pt.profitFactor >= 0.9) note = 'Research profile එක පහුගිය මාස කීපයේ breakeven වගේ — ප්‍රවේශමෙන්.';
    else note = '⚠️ Research profile එක පහුගිය මාස කීපයේ පාඩුයි — lot size අඩු කරන්න.';
    status = PRESETS[`${symbol}|${tf}`].status; // badge = the profile actually used (same rule as profiles.js)
    if (status === 'verified' && pt.trades >= 15 && pt.profitFactor != null && pt.profitFactor < 0.9) status = 'weak';
  }
  const out = {
    ...result, status, decisive, note, hasPreset,
    strategy: best.cfg.strategy, params: best.cfg.params, exits: best.cfg.exits,
    train: strip(best.train), test: strip(test), presetTest: strip(presetTest),
    top: eligible.slice(0, 5).map((r) => ({ strategy: r.cfg.strategy, params: r.cfg.params, exits: r.cfg.exits, train: strip(r.train) })),
  };
  saveOptimized(symbol, tf, out);
  return out;
}
const strip = ({ curve, ...s }) => s;

module.exports = { backtest, optimize };
