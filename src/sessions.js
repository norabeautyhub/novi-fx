// Sessions tab: per-day session candles (London / New York / Asian / full day) for a date range,
// with the time of the session high & low, plus the strategy trades that happened in that range.

const { INSTRUMENTS, toUSD } = require('./instruments');

const FMT = {};
function parts(tSec, tz) {
  FMT[tz] ||= new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = FMT[tz].formatToParts(new Date(tSec * 1000));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, h: +g('hour') % 24, m: +g('minute'), wd: g('weekday') };
}

// session windows in their own city time
const SESSIONS = {
  london: { tz: 'Europe/London', from: 8, to: 17, name: 'London (08:00–17:00 London)' },
  ny: { tz: 'America/New_York', from: 8, to: 17, name: 'New York (08:00–17:00 NY)' },
  asian: { tz: 'Europe/London', from: 0, to: 8, name: 'Asian (00:00–08:00 London)' },
  day: { tz: 'Europe/London', from: 0, to: 24, name: 'මුළු දවස (London දිනය)' },
};

function sessionCandles(candles, symbol, sessionKey) {
  const S = SESSIONS[sessionKey] || SESSIONS.london;
  const inst = INSTRUMENTS[symbol];
  const byDay = new Map();
  for (const c of candles) {
    const p = parts(c.time, S.tz);
    const hm = p.h + p.m / 60;
    if (hm < S.from || hm >= S.to) continue;
    let d = byDay.get(p.date);
    if (!d) { d = { date: p.date, weekday: p.wd, start: c.time, open: c.open, high: c.high, low: c.low, close: c.close, highTime: c.time, lowTime: c.time, end: c.time, n: 0 }; byDay.set(p.date, d); }
    if (c.high > d.high) { d.high = c.high; d.highTime = c.time; }
    if (c.low < d.low) { d.low = c.low; d.lowTime = c.time; }
    d.close = c.close; d.end = c.time; d.n++;
  }
  const out = [...byDay.values()].filter((d) => d.n >= 2).map((d) => {
    const range = d.high - d.low;
    const upFirst = d.lowTime < d.highTime; // low came first → the big move was UP
    return {
      ...d,
      range, change: d.close - d.open, dir: d.close >= d.open ? 'UP' : 'DOWN',
      bigMove: upFirst ? 'UP' : 'DOWN',
      // hindsight: best possible trade inside the session (low→high or high→low), $ for 0.10 lot
      hindsightUSD010: +toUSD(symbol, range * inst.contractSize * 0.1, d.close).toFixed(2),
      pips: +(range / inst.pip).toFixed(0),
    };
  });
  return { sessions: out, name: S.name };
}

module.exports = { sessionCandles, SESSIONS, parts };
