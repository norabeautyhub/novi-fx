// AI analysis: Claude searches today's news (web search tool), reads the chart data,
// gives its OWN signal, and we compare it with the researched strategy signal.
// The AI signal is NOT backtested — the strategy signal stays the primary one.
// Every analysis is logged to data/ai-log.json so we can later measure if it helps.

const fs = require('fs');
const path = require('path');
const S = require('./strategy');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const LOG = path.join(__dirname, '..', 'data', 'ai-log.json');

function r(v, d) { return v == null || !isFinite(v) ? null : +(+v).toFixed(d); }

function context(symbol, tf, candles, signal, livePrice, digits) {
  const F = S.features(candles);
  const L = candles.length - 2;
  const last = candles.slice(-60).map((c) => [new Date(c.time * 1000).toISOString().slice(0, 16), r(c.open, digits), r(c.high, digits), r(c.low, digits), r(c.close, digits)]);
  // daily closes (last 30 days) from the same candles
  const days = new Map();
  for (const c of candles) days.set(new Date(c.time * 1000).toISOString().slice(0, 10), c.close);
  const daily = [...days.entries()].slice(-30).map(([d, c]) => [d, r(c, digits)]);
  const recentHigh = Math.max(...candles.slice(-120).map((c) => c.high));
  const recentLow = Math.min(...candles.slice(-120).map((c) => c.low));
  return {
    symbol, timeframe: tf, now_utc: new Date().toISOString().slice(0, 16), live_price: r(livePrice, digits),
    indicators_last_closed: {
      atr14: r(F.atr[L], digits), rsi14: r(F.rsi[L], 1), adx14: r(F.adx[L], 1),
      ema20: r(F.ema20[L], digits), ema50: r(F.ema50[L], digits), ema200: r(F.ema200[L], digits),
      trend_4h: F.htf4[L], trend_daily: F.htfD[L],
      range_last_120_candles: { high: r(recentHigh, digits), low: r(recentLow, digits) },
    },
    strategy_signal: {
      action: signal.action, entry: r(signal.entry, digits), stop_loss: r(signal.stopLoss, digits), target: r(signal.tp2, digits),
      strategy: signal.profile?.strategy, profile_status: signal.profile?.status, research: signal.profile?.research,
      checklist: (signal.reasons || []).map((x) => (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '• ') + x.text),
    },
    last_60_candles_ohlc: last,
    daily_closes_30d: daily,
  };
}

const PROMPT = (ctx) => `You are a professional, honest market analyst for a beginner trader in Sri Lanka.

TASK
1. Use web search (max 4 searches) to find TODAY's news that moves ${ctx.symbol}: central banks (Fed/ECB etc.), inflation, jobs, USD strength, geopolitics, and HIGH-IMPACT economic events scheduled in the next 48 hours (CPI, NFP, FOMC, rate decisions) with times in UTC. Prefer reputable sources (Reuters, Bloomberg, FXStreet, Kitco, ForexFactory, Investing.com). Do not invent news.
2. Analyse the chart data below (timeframe ${ctx.timeframe}).
3. Give YOUR OWN best signal for the next 1–3 days: BUY, SELL or WAIT. Be strict: if news risk is high or the picture is unclear, say WAIT. A good trade needs a logical stop beyond structure and reward at least 1.5× risk.
4. Compare with the strategy signal (a rule-based strategy that was backtested on years of data).

MARKET DATA (JSON)
${JSON.stringify(ctx)}

OUTPUT
First, a short plain explanation is fine. Then end your reply with ONE json code block exactly in this shape (numbers as numbers, Sinhala text in Sinhala script; trading terms may stay English):
\`\`\`json
{
  "news_bias": "bullish" | "bearish" | "neutral",
  "news_summary_si": "2–4 sentences: what news says for ${ctx.symbol} today",
  "events": [{"time_utc": "YYYY-MM-DD HH:MM", "event": "name", "impact": "high" | "medium"}],
  "technical_summary_si": "2–3 sentences on trend, key levels",
  "ai_signal": {"action": "BUY" | "SELL" | "WAIT", "entry": number|null, "stop_loss": number|null, "take_profit": number|null, "confidence": 0-100, "hold_hours": number|null},
  "agree_with_strategy": "agree" | "partial" | "disagree",
  "comparison_si": "1–2 sentences: why you agree/disagree with the strategy signal",
  "risks_si": ["short risk 1", "short risk 2"],
  "final_advice_si": "one clear sentence: what should the trader do now"
}
\`\`\``;

async function callClaude(messages, key) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3000, messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  return j;
}

function parseJSON(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : text.slice(text.lastIndexOf('{"news_bias"'));
  try { return JSON.parse(raw); } catch { return null; }
}

// sanity-check the AI levels and compute R:R
function checkAiSignal(s, price) {
  if (!s || !['BUY', 'SELL'].includes(s.action)) return { ...(s || {}), action: s?.action || 'WAIT', valid: true };
  const d = s.action === 'BUY' ? 1 : -1;
  const entry = s.entry ?? price;
  const problems = [];
  if (!(s.stop_loss > 0) || d * (entry - s.stop_loss) <= 0) problems.push('Stop loss එක වැරදි පැත්තේ / නැහැ');
  if (!(s.take_profit > 0) || d * (s.take_profit - entry) <= 0) problems.push('Take profit එක වැරදි පැත්තේ / නැහැ');
  const rr = problems.length ? null : Math.abs(s.take_profit - entry) / Math.abs(entry - s.stop_loss);
  return { ...s, entry, rr: rr == null ? null : +rr.toFixed(2), valid: !problems.length, problems };
}

function compare(strat, ai) {
  const sa = strat.action, aa = ai.action;
  const st = ['BUY', 'SELL'].includes(sa), at = ['BUY', 'SELL'].includes(aa);
  if (st && at && sa === aa) return { code: 'MATCH', text: 'Strategy එකයි AI එකයි දෙකම එකම දිශාව — ශක්තිමත් signal එකක්' };
  if (st && at) return { code: 'CONFLICT', text: 'Strategy එකයි AI එකයි විරුද්ධ දිශා — මේ trade එක skip කරන එක හොඳයි' };
  if (!st && !at) return { code: 'MATCH_WAIT', text: 'දෙකම WAIT — දැන් trade එකක් නැහැ' };
  if (st && !at) return { code: 'PARTIAL', text: 'Strategy signal එකක් තියෙනවා, ඒත් AI එක WAIT කියනවා — risk අඩු කරන්න හෝ skip කරන්න' };
  return { code: 'AI_ONLY', text: 'AI එක විතරයි signal එකක් දෙන්නේ — strategy එක (backtest කරපු එක) තාම confirm කරලා නැහැ' };
}

function log(entry) {
  try {
    let all = [];
    try { all = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch {}
    all.unshift(entry);
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, JSON.stringify(all.slice(0, 1000), null, 2));
  } catch {}
}

async function analyze({ symbol, tf, signal, candles, livePrice, digits }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'NO_KEY' };

  const ctx = context(symbol, tf, candles, signal, livePrice, digits);
  const messages = [{ role: 'user', content: PROMPT(ctx) }];
  let resp, content = [];
  for (let k = 0; k < 3; k++) {         // web search can pause long turns → continue
    resp = await callClaude(messages, key);
    content = content.concat(resp.content);
    if (resp.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: resp.content });
  }
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const sources = [];
  for (const b of content) for (const c of b.citations || []) if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title });
  if (!sources.length) for (const b of content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content.slice(0, 3)) if (x.url && !sources.some((s) => s.url === x.url)) sources.push({ url: x.url, title: x.title });

  const parsed = parseJSON(text);
  if (!parsed) return { ok: false, error: 'PARSE', raw: text.slice(-1500), sources };

  const aiSignal = checkAiSignal(parsed.ai_signal, livePrice);
  const strategy = { action: signal.action, entry: signal.entry, stopLoss: signal.stopLoss, target: signal.tp2, rr: signal.riskReward, status: signal.profile?.status, strategyName: signal.profile?.strategy };
  const match = compare(signal, aiSignal);
  const nowMs = Date.now();
  const soonEvents = (parsed.events || []).filter((e) => e.impact === 'high' && Date.parse(e.time_utc.replace(' ', 'T') + 'Z') - nowMs < 24 * 3600e3 && Date.parse(e.time_utc.replace(' ', 'T') + 'Z') > nowMs - 2 * 3600e3);

  const out = {
    ok: true, time: new Date().toISOString(), symbol, tf, price: livePrice, model: MODEL,
    strategy, ai: aiSignal, match,
    news: { bias: parsed.news_bias, summary: parsed.news_summary_si, events: parsed.events || [], soonHighImpact: soonEvents },
    technical: parsed.technical_summary_si, comparison: parsed.comparison_si, agree: parsed.agree_with_strategy,
    risks: parsed.risks_si || [], advice: parsed.final_advice_si,
    sources: sources.slice(0, 8),
    searches: resp.usage?.server_tool_use?.web_search_requests ?? null,
  };
  log({ time: out.time, symbol, tf, price: livePrice, strategy, ai: aiSignal, match: match.code, newsBias: out.news.bias });
  return out;
}

module.exports = { analyze, compare, checkAiSignal, parseJSON };
