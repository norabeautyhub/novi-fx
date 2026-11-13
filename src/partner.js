// Partner market check: does a closely linked market point the same way?
// Research (2015–2018 tick data, research/partner_research.py) found that partner
// agreement does NOT improve signals — so this is shown as information only and
// never changes the signal or the grade.

const { features } = require('./strategy');
const RESEARCH = require('./partner-research.json');

// relation +1 = move together, −1 = move opposite
const PARTNERS = {
  XAUUSD: [['XAGUSD', 1]], XAGUSD: [['XAUUSD', 1]],
  EURUSD: [['GBPUSD', 1], ['USDCHF', -1]], GBPUSD: [['EURUSD', 1]], USDCHF: [['EURUSD', -1]],
  NZDUSD: [['AUDUSD', 1]], AUDUSD: [['NZDUSD', 1]],
  BTCUSDT: [['ETHUSDT', 1]], ETHUSDT: [['BTCUSDT', 1]],
};

const dirOf = (v) => (v > 0 ? 'UP' : v < 0 ? 'DOWN' : 'FLAT');

async function partnerCheck(symbol, tf, direction, getCandles) {
  const list = PARTNERS[symbol];
  if (!list) return { available: false, reason: 'මේ market එකට partner market එකක් set කරලා නැහැ' };
  const d = direction === 'BUY' ? 1 : direction === 'SELL' ? -1 : 0;
  const out = [];
  for (const [p, rel] of list) {
    try {
      const cs = await getCandles(p, tf);
      const F = features(cs);
      const i = cs.length - 2; // last CLOSED candle
      const t = { tf: Math.sign(F.ema20[i] - F.ema50[i]), h4: tf === '1d' ? 0 : Math.sign(F.htf4[i]), d1: Math.sign(F.htfD[i]) };
      const main = t.d1 || t.tf;            // research used the partner's daily trend
      const implied = main * rel;           // what the partner says about OUR market
      const verdict = !d ? 'NONE' : !implied ? 'FLAT' : implied === d ? 'AGREE' : 'DISAGREE';
      const r = RESEARCH[`${symbol}|${p}|${tf}`] || null;
      out.push({ symbol: p, relation: rel, price: cs[cs.length - 1].close, trend: { tf: dirOf(t.tf), h4: dirOf(t.h4), d1: dirOf(t.d1) },
        implied: implied > 0 ? 'BUY' : implied < 0 ? 'SELL' : null, verdict, research: r });
    } catch (e) { out.push({ symbol: p, relation: rel, error: e.message }); }
  }
  return { available: true, direction: d ? direction : null, partners: out };
}

module.exports = { partnerCheck, PARTNERS };
