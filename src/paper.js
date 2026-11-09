// Paper (demo) trading account, saved to data/paper.json.
// Positions are checked against live prices: SL/TP hit => auto close.

const fs = require('fs');
const path = require('path');
const { INSTRUMENTS, toUSD } = require('./instruments');

const FILE = path.join(__dirname, '..', 'data', 'paper.json');
const START_BALANCE = 10000;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { balance: START_BALANCE, positions: [], history: [], nextId: 1 }; }
}
function save(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

function pnlUSD(pos, price) {
  const inst = INSTRUMENTS[pos.symbol];
  const dir = pos.side === 'BUY' ? 1 : -1;
  const quote = (price - pos.entry) * dir * pos.lots * inst.contractSize;
  return toUSD(pos.symbol, quote, price);
}

function open({ symbol, side, lots, stopLoss, takeProfit, price, note }) {
  if (!INSTRUMENTS[symbol]) throw new Error('Unknown symbol');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('side must be BUY or SELL');
  lots = +lots;
  if (!(lots > 0)) throw new Error('lots > 0 වෙන්න ඕන');
  const dir = side === 'BUY' ? 1 : -1;
  if (stopLoss && dir * (price - stopLoss) <= 0) throw new Error(`Stop loss එක වැරදි පැත්තේ (දැන් මිල ${price})`);
  if (takeProfit && dir * (takeProfit - price) <= 0) throw new Error(`Take profit එක වැරදි පැත්තේ (දැන් මිල ${price})`);
  const s = load();
  const pos = {
    id: s.nextId++, symbol, side, lots, entry: price,
    stopLoss: stopLoss ? +stopLoss : null, takeProfit: takeProfit ? +takeProfit : null,
    openedAt: Date.now(), note: note || '',
  };
  s.positions.push(pos);
  save(s);
  return pos;
}

function closePos(s, pos, price, reason) {
  const pnl = +pnlUSD(pos, price).toFixed(2);
  s.balance = +(s.balance + pnl).toFixed(2);
  s.positions = s.positions.filter((p) => p.id !== pos.id);
  s.history.unshift({ ...pos, exit: price, closedAt: Date.now(), pnl, reason });
  s.history = s.history.slice(0, 500);
}

function close(id, price) {
  const s = load();
  const pos = s.positions.find((p) => p.id === +id);
  if (!pos) throw new Error('Position එක හම්බුනේ නැහැ');
  closePos(s, pos, price, 'MANUAL');
  save(s);
}

// prices: { SYMBOL: lastPrice }
function mark(prices) {
  const s = load();
  let changed = false;
  for (const pos of [...s.positions]) {
    const p = prices[pos.symbol];
    if (p == null) continue;
    const dir = pos.side === 'BUY' ? 1 : -1;
    if (pos.stopLoss != null && dir * (p - pos.stopLoss) <= 0) { closePos(s, pos, pos.stopLoss, 'SL'); changed = true; }
    else if (pos.takeProfit != null && dir * (p - pos.takeProfit) >= 0) { closePos(s, pos, pos.takeProfit, 'TP'); changed = true; }
  }
  if (changed) save(s);
  const positions = s.positions.map((pos) => ({ ...pos, price: prices[pos.symbol] ?? null, pnl: prices[pos.symbol] != null ? +pnlUSD(pos, prices[pos.symbol]).toFixed(2) : null }));
  const floating = positions.reduce((a, p) => a + (p.pnl || 0), 0);
  const closed = s.history.length;
  const wins = s.history.filter((h) => h.pnl > 0).length;
  return {
    balance: s.balance,
    equity: +(s.balance + floating).toFixed(2),
    floating: +floating.toFixed(2),
    positions,
    history: s.history.slice(0, 100),
    stats: { closed, wins, winRate: closed ? +((wins / closed) * 100).toFixed(1) : 0, totalPnl: +(s.balance - START_BALANCE).toFixed(2) },
  };
}

function reset() { save({ balance: START_BALANCE, positions: [], history: [], nextId: 1 }); }
function symbolsOpen() { return [...new Set(load().positions.map((p) => p.symbol))]; }

module.exports = { open, close, mark, reset, symbolsOpen };
