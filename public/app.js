/* Novi FX frontend */
const S = { mode: 'normal', symbol: 'XAUUSD', tf: '1h', cfg: null, signal: null, lastCandle: null, priceLines: [], scan: {}, prices: {}, live: {}, tfSec: 3600, lastCandleLoad: 0 };
const TF_SEC = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const $ = (id) => document.getElementById(id);

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  const pw = store('novi-fx-pw');
  if (pw) headers['x-app-password'] = pw;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await res.json();
  if (res.status === 401) {
    const p = window.prompt('Novi FX password');
    if (p) { store('novi-fx-pw', p); return api(path, opts); }
  }
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

const digits = (s) => S.cfg?.instruments[s]?.digits ?? 2;
const fmt = (v, s = S.symbol) => (v == null || isNaN(v) ? '—' : (+v).toFixed(digits(s)));
const money = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2));
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const dt = (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ---------- charts ---------- */
// All chart times in Sri Lanka time (Asia/Colombo, UTC+5:30) instead of UTC
const SLTZ = 'Asia/Colombo';
const slFmt = (t, o) => new Date((typeof t === 'number' ? t : Date.UTC(t.year, t.month - 1, t.day) / 1000) * 1000).toLocaleString('en-GB', { timeZone: SLTZ, ...o });
const tickSL = (t, type) => (type === 0 ? slFmt(t, { year: 'numeric' }) : type === 1 ? slFmt(t, { month: 'short' }) : type === 2 ? slFmt(t, { day: 'numeric', month: 'short' }) : slFmt(t, { hour: '2-digit', minute: '2-digit', hour12: false }));
const crossSL = (t) => (S.tf === '1d' ? slFmt(t, { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' }) : slFmt(t, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
const chartOpts = {
  layout: { background: { color: '#0d1117' }, textColor: '#8b98a8' },
  grid: { vertLines: { color: '#161d26' }, horzLines: { color: '#161d26' } },
  timeScale: { timeVisible: true, borderColor: '#2a3441', tickMarkFormatter: tickSL },
  localization: { timeFormatter: crossSL },
  rightPriceScale: { borderColor: '#2a3441' },
  crosshair: { mode: 0 },
};
const chart = LightweightCharts.createChart($('chart'), { ...chartOpts, autoSize: true });
const candleS = chart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
const volS = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: '#2a3441' });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
const ema20S = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
const ema50S = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
const ema200S = chart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
const bbU = chart.addLineSeries({ color: 'rgba(139,152,168,.5)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false });
const bbL = chart.addLineSeries({ color: 'rgba(139,152,168,.5)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false });

const rsiChart = LightweightCharts.createChart($('rsiChart'), { ...chartOpts, autoSize: true, timeScale: { visible: false }, rightPriceScale: { borderColor: '#2a3441', scaleMargins: { top: 0.08, bottom: 0.08 } } });
const rsiS = rsiChart.addLineSeries({ color: '#a855f7', lineWidth: 1, priceLineVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
[70, 30].forEach((v) => rsiS.createPriceLine({ price: v, color: '#2a3441', lineStyle: 2, lineWidth: 1, axisLabelVisible: false }));
chart.timeScale().subscribeVisibleLogicalRangeChange((r) => r && rsiChart.timeScale().setVisibleLogicalRange(r));

$('tgEma').onchange = (e) => [ema20S, ema50S, ema200S].forEach((s) => s.applyOptions({ visible: e.target.checked }));
$('tgBb').onchange = (e) => [bbU, bbL].forEach((s) => s.applyOptions({ visible: e.target.checked }));

function applyPrecision() {
  const d = digits(S.symbol);
  candleS.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / 10 ** d } });
}

async function loadChart(fit) {
  const d = await api(`/api/candles?symbol=${S.symbol}&tf=${S.tf}`);
  candleS.setData(d.candles);
  volS.setData(d.candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)' })));
  ema20S.setData(d.ema20); ema50S.setData(d.ema50); ema200S.setData(d.ema200);
  bbU.setData(d.bbUpper); bbL.setData(d.bbLower);
  rsiS.setData(d.rsi);
  if (fit) chart.timeScale().setVisibleLogicalRange({ from: d.candles.length - 150, to: d.candles.length + 5 });
  const last = d.candles[d.candles.length - 1], first = d.candles[Math.max(0, d.candles.length - 25)];
  S.lastCandle = { ...last };
  S.lastCandleLoad = Date.now();
  S.chartFrom = d.candles[0].time;
  if (fit) drawTradeMarkers();
  S.dayOpen = first.open;
  setHeaderPrice(S.prices[S.symbol] ?? last.close);
  // backup data source note (e.g. Silver from Binance Futures when Twelve Data can't give it)
  let src = $('srcNote');
  if (!src) { src = document.createElement('span'); src.id = 'srcNote'; src.className = 'src-note'; $('symChg').after(src); }
  src.textContent = d.source ? `ⓘ ${d.source}` : '';
  src.title = d.source ? `Twelve Data එකෙන් candles ගන්න බැරි නිසා (${d.sourceNote || ''}) backup source එකෙන් ගත්තා. Futures මිල spot එකට ගොඩක් ළඟයි, ඒත් cents කීපයක් වෙනස් වෙන්න පුළුවන්.` : '';
}

function setHeaderPrice(p) {
  $('symPrice').textContent = fmt(p);
  if (!S.dayOpen) return;
  const chg = ((p - S.dayOpen) / S.dayOpen) * 100;
  $('symChg').textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
  $('symChg').className = 'mono ' + (chg >= 0 ? 'up' : 'down');
}

/* ---------- live prices (Server-Sent Events) ---------- */
function startStream() {
  const pw = store('novi-fx-pw');
  const es = new EventSource('/api/stream' + (pw ? '?pw=' + encodeURIComponent(pw) : ''));
  es.onmessage = (ev) => {
    const t = JSON.parse(ev.data);
    S.prices[t.s] = t.p;
    S.live[t.s] = Date.now();
    const wl = document.querySelector(`.wl-item[data-s="${t.s}"] .lp`);
    if (wl) { wl.textContent = fmt(t.p, t.s); }
    if (t.s === S.symbol) onLiveTick(t.p, Math.floor(t.t / 1000));
  };
  es.onerror = () => {}; // EventSource reconnects by itself
}

function onLiveTick(p, tSec) {
  setHeaderPrice(p);
  checkPlanAlert(p);
  const c = S.lastCandle;
  if (c) {
    if (tSec >= c.time + S.tfSec) {
      // candle closed → start a new one and reload candles + signal (closed-candle signal)
      const n = c.time + S.tfSec * Math.floor((tSec - c.time) / S.tfSec);
      S.lastCandle = { time: n, open: p, high: p, low: p, close: p, volume: 0 };
      setTimeout(() => refreshAll(false), 4000);
    } else {
      c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p;
    }
    candleS.update(S.lastCandle);
  }
  renderStatus();
}

// same logic as signalStatus() in src/signals.js
function signalStatus(sig, price, nowSec) {
  if (!sig || !['BUY', 'SELL'].includes(sig.action) || price == null) return null;
  const dir = sig.action === 'BUY' ? 1 : -1;
  if (sig.mode === 'highwin') {
    if (sig.outcome === 'SL') return { code: 'INVALID', text: 'Stop loss එක වැදුනා — signal එක ඉවරයි' };
    if (sig.outcome === 'TP1') return { code: 'DONE', text: 'Trade එක 1R දක්වා ගියා (50% ලාභය ගත්තා) — අලුතෙන් entry නැහැ' };
    if (sig.filled) return { code: 'FILLED', text: 'Limit order එක fill වුණා — trade එක open. අලුතෙන් entry ගන්න එපා' };
    if (dir * (price - sig.stopLoss) <= 0) return { code: 'INVALID', text: 'මිල SL එක පහු කළා — signal එක cancel' };
    if (nowSec > sig.limitExpires) return { code: 'EXPIRED', text: 'Candles 4ක් ඇතුළත limit මිලට ආවේ නැහැ — order එක delete කරන්න' };
    if (dir * (price - sig.entry) <= 0) return { code: 'FILLED', text: 'මිල limit එකට ආවා — order එක fill වෙලා ඇති' };
    return { code: 'LIMIT', text: `${sig.action} LIMIT order එක ${fmt(sig.entry)} ට දාන්න — ${dt(sig.limitExpires * 1000)} දක්වා valid` };
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

function renderStatus() {
  const box = $('sigStatus');
  if (!box) return;
  const sig = S.signal;
  const price = S.prices[S.symbol] ?? S.lastCandle?.close;
  const st = signalStatus(sig, price, Date.now() / 1000);
  S.sigState = st?.code || null;
  if (!st) { box.innerHTML = ''; return; }
  box.className = 'status ' + st.code;
  const left = sig.expiresAt ? Math.max(0, Math.round((sig.expiresAt - Date.now() / 1000) / 60)) : null;
  box.innerHTML = `<b>${st.code}</b> · ${st.text}${st.code === 'ACTIVE' && left != null ? `<br><span class="small">තව විනාඩි ${left} ක් valid</span>` : ''}`;
}

/* ---------- strategy profile badges ---------- */
const PROFILE = {
  verified: { cls: 'ok', label: '✅ Verified', text: 'ඇත්ත data එකේ test කරලා ලාභ බව තහවුරුයි' },
  weak: { cls: 'warn', label: '⚠️ Weak', text: 'ලාභය පොඩියි — ප්‍රවේශමෙන්' },
  unverified: { cls: '', label: '❔ Unverified', text: 'තාම test කරලා නැහැ — Optimizer run කරන්න' },
  noedge: { cls: 'bad', label: '⛔ No edge', text: 'Optimizer එකට අනුව ලාභ නැහැ — signals off' },
  disabled: { cls: 'bad', label: '⛔ Disabled', text: 'Research එකට අනුව ලාභ නැහැ — signals off' },
};
const STRAT_NAME = { pullback: 'Trend Pullback', breakout: 'Trend Breakout' };
const MODE_NAME = { normal: 'Normal', breakeven: '🛡️ Breakeven', highwin: '🎯 High Win Rate' };
const MODE_INFO = {
  normal: 'Signal එකේ මිලට entry · SL / Target විතරයි',
  breakeven: 'ලාභය 1R වුණාම SL එක entry එකට — පාඩු trades අඩුයි, ලාභය ≈ එහෙමමයි',
  highwin: 'Limit entry + 1R දී 50% close + SL → entry — win rate 60–69%, ලාභය ~35–45% අඩුයි',
};
/* ---------- market session / activity ---------- */
function zoneHour(tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { h: +g('hour') % 24, m: +g('minute'), wd: g('weekday') };
}
function slTimeOfLondon(hLondon) {
  // London local hour today → Sri Lanka clock time
  const now = new Date(), L = zoneHour('Europe/London');
  const diffMin = (hLondon * 60) - (L.h * 60 + L.m);
  return new Date(now.getTime() + diffMin * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function renderSession() {
  const box = $('sessBox'); if (!box) return;
  const L = zoneHour('Europe/London');
  const crypto = S.cfg?.instruments[S.symbol]?.type === 'crypto';
  const utcDay = new Date().getUTCDay(), utcH = new Date().getUTCHours();
  const closed = !crypto && (utcDay === 6 || (utcDay === 0 && utcH < 22) || (utcDay === 5 && utcH >= 21));
  if (closed) { box.innerHTML = '<span class="sess q">⛔ Market එක වහලා (weekend)</span>'; return; }
  const h = L.h + L.m / 60;
  let cls2, label, next;
  if (h >= 13 && h < 17) { cls2 = 'hot'; label = '🔥 London + New York — වැඩියෙන්ම චලනය වෙන වෙලාව'; next = `ඉවර වෙන්නේ ${slTimeOfLondon(17)}`; }
  else if (h >= 8 && h < 13) { cls2 = 'act'; label = '🇬🇧 London session — සක්‍රීයයි'; next = `🔥 NY overlap ${slTimeOfLondon(13)} ට`; }
  else if (h >= 17 && h < 21) { cls2 = 'act'; label = '🇺🇸 New York — මධ්‍යම'; next = `ඉවර වෙන්නේ ${slTimeOfLondon(21)}`; }
  else if (h >= 7 && h < 8) { cls2 = 'act'; label = '🌅 London open එනවා'; next = `London ${slTimeOfLondon(8)} ට`; }
  else { cls2 = 'q'; label = '😴 Asian / quiet session — මන්දගාමීයි'; next = `London ${slTimeOfLondon(8)} ට · 🔥 overlap ${slTimeOfLondon(13)} ට`; }
  box.innerHTML = `<span class="sess ${cls2}">${label}</span> <span class="small muted">${next} · US news සාමාන්‍යයෙන් ${slTimeOfLondon(13.5)}</span>`;
}

function renderModeBar() {
  $('modeBar').innerHTML = Object.keys(MODE_NAME).map((m) => `<button class="${m === S.mode ? 'active' : ''}" data-mode="${m}" title="${MODE_INFO[m]}">${MODE_NAME[m]}</button>`).join('')
    + `<div class="small muted" style="width:100%">${MODE_INFO[S.mode]}</div>`;
  document.querySelectorAll('#modeBar button').forEach((b) => (b.onclick = () => {
    S.mode = b.dataset.mode; store('novi-fx-mode', S.mode); renderModeBar();
    S.gradeKey = null; S.today = null; S.alerted = {};
    if (S.mode !== 'normal') askNotify();
    loadSignal(); loadMtf(); loadToday(false);
    if (S.bt) $('btOut').innerHTML = '<span class="muted small">Mode එක වෙනස් වුණා — "Backtest run කරන්න" ආයෙත් ඔබන්න.</span>';
  }));
}
function planSteps(sig) {
  const d = sig.action, P = sig.plan || {};
  if (sig.mode === 'highwin') return `<ol class="steps">
    <li><b>${d} LIMIT</b> order එකක් <b class="mono">${fmt(P.limit)}</b> ට දාන්න <span class="muted">(${dt(sig.limitExpires * 1000)} දක්වා — ඊට පස්සේ delete කරන්න)</span></li>
    <li>Stop Loss: <b class="mono neg">${fmt(sig.stopLoss)}</b> · Take Profit: <b class="mono pos">${fmt(P.target)}</b></li>
    <li>මිල <b class="mono">${fmt(P.partialAt)}</b> (1R) ට ආවම: <b>lots වලින් භාගයක් close</b> කරන්න</li>
    <li>ඒ වෙලාවෙම ඉතුරු භාගයේ SL එක <b class="mono">${fmt(P.beTo)}</b> (entry) ට ගෙනියන්න</li></ol>`;
  if (sig.mode === 'breakeven') return `<ol class="steps">
    <li>${d} entry · SL <b class="mono neg">${fmt(sig.stopLoss)}</b> · Target <b class="mono pos">${fmt(P.target)}</b></li>
    <li>මිල <b class="mono">${fmt(P.beAt)}</b> (1R) ට ආවම SL එක <b class="mono">${fmt(P.beTo)}</b> (entry) ට ගෙනියන්න</li></ol>`;
  return '';
}
function toast(msg, notify) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 12000); t.onclick = () => t.remove();
  if (notify) { try { if (window.Notification && Notification.permission === 'granted') new Notification('Novi FX', { body: t.textContent }); } catch {} }
}
function askNotify() { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {} }
// 1R alert for the current signal (breakeven / highwin)
function checkPlanAlert(price) {
  const sig = S.signal;
  if (!sig || S.mode === 'normal' || !sig.plan || !['BUY', 'SELL'].includes(sig.action)) return;
  const lvl = sig.mode === 'highwin' ? sig.plan.partialAt : sig.plan.beAt;
  const d = sig.action === 'BUY' ? 1 : -1;
  const key = `${S.symbol}|${S.tf}|${sig.signalTime}`;
  S.alerted = S.alerted || {};
  if (S.alerted[key] || d * (price - lvl) < 0) return;
  if (sig.mode === 'highwin' && !(sig.filled || d * (price - sig.entry) > 0)) return;
  S.alerted[key] = true;
  toast(`🔔 <b>${S.symbol} 1R (${fmt(lvl)}) ට ආවා!</b><br>${sig.mode === 'highwin' ? 'Lots වලින් භාගයක් close කරලා, ' : ''}SL එක ${fmt(sig.plan.beTo)} (entry) ට ගෙනියන්න.`, true);
}
const profBadge = (st) => `<span class="badge ${PROFILE[st]?.cls || ''}">${PROFILE[st]?.label || st}</span>`;

function profileLine(p) {
  const rs = p.research, op = p.optimizer;
  let html = `<div class="prof">${profBadge(p.status)} <b>${STRAT_NAME[p.strategy] || p.strategy}</b> · Target ${p.exits?.tpR}R</div>`;
  if (p.source === 'optimizer' && op) html += `<div class="small muted">ඔයාගේ data (${op.date}): test කොටසේ trades ${op.test.trades}, PF ${op.test.profitFactor}, Net ${op.test.netR}R</div>`;
  else if (rs && rs.pf) html += `<div class="small muted">Research: ${rs.data} · trades ${rs.trades} · win ${rs.winRate}% · PF ${rs.pf} · ලාභ අවුරුදු ${rs.posYears}</div>`;
  else if (rs && rs.note) html += `<div class="small muted">Research: ${rs.data} — ${rs.note}</div>`;
  if (p.note && p.status !== 'verified') html += `<div class="small" style="color:var(--warn)">${p.note}</div>`;
  return html;
}

/* ---------- signal ---------- */
function drawSignalLines(sig) {
  S.priceLines.forEach((l) => candleS.removePriceLine(l));
  S.priceLines = [];
  const add = (price, color, title, width = 1) => S.priceLines.push(candleS.createPriceLine({ price, color, title, lineWidth: width, lineStyle: 2, axisLabelVisible: true }));
  if (sig && sig.action === 'WAIT' && sig.setup && !sig.setup.off) {
    const u = sig.setup;
    if (u.box) {
      add(u.box.high, u.dir === 'BUY' ? '#22c55e' : 'rgba(139,152,168,.6)', `${u.box.n} High${u.dir === 'BUY' ? ' → BUY' : ''}`, u.dir === 'BUY' ? 2 : 1);
      add(u.box.low, u.dir === 'SELL' ? '#ef4444' : 'rgba(139,152,168,.6)', `${u.box.n} Low${u.dir === 'SELL' ? ' → SELL' : ''}`, u.dir === 'SELL' ? 2 : 1);
    } else if (u.ema20 && u.dir) add(u.ema20, '#f59e0b', `EMA20 pullback → ${u.dir}`, 2);
    return;
  }
  if (!sig || !['BUY', 'SELL'].includes(sig.action)) return;
  if (sig.mode !== 'highwin') { add(sig.zone[0], 'rgba(59,130,246,.5)', 'Zone'); add(sig.zone[1], 'rgba(59,130,246,.5)', 'Zone'); }
  add(sig.entry, '#3b82f6', sig.mode === 'highwin' ? 'Limit' : 'Entry');
  add(sig.stopLoss, '#ef4444', 'SL');
  add(sig.tp1, 'rgba(34,197,94,.6)', sig.mode === 'highwin' ? '1R 50%' : sig.mode === 'breakeven' ? '1.5R' : '1.5R');
  if (sig.mode === 'breakeven' && sig.plan) add(sig.plan.beAt, '#f59e0b', '1R→BE');
  add(sig.tp2, '#22c55e', 'Target');
}

async function loadSignal() {
  const sig = await api(`/api/signal?symbol=${S.symbol}&tf=${S.tf}&mode=${S.mode}`);
  if (sig.livePrice != null && S.prices[S.symbol] == null) S.prices[S.symbol] = sig.livePrice;
  S.signal = sig;
  $('sigTf').textContent = `${S.symbol} · ${S.tf}`;
  const reasons = (sig.reasons || []).map((r) => {
    const c = r.ok === true ? 'p' : r.ok === false ? 'm' : 'z';
    return `<li class="${c}">${r.ok === true ? '✓' : r.ok === false ? '✗' : '•'} ${r.text}</li>`;
  }).join('');
  const isTrade = ['BUY', 'SELL'].includes(sig.action);
  const ago = sig.barsAgo ? `${sig.barsAgo} candle${sig.barsAgo > 1 ? 's' : ''} කලින්` : 'අන්තිම close වුණු candle එකේ';
  const lv = isTrade ? `
    <div id="sigStatus" class="status"></div>
    <div id="sigGrade"></div>
    <div class="small muted" style="margin:4px 0">Signal එක ආවේ ${ago} (${dt(sig.signalTime * 1000)})</div>
    ${planSteps(sig)}
    <div class="levels mono">
      ${sig.mode === 'highwin' ? `<span>Limit entry</span><span>${fmt(sig.entry)}</span><span class="muted">Signal close</span><span class="muted">${fmt(sig.marketEntry)}</span>` : `<span>Entry zone</span><span>${fmt(sig.zone[0])} – ${fmt(sig.zone[1])}</span>
      <span>Entry</span><span>${fmt(sig.entry)}</span>`}
      <span>Stop Loss</span><span class="neg">${fmt(sig.stopLoss)}</span>
      <span>${sig.mode === 'highwin' ? '1R (50% close)' : '1.5R'}</span><span class="pos">${fmt(sig.tp1)}</span>
      <span>Target (${sig.riskReward}R)</span><span class="pos">${fmt(sig.tp2)}</span>
    </div>` : '';
  const head = sig.action === 'OFF' ? 'OFF' : sig.action;
  const u = sig.setup;
  const trig = sig.action === 'WAIT' && u && !u.off && u.dir
    ? `<div class="trigger">📍 <b>${u.dir}</b> setup එකකට බලාගෙන: ${esc(u.text)}${u.box ? ` <span class="muted">(දැන් ${fmt(S.prices[S.symbol] ?? u.price)} · ${u.dir === 'BUY' ? 'High' : 'Low'} එකට තව ${fmt(Math.abs(u.level - (S.prices[S.symbol] ?? u.price)))})</span>` : ''}<br><span class="small muted">Chart එකේ ඉරි වලින් පෙන්නලා තියෙනවා</span></div>`
    : sig.action === 'WAIT' && u?.text ? `<div class="small muted">${esc(u.text)}</div>` : '';
  const sub = sig.action === 'WAIT' ? '<div class="small muted">Setup එක තාම සම්පූර්ණ නැහැ — පහළ checklist එක බලන්න</div>' + trig
    : sig.action === 'OFF' ? '<div class="small muted">මේ symbol/timeframe එකේ signals දෙන්නේ නැහැ</div>' : '';
  $('sigBody').innerHTML = `
    ${profileLine(sig.profile)}
    <div class="sig-action ${sig.action}">${head}</div>${sub}
    ${lv}<ul class="reasons">${reasons}</ul>
    <div class="small muted">Close වුණු candles විතරක් බලලා හදපු signal එකක් — candle එක මැද්දේ වෙනස් වෙන්නේ නැහැ.</div>`;
  drawSignalLines(sig);
  renderStatus();
  const gk = `${S.symbol}|${S.tf}|${sig.signalTime}`;
  if (isTrade && (S.gradeKey !== gk || Date.now() - (S.gradeAt || 0) > 180_000)) { S.gradeKey = gk; S.gradeAt = Date.now(); S.gradeHtml = null; loadGrade().then(() => { S.gradeHtml = $('sigGrade')?.innerHTML; }); }
  else if (isTrade && S.gradeHtml && $('sigGrade')) $('sigGrade').innerHTML = S.gradeHtml;
}

async function loadMtf() {
  try {
    const m = await api(`/api/mtf?symbol=${S.symbol}&mode=${S.mode}`);
    $('mtf').innerHTML = Object.entries(m).map(([tf, v]) =>
      `<div>${tf}<br><span class="pill ${v.action || 'WAIT'}">${v.action || 'ERR'}</span>${v.status ? `<br><span class="muted">${v.status}</span>` : ''}${v.profile ? `<br><span class="muted">${(PROFILE[v.profile]?.label || '').split(' ')[0]}</span>` : ''}</div>`).join('');
  } catch { $('mtf').innerHTML = ''; }
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MATCH = {
  MATCH: { cls: 'ACTIVE', icon: '✅', label: 'MATCH' },
  MATCH_WAIT: { cls: 'DONE', icon: '⏸️', label: 'දෙකම WAIT' },
  PARTIAL: { cls: 'CAUTION', icon: '⚠️', label: 'PARTIAL' },
  AI_ONLY: { cls: 'CAUTION', icon: '⚠️', label: 'AI විතරයි' },
  CONFLICT: { cls: 'INVALID', icon: '❌', label: 'CONFLICT' },
};
const localT = (u) => { const t = Date.parse(String(u).replace(' ', 'T') + 'Z'); return isNaN(t) ? esc(u) + ' UTC' : dt(t) + ' (ලංකා වේලාව)'; };
const BIAS = { bullish: ['pos', '▲ Bullish (මිල උඩට)'], bearish: ['neg', '▼ Bearish (මිල පහළට)'], neutral: ['muted', '● Neutral'] };

function sigCol(title, a, entry, sl, tp, rr, extra) {
  const trade = ['BUY', 'SELL'].includes(a);
  return `<div class="cmp-col"><div class="small muted">${title}</div>
    <div class="cmp-act ${a}">${a || '—'}</div>
    ${trade ? `<div class="mono small">Entry ${fmt(entry)}<br><span class="neg">SL ${fmt(sl)}</span><br><span class="pos">TP ${fmt(tp)}</span>${rr ? `<br>R:R 1:${rr}` : ''}</div>` : ''}
    ${extra || ''}</div>`;
}

function renderAI(r) {
  if (!r.ok) {
    if (r.error === 'NO_KEY') return `<div class="status CAUTION">AI analysis එකට <b>ANTHROPIC_API_KEY</b> එක ඕන. platform.claude.com එකෙන් key එකක් අරන් <code>.env</code> එකට දාලා server එක restart කරන්න.</div>`;
    return `<div class="status INVALID">AI උත්තරය කියවන්න බැරි වුණා — ආයෙත් try කරන්න.</div><div class="small muted">${esc(r.raw || '')}</div>`;
  }
  const m = MATCH[r.match.code] || MATCH.PARTIAL;
  const st = r.strategy, ai = r.ai;
  const b = BIAS[r.news.bias] || BIAS.neutral;
  const ev = (r.news.events || []).map((e) => `<li>${e.impact === 'high' ? '🔴' : '🟠'} <span class="mono">${localT(e.time_utc)}</span> — ${esc(e.event)}</li>`).join('');
  return `
    <div class="ai-head">🤖 AI Analysis · <span class="muted small">${dt(Date.parse(r.time))} · ${r.symbol} ${r.tf}</span></div>
    <div class="status ${m.cls}"><b>${m.icon} ${m.label}</b> · ${esc(r.match.text)}</div>
    <div class="cmp">
      ${sigCol(`📐 Strategy (research) ${profBadge(st.status)}`, st.action, st.entry, st.stopLoss, st.target, st.rr)}
      ${sigCol('🤖 AI (news + chart)', ai.action, ai.entry, ai.stop_loss, ai.take_profit, ai.rr,
        `${ai.confidence != null ? `<div class="small">Confidence ${ai.confidence}%</div>` : ''}${ai.hold_hours ? `<div class="small muted">~පැය ${ai.hold_hours}</div>` : ''}${ai.valid === false ? `<div class="small neg">${esc(ai.problems.join(', '))}</div>` : ''}`)}
    </div>
    ${r.news.soonHighImpact?.length ? `<div class="status INVALID">🔴 ඊළඟ පැය 24 ඇතුළත high-impact news: ${r.news.soonHighImpact.map((e) => esc(e.event) + ' — ' + localT(e.time_utc)).join(', ')} — ඒ වෙලාවට trade එකක් open කරන්න එපා / SL එක ගැන සැලකිලිමත් වෙන්න</div>` : ''}
    <div class="ai-sec"><b>📰 News</b> <span class="${b[0]}">${b[1]}</span><br>${esc(r.news.summary)}</div>
    ${ev ? `<div class="ai-sec"><b>📅 ඉදිරි events</b><ul class="ev">${ev}</ul></div>` : ''}
    <div class="ai-sec"><b>📈 Chart</b><br>${esc(r.technical)}</div>
    <div class="ai-sec"><b>⚖️ Strategy එකයි AI එකයි</b><br>${esc(r.comparison)}</div>
    ${r.risks?.length ? `<div class="ai-sec"><b>⚠️ Risks</b><ul class="ev">${r.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="ai-sec advice"><b>👉 ${esc(r.advice)}</b></div>
    ${['BUY', 'SELL'].includes(ai.action) && ai.valid ? `<button class="sm ghost" id="btnUseAI">AI levels වලින් order fill කරන්න</button>` : ''}
    <div class="small muted" style="margin-top:6px">ⓘ AI signal එක backtest කරලා නැහැ — ප්‍රධාන signal එක strategy එකයි. AI එක news check + දෙවෙනි මතයක් විතරයි. මේ analysis එක ප්‍රතිඵල මනින්න save වුණා.</div>
    ${r.sources?.length ? `<div class="ai-sec small"><b>Sources:</b><br>${r.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a>`).join('<br>')}</div>` : ''}`;
}

$('btnExplain').onclick = async () => {
  const b = $('btnExplain');
  b.disabled = true;
  $('aiOut').innerHTML = '<div class="muted">🔎 News search කරනවා, market එක analyze කරනවා… (තත්පර 20–60)</div>';
  try {
    const r = await api('/api/explain', { method: 'POST', body: { symbol: S.symbol, tf: S.tf, mode: S.mode } });
    S.ai = r;
    $('aiOut').innerHTML = renderAI(r);
    const u = $('btnUseAI');
    if (u) u.onclick = () => {
      $('oSL').value = (+r.ai.stop_loss).toFixed(digits(S.symbol));
      $('oTP').value = (+r.ai.take_profit).toFixed(digits(S.symbol));
      S.orderZone = null;
      $('orderMsg').innerHTML = `<span class="muted">AI levels දැම්මා (${r.ai.action}). ⚠️ AI signal එක backtest කරලා නැහැ.</span>`;
      $('btnCalc').click();
    };
  } catch (e) { $('aiOut').innerHTML = `<div class="status INVALID">${esc(e.message)}</div>`; }
  b.disabled = false;
};

/* ---------- Signal Grade ---------- */
const GRADE = { A: ['gA', '🏆 Grade A', 'හොඳම signal එක'], B: ['gB', '🥈 Grade B', 'Risk අඩු කරලා'], C: ['gC', '⚠️ Grade C', 'Trade කරන්න එපා'] };
const gradeBadge = (g) => g ? `<span class="grade ${GRADE[g.grade]?.[0] || ''}">${GRADE[g.grade]?.[1] || g.grade}</span>` : '';
function gradeBox(g) {
  if (!g) return '';
  return `<div class="gbox ${GRADE[g.grade]?.[0] || ''}"><div class="gtitle">${GRADE[g.grade]?.[1] || g.grade} <span class="small">— ${esc(g.advice || '')}</span></div>
    <ul class="reasons">${(g.reasons || []).map((r) => `<li class="${r.ok === true ? 'p' : r.ok === false ? 'm' : 'z'}">${r.ok === true ? '✓' : r.ok === false ? '✗' : '•'} ${esc(r.text)}</li>`).join('')}</ul></div>`;
}
async function loadGrade() {
  const box = $('sigGrade');
  if (!box) return;
  box.innerHTML = '<div class="small muted">Grade එක ගණනය කරනවා…</div>';
  try { const g = await api(`/api/grade?symbol=${S.symbol}&tf=${S.tf}&mode=${S.mode}`); if ($('sigGrade')) $('sigGrade').innerHTML = gradeBox(g); }
  catch (e) { box.innerHTML = `<div class="small neg">${esc(e.message)}</div>`; }
}

/* ---------- Deep Analysis (no AI) ---------- */
const VOTE = (v) => (v > 0 ? '<span class="pos">▲</span>' : v < 0 ? '<span class="neg">▼</span>' : '<span class="muted">•</span>');
const DMATCH = { ...MATCH, DEEP_ONLY: { cls: 'CAUTION', icon: '⚠️', label: 'Deep විතරයි' } };
const DMATCH_TXT = {
  MATCH: 'Strategy එකයි Deep එකයි එකම දිශාව — ශක්තිමත්', CONFLICT: 'Strategy එකයි Deep එකයි විරුද්ධයි — skip කරන්න',
  MATCH_WAIT: 'දෙකම WAIT — දැන් trade එකක් නැහැ', PARTIAL: 'Strategy signal එකක් තියෙනවා, Deep එක WAIT — ප්‍රවේශමෙන්',
  DEEP_ONLY: 'Deep එක විතරයි signal දෙන්නේ — strategy එක (backtest කරපු එක) තාම confirm නැහැ',
};
const riskLine = (rk, sym, rr) => rk ? `<div class="small">⚠️ Risk: SL දුර <b class="mono">${fmt(rk.distance, sym)}</b> (${rk.pips.toFixed(0)} pips) · $1,000ට 1% risk = <b>${rk.lots1pct1000 > 0 ? rk.lots1pct1000 : '0.01 (අවම)'}</b> lots${rr ? ` · R:R 1:${rr}` : ''}</div>` : '';
const rates = (x) => `<div class="rates"><span class="pos">✅ Success ${x.win}%</span><span>⚪ $0 ${x.be}%</span><span class="neg">❌ Loss ${x.loss}%</span></div>`;

function modesSection(M, sym) {
  if (!M) return '';
  if (M.error) return `<div class="ai-sec small neg">Mode compare: ${esc(M.error)}</div>`;
  const keys = ['normal', 'breakeven', 'highwin'];
  const st0 = M.modes.normal.stats;
  const yrs = (st0.to - st0.from) / (365.25 * 86400);
  const card = (k) => {
    const m = M.modes[k], sg = m.signal, x = m.stats;
    const badges = `${k === M.bestProfit ? '<span class="grade gA">💰 වැඩිම ලාභය</span>' : ''} ${k === M.bestWin ? '<span class="grade gB">🎯 වැඩිම win rate</span>' : ''}`;
    let body;
    if (['BUY', 'SELL'].includes(sg.action)) {
      body = `<div><span class="pill ${sg.action}">${sg.action}</span> <span class="small">${sg.status ? `<b>${sg.status}</b>` : ''}</span></div>
        ${planSteps({ ...sg, mode: k }) || `<div class="small mono">Entry ${fmt(sg.entry, sym)} · <span class="neg">SL ${fmt(sg.stopLoss, sym)}</span> · <span class="pos">Target ${fmt(sg.target, sym)}</span></div>`}`;
    } else if (sg.setup && !sg.setup.off && sg.setup.dir) {
      const u = sg.setup;
      body = `<div class="small"><b>⏸️ WAIT</b> · <span class="pill ${u.dir}">${u.dir}</span> setup එකකට බලාගෙන ඉන්නවා</div>
        <div class="small">📍 ${esc(u.text)}</div>
        <div class="small mono">${k === 'highwin' ? 'Limit' : 'Entry'} ~${fmt(u.entry, sym)} · <span class="neg">SL ~${fmt(u.stopLoss, sym)}</span> · <span class="pos">Target ~${fmt(u.target, sym)}</span>${u.partialAt ? ` · 1R(50%) ~${fmt(u.partialAt, sym)}` : u.beAt ? ` · 1R→BE ~${fmt(u.beAt, sym)}` : ''}</div>
        <ul class="reasons">${(u.conds || []).map((c) => `<li class="${c.ok === true ? 'p' : c.ok === false ? 'm' : 'z'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '•'} ${esc(c.text)}</li>`).join('')}</ul>`;
    } else {
      body = `<div class="small"><b>⏸️ WAIT</b> — ${esc(sg.setup?.text || 'setup එකක් නැහැ')}</div>`;
    }
    return `<div class="mcard${k === S.mode ? ' cur' : ''}"><div class="mc-h"><b>${MODE_NAME[k]}</b> ${badges}</div>${body}${rates(x)}${riskLine(m.risk, sym, m.risk?.rr)}
      <div class="small muted">Backtest: trades ${x.trades} · ලාභය <b class="${cls(x.netR)}">${money0(x.netR * 10)}</b> ($10 risk) · එක දිගට පාඩු max ${x.maxL}</div></div>`;
  };
  return `<div class="ai-sec"><b>📐 Strategy signal — mode 3ම</b> <span class="muted small">(success/loss %: ${sym} backtest ${day(st0.from)} → ${day(st0.to)}, ~අවුරුදු ${yrs.toFixed(1)})</span>
    <div class="mgrid">${keys.map(card).join('')}</div></div>`;
}

function nowSection(n, sym) {
  if (!n) return '';
  if (n.error) return `<div class="ai-sec small neg">දැන්ම trade: ${esc(n.error)}</div>`;
  const m = n.measured;
  const weak = n.action === 'WEAK';
  return `<div class="ai-sec"><b>🧭 දැන්ම trade කළොත්</b> <span class="muted small">(indicators 13 × ${n.timeframes.join(', ')})</span>
    <div class="mcard"><div><span class="pill ${n.direction}">${n.direction}</span> <span class="small">Indicators ශක්තිය ${n.strength}%${weak ? ' — <b class="neg">ගොඩක් දුර්වලයි</b>' : ''}</span></div>
      <div class="small mono">Entry ${fmt(n.entry, sym)} (දැන් මිල) · <span class="neg">SL ${fmt(n.stopLoss, sym)}</span> · <span class="pos">Target ${fmt(n.target, sym)}</span></div>
      ${m.occasions >= 20 ? `<div class="rates"><span class="pos">✅ Success ${m.winRate}%</span><span class="neg">❌ Loss ${m.lossRate}%</span><span class="${cls(m.netR)}">ලාභය ${money0(m.netR * 10)}</span></div>
        <div class="small muted">මනින ලද: පහුගිය දවස් ${m.days} ඇතුළත indicators ${n.direction} පැත්තට ${m.threshold}%+ ක් එකඟ වුණ වෙලාවල් ${m.occasions}ක trade කළා නම් — Target (${n.rr}R) වැදුනේ ${m.winRate}% කින් (costs එක්ක, $10 risk)</div>`
        : `<div class="small muted">මේ තරම් ශක්තියක් තිබුණ වෙලාවල් ${m.occasions}යි — success rate එකක් කියන්න data මදි</div>`}
      ${riskLine(n.risk, sym, n.rr)}
      <div class="small" style="color:var(--warn)">⚠️ මේක strategy setup එකක් නැතුව "දැන්ම" trade කරන එකක් — strategy signals වගේ අවුරුදු ගාණක් ඔප්පු කරලා නැහැ.</div></div></div>`;
}

function allSources(r) {
  const sym = r.symbol, rows = [];
  const M = r.modes && !r.modes.error ? r.modes.modes[S.mode] : null;
  if (M) {
    const sg = M.signal;
    const dir = ['BUY', 'SELL'].includes(sg.action) ? sg.action : sg.setup?.dir || null;
    rows.push({ src: `📐 Strategy (${MODE_NAME[S.mode]})`, dir, lean: !['BUY', 'SELL'].includes(sg.action), txt: ['BUY', 'SELL'].includes(sg.action) ? `${sg.action} signal · ${sg.status || ''}` : dir ? `WAIT — ${dir} setup එකකට බලාගෙන` : 'WAIT', rate: `${M.stats.win}%`, note: `${profBadge(r.strategy?.status || 'unverified')}` });
  }
  if (r.now && !r.now.error) rows.push({ src: '🧭 දැන්ම trade', dir: r.now.direction, txt: `${r.now.direction} · ශක්තිය ${r.now.strength}%`, rate: r.now.measured.occasions >= 20 ? `${r.now.measured.winRate}%` : '—', note: 'test නොකළ ක්‍රමය' });
  rows.push({ src: '📊 Indicators (Deep)', dir: r.score > 0.05 ? 'BUY' : r.score < -0.05 ? 'SELL' : null, txt: `${r.action} · ${r.confidence}% ${r.score > 0 ? 'BUY' : 'SELL'} පැත්තට`, rate: '—', note: Object.entries(r.tfScore || {}).map(([t, x]) => `${t} ▲${x.buy}/▼${x.sell}`).join(' ') });
  if (r.ml?.available) rows.push({ src: '🧠 ML (NN+LSTM+LGB)', dir: r.ml.models.ens.dir, txt: `${r.ml.models.ens.dir} ${(r.ml.models.ens.prob * 100).toFixed(1)}%`, rate: '—', note: `accuracy ~${r.ml.valAcc}% (දුර්වලයි)` });
  else rows.push({ src: '🧠 ML', dir: null, txt: '—', rate: '—', note: esc(r.ml?.reason || 'නැහැ') });
  const ai = S.ai && S.ai.ok && S.ai.symbol === sym && S.ai.tf === r.tf && Date.now() - Date.parse(S.ai.time) < 2 * 3600e3 ? S.ai : null;
  if (ai) rows.push({ src: '🤖 AI (news + chart)', dir: ['BUY', 'SELL'].includes(ai.ai.action) ? ai.ai.action : null, txt: `${ai.ai.action}${ai.ai.confidence != null ? ` · ${ai.ai.confidence}%` : ''} · news ${ai.news.bias || ''}`, rate: '—', note: dt(Date.parse(ai.time)) });
  else rows.push({ src: '🤖 AI', dir: null, txt: '"AI Analysis" click කරලා නැහැ', rate: '—', note: '' });
  const ns = r.news?.signal;
  if (ns) rows.push({ src: '📰 News (keywords)', dir: ['BUY', 'SELL'].includes(ns.action) ? ns.action : null, txt: `${ns.action === 'NEUTRAL' ? 'පැහැදිලි නැහැ' : ns.action} · 📈${ns.bull} 📉${ns.bear}`, rate: '—', note: 'Tracker එකෙන් මනිනවා' });
  const pt = r.partner?.available ? r.partner.partners.find((x) => !x.error) : null;
  if (pt) rows.push({ src: `🔗 Partner (${pt.symbol})`, dir: pt.implied, count: false, txt: `${pt.symbol} daily ${pt.trend.d1}${pt.relation < 0 ? ' (අනිත් පැත්තට යන market)' : ''}`, rate: pt.research ? `${pt.research.agree.win}%` : '—', note: 'තොරතුරට විතරයි — ගණන් ගන්නේ නැහැ' });
  const counted = rows.filter((x) => x.count !== false);
  const buy = counted.filter((x) => x.dir === 'BUY').length, sell = counted.filter((x) => x.dir === 'SELL').length;
  const verdict = buy && !sell ? `✅ ඔක්කොම (${buy}) BUY පැත්තට` : sell && !buy ? `✅ ඔක්කොම (${sell}) SELL පැත්තට` : buy > sell ? `▲ BUY ${buy} · ▼ SELL ${sell} — වැඩි හරිය BUY` : sell > buy ? `▲ BUY ${buy} · ▼ SELL ${sell} — වැඩි හරිය SELL` : `▲ BUY ${buy} · ▼ SELL ${sell} — එකඟතාවයක් නැහැ`;
  return `<div class="ai-sec"><b>⚖️ ඔක්කොම එකට</b>
    <div style="overflow-x:auto"><table class="votes cmp-all"><tr><th>Source</th><th>දිශාව</th><th>Success</th></tr>
    ${rows.map((x) => `<tr><td>${x.src}<br><span class="muted" style="font-size:10.5px">${x.txt}${x.note ? ' · ' + x.note : ''}</span></td><td>${x.dir ? `<span class="pill ${x.dir}">${x.dir}</span>${x.lean ? '<br><span class="muted" style="font-size:10px">(setup)</span>' : ''}` : '<span class="muted">—</span>'}</td><td>${x.rate}</td></tr>`).join('')}</table></div>
    <div class="status ${buy && !sell || sell && !buy ? 'ACTIVE' : buy === sell ? 'CAUTION' : 'DONE'}"><b>${verdict}</b></div>
    <div class="small muted">ⓘ එකම දිශාවට sources වැඩි වුණාම විශ්වාසය වැඩියි. ඒත් ඔප්පු වුණු signal එක 📐 Strategy එකයි — ඒක WAIT නම් ඉවසීම හොඳයි.</div></div>`;
}

function partnerSection(r) {
  const P = r.partner;
  if (!P) return '';
  if (!P.available) return `<div class="ai-sec"><b>🔗 Partner market</b> <span class="small muted">${esc(P.reason || '')}</span></div>`;
  const TR = (t) => t === 'UP' ? '<span class="pos">▲ UP</span>' : t === 'DOWN' ? '<span class="neg">▼ DOWN</span>' : '<span class="muted">— පැහැදිලි නැහැ</span>';
  const V = { AGREE: ['ACTIVE', '✅ එකඟයි'], DISAGREE: ['INVALID', '⚠️ එකඟ නැහැ'], FLAT: ['CAUTION', '— Partner trend එක පැහැදිලි නැහැ'], NONE: ['CAUTION', 'සසඳන්න signal / setup එකක් නැහැ'] };
  const body = P.partners.map((p) => {
    if (p.error) return `<div class="status CAUTION small">⚠️ <b>${p.symbol}</b> data දැන් ගන්න බැහැ — partner check එක මඟ හැරියා.<br><span class="muted">හේතුව: ${esc(p.error)}</span></div>`;
    const v = V[p.verdict] || V.NONE, R = p.research;
    return `<div class="partner">
      <div><b>${p.symbol}</b> <span class="muted small">${fmt(p.price, p.symbol)} · ${p.relation > 0 ? 'එකම දිශාවට යන market' : 'අනිත් පැත්තට යන market'}</span></div>
      <table class="votes"><tr><th>${r.tf}</th><th>4h</th><th>Daily</th></tr><tr><td>${TR(p.trend.tf)}</td><td>${TR(p.trend.h4)}</td><td>${TR(p.trend.d1)}</td></tr></table>
      <div class="status ${v[0]}"><b>${v[1]}</b>${P.direction ? ` · ${r.symbol} ${P.direction} එකට ${p.symbol} ${p.implied ? `කියන්නේ ${p.implied}` : 'දිශාවක් කියන්නේ නැහැ'}` : ''}</div>
      ${R ? `<div class="small">📊 Research (2015–2018, ${r.tf}): partner එකඟ වුණු signals win <b>${R.agree.win}%</b> · PF ${R.agree.pf} &nbsp;|&nbsp; එකඟ නැති signals win <b>${R.disagree.win}%</b> · PF ${R.disagree.pf}</div>` : `<div class="small muted">මේ timeframe එකට research නැහැ</div>`}
    </div>`;
  }).join('');
  return `<div class="ai-sec"><b>🔗 Partner market</b> <span class="muted small">${P.direction ? `(${r.symbol} ${P.direction} එක්ක සසඳනවා)` : ''}</span>${body}
    <div class="small muted">ⓘ Research අනුව partner market එක එකඟ වුණාට signal එක හොඳ වෙන්නේ නැහැ — ඒ නිසා මේක තොරතුරට විතරයි. Signal එකට, grade එකට බලපාන්නේ නැහැ.</div></div>`;
}

function renderDeep(r) {
  const tfs = ['15m', '1h', '4h', '1d'];
  const names = (tfs.map((t) => r.frames[t]).find((f) => f && f.votes) || { votes: [] }).votes.map((v) => [v.key, v.name]);
  const cell = (t, key) => { const f = r.frames[t]; if (!f || !f.votes) return '<td class="muted">!</td>'; const v = f.votes.find((x) => x.key === key); return `<td title="${esc(v.why)}">${VOTE(v.vote)}</td>`; };
  const m = DMATCH[r.match] || MATCH.PARTIAL;
  const L = r.levels, trade = ['BUY', 'SELL'].includes(r.action);
  const main = r.frames[r.tf]?.votes ? r.tf : '1h';
  const EFF = { BULLISH: ['pos', '📈 Bullish'], BEARISH: ['neg', '📉 Bearish'], NEUTRAL: ['muted', '➖ Neutral'] };
  const nw = r.news && r.news.items ? r.news.items.map((n) => { const e = EFF[n.effect] || EFF.NEUTRAL; return `<li class="nw"><span class="${e[0]} nw-eff">${e[1]}</span> <span class="muted">${ago(n.time)}</span> · <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a> <span class="muted">(${esc(n.source)})</span>
    ${n.short ? `<div class="nw-sum">${esc(n.short)}</div>` : ''}${n.reason ? `<div class="nw-why">→ ${esc(n.reason)} → ${r.symbol} ${n.effect === 'BULLISH' ? '📈' : n.effect === 'BEARISH' ? '📉' : ''}</div>` : ''}</li>`; }).join('') : '';
  const nsig = r.news?.signal;
  const newsBox = nsig ? `<div class="status ${nsig.action === 'BUY' || nsig.action === 'SELL' ? 'ACTIVE' : 'CAUTION'}">📰 <b>News signal: ${nsig.action === 'NEUTRAL' ? 'පැහැදිලි දිශාවක් නැහැ' : `<span class="pill ${nsig.action}">${nsig.action}</span>`}</b> · 📈 ${nsig.bull} · 📉 ${nsig.bear} · ➖ ${nsig.neutral} <span class="muted">(පැය 24)</span><br><span class="small">${esc(nsig.why)}</span></div>` : '';
  const cal = Array.isArray(r.calendar) ? r.calendar.map((e) => `<li>${e.impact === 'High' ? '🔴' : '🟠'} <span class="mono">${dt(e.time)}</span> · ${e.country} ${esc(e.title)}${e.forecast ? ` <span class="muted">(forecast ${esc(e.forecast)}, කලින් ${esc(e.previous || '—')})</span>` : ''}</li>`).join('') : '';
  return `
    <div class="ai-head">🔬 Deep Analysis · <span class="muted small">${dt(Date.parse(r.time))} · ${r.symbol} ${r.tf}</span></div>
    ${gradeBox(r.grade)}
    ${allSources(r)}
    ${modesSection(r.modes, r.symbol)}
    ${nowSection(r.now, r.symbol)}
    <div class="ai-sec"><b>📊 Deep indicators signal</b></div>
    <div class="deep-res"><div class="cmp-act ${r.action}">${r.action}</div>
      <div><div class="small">Indicators ${r.confidence}% ${r.score > 0 ? 'BUY' : r.score < 0 ? 'SELL' : ''} පැත්තට</div>
      <div class="conf"><div style="width:${r.confidence}%; background:${r.score > 0 ? 'var(--buy)' : 'var(--sell)'}"></div></div></div></div>
    ${r.why.length ? `<div class="small muted">WAIT හේතුව: ${r.why.map(esc).join(' · ')}</div>` : ''}
    ${trade && L ? `<div class="levels mono small"><span>Entry</span><span>${fmt(L.entry)}</span><span>Stop Loss</span><span class="neg">${fmt(L.stopLoss)}</span>
      <span>TP1 (1.5R)</span><span class="pos">${fmt(L.tp1)}</span><span>TP2 (2.5R)</span><span class="pos">${fmt(L.tp2)}</span>${L.nextLevel ? `<span>ඊළඟ ${r.action === 'BUY' ? 'resistance' : 'support'}</span><span>${fmt(L.nextLevel)}</span>` : ''}</div>
      <button class="sm ghost" id="btnUseDeep">Deep levels වලින් order fill කරන්න</button>` : ''}
    <div class="status ${m.cls}"><b>${m.icon} ${m.label}</b> · ${DMATCH_TXT[r.match] || ''}${r.strategy ? ` <span class="muted">(Strategy: ${r.strategy.action})</span>` : ''}</div>
    ${r.soonHighImpact?.length ? `<div class="status INVALID">🔴 ඉදිරි පැය 24 ඇතුළත high-impact news: ${r.soonHighImpact.map((e) => `${e.country} ${esc(e.title)} — ${dt(e.time)}`).join(', ')}. ඒ වෙලාවට කලින් trade එකක් open කරන්න එපා.</div>` : ''}
    ${r.next4h?.length ? `<div class="status INVALID"><b>⚠️ ඊළඟ පැය 4 ඇතුළත ලොකු news: ${r.next4h.map((e) => `${e.country} ${esc(e.title)} (${dt(e.time)})`).join(', ')}</b> — News එකට කලින් trade එක ගන්න එපා. News එකෙන් පස්සේ මිල ස්ථාවර වෙනකම් ඉන්න.</div>` : ''}
    ${partnerSection(r)}
    <div class="ai-sec"><b>📊 Indicators ඡන්ද</b> <span class="muted small">▲ BUY · ▼ SELL · • neutral (mouse එක තිබ්බම විස්තර)</span>
      <table class="votes"><tr><th></th>${tfs.map((t) => `<th class="${t === r.tf ? 'cur' : ''}">${t}</th>`).join('')}</tr>
      ${names.map(([k, n]) => `<tr><td>${esc(n)}</td>${tfs.map((t) => cell(t, k)).join('')}</tr>`).join('')}
      <tr class="tot"><td>▲ / ▼</td>${tfs.map((t) => r.tfScore[t] ? `<td><span class="pos">${r.tfScore[t].buy}</span>/<span class="neg">${r.tfScore[t].sell}</span></td>` : '<td>—</td>').join('')}</tr></table></div>
    <div class="ai-sec"><b>🧠 ML Models (1h)</b> ${r.ml?.available ? `<span class="muted small">train කළේ ${r.ml.trainedOn} data · test accuracy ${r.ml.valAcc}%</span>
      <table class="votes"><tr><th></th><th>දිශාව</th><th>දිනන්න ඉඩ</th></tr>
      ${[['mlp', 'Neural network'], ['lstm', 'LSTM'], ['lgb', 'LightGBM'], ['ens', 'එකතුව']].map(([k, n]) => `<tr${k === 'ens' ? ' class="tot"' : ''}><td>${n}</td><td><span class="pill ${r.ml.models[k].dir}">${r.ml.models[k].dir}</span></td><td>${(r.ml.models[k].prob * 100).toFixed(1)}%</td></tr>`).join('')}</table>
      ${r.ml.filter ? `<div class="small">Strategy signal එකට ML filter: <b class="${r.ml.filter.ok ? 'pos' : 'neg'}">${r.ml.filter.ok ? '👍 ගන්න' : '👎 skip කරන්න'}</b> <span class="muted">(${(r.ml.filter.prob * 100).toFixed(1)}% vs සාමාන්‍ය ${(r.ml.filter.median * 100).toFixed(1)}%)</span></div>` : ''}
      <div class="small muted">ⓘ ML models දුර්වලයි (coin එකට වඩා ටිකක් හොඳයි) — ඒ නිසා score එකේ බර indicator එකක් තරමයි.</div>`
      : `<div class="small muted">${esc(r.ml?.reason || 'ML නැහැ')}</div>`}</div>
    <details class="ai-sec"><summary><b>🔎 ${main} විස්තර</b></summary><ul class="ev">${(r.frames[main].votes || []).map((v) => `<li>${VOTE(v.vote)} <b>${esc(v.name)}</b>: ${esc(v.why)}</li>`).join('')}</ul></details>
    <div class="ai-sec"><b>📰 අලුත්ම news සහ market එකට බලපෑම</b> ${r.news?.error ? `<span class="small neg">${esc(r.news.error)}</span>` : ''}
      ${newsBox}${nw ? `<ul class="ev news">${nw}</ul>` : '<div class="small muted">News නැහැ</div>'}
      <div class="small muted">ⓘ බලපෑම තීරණය කරන්නේ keywords වලින් (Fed, rate hike, war, dollar falls…) — AI තරම් හරි නැහැ. සාරාංශය English වලින් (news එකේම). News signal එක backtest කරන්න පරණ news data නැහැ — ඒ නිසා AI Tracker එකේ "📰 News signal" එකෙන් දැන් ඉඳන් ඇත්ත success rate එක මනිනවා.</div></div>
    <div class="ai-sec"><b>📅 ඉදිරි පැය 48 economic events</b> ${r.calendar?.error ? `<span class="small neg">${esc(r.calendar.error)}</span>` : ''}${cal ? `<ul class="ev">${cal}</ul>` : (Array.isArray(r.calendar) ? '<div class="small muted">ලොකු events නැහැ ✓</div>' : '')}</div>
    <div class="small muted">ⓘ Deep signal එක backtest කරලා නැහැ — ප්‍රධාන signal එක strategy එකයි. මේ analysis එක AI Tracker එකේ save වුණා.</div>`;
}
$('btnDeep').onclick = async () => {
  const b = $('btnDeep'); b.disabled = true;
  $('deepOut').innerHTML = '<div class="muted">🔬 Timeframes 4ක indicators ගණනය කරනවා, news බලනවා…</div>';
  try {
    const r = await api('/api/deep', { method: 'POST', body: { symbol: S.symbol, tf: S.tf, mode: S.mode } });
    $('deepOut').innerHTML = renderDeep(r);
    const u = $('btnUseDeep');
    if (u) u.onclick = () => {
      $('oSL').value = (+r.levels.stopLoss).toFixed(digits(S.symbol));
      $('oTP').value = (+r.levels.tp2).toFixed(digits(S.symbol));
      S.orderZone = null;
      $('orderMsg').innerHTML = `<span class="muted">Deep levels දැම්මා (${r.action}). ⚠️ Deep signal එක backtest කරලා නැහැ.</span>`;
      $('btnCalc').click();
    };
  } catch (e) { $('deepOut').innerHTML = `<div class="status INVALID">${esc(e.message)}</div>`; }
  b.disabled = false;
};

/* ---------- watchlist & scanner ---------- */
function renderWatchlist() {
  $('watchlist').innerHTML = Object.entries(S.cfg.instruments).map(([s, inst]) => {
    const r = S.scan[s];
    return `<div class="wl-item ${s === S.symbol ? 'active' : ''}" data-s="${s}">
      <div><div class="n"><span class="dot" data-dot="${s}"></span>${s}</div><div class="d">${inst.name} · <span class="lp mono">${fmt(S.prices[s] ?? r?.price, s)}</span></div></div>
      ${r ? `<span class="pill ${r.error ? 'WAIT' : r.action}">${r.error ? '!' : r.action}</span>` : ''}
    </div>`;
  }).join('');
  document.querySelectorAll('.wl-item').forEach((el) => (el.onclick = () => selectSymbol(el.dataset.s)));
}

/* ---------- AI signal tracker ---------- */
const RES = { WIN: ['pos', '✅ දිනුවා'], LOSS: ['neg', '❌ පැරදුණා'], OPEN: ['', '⏳ Open'], NOT_FILLED: ['muted', '— Entry නැහැ'], PENDING: ['muted', '⏳ Entry එනකම්'], WAITING: ['muted', '⏳'] };
const outTxt = (o) => !o ? '<span class="muted">—</span>' : `<span class="${RES[o.result]?.[0] || ''}">${RES[o.result]?.[1] || o.result}${o.r != null ? ` (${o.r > 0 ? '+' : ''}${o.r}R)` : ''}</span>`;
function scoreRow(name, sc, note) {
  const usd = (sc.netR * 10).toFixed(0);
  return `<tr><td><b>${name}</b>${note ? `<br><span class="muted small">${note}</span>` : ''}</td><td>${sc.signals}</td><td>${sc.closed}</td>
    <td>${sc.winRate == null ? '—' : sc.winRate + '%'}</td><td class="${cls(sc.netR)}"><b>${sc.netR > 0 ? '+' : ''}${sc.netR}R</b><br><span class="small">$10 risk: ${sc.netR >= 0 ? '+' : '−'}$${Math.abs(usd)}</span></td><td class="small muted">${sc.open} open · ${sc.notFilled} entry නැහැ · ${sc.pending} බලාගෙන</td></tr>`;
}
function newsTrackBox(n) {
  if (!n) return '';
  const pc = (x) => x.pct == null ? '<span class="muted">—</span>' : `<b class="${x.pct > 50 ? 'pos' : 'neg'}">${x.pct}%</b> <span class="muted small">(${x.right}/${x.done})</span>`;
  const enough = n.h24.done >= 30;
  return `<div class="bt-h" style="margin-top:10px">📰 News signal (Deep) <span class="muted small">(BUY/SELL news signals ${n.signals})</span></div>
    <table class="wrap"><tr><th></th><th>පැය 4කට පස්සේ හරි දිශාවට</th><th>පැය 24කට පස්සේ හරි දිශාවට</th></tr>
      <tr><td>📰 News signals</td><td>${pc(n.h4)}</td><td>${pc(n.h24)}</td></tr></table>
    <p class="small muted">${enough ? (n.h24.pct > 55 ? '✅ News signal එක 50% ට වඩා හොඳට වැඩ කරනවා.' : '❌ News signal එක coin එකක් උඩ දැම්මා වගේ (≈50%) — trade කරන්න පාවිච්චි කරන්න එපා.') : '⚠️ තීරණයක් ගන්න news signals 30+ ක් ඕන — Deep Analysis කරන හැම වෙලාවකම save වෙනවා.'} 50% කියන්නේ අහම්බෙන් හරියන ප්‍රමාණය.</p>`;
}

async function loadTracker() {
  const box = $('tab-tracker');
  box.innerHTML = '<div class="muted small">AI signals check කරනවා…</div>';
  try {
    const t = await api('/api/ai-tracker');
    const gradeTable = `<div class="bt-h" style="margin-top:6px">🏆 Signal Grades <span class="muted small">(signals ${t.gradeCount} — "අද Signals" සහ Deep/Grade check කරනකොට auto save වෙනවා)</span></div>
      <table class="wrap"><tr><th></th><th>Signals</th><th>ඉවර වුණු</th><th>Win rate</th><th>ලාභ / පාඩු</th><th></th></tr>
        ${scoreRow('🏆 Grade A', t.byGrade.A, 'හොඳම signals')}${scoreRow('🥈 Grade B', t.byGrade.B, 'එක දුර්වල තැනක්')}${scoreRow('⚠️ Grade C', t.byGrade.C, 'trade නොකළ යුතු ඒවා')}
      </table><p class="small muted">Grade system එක වැඩ කරනවා නම් A row එක B ට වඩා, B row එක C ට වඩා හොඳ වෙන්න ඕන. Signals 30+ ක් එකතු වෙනකම් තීරණයක් ගන්න එපා.</p>`
      + newsTrackBox(t.news);
    if (!t.analyses) { box.innerHTML = gradeTable + '<div class="muted">තාම AI / Deep analyses නැහැ. Signal card එකේ "🤖 AI Analysis + News check" click කරලා analyses එකතු කරන්න. AI signals 50+ ක් එකතු වුණාම මෙතනින් AI ඇත්තටම ලාභද කියලා පේනවා.</div>'; return; }
    const bm = t.byMatch;
    const enough = t.ai.closed >= 30;
    box.innerHTML = gradeTable + `
      <div class="row"><b>🤖 AI Signal Tracker</b><span class="muted small">Analyses ${t.analyses} · update ${dt(t.time)}</span><button id="btnTrRef" class="sm ghost">Refresh</button></div>
      <div class="status ${enough ? (t.ai.netR > 0 ? 'ACTIVE' : 'INVALID') : 'CAUTION'}">${enough
        ? (t.ai.netR > 0 ? `✅ AI signals ${t.ai.closed}කින් ලාභයි (${t.ai.netR}R).` : `❌ AI signals ${t.ai.closed}කින් පාඩුයි (${t.ai.netR}R) — AI signal එක trade කරන්න එපා, news check එකට විතරක් පාවිච්චි කරන්න.`)
        : `⚠️ ඉවර වුණු AI signals ${t.ai.closed}යි. තීරණයක් ගන්න අවම 30–50ක් ඕන — තව analyses එකතු කරන්න.`}</div>
      <table class="wrap">
        <tr><th></th><th>Signals</th><th>ඉවර වුණු</th><th>Win rate</th><th>ලාභ / පාඩු</th><th></th></tr>
        ${scoreRow('🤖 AI signals (ඔක්කොම)', t.ai)}
        ${scoreRow('📐 Strategy signals', t.strategy, 'AI analysis කරපු වෙලාවල තිබුණ strategy signals')}
        ${scoreRow('✅ Strategy + AI MATCH', bm.MATCH.strategy, 'AI එකඟ වුණ strategy signals')}
        ${scoreRow('⚠️ Strategy + AI WAIT (PARTIAL)', bm.PARTIAL.strategy, 'AI එක WAIT කිව්ව strategy signals')}
        ${scoreRow('❌ Strategy + AI CONFLICT', bm.CONFLICT.strategy, 'AI විරුද්ධ වුණ strategy signals')}
        ${scoreRow('🤖 AI විතරයි (AI_ONLY)', bm.AI_ONLY.ai, 'Strategy signal නැති වෙලාවේ AI දුන්න signals')}
        <tr><td colspan="6" class="small muted" style="padding-top:10px"><b>🔬 Deep Analysis (${t.deepCount})</b></td></tr>
        ${scoreRow('🔬 Deep signals (ඔක්කොම)', t.deep)}
        ${scoreRow('✅ Strategy + Deep MATCH', t.deepByMatch.MATCH.strategy, 'Deep එකඟ වුණ strategy signals')}
        ${scoreRow('❌ Strategy + Deep CONFLICT', t.deepByMatch.CONFLICT.strategy, 'Deep විරුද්ධ වුණ strategy signals')}
        ${scoreRow('🔬 Deep විතරයි', t.deepByMatch.DEEP_ONLY.ai, 'Strategy signal නැති වෙලාවේ Deep දුන්න signals')}
      </table>
      <p class="small muted">වැදගත්ම ප්‍රශ්නය: "✅ MATCH" row එක "❌ CONFLICT" සහ "⚠️ PARTIAL" rows වලට වඩා හොඳද? හොඳ නම් AI news check එක ඇත්තටම උදව් වෙනවා. Rules: entry මිල පැය 24 ඇතුළත ආවොත් විතරක් trade එකක් ගණන් ගන්නවා · SL/TP · දවස් 7කින් close · trading cost අඩු කරලා.</p>
      <table><tr><th>වෙලාව</th><th>Market</th><th>Match</th><th>🤖 AI / 🔬 Deep</th><th>ප්‍රතිඵලය</th><th>📐 Strategy</th><th>Strategy ප්‍රතිඵලය</th></tr>
      ${t.rows.map((r) => `<tr><td class="small">${dt(Date.parse(r.time))}</td><td>${r.symbol} <span class="muted">${r.tf}</span></td><td class="small">${(MATCH[r.match] || {}).icon || ''} ${r.match || ''}</td>
        <td>${r.kind === 'deep' ? '🔬' : '🤖'} <span class="pill ${r.ai.action}">${r.ai.action || '—'}</span></td><td class="small">${r.ai.dup ? '<span class="muted">(duplicate)</span>' : outTxt(r.ai.outcome)}</td>
        <td><span class="pill ${r.strategy.action}">${r.strategy.action || '—'}</span></td><td class="small">${r.strategy.dup ? '<span class="muted">(duplicate)</span>' : outTxt(r.strategy.outcome)}</td></tr>`).join('')}
      </table>`;
    $('btnTrRef').onclick = loadTracker;
  } catch (e) { box.innerHTML = `<span class="neg">${e.message}</span>`; }
}

/* ---------- Sessions tab ---------- */
const slT = (t) => new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' });
const slD = (t) => new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const isoDay = (d) => d.toISOString().slice(0, 10);
function ssPreset(k) {
  const now = new Date(); const dow = (now.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  let f = mon, t = now;
  if (k === 'last') { f = new Date(mon.getTime() - 7 * 86400e3); t = new Date(mon.getTime() - 86400e3); }
  if (k === '4w') f = new Date(mon.getTime() - 21 * 86400e3);
  if (k === '3m') f = new Date(now.getTime() - 90 * 86400e3);
  $('ssFrom').value = isoDay(f); $('ssTo').value = isoDay(t);
}
let ssChart = null;
async function loadSessions() {
  const out = $('ssOut');
  out.innerHTML = '<span class="muted">Candles ගන්නවා…</span>';
  try {
    const r = await api(`/api/sessions?symbol=${S.symbol}&tf=${S.tf}&mode=${S.mode}&session=${$('ssSess').value}&from=${$('ssFrom').value}&to=${$('ssTo').value}`);
    S.ss = r; renderSessions();
  } catch (e) { out.innerHTML = `<span class="neg">${esc(e.message)}</span>`; }
}
function renderSessions() {
  const r = S.ss; if (!r) return;
  const sym = r.symbol, ss = r.sessions;
  const start = Math.max(1, +(store('novi-fx-bt-start') || 1000)), riskPct = Math.max(0.1, +(store('novi-fx-bt-risk') || 1)), risk$ = (start * riskPct) / 100;
  if (!ss.length) { $('ssOut').innerHTML = '<span class="muted">මේ දින පරාසයේ session data නැහැ (weekend / market වහලා?)</span>'; return; }
  const big = ss.reduce((a, x) => (x.range > a.range ? x : a)), small = ss.reduce((a, x) => (x.range < a.range ? x : a));
  const avg = ss.reduce((a, x) => a + x.range, 0) / ss.length;
  const hourCount = (key) => { const m = {}; for (const x of ss) { const hh = +slT(x[key]).slice(0, 2); const h = `${String(hh).padStart(2, '0')}:00–${String((hh + 1) % 24).padStart(2, '0')}:00`; m[h] = (m[h] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([h, n]) => `${h} (දවස් ${n})`).join(', '); };
  const tradesByDay = {};
  for (const t of r.trades) { const d = new Date(t.entryTime * 1000).toISOString().slice(0, 10); (tradesByDay[d] ||= []).push(t); }
  const totR = r.trades.reduce((a, t) => a + t.r, 0);
  const wins = r.trades.filter((t) => t.r > 0.1).length, losses = r.trades.filter((t) => t.r < -0.1).length;
  $('ssOut').innerHTML = `
    <div class="bt-h">${sym} · ${esc(r.sessionName)} · ${$('ssFrom').value} → ${$('ssTo').value} <span class="muted small">(sessions ${ss.length}, ${r.candleTf} candles)</span></div>
    <div class="stats">
      <div>🏆 වැඩිම චලනය<b>${big.date.slice(5)} ${big.weekday}</b><span class="small">${fmt(big.range, sym)} (${big.pips} pips)</span></div>
      <div>😴 අඩුම චලනය<b>${small.date.slice(5)} ${small.weekday}</b><span class="small">${fmt(small.range, sym)}</span></div>
      <div>සාමාන්‍ය චලනය<b>${fmt(avg, sym)}</b><span class="small">session එකකට</span></div>
      <div>UP / DOWN දවස්<b><span class="pos">${ss.filter((x) => x.dir === 'UP').length}</span> / <span class="neg">${ss.filter((x) => x.dir === 'DOWN').length}</span></b></div>
    </div>
    <div class="small">⏰ Session High එක වැඩියෙන්ම ආවේ (ලංකා වේලාව): <b>${hourCount('highTime')}</b> · Low එක: <b>${hourCount('lowTime')}</b></div>
    <div id="ssChart" style="height:230px;margin:8px 0"></div>
    <div class="small muted">හැම candle එකක්ම = එක දවසක ${esc(r.sessionName)} session එක. ▲▼ = ඒ දවස්වල strategy (${STRAT_NAME[r.strategy] || r.strategy}, ${S.tf}, ${MODE_NAME[r.mode]}) ගත්ත trades.</div>

    <div class="bt-sec"><div class="bt-h">💵 ඒ කාලයේ strategy trades ගත්තා නම් <span class="muted small">(trade එකකට ${usd(risk$)} risk — Backtest tab එකේ මුදල/risk % වෙනස් කරන්න පුළුවන්)</span></div>
      ${r.tradeErr ? `<div class="small neg">${esc(r.tradeErr)}</div>` : r.trades.length ? `
      <div class="verdict v-${totR > 0 ? '🟢' : '🔴'}"><div class="v-light">${totR > 0 ? '🟢' : '🔴'}</div><div><div class="v-title">${money0(totR * risk$)}</div>
        <div>Trades ${r.trades.length} · ✅ ${wins} · ⚪ ${r.trades.length - wins - losses} · ❌ ${losses}</div></div></div>
      <table><tr><th>Signal (ලංකා)</th><th></th><th>Entry</th><th>SL</th><th>Target</th><th>ඉවර වුණේ</th><th>ප්‍රතිඵලය</th></tr>
      ${r.trades.map((t) => `<tr><td class="small">${slD(t.signalTime)}</td><td><span class="pill ${t.side}">${t.side}</span></td><td class="mono">${fmt(t.entry, sym)}</td><td class="mono">${fmt(t.stop, sym)}</td><td class="mono">${fmt(t.target, sym)}</td>
        <td class="small">${slD(t.exitTime)} <span class="muted">${t.reason === 'TP' ? 'Target' : t.reason === 'SL' ? 'SL' : t.reason}</span></td><td class="${cls(t.r)}"><b>${money0(t.r * risk$)}</b></td></tr>`).join('')}</table>`
      : '<div class="small muted">මේ කාලයේ strategy එකෙන් ඉවර වුණු trades නැහැ (signals අඩුවෙන් එන්නේ).</div>'}</div>

    <details class="bt-sec" open><summary><b>📋 දවසින් දවස</b></summary>
      <table><tr><th>දවස</th><th>Open</th><th>High (ලංකා)</th><th>Low (ලංකා)</th><th>Close</th><th>චලනය</th><th>ලොකු චලනය</th><th title="Low එකේ ගත්තා/High එකේ විකුණුවා නම් (පස්සේ බලලා විතරයි දන්නේ)">උපරිම ඉඩ (0.10 lot)</th><th>Strategy</th></tr>
      ${ss.slice().reverse().map((x) => `<tr${x === big ? ' style="background:rgba(251,191,36,.08)"' : ''}><td>${x.date.slice(5)} ${x.weekday}</td><td class="mono">${fmt(x.open, sym)}</td>
        <td class="mono">${fmt(x.high, sym)} <span class="muted">${slT(x.highTime)}</span></td><td class="mono">${fmt(x.low, sym)} <span class="muted">${slT(x.lowTime)}</span></td>
        <td class="mono ${x.dir === 'UP' ? 'pos' : 'neg'}">${fmt(x.close, sym)}</td><td>${fmt(x.range, sym)} <span class="muted small">${x.pips}p</span></td>
        <td>${x.bigMove === 'UP' ? '<span class="pos">▲ Low → High</span>' : '<span class="neg">▼ High → Low</span>'}</td><td class="muted">$${x.hindsightUSD010}</td>
        <td class="small">${(tradesByDay[x.date] || []).map((t) => `<span class="pill ${t.side}">${t.side}</span> <b class="${cls(t.r)}">${money0(t.r * risk$)}</b>`).join('<br>') || '—'}</td></tr>`).join('')}</table>
      <div class="small muted">"උපරිම ඉඩ" = session එකේ Low එකේ ගත්තා/High එකේ විකුණුවා නම් ලැබෙන්න තිබුණු උපරිමය — ඒක පස්සේ බලලා විතරයි දන්නේ, ඇත්තටම කාටවත් ගන්න බැහැ.</div></details>`;
  // session candle chart + trade markers
  if (ssChart) { try { ssChart.remove(); } catch {} ssChart = null; }
  ssChart = LightweightCharts.createChart($('ssChart'), { ...chartOpts, autoSize: true, timeScale: { borderColor: '#2a3441', timeVisible: false, tickMarkFormatter: (t) => slFmt(t, { day: 'numeric', month: 'short' }) },
    localization: { timeFormatter: (t) => slFmt(t, { weekday: 'short', day: '2-digit', month: 'short' }) + ' session' } });
  const cs = ssChart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
  const d = digits(sym); cs.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / 10 ** d } });
  cs.setData(ss.map((x) => ({ time: x.start, open: x.open, high: x.high, low: x.low, close: x.close })));
  const mk = [];
  for (const t of r.trades) {
    let k = ss.length - 1; while (k > 0 && ss[k].start > t.entryTime) k--;
    mk.push({ time: ss[k].start, position: t.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown', color: t.r > 0 ? '#22c55e' : '#ef4444', text: money0(t.r * risk$) });
  }
  mk.sort((a, b) => a.time - b.time); cs.setMarkers(mk);
  ssChart.timeScale().fitContent();
}
$('ssGo').onclick = loadSessions;
document.querySelectorAll('[data-ss]').forEach((b) => (b.onclick = () => { ssPreset(b.dataset.ss); loadSessions(); }));

/* ---------- today's verified signals ---------- */
const ago = (t) => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 60 ? `විනාඩි ${m}කට කලින්` : m < 1440 ? `පැය ${Math.round(m / 60)}කට කලින්` : `දවස් ${Math.round(m / 1440)}කට කලින්`; };
async function loadToday(force) {
  const box = $('todayBox');
  if (box && (force || !S.today)) box.innerHTML = '<div class="muted small">✅ Verified markets check කරනවා… (පළවෙනි වතාවට විනාඩියක් විතර යන්න පුළුවන්)</div>';
  try {
    const t = await api(`/api/today?mode=${S.mode}` + (force ? '&force=1' : ''));
    S.today = t;
    const active = t.signals.filter((x) => x.grade?.grade === 'A').length;
    $('todayCount').textContent = t.signals.length ? `${active}/${t.signals.length}` : '';
    $('todayCount').className = 'cnt' + (active ? ' on' : '');
    if (!box) return;
    const cards = t.signals.map((x) => `
      <div class="tcard" data-s="${x.symbol}" data-tf="${x.tf}">
        <div class="tc-top">${gradeBadge(x.grade)} <b>${x.symbol}</b> <span class="muted">${x.tf}</span> <span class="pill ${x.action}">${x.action}</span> ${profBadge(x.profile)}</div>
        ${x.grade?.advice ? `<div class="small" title="${esc((x.grade.reasons || []).map((r) => (r.ok === false ? '✗ ' : r.ok ? '✓ ' : '• ') + r.text).join('\n'))}">${esc(x.grade.advice)}</div>` : ''}
        <div class="status ${x.status}" style="margin:4px 0"><b>${x.status}</b> · ${x.statusText}</div>
        <div class="mono small">${x.mode === 'highwin' ? `LIMIT ${fmt(x.entry, x.symbol)} · 1R ${fmt(x.tp1, x.symbol)}` : `Zone ${fmt(x.zone[0], x.symbol)} – ${fmt(x.zone[1], x.symbol)}`} · <span class="neg">SL ${fmt(x.stopLoss, x.symbol)}</span> · <span class="pos">Target ${fmt(x.target, x.symbol)}</span></div>
        <div class="small muted">දැන් ${fmt(x.price, x.symbol)} · signal එක ${ago(x.signalTime)} · ${STRAT_NAME[x.strategy] || x.strategy}</div>
      </div>`).join('');
    box.innerHTML = `<div class="panel-title" style="padding:4px 0">✅ අද Verified Signals <span class="muted small">update: ${dt(t.time)}</span> <button id="btnTodayRef" class="sm ghost">Refresh</button></div>
      ${t.signals.length ? `<div class="tgrid">${cards}</div>` : `<div class="muted small">දැනට verified signals නැහැ. Verified markets ${t.checked.length}ක් check කළා (${t.checked.map((c) => c.symbol + ' ' + c.tf).join(', ')}). ඉවසලා ඉන්න — හොඳ setups අඩුවෙන් එන්නේ.</div>`}
      ${t.errors.length ? `<div class="small neg">Check කරන්න බැරි වුණා: ${t.errors.map((e) => e.symbol + ' ' + e.tf).join(', ')}</div>` : ''}`;
    $('btnTodayRef').onclick = () => loadToday(true);
    document.querySelectorAll('.tcard').forEach((el) => (el.onclick = () => {
      S.tf = el.dataset.tf; S.tfSec = TF_SEC[S.tf]; store('novi-fx-tf', S.tf); renderTfBar(); selectSymbol(el.dataset.s);
    }));
  } catch (e) { if (box) box.innerHTML = `<span class="neg small">${e.message}</span>`; }
}
$('btnToday').onclick = () => { switchTab('scanner'); loadToday(false); };

async function runScan() {
  $('btnScan').disabled = true;
  $('scanBox').innerHTML = '<span class="muted">Scan කරනවා… (markets 17 — විනාඩියක් විතර යන්න පුළුවන්)</span>';
  try {
    const rows = await api(`/api/scan?tf=${S.tf}&mode=${S.mode}`);
    S.scan = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    renderWatchlist();
    const onlyV = store('novi-fx-onlyv') !== '0';
    const shown = rows.filter((r) => !onlyV || r.error || ['verified', 'weak'].includes(r.profile));
    $('scanBox').innerHTML = `<div class="row small"><label><input type="checkbox" id="onlyV" ${onlyV ? 'checked' : ''} style="width:auto"> Verified / Weak විතරක් පෙන්නන්න</label><span class="muted">Timeframe: ${S.tf}</span></div>
      <table><tr><th>Symbol</th><th>Strategy</th><th>Signal</th><th>Status</th><th>Price</th><th>Entry</th><th>SL</th><th>Target</th></tr>
      ${shown.map((r) => r.error ? `<tr><td>${r.symbol}</td><td colspan="7" class="muted">${r.error}</td></tr>` :
        `<tr data-s="${r.symbol}" style="cursor:pointer"><td>${r.symbol}</td><td>${profBadge(r.profile)}</td><td><span class="pill ${r.action}">${r.action}</span></td><td class="small">${r.status || ''}</td>
        <td class="mono">${fmt(r.price, r.symbol)}</td><td class="mono">${fmt(r.entry, r.symbol)}</td><td class="mono">${fmt(r.stopLoss, r.symbol)}</td><td class="mono">${fmt(r.tp2, r.symbol)}</td></tr>`).join('')}
      </table>${shown.length ? '' : '<p class="muted small">මේ timeframe එකේ verified symbols නැහැ. 1h හෝ 4h බලන්න, නැත්නම් Optimizer run කරන්න.</p>'}
      <p class="muted small">Row එක click කරලා chart එක බලන්න.</p>`;
    $('onlyV').onchange = (e) => { store('novi-fx-onlyv', e.target.checked ? '1' : '0'); runScan(); };
    document.querySelectorAll('#tab-scanner tr[data-s]').forEach((el) => (el.onclick = () => selectSymbol(el.dataset.s)));
  } catch (e) { $('scanBox').innerHTML = `<span class="neg">${e.message}</span>`; }
  $('btnScan').disabled = false;
}
$('btnScan').onclick = () => { switchTab('scanner'); runScan(); };
$('btnScan2').onclick = () => runScan();

/* ---------- backtest + optimizer ---------- */
let btChart, btLine;
const statBoxes = (s) => `<div class="stats">
  <div>Trades<b>${s.trades}</b></div><div>Win rate<b>${s.winRate}%</b></div>
  <div>Net (R)<b class="${cls(s.netR)}">${s.netR}</b></div><div>Profit factor<b>${s.profitFactor ?? '—'}</b></div>
  <div>Max DD (R)<b class="neg">${s.maxDrawdownR}</b></div><div>Break-even WR<b>${s.breakEvenWinRate}%</b></div>
  <div>Wins<b class="pos">${s.wins}</b></div><div>Losses<b class="neg">${s.losses}</b></div></div>`;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

const money0 = (v) => `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const usd = (v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function streaks(tr) {
  let maxL = 0, maxW = 0, l = 0, w = 0;
  for (const t of tr) { if (t.r > 0.1) { w++; l = 0; } else if (t.r < -0.1) { l++; w = 0; } maxL = Math.max(maxL, l); maxW = Math.max(maxW, w); }
  return { maxL, maxW };
}

function renderBacktest() {
  const r = S.bt; if (!r) return;
  const s = r.stats, p = r.profile, tr = r.trades;
  const start = Math.max(1, +(store('novi-fx-bt-start') || 1000));
  const riskPct = Math.max(0.1, +(store('novi-fx-bt-risk') || 1));
  const risk$ = (start * riskPct) / 100;
  const months = Math.max(0.1, (s.to - s.from) / (30.44 * 86400));
  const per = (s.trades / months).toFixed(1);
  const wins = tr.filter((t) => t.r > 0.1), bes = tr.filter((t) => Math.abs(t.r) <= 0.1), losses = tr.filter((t) => t.r < -0.1);
  const grossWin = wins.reduce((a, t) => a + t.gross, 0) * risk$;
  const grossBE = bes.reduce((a, t) => a + t.gross, 0) * risk$;
  const grossLoss = losses.reduce((a, t) => a + t.gross, 0) * risk$;
  const costs = tr.reduce((a, t) => a + t.cost, 0) * risk$;
  const net = grossWin + grossBE + grossLoss - costs;
  const tp = p.exits.tpR;
  const allTP = wins.every((t) => Math.abs(t.gross - tp) < 1e-6), allSL = losses.every((t) => Math.abs(t.gross + 1) < 1e-6);
  const { maxL, maxW } = streaks(tr);

  // 1. verdict light
  let light, title, sentence;
  const period = months >= 12 ? `අවුරුදු ${(months / 12).toFixed(1)}` : `මාස ${months.toFixed(1)}`;
  if (s.trades < 20) { light = '⚪'; title = 'Data මදි'; sentence = `${period} කට trades ${s.trades}යි — තීරණයකට මදි.`; }
  else if (net > 0 && s.profitFactor >= 1.3) { light = '🟢'; title = 'හොඳයි'; sentence = `${period} ක trades ${s.trades} කින් පැහැදිලි ලාභයක් ආවා.`; }
  else if (net > 0) { light = '🟡'; title = 'ලාභය පොඩියි'; sentence = `${period} ක trades ${s.trades} කින් ආවේ පොඩි ලාභයක් විතරයි — ඒ කාලයේ හොඳට වැඩ කළේ නැහැ.`; }
  else { light = '🔴'; title = 'පාඩුයි'; sentence = `${period} ක trades ${s.trades} කින් පාඩුයි — මේ කාලයේ මේ strategy එක වැඩ කළේ නැහැ.`; }

  const winLine = allTP && wins.length ? `${wins.length} දිනුම් × ${usd(risk$ * tp)} <span class="muted">(${tp} × ${usd(risk$)})</span>` : `දිනුම් ${wins.length}`;
  const lossLine = allSL && losses.length ? `${losses.length} පැරදුම් × ${usd(risk$)}` : `පැරදුම් ${losses.length}`;

  $('btOut').innerHTML = `
    <div class="verdict v-${light}"><div class="v-light">${light}</div><div><div class="v-title">${title}</div><div>${sentence}</div>
      <div class="small muted">${S.symbol} ${S.tf} · ${STRAT_NAME[p.strategy] || p.strategy} · <b>${MODE_NAME[s.mode || 'normal']}</b> · ${day(s.from)} → ${day(s.to)} · මාසෙකට trades ${per}ක් විතර</div>
      <div class="small">✅ දිනුම් <b class="pos">${Math.round((wins.length / Math.max(1, s.trades)) * 100)}%</b> · ⚪ Breakeven <b>${Math.round((bes.length / Math.max(1, s.trades)) * 100)}%</b> · ❌ පාඩු <b class="neg">${Math.round((losses.length / Math.max(1, s.trades)) * 100)}%</b>${s.notFilled ? ` · <span class="muted">Limit fill නොවුණු signals ${s.notFilled}</span>` : ''}</div></div></div>
    <div class="bt-sec"><button id="btnCompare" class="sm ghost">⚖️ Modes 3ම compare කරන්න</button><div id="cmpOut"></div></div>

    <div class="bt-sec">
      <div class="bt-h">💵 මගේ සල්ලි වලට මොකද වෙන්නේ?</div>
      <div class="row small">පටන් ගන්න මුදල $ <input id="btStart" type="number" value="${start}" min="1" style="width:90px">
        හැම trade එකකටම risk % <input id="btRisk" type="number" value="${riskPct}" step="0.5" min="0.1" style="width:60px">
        <span class="muted">= trade එකකට <b>${usd(risk$)}</b> risk (SL වැදුනොත් නැති වෙන ගාණ)</span></div>
      <table class="calc">
        <tr><td>✅ ${winLine}</td><td class="pos">${money0(grossWin)}</td></tr>
        ${bes.length ? `<tr><td>⚪ Breakeven ${bes.length} (SL entry එකට ගිහින් ~$0)</td><td>${money0(grossBE)}</td></tr>` : ''}
        <tr><td>❌ ${lossLine}</td><td class="neg">${money0(grossLoss)}</td></tr>
        <tr><td>💸 Trading costs (spread/commission) — trades ${s.trades}</td><td class="neg">${money0(-costs)}</td></tr>
        <tr class="tot"><td>අන්තිම ලාභය / පාඩුව</td><td class="${cls(net)}">${money0(net)}</td></tr>
        <tr class="tot"><td>${usd(start)} → අන්තිම balance එක</td><td><b>${usd(start + net)}</b> <span class="${cls(net)}">(${net >= 0 ? '+' : ''}${((net / start) * 100).toFixed(1)}%)</span></td></tr>
      </table>
    </div>

    <div class="bt-sec"><div class="bt-h">📈 Balance එක වෙනස් වුණ හැටි</div><div id="btCurve" style="height:150px"></div></div>

    <div class="bt-sec"><div class="bt-h">🟩🟥 දිනුම් / පැරදුම් (පිළිවෙළට)</div>
      <div class="sq">${tr.map((t) => `<span class="${t.r > 0.1 ? 'w' : t.r < -0.1 ? 'l' : 'b'}" title="${day(t.entryTime)} ${t.side} ${money0(t.r * risk$)}"></span>`).join('')}</div>
      <div class="small">එක දිගට පැරදුණු වැඩිම වාර ගණන: <b class="neg">${maxL}</b> (${money0(-maxL * risk$)}) · එක දිගට දිනපු වැඩිම: <b class="pos">${maxW}</b>
        <br><span class="muted">පාඩු ${maxL}ක් එක දිගට එනකොටත් ඉවසලා ඉන්න ඕන — ඒක මේ strategy එකේ සාමාන්‍ය දෙයක්.</span></div></div>

    <div class="bt-sec"><button id="btnMarkers" class="sm ghost">${S.markersOn ? '📍 Chart එකේ trades හංගන්න' : '📍 Chart එකේ trades පෙන්නන්න'}</button>
      <span class="small muted">▲ BUY / ▼ SELL ලකුණු chart එකේ (chart එකේ තියෙන කාලයට විතරක්)</span></div>

    <details class="bt-sec"><summary><b>📋 Trades list (${tr.length})</b></summary>
      <table><tr><th>දිනය</th><th></th><th>Entry</th><th>SL</th><th>Target</th><th>ප්‍රතිඵලය</th><th>කාලය</th></tr>
      ${tr.slice().reverse().map((t) => `<tr><td class="small">${dt(t.entryTime * 1000)}</td><td><span class="pill ${t.side}">${t.side}</span></td>
        <td class="mono">${fmt(t.entry)}</td><td class="mono">${fmt(t.stop)}</td><td class="mono">${fmt(t.target)}</td>
        <td class="${cls(t.r)}"><b>${money0(t.r * risk$)}</b> <span class="small muted">${t.reason === 'TP' ? 'Target වැදුනා' : t.reason === 'SL' ? 'SL වැදුනා' : t.reason}</span></td>
        <td class="small muted">පැය ${Math.round((t.exitTime - t.entryTime) / 3600)}</td></tr>`).join('')}</table></details>

    <details class="bt-sec"><summary><b>🔧 විස්තර (advanced)</b></summary>
      ${profileLine(p)}
      ${statBoxes(s)}
      <p class="small muted">R = trade එකක risk කරන මුදල (මෙතන ${usd(risk$)}). Profit factor = දිනපු මුදල ÷ පැරදුණු මුදල (1 ට වැඩි නම් ලාභ). Max DD = ඉහළම තැනේ ඉඳන් පහළට ගිය උපරිමය. Cost = trade එකකට ${s.cost}.</p>
    </details>`;

  // balance curve in $
  if (btChart) { btChart.remove(); btChart = null; }
  btChart = LightweightCharts.createChart($('btCurve'), { ...chartOpts, autoSize: true, localization: { timeFormatter: (t) => slFmt(t, { day: '2-digit', month: 'short', year: 'numeric' }) } });
  btLine = btChart.addAreaSeries({ lineColor: '#3b82f6', topColor: 'rgba(59,130,246,.3)', bottomColor: 'rgba(59,130,246,0)', lineWidth: 2 });
  let bal = start; const pts = [{ time: s.from, value: start }]; const seen = new Set([s.from]);
  for (const t of tr) { bal += t.r * risk$; if (!seen.has(t.exitTime)) { seen.add(t.exitTime); pts.push({ time: t.exitTime, value: +bal.toFixed(2) }); } else pts[pts.length - 1].value = +bal.toFixed(2); }
  btLine.setData(pts);
  btLine.createPriceLine({ price: start, color: '#8b98a8', lineStyle: 2, lineWidth: 1, title: 'Start' });
  btChart.timeScale().fitContent();

  $('btStart').onchange = (e) => { store('novi-fx-bt-start', e.target.value); renderBacktest(); };
  $('btRisk').onchange = (e) => { store('novi-fx-bt-risk', e.target.value); renderBacktest(); };
  $('btnMarkers').onclick = () => { S.markersOn = !S.markersOn; drawTradeMarkers(); renderBacktest(); };
  $('btnCompare').onclick = compareModes;
}

async function compareModes() {
  const box = $('cmpOut'); box.innerHTML = '<span class="muted small">Modes 3ම backtest කරනවා…</span>';
  const start = Math.max(1, +(store('novi-fx-bt-start') || 1000)), risk$ = (start * Math.max(0.1, +(store('novi-fx-bt-risk') || 1))) / 100;
  try {
    const rows = [];
    for (const m of ['normal', 'breakeven', 'highwin']) {
      const r = await api(`/api/backtest?symbol=${S.symbol}&tf=${S.tf}&mode=${m}`);
      const tr = r.trades, n = Math.max(1, tr.length);
      const w = tr.filter((t) => t.r > 0.1).length, b = tr.filter((t) => Math.abs(t.r) <= 0.1).length, l = tr.filter((t) => t.r < -0.1).length;
      rows.push({ m, n: tr.length, w, b, l, net: r.stats.netR * risk$, maxL: streaks(tr).maxL });
    }
    const best = rows.reduce((a, x) => (x.net > a.net ? x : a));
    box.innerHTML = `<table class="wrap"><tr><th>Mode</th><th>Trades</th><th>✅ දිනුම්</th><th>⚪ $0</th><th>❌ පාඩු</th><th>එක දිගට පාඩු (max)</th><th>ලාභය</th></tr>
      ${rows.map((x) => `<tr${x.m === S.mode ? ' style="background:var(--panel2)"' : ''}><td>${MODE_NAME[x.m]}</td><td>${x.n}</td><td class="pos">${Math.round((x.w / Math.max(1, x.n)) * 100)}%</td><td>${Math.round((x.b / Math.max(1, x.n)) * 100)}%</td><td class="neg">${Math.round((x.l / Math.max(1, x.n)) * 100)}%</td><td>${x.maxL}</td><td class="${cls(x.net)}"><b>${money0(x.net)}</b>${x === best ? ' 🏆' : ''}</td></tr>`).join('')}
      </table><p class="small muted">${S.symbol} ${S.tf}, $${start} · trade එකකට ${usd(risk$)} risk. Mode එක තෝරන්න Signal card එකේ උඩ buttons.</p>`;
  } catch (e) { box.innerHTML = `<span class="neg small">${esc(e.message)}</span>`; }
}

function drawTradeMarkers() {
  if (!S.markersOn || !S.bt || S.bt.symbol !== S.symbol || S.bt.tf !== S.tf) { candleS.setMarkers([]); return; }
  const risk$ = (Math.max(1, +(store('novi-fx-bt-start') || 1000)) * Math.max(0.1, +(store('novi-fx-bt-risk') || 1))) / 100;
  const m = S.bt.trades.filter((t) => t.entryTime >= (S.chartFrom || 0)).map((t) => ({
    time: t.entryTime, position: t.side === 'BUY' ? 'belowBar' : 'aboveBar', shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown',
    color: t.r > 0 ? '#22c55e' : '#ef4444', text: money0(t.r * risk$),
  }));
  candleS.setMarkers(m);
}

$('btnBacktest').onclick = async () => {
  $('btOut').innerHTML = '<span class="muted">Backtest කරනවා… (candles 5000ක් ගන්නවා)</span>';
  try {
    const r = await api(`/api/backtest?symbol=${S.symbol}&tf=${S.tf}&mode=${S.mode}`);
    S.bt = { ...r, symbol: S.symbol, tf: S.tf };
    renderBacktest();
    drawTradeMarkers();
  } catch (e) { $('btOut').innerHTML = `<span class="neg">${e.message}</span>`; }
};

const paramText = (st, p, ex) => st === 'pullback'
  ? `Pullback · ADX>${p.adx} · ${p.htf === 'htfD' ? 'Daily' : '4H'} trend · SL ${p.sl}ATR · touch ${p.touch} · ${ex.tpR}R`
  : `Breakout ${p.n} · ADX>${p.adx} · ${p.htf === 'htfD' ? 'Daily' : '4H'} trend · SL ${p.sl}ATR${p.hours ? ' · London/NY' : ''} · ${ex.tpR}R`;
const mini = (s) => `${s.trades} trades · win ${s.winRate}% · PF ${s.profitFactor ?? '—'} · Net <b class="${cls(s.netR)}">${s.netR}R</b>`;

$('btnOptimize').onclick = async () => {
  const b = $('btnOptimize'); b.disabled = true;
  $('btOut').innerHTML = '<span class="muted">Optimizer run වෙනවා… settings 112ක් test කරනවා (තත්පර 10–30)</span>';
  try {
    const o = await api('/api/optimize', { method: 'POST', body: { symbol: S.symbol, tf: S.tf } });
    if (!o.train) { $('btOut').innerHTML = `${profBadge(o.status)} <span class="small">${o.note}</span>`; b.disabled = false; return; }
    $('btOut').innerHTML = `
      <div class="prof">${profBadge(o.status)} <b>${S.symbol} ${S.tf}</b> — ${o.note}</div>
      <p class="small muted">Data: ${day(o.from)} → ${day(o.to)}. <b>Train</b> (${day(o.from)} → ${day(o.splitTime)}) එකේ හොඳම settings තෝරලා, ඒවා කවදාවත් නොදැකපු <b>Test</b> (${day(o.splitTime)} → ${day(o.to)}) කොටසේ test කළා.</p>
      <table class="wrap">
        <tr><th></th><th>Settings</th><th>Train</th><th>Test (වැදගත්ම එක)</th></tr>
        <tr><td>Optimizer best</td><td class="small">${paramText(o.strategy, o.params, o.exits)}</td><td class="small">${mini(o.train)}</td><td class="small">${mini(o.test)}</td></tr>
        <tr><td>දැනට තියෙන profile</td><td class="small">—</td><td></td><td class="small">${mini(o.presetTest)}</td></tr>
      </table>
      <p class="small">${o.hasPreset
        ? 'ⓘ මේ symbol/timeframe එකට අවුරුදු 4–5 ක research profile එකක් තියෙනවා — ඒකම තියාගත්තා. "දැනට තියෙන profile" row එකෙන් පේන්නේ ඒක පහුගිය මාස කීපයේ කොහොමද වැඩ කළේ කියලා.'
        : o.decisive ? '✓ මේ profile එක save වුණා — signals දැන් මේ settings වලින් එනවා.' : 'ⓘ Trades මදි නිසා profile එක වෙනස් කළේ නැහැ.'}</p>`;
    loadSignal();
  } catch (e) { $('btOut').innerHTML = `<span class="neg">${e.message}</span>`; }
  b.disabled = false;
};

/* ---------- paper trading ---------- */
async function loadPaper() {
  try {
    const p = await api('/api/paper');
    $('acct').innerHTML = `<div>Balance<b>$${p.balance.toFixed(2)}</b></div><div>Equity<b>$${p.equity.toFixed(2)}</b></div><div>Floating<b class="${cls(p.floating)}">${money(p.floating)}</b></div>`;
    $('tab-positions').innerHTML = p.positions.length ? `<table><tr><th>#</th><th>Symbol</th><th>Side</th><th>Lots</th><th>Entry</th><th>Price</th><th>SL</th><th>TP</th><th>P&L $</th><th></th></tr>
      ${p.positions.map((x) => `<tr><td>${x.id}</td><td>${x.symbol}<br><span class="small muted">${MODE_NAME[x.mode || 'normal']}</span></td><td class="${x.side === 'BUY' ? 'pos' : 'neg'}">${x.side}${x.pending ? '<br><span class="small">⏳ LIMIT</span>' : ''}${x.events?.length ? `<br><span class="small muted">${x.events.map(esc).join(' · ')}</span>` : ''}</td><td>${x.lots}</td>
      <td class="mono">${fmt(x.entry, x.symbol)}</td><td class="mono">${fmt(x.price, x.symbol)}</td><td class="mono">${fmt(x.stopLoss, x.symbol)}</td><td class="mono">${fmt(x.takeProfit, x.symbol)}</td>
      <td class="mono ${cls(x.pnl)}">${money(x.pnl)}</td><td><button class="sm ghost" data-close="${x.id}">Close</button></td></tr>`).join('')}</table>`
      : '<span class="muted">Open positions නැහැ.</span>';
    document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = async () => { await api('/api/paper/close', { method: 'POST', body: { id: b.dataset.close } }); loadPaper(); }));
    const st = p.stats;
    $('tab-history').innerHTML = `<div class="row small"><span>Closed: <b>${st.closed}</b></span><span>Win rate: <b>${st.winRate}%</b></span><span>Total P&L: <b class="${cls(st.totalPnl)}">$${money(st.totalPnl)}</b></span>
      <button class="sm ghost" id="btnReset">Account reset ($10,000)</button></div>` +
      (p.history.length ? `<table><tr><th>Closed</th><th>Symbol</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Reason</th><th>P&L $</th></tr>
      ${p.history.map((h) => `<tr><td>${dt(h.closedAt)}</td><td>${h.symbol}</td><td>${h.side}</td><td>${h.lots}</td><td class="mono">${fmt(h.entry, h.symbol)}</td><td class="mono">${fmt(h.exit, h.symbol)}</td><td>${h.reason}</td><td class="mono ${cls(h.pnl)}">${money(h.pnl)}</td></tr>`).join('')}</table>` : '');
    const rb = $('btnReset');
    if (rb) rb.onclick = async () => { await api('/api/paper/reset', { method: 'POST' }); loadPaper(); };
    S.balance = p.balance;
    S.seenEv = S.seenEv || {};
    for (const x of p.positions) {
      const n = (x.events || []).length, prev = S.seenEv[x.id];
      if (prev != null && n > prev) toast(`🔔 Demo #${x.id} ${x.symbol}: ${esc(x.events.slice(prev).join(' · '))}`, true);
      S.seenEv[x.id] = n;
    }
  } catch (e) { $('acct').innerHTML = `<span class="neg small">${e.message}</span>`; }
}

$('btnUseSig').onclick = () => {
  const s = S.signal;
  if (!s || !['BUY', 'SELL'].includes(s.action)) { $('orderMsg').textContent = 'දැන් active signal එකක් නැහැ.'; return; }
  S.orderZone = s.mode === 'highwin' ? null : s.zone;
  S.orderLimit = s.mode === 'highwin' ? { side: s.action, price: s.entry, expires: s.limitExpires } : null;
  if (s.mode === 'highwin') $('orderMsg').innerHTML = `<span class="muted">🎯 ${s.action} LIMIT @ ${fmt(s.entry)} — ${s.action} button එක ඔබන්න (මිල limit එකට ආවම demo එකේ trade එක open වෙනවා)</span>`;
  if (S.sigState && !['ACTIVE', 'LIMIT'].includes(S.sigState)) $('orderMsg').innerHTML = `<span class="neg">⚠️ Signal status: ${S.sigState} — දැන් entry ගන්න හොඳ නැහැ.</span>`;
  $('oSL').value = (+s.stopLoss).toFixed(digits(S.symbol));
  $('oTP').value = (+s.tp2).toFixed(digits(S.symbol));
  $('btnCalc').click();
};

$('btnCalc').onclick = async () => {
  const entry = (S.mode === 'highwin' && S.orderLimit ? S.orderLimit.price : null) ?? S.prices[S.symbol] ?? S.lastCandle?.close, stop = +$('oSL').value;
  if (!stop) { $('calcOut').textContent = 'මුලින් Stop Loss එක දාන්න.'; return; }
  try {
    const r = await api(`/api/size?symbol=${S.symbol}&entry=${entry}&stop=${stop}&balance=${S.balance || 10000}&riskPct=${$('oRisk').value}`);
    if (!r || !(r.lots > 0)) { $('calcOut').textContent = 'Risk එකට lot එක ගොඩක් පොඩියි — risk % වැඩි කරන්න හෝ SL එක ළං කරන්න.'; return; }
    $('oLots').value = r.lots;
    $('calcOut').textContent = `${r.lots} lots · SL ${r.pips} pips · risk $${r.riskUSD}`;
  } catch (e) { $('calcOut').textContent = e.message; }
};

async function placeOrder(side, force) {
  $('orderMsg').textContent = '';
  const zone = S.signal && S.signal.action === side && S.orderZone ? S.orderZone : null;
  try {
    const pos = await api('/api/paper/open', { method: 'POST', body: {
      symbol: S.symbol, side, lots: +$('oLots').value, zone, force: !!force, mode: S.mode,
      limitPrice: S.mode === 'highwin' && S.orderLimit && S.orderLimit.side === side ? S.orderLimit.price : null,
      expiresAt: S.mode === 'highwin' && S.orderLimit && S.orderLimit.side === side ? S.orderLimit.expires : null,
      stopLoss: $('oSL').value ? +$('oSL').value : null, takeProfit: $('oTP').value ? +$('oTP').value : null,
      note: S.signal ? `signal ${S.signal.action} ${S.signal.score}` : '',
    } });
    $('orderMsg').innerHTML = pos.pending ? `<span class="pos">⏳ ${side} LIMIT ${pos.lots} ${pos.symbol} @ ${fmt(pos.entry)} දැම්මා (${MODE_NAME[pos.mode]})</span>`
      : `<span class="pos">✓ ${side} ${pos.lots} ${pos.symbol} @ ${fmt(pos.entry)} (${MODE_NAME[pos.mode]})</span>`;
    if (!pos.stopLoss) $('orderMsg').innerHTML += '<br><span class="neg">⚠️ Stop loss නැතුව trade එකක්!</span>';
    switchTab('positions'); loadPaper();
  } catch (e) {
    $('orderMsg').innerHTML = `<span class="neg">${e.message}</span>`;
    if (/zone/.test(e.message)) {
      $('orderMsg').innerHTML += `<br><button class="sm ghost" id="btnForce">එහෙමත් ${side} කරන්න</button>`;
      $('btnForce').onclick = () => placeOrder(side, true);
    }
  }
}
$('btnBuy').onclick = () => placeOrder('BUY');
$('btnSell').onclick = () => placeOrder('SELL');

/* ---------- tabs / nav ---------- */
function switchTab(name) {
  if (name === 'tracker') loadTracker();
  if (name === 'sessions' && !$('ssFrom').value) ssPreset('week');
  if ((name === 'backtest' || name === 'scanner' || name === 'tracker' || name === 'sessions') && document.querySelector('.tab-body').offsetHeight < 330) setPanelH(380);
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
}
document.querySelectorAll('.tabs button[data-tab]').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

/* ---------- bottom panel: drag to resize + expand button ---------- */
function setPanelH(h) {
  const center = document.querySelector('.center');
  const max = center.clientHeight - 220; // keep at least ~220px for the chart
  h = Math.max(120, Math.min(h, max));
  document.documentElement.style.setProperty('--panel-h', h + 'px');
  store('novi-fx-panel', String(Math.round(h)));
}
(function initPanel() {
  const saved = +store('novi-fx-panel');
  if (saved) setPanelH(saved);
  const rz = $('resizer');
  let startY, startH;
  const move = (e) => setPanelH(startH + (startY - (e.touches ? e.touches[0].clientY : e.clientY)));
  const up = () => { rz.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
  const down = (e) => {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = document.querySelector('.tab-body').offsetHeight;
    rz.classList.add('drag');
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move); document.addEventListener('touchend', up);
    e.preventDefault();
  };
  rz.addEventListener('mousedown', down); rz.addEventListener('touchstart', down);
  $('btnPanelSize').onclick = () => {
    const cur = document.querySelector('.tab-body').offsetHeight;
    const big = document.querySelector('.center').clientHeight - 220;
    setPanelH(cur < big - 20 ? big : 260);
  };
})();

function renderTfBar() {
  $('tfBar').innerHTML = S.cfg.timeframes.map((tf) => `<button class="${tf === S.tf ? 'active' : ''}" data-tf="${tf}">${tf}</button>`).join('');
  document.querySelectorAll('#tfBar button').forEach((b) => (b.onclick = () => { S.tf = b.dataset.tf; S.tfSec = TF_SEC[S.tf]; store('novi-fx-tf', S.tf); renderTfBar(); refreshAll(true); }));
}

function selectSymbol(s) {
  setTimeout(renderSession, 0);
  S.symbol = s; store('novi-fx-sym', s); S.orderZone = null; S.dayOpen = null;
  $('symName').textContent = s; $('aiOut').textContent = ''; $('deepOut').textContent = ''; $('oSL').value = ''; $('oTP').value = ''; $('calcOut').textContent = '';
  applyPrecision(); renderWatchlist(); refreshAll(true);
}

async function refreshAll(fit) {
  try { await loadChart(fit); await loadSignal(); }
  catch (e) { $('sigBody').innerHTML = `<span class="neg">${e.message}</span>`; }
  if (fit) loadMtf();
}

function isLive(s) { return S.live[s] && Date.now() - S.live[s] < 30_000; }

let tick = 0;
function loop() {
  tick++;
  // Live symbols: candles reload on candle close (onLiveTick) + every 5 min as a safety net.
  // Not live: reload every 60s (Twelve Data free limit).
  const age = Date.now() - S.lastCandleLoad;
  if (age > (isLive(S.symbol) ? 300_000 : 60_000)) refreshAll(false);
  loadPaper();
  if (tick % 60 === 0) loadMtf();
  if (tick % 100 === 0) loadToday(false); // ~5 min
  if (tick % 20 === 0) renderSession();
  for (const s of Object.keys(S.cfg.instruments)) {
    const d = document.querySelector(`[data-dot="${s}"]`);
    if (d) { d.className = 'dot ' + (isLive(s) ? 'on' : ''); d.title = isLive(s) ? 'LIVE' : 'Delayed'; }
  }
  const lb = $('liveBadge');
  if (lb) { const on = isLive(S.symbol); lb.className = 'badge ' + (on ? 'ok' : 'warn'); lb.textContent = on ? '● LIVE' : 'Delayed (60s)'; }
  renderStatus();
}

(async function init() {
  S.cfg = await api('/api/config');
  S.symbol = S.cfg.instruments[store('novi-fx-sym')] ? store('novi-fx-sym') : 'XAUUSD';
  S.tf = S.cfg.timeframes.includes(store('novi-fx-tf')) ? store('novi-fx-tf') : '1h';
  S.tfSec = TF_SEC[S.tf];
  S.mode = ['normal', 'breakeven', 'highwin'].includes(store('novi-fx-mode')) ? store('novi-fx-mode') : 'normal';
  renderModeBar();
  renderSession();
  startStream();
  $('symName').textContent = S.symbol;
  const b = [];
  if (S.cfg.demoData) b.push('<span class="badge warn">DEMO DATA (fake prices)</span>');
  else if (!S.cfg.hasTwelveData) b.push('<span class="badge warn">Forex key නැහැ — crypto විතරයි</span>');
  b.push(S.cfg.hasAI ? '<span class="badge ok">AI on</span>' : '<span class="badge">AI off</span>');
  if (!S.cfg.demoData && !S.cfg.hasFinnhub) b.push('<span class="badge warn">FINNHUB key නැහැ — forex/gold live නැහැ</span>');
  b.push('<span id="liveBadge" class="badge">…</span>');
  b.push('<span class="badge">Paper trading</span>');
  $('badges').innerHTML = b.join('');
  applyPrecision(); renderTfBar(); renderWatchlist();
  await refreshAll(true);
  loadPaper();
  loadToday(false);
  setInterval(loop, 3_000);
})();
