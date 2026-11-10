// Live signal from the researched strategies (closed candles only).
// Looks back `validBars` closed candles for the most recent BUY/SELL and checks
// whether SL / TP1 was already touched after it.

const S = require('./strategy');
const { MODES } = S;
const { getProfile } = require('./profiles');

const VALID_BARS = 3;
const ZONE_FWD = 0.25, ZONE_BACK = 0.3; // ATRs

const TREND_TXT = { 1: 'UP ▲', '-1': 'DOWN ▼', 0: 'පැහැදිලි නැහැ' };

function checklist(F, i, prof, f) {
  const p = prof.params, out = [];
  const htf = F[p.htf || 'htf4'][i];
  const htfName = (p.htf || 'htf4') === 'htfD' ? 'Daily' : '4H';
  out.push({ ok: htf !== 0, text: `${htfName} trend: ${TREND_TXT[htf]}` });
  if (prof.strategy === 'pullback') {
    const up = F.ema20[i] > F.ema50[i] && F.ema50[i] > F.ema200[i];
    const dn = F.ema20[i] < F.ema50[i] && F.ema50[i] < F.ema200[i];
    out.push({ ok: (up && htf > 0) || (dn && htf < 0), text: `EMA 20/50/200 පිළිවෙළ: ${up ? 'UP' : dn ? 'DOWN' : 'පටලැවිලා'}${(up && htf < 0) || (dn && htf > 0) ? ' (ලොකු trend එකට විරුද්ධයි)' : ''}` });
    out.push({ ok: F.adx[i] > p.adx, text: `Trend ශක්තිය ADX ${F.adx[i].toFixed(0)} (අවම ${p.adx})` });
    out.push({ ok: null, text: `RSI ${F.rsi[i].toFixed(0)} — 50 cross එකක් එනකම් (entry trigger)` });
    out.push({ ok: null, text: `EMA20 ${f(F.ema20[i])} — මිල ඒකට pullback වෙලා ආයෙත් හැරෙන්න ඕන` });
  } else {
    const hi = Math.max(...F.h.slice(i - p.n, i)), lo = Math.min(...F.l.slice(i - p.n, i));
    out.push({ ok: F.adx[i] > (p.adx || 0), text: `Trend ශක්තිය ADX ${F.adx[i].toFixed(0)}${p.adx ? ` (අවම ${p.adx})` : ''}` });
    out.push({ ok: null, text: `Candles ${p.n} high ${f(hi)} / low ${f(lo)} — trend පැත්තට break එකක් එනකම්` });
    if (p.hours) out.push({ ok: p.hours.includes(F.hour[i]), text: 'London/New York session (UTC 07–17) ඇතුළේ විතරයි' });
  }
  return out;
}

function liveSignal(candles, symbol, tf, tfSec, digits, mode = 'normal') {
  const prof = getProfile(symbol, tf);
  const f = (v) => (digits != null ? (+v).toFixed(digits) : String(+(+v).toPrecision(8)));
  const L = candles.length - 2; // last CLOSED candle
  const base = { profile: { status: prof.status, strategy: prof.strategy, params: prof.params, exits: prof.exits, research: prof.research, optimizer: prof.optimizer, source: prof.source, note: prof.note }, closedCandleTime: candles[L]?.time, price: candles[L]?.close };

  if (candles.length < 260) return { ...base, action: 'WAIT', score: 0, confidence: 0, reasons: [{ ok: false, text: 'Candles මදි (260+ ඕන)' }] };
  const F = S.features(candles);
  if (prof.status === 'disabled' || prof.status === 'noedge') {
    return { ...base, action: 'OFF', score: 0, confidence: 0, reasons: [] };
  }
  const { sig, sl } = S.STRATEGIES[prof.strategy](F, prof.params);

  let k = -1;
  for (let j = L; j >= Math.max(0, L - VALID_BARS + 1); j--) if (sig[j]) { k = j; break; }
  const reasons = checklist(F, L, prof, f);

  if (k < 0) {
    return { ...base, action: 'WAIT', score: 0, confidence: 0, atr: F.atr[L], rsi: F.rsi[L], adx: F.adx[L], reasons };
  }

  const d = sig[k], a = F.atr[k], entry = F.c[k], risk = sl[k];
  const tpR = prof.exits.tpR;
  const res = {
    ...base,
    action: d === 1 ? 'BUY' : 'SELL',
    score: d, confidence: null,
    price: F.c[L], atr: a, rsi: F.rsi[L], adx: F.adx[L],
    entry, stopLoss: entry - d * risk,
    tp1: entry + d * 1.5 * risk,     // half-way mark (optional partial close)
    tp2: entry + d * tpR * risk,     // main target used in research/backtest
    riskReward: tpR,
    zone: d === 1 ? [entry - ZONE_BACK * a, entry + ZONE_FWD * a] : [entry - ZONE_FWD * a, entry + ZONE_BACK * a],
    signalTime: candles[k].time + tfSec,
    expiresAt: candles[k].time + (VALID_BARS + 1) * tfSec,
    barsAgo: L - k,
    reasons: [
      { ok: true, text: prof.strategy === 'pullback'
        ? `${d === 1 ? 'Up' : 'Down'} trend එකේ EMA20 ට pullback එකක් වෙලා RSI 50 ${d === 1 ? 'උඩට' : 'යටට'} cross වුණා`
        : `Candles ${prof.params.n} ක ${d === 1 ? 'high එක උඩින්' : 'low එකට යටින්'} break වුණා (trend පැත්තට)` },
      ...checklist(F, k, prof, f),
    ],
  };
  res.mode = MODES[mode] ? mode : 'normal';
  const R1 = (e, r) => e + d * r;
  if (res.mode === 'highwin') {
    // limit entry 0.5 ATR better; stop stays at the same price; 50% off at 1R + SL to entry; rest to target
    const lim = entry - d * 0.5 * a;
    const rk = Math.max(risk - 0.5 * a, 0.5 * a);
    res.marketEntry = entry;
    res.entry = lim; res.stopLoss = lim - d * rk; res.tp1 = lim + d * rk; res.tp2 = lim + d * tpR * rk;
    res.zone = [lim, lim];
    res.limitExpires = candles[k].time + (1 + 4) * tfSec;
    res.plan = { limit: lim, partialAt: res.tp1, beTo: lim + d * 0.05 * rk, target: res.tp2 };
    // was the limit filled (within 4 candles)? then follow the trade
    let fillJ = -1;
    for (let j = k + 1; j < Math.min(candles.length, k + 5); j++) if (d === 1 ? candles[j].low <= lim : candles[j].high >= lim) { fillJ = j; break; }
    if (fillJ >= 0) {
      res.filled = true; res.filledTime = candles[fillJ].time;
      for (let j = fillJ; j < candles.length; j++) {
        const c = candles[j];
        if (d === 1 ? c.low <= res.stopLoss : c.high >= res.stopLoss) { res.outcome = 'SL'; break; }
        if (d === 1 ? c.high >= res.tp1 : c.low <= res.tp1) { res.outcome = 'TP1'; break; }
      }
    }
    return res;
  }
  if (res.mode === 'breakeven') res.plan = { beAt: R1(entry, risk), beTo: entry + d * 0.05 * risk, target: res.tp2 };
  for (let j = k + 1; j < candles.length; j++) {
    const c = candles[j];
    if (d === 1 ? c.low <= res.stopLoss : c.high >= res.stopLoss) { res.outcome = 'SL'; break; }
    if (d === 1 ? c.high >= res.tp1 : c.low <= res.tp1) { res.outcome = 'TP1'; break; }
  }
  return res;
}

// Where is the live price relative to a signal? (copied in public/app.js)
function signalStatus(sig, price, nowSec) {
  if (!sig || !['BUY', 'SELL'].includes(sig.action) || price == null) return null;
  const dir = sig.action === 'BUY' ? 1 : -1;
  if (sig.mode === 'highwin') {
    if (sig.outcome === 'SL') return { code: 'INVALID', text: 'Stop loss එක වැදුනා — signal එක ඉවරයි' };
    if (sig.outcome === 'TP1') return { code: 'DONE', text: 'Trade එක 1R දක්වා ගියා (50% ලාභය ගත්තා) — අලුතෙන් entry නැහැ' };
    if (sig.filled) return { code: 'FILLED', text: 'Limit order එක fill වුණා — trade එක open. අලුතෙන් entry ගන්න එපා' };
    if (dir * (price - sig.stopLoss) <= 0) return { code: 'INVALID', text: 'මිල SL එක පහු කළා — signal එක cancel' };
    if (nowSec > sig.limitExpires) return { code: 'EXPIRED', text: 'Candles 4ක් ඇතුළත limit මිලට ආවේ නැහැ — order එක delete කරන්න' };
    return { code: 'LIMIT', text: `${sig.action} LIMIT order එකක් ${sig.entry} මිලට දාන්න — candles 4ක් ඇතුළත මිල ආවොත් trade එක වෙනවා` };
  }
  if (sig.outcome === 'SL') return { code: 'INVALID', text: 'Stop loss එක වැදුනා — signal එක cancel' };
  if (sig.outcome === 'TP1') return { code: 'DONE', text: 'මිල 1.5R දක්වා ගිහින් — දැන් entry ගන්න පරක්කුයි' };
  if (dir * (price - sig.stopLoss) <= 0) return { code: 'INVALID', text: 'මිල SL එක පහු කළා — signal එක cancel' };
  if (dir * (price - sig.tp1) >= 0) return { code: 'DONE', text: 'මිල 1.5R දක්වා ගිහින් — දැන් entry ගන්න පරක්කුයි' };
  if (nowSec > sig.expiresAt) return { code: 'EXPIRED', text: 'Signal එක පරණයි (expired)' };
  const [lo, hi] = sig.zone;
  if (price >= lo && price <= hi) return { code: 'ACTIVE', text: 'මිල entry zone එක ඇතුළේ — entry ගන්න පුළුවන්' };
  if (dir * (price - (dir === 1 ? hi : lo)) > 0) return { code: 'MISSED', text: 'මිල zone එකෙන් ඉස්සරහට ගිහින් — chase කරන්න එපා, zone එකට එනකම් ඉන්න' };
  return { code: 'CAUTION', text: 'මිල zone එකට එහා පැත්තේ, SL එකට ළඟයි — ප්‍රවේශමෙන්' };
}

module.exports = { liveSignal, signalStatus };

// When the strategy says WAIT: where/what would trigger the next signal (for each trade mode).
// Uses the same rules as the strategy, looking at the last CLOSED candle.
function setupPlan(candles, symbol, tf, mode = 'normal', digits) {
  const prof = getProfile(symbol, tf);
  if (['disabled', 'noedge'].includes(prof.status)) return { off: true, text: prof.note || 'මේ market එකේ strategy එක off' };
  if (candles.length < 260) return { off: true, text: 'Candles මදි' };
  const F = S.features(candles);
  const L = candles.length - 2, p = prof.params, a = F.atr[L], price = F.c[L];
  const f = (v) => (digits != null ? (+v).toFixed(digits) : String(+(+v).toPrecision(8)));
  const htf = F[p.htf || 'htf4'][L];
  const htfName = (p.htf || 'htf4') === 'htfD' ? 'Daily' : '4H';
  const conds = [];
  if (htf === 0) return { dir: null, text: `${htfName} trend එක පැහැදිලි නැහැ — setup එකක් නැහැ (trend එකක් එනකම් ඉන්න)`, conds: [{ ok: false, text: `${htfName} trend: පැහැදිලි නැහැ` }] };
  const d = htf, act = d === 1 ? 'BUY' : 'SELL';
  conds.push({ ok: true, text: `${htfName} trend: ${d === 1 ? 'UP ▲' : 'DOWN ▼'}` });
  let level, text;
  const minAdx = p.adx || 0;
  conds.push({ ok: F.adx[L] > minAdx, text: `ADX ${F.adx[L].toFixed(0)} (අවම ${minAdx})` });
  if (prof.strategy === 'breakout') {
    const hi = Math.max(...F.h.slice(L - p.n + 1, L + 1)), lo = Math.min(...F.l.slice(L - p.n + 1, L + 1));
    level = d === 1 ? hi : lo;
    text = `${tf} candle එකක් ${f(level)} ට ${d === 1 ? 'උඩින්' : 'යටින්'} close වුණොත් → ${act}`;
    conds.push({ ok: null, text: `මිල දැන් ${f(price)} — break එකට තව ${f(Math.abs(level - price))}` });
    if (p.hours) conds.push({ ok: null, text: 'London/New York session (ලංකා වේලාවෙන් 12:30–22:30) ඇතුළේ close වෙන්න ඕන' });
  } else {
    const stack = d === 1 ? F.ema20[L] > F.ema50[L] && F.ema50[L] > F.ema200[L] : F.ema20[L] < F.ema50[L] && F.ema50[L] < F.ema200[L];
    conds.push({ ok: stack, text: `EMA 20/50/200 ${d === 1 ? 'UP' : 'DOWN'} පිළිවෙළට${stack ? '' : ' නැහැ'}` });
    level = F.ema20[L] + d * 0.1 * a;
    text = `මිල EMA20 (${f(F.ema20[L])}) ළඟට pullback වෙලා, RSI 50 ${d === 1 ? 'උඩට' : 'යටට'} cross වෙලා candle එක EMA20 ට ${d === 1 ? 'උඩින්' : 'යටින්'} close වුණොත් → ${act}`;
    conds.push({ ok: null, text: `RSI දැන් ${F.rsi[L].toFixed(0)}` });
  }
  // approximate levels if it triggers at `level`
  const risk = p.sl * a, tpR = prof.exits.tpR;
  let entry = level, sl = level - d * risk, tp = level + d * tpR * risk, extra = {};
  if (mode === 'highwin') {
    const rk = Math.max(risk - 0.5 * a, 0.5 * a);
    entry = level - d * 0.5 * a; sl = entry - d * rk; tp = entry + d * tpR * rk;
    extra = { partialAt: entry + d * rk, beTo: entry + d * 0.05 * rk };
  } else if (mode === 'breakeven') extra = { beAt: level + d * risk, beTo: level + d * 0.05 * risk };
  return { dir: act, level, text, conds, entry, stopLoss: sl, target: tp, ...extra, approx: true };
}
module.exports.setupPlan = setupPlan;
