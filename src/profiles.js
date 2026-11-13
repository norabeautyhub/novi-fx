// Strategy profile per symbol + timeframe.
//  PRESETS come from the offline research (real tick data, spread costs, walk-forward):
//    Gold 2014–2018 (4.5 yrs), EURUSD 2017–2021 (5 yrs) and 10 more markets 2015–2018.
//    verified = profitable on unseen years (walk-forward) + PF ≥ 1.2 + 30+ trades + ≥3/4 years profitable.
//  data/profiles.json holds results of the in-app Optimizer (your machine, latest data)
//  and overrides the preset when it has enough trades to judge.
//
// status: verified | weak | unverified | noedge | disabled

const fs = require('fs');
const path = require('path');

const LONDON_NY = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; // UTC hours

const DEFAULT = {
  status: 'unverified',
  strategy: 'pullback',
  params: { adx: 15, htf: 'htf4', rsi: 50, sl: 2.0, touch: 0.3 },
  exits: { tpR: 3 },
  note: 'මේ symbol/timeframe එක research කරලා නැහැ — Backtest tab එකේ "Optimizer" run කරන්න.',
};

const PRESETS = {
  'XAUUSD|1h': {
    status: 'verified', strategy: 'pullback',
    params: { adx: 25, htf: 'htfD', rsi: 50, sl: 1.5, touch: 0.3 }, exits: { tpR: 3 },
    research: { data: 'Gold 2014–2018', trades: 91, winRate: 33, pf: 1.3, netR: 20, posYears: '5/5' },
  },
  'XAUUSD|4h': {
    status: 'verified', strategy: 'breakout',
    params: { n: 55, sl: 1.5, htf: 'htfD', hours: LONDON_NY, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'Gold 2014–2018', trades: 117, winRate: 33, pf: 1.4, netR: 33, posYears: '4/5' },
  },
  'XAUUSD|15m': {
    status: 'weak', strategy: 'breakout',
    params: { n: 55, sl: 2.5, htf: 'htfD', adx: 20 }, exits: { tpR: 3 },
    research: { data: 'Gold 2014–2018', trades: 720, winRate: 30, pf: 1.11, netR: 63, posYears: '4/5' },
    note: 'ලාභය පොඩියි (PF 1.11) — spread වැඩි broker කෙනෙක් එක්ක පාඩු වෙන්න පුළුවන්.',
  },
  'EURUSD|4h': {
    status: 'verified', strategy: 'pullback',
    params: { adx: 15, htf: 'htf4', rsi: 50, sl: 2.0, touch: 0.0 }, exits: { tpR: 3 },
    research: { data: 'EURUSD 2017–2021', trades: 61, winRate: 34, pf: 1.51, netR: 21, posYears: '5/5' },
  },
  'EURUSD|1h': {
    status: 'disabled', strategy: 'pullback', params: DEFAULT.params, exits: { tpR: 3 },
    research: { data: 'EURUSD 2017–2021', note: 'strategies 4ක් + settings 550+ — කිසිම එකක් costs එක්ක ලාභ නැහැ' },
    note: 'EURUSD 1h එකේ හොඳ strategy එකක් හම්බුනේ නැහැ — signals off.',
  },
  'EURUSD|15m': {
    status: 'disabled', strategy: 'pullback', params: DEFAULT.params, exits: { tpR: 3 },
    research: { data: 'EURUSD 2017–2021', note: 'හැම setting එකක්ම පාඩුයි (costs නිසා)' },
    note: 'EURUSD 15m — costs නිසා පාඩුයි, signals off.',
  },
  // ---- 10 more markets: real tick data 2015–2018 (2018 = Jan–Jun), costs ×1.2, walk-forward ----
  'XAGUSD|1h': {
    status: 'weak', strategy: 'breakout',
    params: { n: 55, sl: 2.5, htf: 'htfD', hours: LONDON_NY, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'Silver 2015–2018', trades: 128, winRate: 33, pf: 1.11, netR: 11, posYears: '2/4', walkForward: { netR: 3.8, pf: 1.04 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.04) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
  'XAGUSD|4h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 55, sl: 1.5, htf: 'htf4', hours: null, adx: 20 }, exits: { tpR: 2 },
    research: { data: 'Silver 2015–2018', trades: 122, winRate: 40, pf: 1.01, netR: 1, posYears: '2/4', walkForward: { netR: -6.7, pf: 0.87 } },
    note: 'Silver 4h — නොදැකපු අවුරුදු වල පාඩුයි (-6.7R) — signals off.',
  },
  'GBPUSD|1h': {
    status: 'weak', strategy: 'pullback',
    params: { adx: 25, htf: 'htf4', rsi: 50, sl: 1.5, touch: 0.0 }, exits: { tpR: 2 },
    research: { data: 'GBPUSD 2015–2018', trades: 72, winRate: 46, pf: 1.51, netR: 22, posYears: '3/4', walkForward: { netR: 5.8, pf: 1.11 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.11) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
  'GBPUSD|4h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 20, sl: 1.5, htf: 'htfD', hours: LONDON_NY, adx: 20 }, exits: { tpR: 2 },
    research: { data: 'GBPUSD 2015–2018', trades: 117, winRate: 38, pf: 1.16, netR: 12, posYears: '4/4', walkForward: { netR: -9.2, pf: 0.88 } },
    note: 'GBPUSD 4h — නොදැකපු අවුරුදු වල පාඩුයි (-9.2R) — signals off.',
  },
  'USDCAD|1h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 55, sl: 2.5, htf: 'htf4', hours: null, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'USDCAD 2015–2018', trades: 226, winRate: 30, pf: 1.19, netR: 31, posYears: '4/4', walkForward: { netR: -1.8, pf: 0.97 } },
    note: 'USDCAD 1h — නොදැකපු අවුරුදු වල පාඩුයි (-1.8R) — signals off.',
  },
  'USDCAD|4h': {
    status: 'verified', strategy: 'breakout',
    params: { n: 20, sl: 2.5, htf: 'htf4', hours: LONDON_NY, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'USDCAD 2015–2018', trades: 78, winRate: 36, pf: 1.63, netR: 32, posYears: '4/4', walkForward: { netR: 9.8, pf: 1.28 } },
  },
  'USDCHF|1h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 20, sl: 2.5, htf: 'htf4', hours: LONDON_NY, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'USDCHF 2015–2018', trades: 206, winRate: 29, pf: 1.11, netR: 17, posYears: '3/4', walkForward: { netR: -5.3, pf: 0.95 } },
    note: 'USDCHF 1h — නොදැකපු අවුරුදු වල පාඩුයි (-5.3R) — signals off.',
  },
  'USDCHF|4h': {
    status: 'weak', strategy: 'pullback',
    params: { adx: 15, htf: 'htf4', rsi: 50, sl: 2.0, touch: 0.3 }, exits: { tpR: 3 },
    research: { data: 'USDCHF 2015–2018', trades: 43, winRate: 33, pf: 1.37, netR: 11, posYears: '3/4', walkForward: { netR: 1.5, pf: 1.05 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.05) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
  'EURJPY|1h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 55, sl: 2.5, htf: 'htfD', hours: LONDON_NY, adx: 0 }, exits: { tpR: 2 },
    research: { data: 'EURJPY 2015–2018', trades: 188, winRate: 38, pf: 1.11, netR: 14, posYears: '4/4', walkForward: { netR: -5.0, pf: 0.95 } },
    note: 'EURJPY 1h — නොදැකපු අවුරුදු වල පාඩුයි (-5.0R) — signals off.',
  },
  'EURJPY|4h': {
    status: 'weak', strategy: 'pullback',
    params: { adx: 15, htf: 'htfD', rsi: 50, sl: 1.5, touch: 0.3 }, exits: { tpR: 2 },
    research: { data: 'EURJPY 2015–2018', trades: 60, winRate: 38, pf: 1.16, netR: 6, posYears: '3/4', walkForward: { netR: 1.4, pf: 1.05 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.05) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
  'AUDUSD|1h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 20, sl: 2.5, htf: 'htfD', hours: null, adx: 20 }, exits: { tpR: 3 },
    research: { data: 'AUDUSD 2015–2018', trades: 200, winRate: 28, pf: 1.07, netR: 10, posYears: '3/4', walkForward: { netR: -10.1, pf: 0.91 } },
    note: 'AUDUSD 1h — නොදැකපු අවුරුදු වල පාඩුයි (-10.1R) — signals off.',
  },
  'AUDUSD|4h': {
    status: 'disabled', strategy: 'pullback',
    params: { adx: 20, htf: 'htfD', rsi: 50, sl: 1.5, touch: 0.3 }, exits: { tpR: 2 },
    research: { data: 'AUDUSD 2015–2018', trades: 32, winRate: 41, pf: 1.29, netR: 6, posYears: '3/4', walkForward: { netR: -4.3, pf: 0.85 } },
    note: 'AUDUSD 4h — නොදැකපු අවුරුදු වල පාඩුයි (-4.3R) — signals off.',
  },
  'USDJPY|1h': {
    status: 'disabled', strategy: 'pullback',
    params: { adx: 15, htf: 'htf4', rsi: 50, sl: 2.0, touch: 0.0 }, exits: { tpR: 3 },
    research: { data: 'USDJPY 2015–2018', trades: 192, winRate: 30, pf: 1.18, netR: 26, posYears: '3/4', walkForward: { netR: -7.3, pf: 0.95 } },
    note: 'USDJPY 1h — නොදැකපු අවුරුදු වල පාඩුයි (-7.3R) — signals off.',
  },
  'USDJPY|4h': {
    status: 'disabled', strategy: 'pullback',
    params: { adx: 20, htf: 'htfD', rsi: 50, sl: 2.0, touch: 0.0 }, exits: { tpR: 3 },
    research: { data: 'USDJPY 2015–2018', trades: 30, winRate: 33, pf: 1.45, netR: 9, posYears: '3/4', walkForward: { netR: -4.3, pf: 0.93 } },
    note: 'USDJPY 4h — නොදැකපු අවුරුදු වල පාඩුයි (-4.3R) — signals off.',
  },
  'GBPJPY|1h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 55, sl: 2.5, htf: 'htf4', hours: LONDON_NY, adx: 0 }, exits: { tpR: 3 },
    research: { data: 'GBPJPY 2015–2018', trades: 211, winRate: 31, pf: 1.28, netR: 43, posYears: '3/4', walkForward: { netR: -0.9, pf: 0.98 } },
    note: 'GBPJPY 1h — නොදැකපු අවුරුදු වල පාඩුයි (-0.9R) — signals off.',
  },
  'GBPJPY|4h': {
    status: 'disabled', strategy: 'breakout',
    params: { n: 20, sl: 1.5, htf: 'htf4', hours: LONDON_NY, adx: 0 }, exits: { tpR: 3 },
    research: { data: 'GBPJPY 2015–2018', trades: 148, winRate: 34, pf: 1.5, netR: 50, posYears: '4/4', walkForward: { netR: -7.8, pf: 0.82 } },
    note: 'GBPJPY 4h — නොදැකපු අවුරුදු වල පාඩුයි (-7.8R) — signals off.',
  },
  'NZDUSD|1h': {
    status: 'weak', strategy: 'pullback',
    params: { adx: 25, htf: 'htfD', rsi: 50, sl: 2.0, touch: 0.3 }, exits: { tpR: 3 },
    research: { data: 'NZDUSD 2015–2018', trades: 76, winRate: 36, pf: 1.49, netR: 26, posYears: '3/4', walkForward: { netR: 5.2, pf: 1.16 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.16) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
  'NZDUSD|4h': {
    status: 'verified', strategy: 'pullback',
    params: { adx: 20, htf: 'htf4', rsi: 50, sl: 1.5, touch: 0.0 }, exits: { tpR: 2 },
    research: { data: 'NZDUSD 2015–2018', trades: 37, winRate: 43, pf: 1.4, netR: 9, posYears: '3/4', walkForward: { netR: 7.9, pf: 1.21 } },
  },
  'EURGBP|1h': {
    status: 'verified', strategy: 'pullback',
    params: { adx: 25, htf: 'htf4', rsi: 50, sl: 2.0, touch: 0.0 }, exits: { tpR: 3 },
    research: { data: 'EURGBP 2015–2018', trades: 65, winRate: 34, pf: 1.41, netR: 19, posYears: '3/4', walkForward: { netR: 23.3, pf: 1.47 } },
  },
  'EURGBP|4h': {
    status: 'weak', strategy: 'breakout',
    params: { n: 55, sl: 1.5, htf: 'htfD', hours: LONDON_NY, adx: 20 }, exits: { tpR: 2 },
    research: { data: 'EURGBP 2015–2018', trades: 104, winRate: 40, pf: 1.26, netR: 17, posYears: '3/4', walkForward: { netR: 1.1, pf: 1.02 } },
    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF 1.02) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',
  },
};

const FILE = path.join(__dirname, '..', 'data', 'profiles.json');
function loadSaved() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function saveOptimized(symbol, tf, result) {
  const all = loadSaved();
  all[`${symbol}|${tf}`] = result;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

function getProfile(symbol, tf) {
  const key = `${symbol}|${tf}`;
  const preset = PRESETS[key];
  const base = preset ? { ...preset, source: 'research' } : { ...DEFAULT, source: 'default' };
  const opt = loadSaved()[key];
  // Research presets (4–5 years of tick data) outweigh ~10 months of optimizer data:
  // the optimizer only replaces a profile where no research preset exists.
  if (opt && preset) {
    base.optimizer = opt;
    const pt = opt.presetTest;
    if (pt && pt.trades >= 15 && pt.profitFactor != null && pt.profitFactor < 0.9) {
      base.note = `⚠️ පහුගිය මාස කීපයේ මේ strategy එක පාඩුයි (PF ${pt.profitFactor}) — lot size එක අඩු කරන්න / ප්‍රවේශමෙන්.`;
      if (base.status === 'verified') base.status = 'weak';
    }
    return base;
  }
  if (opt && opt.decisive) {
    return { ...base, status: opt.status, strategy: opt.strategy, params: opt.params, exits: opt.exits, source: 'optimizer', optimizer: opt, note: opt.note };
  }
  if (opt) base.optimizer = opt; // shown, but not enough trades to override the research
  return base;
}

module.exports = { getProfile, saveOptimized, PRESETS, DEFAULT, LONDON_NY };
