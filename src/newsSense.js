// News → market effect, without AI (keyword rules).
// Each headline is split into clauses ("Dollar falls as gold rises" → 2 clauses);
// in each clause we find which currency it talks about and whether the words say
// that currency gets stronger (+) or weaker (−). Then:
//   base currency stronger → BULLISH for the pair, quote currency stronger → BEARISH.
// War / tension headlines push safe havens (Gold, Silver, JPY, CHF) up.
// This is a rough reader — far less accurate than a person or AI. Its real success
// rate is measured from now on in the Tracker (no old news data to backtest with).

const UP = ['rise', 'rises', 'rising', 'rose', 'gain', 'gains', 'climb', 'climbs', 'jump', 'jumps', 'surge', 'surges', 'soar', 'soars', 'rally', 'rallies',
  'higher', 'strengthens', 'strengthen', 'stronger', 'firm', 'firms', 'firmer', 'rebound', 'rebounds', 'advance', 'advances', 'record high', 'bullish', 'outperform', 'boost', 'boosts', 'boosted'];
const DOWN = ['fall', 'falls', 'falling', 'fell', 'drop', 'drops', 'slide', 'slides', 'slip', 'slips', 'decline', 'declines', 'tumble', 'tumbles', 'plunge', 'plunges',
  'sink', 'sinks', 'lower', 'weaken', 'weakens', 'weaker', 'retreat', 'retreats', 'slump', 'slumps', 'loss', 'losses', 'bearish', 'sell-off', 'selloff', 'pressure', 'pressured'];
// monetary / economy words: good for the currency they are about
const HAWK = ['rate hike', 'rate hikes', 'hike rates', 'raises rates', 'raise rates', 'hawkish', 'tighten', 'tightening', 'higher for longer', 'hot inflation',
  'inflation rises', 'inflation jumps', 'inflation accelerates', 'strong jobs', 'beats expectations', 'beat expectations', 'better-than-expected', 'robust growth'];
const DOVE = ['rate cut', 'rate cuts', 'cut rates', 'cuts rates', 'dovish', 'easing', 'stimulus', 'weak jobs', 'misses expectations', 'missed expectations',
  'worse-than-expected', 'recession', 'slowdown', 'contraction', 'unemployment rises', 'jobless claims rise', 'inflation cools', 'inflation slows', 'shutdown'];
const RISK_OFF = ['war', 'conflict', 'attack', 'attacks', 'missile', 'missiles', 'tension', 'tensions', 'geopolitical', 'safe haven', 'safe-haven', 'crisis',
  'invasion', 'sanctions', 'escalation', 'escalates'];
const SAFE = new Set(['XAU', 'XAG', 'JPY', 'CHF']);

const NAME = { XAU: 'Gold', XAG: 'Silver', USD: 'USD', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY', AUD: 'AUD', NZD: 'NZD', CAD: 'CAD', CHF: 'CHF',
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB' };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rx = (w) => new RegExp(`(^|[^a-z])${esc(w)}([^a-z]|$)`);
const count = (txt, list) => list.reduce((n, w) => n + (rx(w).test(txt) ? 1 : 0), 0);
const has = (txt, list) => list.some((w) => rx(w.trim()).test(txt));

function clauses(text) {
  return text.toLowerCase().split(/,|;|:| - | – | as | while | after | amid | but | despite | though | ahead of /).map((s) => ` ${s.trim()} `).filter((s) => s.trim());
}

// effect of one headline on BASE/QUOTE. Returns { effect: +1|-1|0, reason }
function headlineEffect(text, base, quote, KEYWORDS) {
  const strength = {};   // currency → +/−
  for (const cl of clauses(text)) {
    const pol = count(cl, UP) - count(cl, DOWN) + 1.5 * (count(cl, HAWK) - count(cl, DOVE));
    if (!pol) continue;
    for (const c of [base, quote]) {
      const words = KEYWORDS[c] || [];
      if (words.length && has(cl, words)) strength[c] = (strength[c] || 0) + Math.sign(pol);
    }
  }
  let score = (strength[base] || 0) - (strength[quote] || 0);
  const why = Object.entries(strength).filter(([, v]) => v).map(([c, v]) => `${NAME[c] || c} ${v > 0 ? 'ශක්තිමත්' : 'දුර්වල'}`);
  const lower = ` ${text.toLowerCase()} `;
  if (has(lower, RISK_OFF) && (SAFE.has(base) || SAFE.has(quote))) {
    score += SAFE.has(base) ? 1 : -1;
    why.push(`යුද්ධ / ආතතිය → safe haven (${NAME[SAFE.has(base) ? base : quote]}) ශක්තිමත්`);
  }
  const effect = Math.sign(score);
  return { effect, reason: why.length ? why.join(' · ') : '' };
}

function shortSummary(s) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  const first = t.split(/(?<=[.!?])\s/)[0];
  const out = first.length > 40 ? first : t;
  return out.length > 200 ? out.slice(0, 197).replace(/\s\S*$/, '') + '…' : out;
}

// items: [{ headline, summary, time }]  → adds effect/reason/short, returns overall news signal
function newsSignal(items, base, quote, KEYWORDS) {
  const now = Date.now() / 1000;
  let bull = 0, bear = 0, neutral = 0;
  for (const n of items) {
    const h = headlineEffect(n.headline || '', base, quote, KEYWORDS);
    const e = h.effect || headlineEffect(shortSummary(n.summary || ''), base, quote, KEYWORDS).effect;
    const r = h.effect ? h.reason : e ? headlineEffect(shortSummary(n.summary || ''), base, quote, KEYWORDS).reason : '';
    n.effect = e > 0 ? 'BULLISH' : e < 0 ? 'BEARISH' : 'NEUTRAL';
    n.reason = r;
    n.short = shortSummary(n.summary);
    if (now - n.time > 24 * 3600) continue; // only the last 24h count toward the signal
    if (e > 0) bull++; else if (e < 0) bear++; else neutral++;
  }
  let action = 'NEUTRAL', why;
  if (bull + bear < 2) why = 'පැය 24 ඇතුළත මේ market එකට බලපාන news මදි';
  else if (bull - bear >= 2 && bull >= 2 * bear) { action = 'BUY'; why = `news වැඩි හරිය ${NAME[base] || base} ට හොඳයි`; }
  else if (bear - bull >= 2 && bear >= 2 * bull) { action = 'SELL'; why = `news වැඩි හරිය ${NAME[base] || base} ට නරකයි`; }
  else why = 'news දෙපැත්තටම — පැහැදිලි දිශාවක් නැහැ';
  return { action, bull, bear, neutral, why };
}

module.exports = { newsSignal, headlineEffect, shortSummary };
