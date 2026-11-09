/* Novi FX frontend */
const S = { symbol: 'XAUUSD', tf: '1h', cfg: null, signal: null, lastCandle: null, priceLines: [], scan: {}, prices: {}, live: {}, tfSec: 3600, lastCandleLoad: 0 };
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
const chartOpts = {
  layout: { background: { color: '#0d1117' }, textColor: '#8b98a8' },
  grid: { vertLines: { color: '#161d26' }, horzLines: { color: '#161d26' } },
  timeScale: { timeVisible: true, borderColor: '#2a3441' },
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
  S.dayOpen = first.open;
  setHeaderPrice(S.prices[S.symbol] ?? last.close);
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
  if (!sig || !['BUY', 'SELL'].includes(sig.action)) return;
  const add = (price, color, title) => S.priceLines.push(candleS.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: 2, axisLabelVisible: true }));
  add(sig.zone[0], 'rgba(59,130,246,.5)', 'Zone');
  add(sig.zone[1], 'rgba(59,130,246,.5)', 'Zone');
  add(sig.entry, '#3b82f6', 'Entry');
  add(sig.stopLoss, '#ef4444', 'SL');
  add(sig.tp1, 'rgba(34,197,94,.6)', '1.5R');
  add(sig.tp2, '#22c55e', 'Target');
}

async function loadSignal() {
  const sig = await api(`/api/signal?symbol=${S.symbol}&tf=${S.tf}`);
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
    <div class="small muted" style="margin:4px 0">Signal එක ආවේ ${ago} (${dt(sig.signalTime * 1000)})</div>
    <div class="levels mono">
      <span>Entry zone</span><span>${fmt(sig.zone[0])} – ${fmt(sig.zone[1])}</span>
      <span>Entry</span><span>${fmt(sig.entry)}</span>
      <span>Stop Loss</span><span class="neg">${fmt(sig.stopLoss)}</span>
      <span>1.5R (partial)</span><span class="pos">${fmt(sig.tp1)}</span>
      <span>Target (${sig.riskReward}R)</span><span class="pos">${fmt(sig.tp2)}</span>
    </div>` : '';
  const head = sig.action === 'OFF' ? 'OFF' : sig.action;
  const sub = sig.action === 'WAIT' ? '<div class="small muted">Setup එක තාම සම්පූර්ණ නැහැ — පහළ checklist එක බලන්න</div>'
    : sig.action === 'OFF' ? '<div class="small muted">මේ symbol/timeframe එකේ signals දෙන්නේ නැහැ</div>' : '';
  $('sigBody').innerHTML = `
    ${profileLine(sig.profile)}
    <div class="sig-action ${sig.action}">${head}</div>${sub}
    ${lv}<ul class="reasons">${reasons}</ul>
    <div class="small muted">Close වුණු candles විතරක් බලලා හදපු signal එකක් — candle එක මැද්දේ වෙනස් වෙන්නේ නැහැ.</div>`;
  drawSignalLines(sig);
  renderStatus();
}

async function loadMtf() {
  try {
    const m = await api(`/api/mtf?symbol=${S.symbol}`);
    $('mtf').innerHTML = Object.entries(m).map(([tf, v]) =>
      `<div>${tf}<br><span class="pill ${v.action || 'WAIT'}">${v.action || 'ERR'}</span>${v.status ? `<br><span class="muted">${v.status}</span>` : ''}${v.profile ? `<br><span class="muted">${(PROFILE[v.profile]?.label || '').split(' ')[0]}</span>` : ''}</div>`).join('');
  } catch { $('mtf').innerHTML = ''; }
}

$('btnExplain').onclick = async () => {
  const b = $('btnExplain');
  b.disabled = true; $('aiOut').textContent = 'Analyze කරනවා…';
  try {
    const r = await api('/api/explain', { method: 'POST', body: { symbol: S.symbol, tf: S.tf } });
    $('aiOut').textContent = r.text + (r.source === 'rules' && !S.cfg.hasAI ? '\n\n(ANTHROPIC_API_KEY දැම්මොත් AI analysis එක එනවා)' : '');
  } catch (e) { $('aiOut').textContent = e.message; }
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

async function runScan() {
  $('btnScan').disabled = true;
  $('tab-scanner').innerHTML = '<span class="muted">Scan කරනවා…</span>';
  try {
    const rows = await api(`/api/scan?tf=${S.tf}`);
    S.scan = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    renderWatchlist();
    const onlyV = store('novi-fx-onlyv') !== '0';
    const shown = rows.filter((r) => !onlyV || r.error || ['verified', 'weak'].includes(r.profile));
    $('tab-scanner').innerHTML = `<div class="row small"><label><input type="checkbox" id="onlyV" ${onlyV ? 'checked' : ''} style="width:auto"> Verified / Weak විතරක් පෙන්නන්න</label><span class="muted">Timeframe: ${S.tf}</span></div>
      <table><tr><th>Symbol</th><th>Strategy</th><th>Signal</th><th>Status</th><th>Price</th><th>Entry</th><th>SL</th><th>Target</th></tr>
      ${shown.map((r) => r.error ? `<tr><td>${r.symbol}</td><td colspan="7" class="muted">${r.error}</td></tr>` :
        `<tr data-s="${r.symbol}" style="cursor:pointer"><td>${r.symbol}</td><td>${profBadge(r.profile)}</td><td><span class="pill ${r.action}">${r.action}</span></td><td class="small">${r.status || ''}</td>
        <td class="mono">${fmt(r.price, r.symbol)}</td><td class="mono">${fmt(r.entry, r.symbol)}</td><td class="mono">${fmt(r.stopLoss, r.symbol)}</td><td class="mono">${fmt(r.tp2, r.symbol)}</td></tr>`).join('')}
      </table>${shown.length ? '' : '<p class="muted small">මේ timeframe එකේ verified symbols නැහැ. 1h හෝ 4h බලන්න, නැත්නම් Optimizer run කරන්න.</p>'}
      <p class="muted small">Row එක click කරලා chart එක බලන්න.</p>`;
    $('onlyV').onchange = (e) => { store('novi-fx-onlyv', e.target.checked ? '1' : '0'); runScan(); };
    document.querySelectorAll('#tab-scanner tr[data-s]').forEach((el) => (el.onclick = () => selectSymbol(el.dataset.s)));
  } catch (e) { $('tab-scanner').innerHTML = `<span class="neg">${e.message}</span>`; }
  $('btnScan').disabled = false;
}
$('btnScan').onclick = () => { switchTab('scanner'); runScan(); };

/* ---------- backtest + optimizer ---------- */
let btChart, btLine;
const statBoxes = (s) => `<div class="stats">
  <div>Trades<b>${s.trades}</b></div><div>Win rate<b>${s.winRate}%</b></div>
  <div>Net (R)<b class="${cls(s.netR)}">${s.netR}</b></div><div>Profit factor<b>${s.profitFactor ?? '—'}</b></div>
  <div>Max DD (R)<b class="neg">${s.maxDrawdownR}</b></div><div>Break-even WR<b>${s.breakEvenWinRate}%</b></div>
  <div>Wins<b class="pos">${s.wins}</b></div><div>Losses<b class="neg">${s.losses}</b></div></div>`;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

$('btnBacktest').onclick = async () => {
  $('btOut').innerHTML = '<span class="muted">Backtest කරනවා… (candles 5000ක් ගන්නවා)</span>';
  try {
    const r = await api(`/api/backtest?symbol=${S.symbol}&tf=${S.tf}`);
    const s = r.stats, p = r.profile;
    const verdict = s.trades < 20 ? '⚠️ Trades 20කට අඩුයි — මේ කාලයේ results විශ්වාස කරන්න මදි.'
      : s.netR > 0 && s.profitFactor >= 1.15 ? '✅ මේ කාලයේ profitable. (අනාගතයේත් එහෙමමයි කියලා guarantee නැහැ.)'
      : s.netR > 0 ? '⚠️ පොඩි ලාභයක් විතරයි.' : '❌ මේ කාලයේ පාඩුයි.';
    $('btOut').innerHTML = `${profileLine(p)}
      <p class="small muted">${day(s.from)} → ${day(s.to)} · Trading cost එක trade එකකට ${s.cost} (spread + commission) අඩු කරලා තියෙන්නේ</p>
      ${statBoxes(s)}
      <p class="small">${verdict} <span class="muted">1R = එක trade එකක risk කරන මුදල. උදා: $10 risk කරනවා නම් Net ${s.netR}R = $${(s.netR * 10).toFixed(0)}.</span></p>`;
    if (!btChart) {
      btChart = LightweightCharts.createChart($('btChart'), { ...chartOpts, autoSize: true });
      btLine = btChart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
    }
    const seen = new Set();
    btLine.setData(r.curve.filter((pt) => !seen.has(pt.time) && seen.add(pt.time)));
    btChart.timeScale().fitContent();
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
      ${p.positions.map((x) => `<tr><td>${x.id}</td><td>${x.symbol}</td><td class="${x.side === 'BUY' ? 'pos' : 'neg'}">${x.side}</td><td>${x.lots}</td>
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
  } catch (e) { $('acct').innerHTML = `<span class="neg small">${e.message}</span>`; }
}

$('btnUseSig').onclick = () => {
  const s = S.signal;
  if (!s || !['BUY', 'SELL'].includes(s.action)) { $('orderMsg').textContent = 'දැන් active signal එකක් නැහැ.'; return; }
  S.orderZone = s.zone;
  if (S.sigState && S.sigState !== 'ACTIVE') $('orderMsg').innerHTML = `<span class="neg">⚠️ Signal status: ${S.sigState} — දැන් entry ගන්න හොඳ නැහැ.</span>`;
  $('oSL').value = (+s.stopLoss).toFixed(digits(S.symbol));
  $('oTP').value = (+s.tp2).toFixed(digits(S.symbol));
  $('btnCalc').click();
};

$('btnCalc').onclick = async () => {
  const entry = S.prices[S.symbol] ?? S.lastCandle?.close, stop = +$('oSL').value;
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
      symbol: S.symbol, side, lots: +$('oLots').value, zone, force: !!force,
      stopLoss: $('oSL').value ? +$('oSL').value : null, takeProfit: $('oTP').value ? +$('oTP').value : null,
      note: S.signal ? `signal ${S.signal.action} ${S.signal.score}` : '',
    } });
    $('orderMsg').innerHTML = `<span class="pos">✓ ${side} ${pos.lots} ${pos.symbol} @ ${fmt(pos.entry)}</span>`;
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
  if ((name === 'backtest' || name === 'scanner') && document.querySelector('.tab-body').offsetHeight < 330) setPanelH(380);
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
  S.symbol = s; store('novi-fx-sym', s); S.orderZone = null; S.dayOpen = null;
  $('symName').textContent = s; $('aiOut').textContent = ''; $('oSL').value = ''; $('oTP').value = ''; $('calcOut').textContent = '';
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
  setInterval(loop, 3_000);
})();
