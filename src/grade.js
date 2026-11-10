// Signal Grade: combines every tool into one simple grade for a strategy signal.
//  🏆 A — verified strategy signal, price in entry zone, Deep agrees, ML not against, no big news soon
//  🥈 B — valid strategy signal with one weak point → trade with smaller risk
//  ⚠️ C — no valid strategy signal, or 2+ weak points → don't trade
// Grades are logged (data/grade-log.json) so the Tracker can prove whether A really beats B/C.

const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, '..', 'data', 'grade-log.json');

function grade({ strategy, statusCode: sc, deepAction, ml, soonNews }) {
  let statusCode = sc;
  const reasons = [];
  const act = strategy?.action;
  if (!['BUY', 'SELL'].includes(act)) return { grade: 'C', reasons: [{ ok: false, text: 'Strategy signal එකක් නැහැ' }], advice: 'Trade කරන්න එපා — strategy signal එකක් එනකම් ඉන්න' };
  const prof = strategy.profile?.status || strategy.status;
  if (!['verified', 'weak'].includes(prof)) return { grade: 'C', reasons: [{ ok: false, text: `Strategy profile එක ${prof} — test කරලා ලාභ බව ඔප්පු නැහැ` }], advice: 'Trade කරන්න එපා' };
  if (['INVALID', 'EXPIRED', 'DONE'].includes(statusCode)) return { grade: 'C', reasons: [{ ok: false, text: `Signal status ${statusCode} — signal එක ඉවරයි` }], advice: 'Trade කරන්න එපා' };
  if (statusCode === 'FILLED') return { grade: 'C', reasons: [{ ok: false, text: 'Limit order එක දැනටමත් fill වෙලා — අලුත් entry නැහැ' }], advice: 'ඊළඟ signal එකට ඉන්න' };
  if (statusCode === 'LIMIT') statusCode = 'ACTIVE'; // waiting for the limit = the right time to place the order
  if (statusCode === 'MISSED') return { grade: 'C', reasons: [{ ok: false, text: 'මිල entry zone එකෙන් ඉස්සරහට ගිහින් (MISSED)' }], advice: 'Chase කරන්න එපා — zone එකට එනකම් ඉන්න' };

  let neg = 0;
  const add = (ok, text) => { reasons.push({ ok, text }); if (ok === false) neg++; };
  add(prof === 'verified', prof === 'verified' ? 'Strategy එක ✅ Verified' : 'Strategy profile එක ⚠️ Weak');
  add(statusCode === 'ACTIVE', statusCode === 'ACTIVE' ? (sc === 'LIMIT' ? 'Limit order එක දාන්න හොඳ වෙලාව' : 'මිල entry zone එක ඇතුළේ') : 'මිල zone එකට එහා පැත්තේ (CAUTION)');
  if (deepAction === act) add(true, `Deep Analysis එකත් ${act}`);
  else if (deepAction === 'WAIT') add(null, 'Deep Analysis එක WAIT (එකඟත් නැහැ, විරුද්ධත් නැහැ)');
  else if (deepAction) add(false, `Deep Analysis එක ${deepAction} — විරුද්ධයි`);
  if (ml && ml.available && ml.filter) add(ml.filter.ok ? true : false, ml.filter.ok ? 'ML filter 👍' : 'ML filter 👎');
  else add(null, 'ML filter නැහැ (මේ market එකට)');
  if (soonNews == null) add(null, 'News calendar එක check කරන්න බැරි වුණා — CPI/NFP වගේ news ඔයාම බලන්න');
  else if (soonNews.length) add(false, `ඉදිරි පැය 24 ඇතුළත high-impact news: ${soonNews.map((e) => e.title).join(', ')}`);
  else add(true, 'ළඟ ලොකු news නැහැ');

  const g = neg === 0 && prof === 'verified' && statusCode === 'ACTIVE' && deepAction === act ? 'A' : neg <= 1 ? 'B' : 'C';
  const advice = g === 'A' ? 'හොඳම signal එක — සාමාන්‍ය risk එක (1%) එක්ක trade කරන්න පුළුවන්'
    : g === 'B' ? 'Trade කරනවා නම් risk එක අඩු කරන්න (0.5%)' : 'Trade කරන්න එපා — දුර්වල තැන් ගොඩක්';
  return { grade: g, reasons, advice };
}

function logGrade(e) {
  try {
    let all = [];
    try { all = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch {}
    const key = `${e.symbol}|${e.tf}|${e.signalTime}`;
    const prev = all.find((x) => x.key === key);
    if (prev) { // keep the first grade we saw for this signal (what the trader saw at entry time)
      return;
    }
    all.unshift({ key, ...e });
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, JSON.stringify(all.slice(0, 2000), null, 2));
  } catch {}
}

module.exports = { grade, logGrade, LOG };
