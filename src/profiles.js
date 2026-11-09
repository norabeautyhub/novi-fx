// Strategy profile per symbol + timeframe.
//  PRESETS come from the offline research (real tick data, spread costs, walk-forward):
//    Gold 2014–2018 (4.5 yrs) and EURUSD 2017–2021 (5 yrs).
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
