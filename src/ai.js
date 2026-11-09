// AI explanation layer. Sends the rule-engine result + recent market context to
// Claude and gets back a Sinhala explanation. Without ANTHROPIC_API_KEY it falls
// back to a plain rule-based summary.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

function fallback(symbol, tf, sig) {
  const head = sig.action === 'WAIT'
    ? `${symbol} (${tf}) — දැනට පැහැදිලි setup එකක් නැහැ. ඉවසලා ඉන්න.`
    : `${symbol} (${tf}) — ${sig.action} setup එකක් (confidence ${sig.confidence}%).`;
  const lines = sig.reasons.map((r) => `• ${typeof r === 'string' ? r : r.text}`);
  return [head, ...lines, '', 'මතක තියාගන්න: මේක probability එකක් විතරයි. Stop loss එක නැතුව trade කරන්න එපා, එක trade එකකට balance එකෙන් 1–2% ට වඩා risk කරන්න එපා.'].join('\n');
}

async function explain({ symbol, tf, signal, candles, mtf }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: fallback(symbol, tf, signal), source: 'rules' };

  const recent = candles.slice(-30).map((c) => [new Date(c.time * 1000).toISOString().slice(0, 16), c.open, c.high, c.low, c.close]);
  const prompt = `You are a careful trading analyst helping a beginner in Sri Lanka. Reply in Sinhala (Sinhala script), trading terms may stay in English.

Instrument: ${symbol}, timeframe: ${tf}
Rule engine result (JSON): ${JSON.stringify(signal)}
Multi-timeframe signals: ${JSON.stringify(mtf || {})}
Last 30 candles [time, open, high, low, close]: ${JSON.stringify(recent)}

Write a short analysis (max ~180 words):
1. Market structure & trend in plain words.
2. Do you agree with the rule engine's ${signal.action}? Say clearly if the setup looks weak, and what would invalidate it.
3. If there is a trade: entry, stop loss, take profit levels and why. If WAIT: what to wait for.
4. One line on risk (no guarantees, use stop loss, risk 1–2%).
Do not invent news. Be honest when the picture is unclear.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    return { text: j.content.map((b) => b.text || '').join(''), source: 'ai' };
  } catch (e) {
    return { text: fallback(symbol, tf, signal) + `\n\n(AI error: ${e.message})`, source: 'rules' };
  }
}

module.exports = { explain };
