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

// mode: normal | breakeven (SL → entry at 1R) | highwin (limit entry, 50% close at 1R + SL → entry)
function open({ symbol, side, lots, stopLoss, takeProfit, price, note, mode, limitPrice, expiresAt }) {
  if (!INSTRUMENTS[symbol]) throw new Error('Unknown symbol');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('side must be BUY or SELL');
  lots = +lots;
  if (!(lots > 0)) throw new Error('lots > 0 වෙන්න ඕන');
  const dir = side === 'BUY' ? 1 : -1;
  mode = ['breakeven', 'highwin'].includes(mode) ? mode : 'normal';
  const pending = mode === 'highwin' && limitPrice > 0 && dir * (price - limitPrice) > 0; // price not yet at the limit
  const ref = pending ? +limitPrice : mode === 'highwin' && limitPrice > 0 ? +limitPrice : price;
  if (stopLoss && dir * (ref - stopLoss) <= 0) throw new Error(`Stop loss එක වැරදි පැත්තේ (entry ${ref})`);
  if (takeProfit && dir * (takeProfit - ref) <= 0) throw new Error(`Take profit එක වැරදි පැත්තේ (entry ${ref})`);
  if (mode !== 'normal' && !stopLoss) throw new Error('Breakeven / High Win mode වලට Stop Loss එක ඕන');
  const s = load();
  const pos = {
    id: s.nextId++, symbol, side, lots, entry: pending ? +limitPrice : price, mode,
    stopLoss: stopLoss ? +stopLoss : null, takeProfit: takeProfit ? +takeProfit : null,
    openedAt: Date.now(), note: note || '', events: [],
  };
  if (pending) { pos.pending = true; pos.expiresAt = expiresAt ? expiresAt * 1000 : Date.now() + 4 * 3600e3; }
  if (pos.stopLoss) pos.r1 = pos.entry + dir * Math.abs(pos.entry - pos.stopLoss);
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
    const dir = pos.side === 'BUY' ? 1 : -1;
    if (pos.pending) {
      if (Date.now() > pos.expiresAt) {
        s.positions = s.positions.filter((x) => x.id !== pos.id);
        s.history.unshift({ ...pos, exit: null, closedAt: Date.now(), pnl: 0, reason: 'NOT FILLED' });
        changed = true; continue;
      }
      if (p != null && dir * (p - pos.entry) <= 0) { pos.pending = false; pos.filledAt = Date.now(); pos.events.push('Limit fill වුණා'); changed = true; }
      continue;
    }
    if (p == null) continue;
    if (pos.stopLoss != null && dir * (p - pos.stopLoss) <= 0) { closePos(s, pos, pos.stopLoss, pos.beDone ? (pos.partialDone ? 'PART+BE' : 'BE') : 'SL'); changed = true; continue; }
    if (pos.takeProfit != null && dir * (p - pos.takeProfit) >= 0) { closePos(s, pos, pos.takeProfit, 'TP'); changed = true; continue; }
    // 1R reached → trade management
    if (pos.r1 && !pos.beDone && pos.mode !== 'normal' && dir * (p - pos.r1) >= 0) {
      const risk = Math.abs(pos.r1 - pos.entry);
      if (pos.mode === 'highwin' && !pos.partialDone) {
        const half = +(pos.lots / 2).toFixed(3);
        const partPos = { ...pos, lots: half };
        const pnl = +pnlUSD(partPos, pos.r1).toFixed(2);
        s.balance = +(s.balance + pnl).toFixed(2);
        s.history.unshift({ ...partPos, exit: pos.r1, closedAt: Date.now(), pnl, reason: 'PARTIAL 50% @1R' });
        pos.lots = +(pos.lots - half).toFixed(3);
        pos.partialDone = true;
        pos.events.push(`1R: 50% close (+$${pnl})`);
      }
      pos.stopLoss = +(pos.entry + dir * 0.05 * risk).toFixed(6);
      pos.beDone = true;
      pos.events.push('SL → entry (breakeven)');
      changed = true;
    }
  }
  if (changed) save(s);
  const positions = s.positions.map((pos) => ({ ...pos, price: prices[pos.symbol] ?? null, pnl: !pos.pending && prices[pos.symbol] != null ? +pnlUSD(pos, prices[pos.symbol]).toFixed(2) : null }));
  const floating = positions.reduce((a, p) => a + (p.pnl || 0), 0);
  const trades = s.history.filter((h) => !String(h.reason).startsWith('PARTIAL') && h.reason !== 'NOT FILLED');
  const closed = trades.length;
  const wins = trades.filter((h) => h.pnl > 0 || String(h.reason) === 'PART+BE').length;
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
