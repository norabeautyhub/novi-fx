"""Train final ML models on ALL research data and export them as JSON for the app (JS inference)."""
import json, numpy as np, torch, lightgbm as lgb
import ml
from ml_features import build, labels
torch.manual_seed(7); np.random.seed(7)

def export_mlp(model):
    L = [m for m in model.n if isinstance(m, torch.nn.Linear)]
    return [{'W': l.weight.detach().numpy().round(6).tolist(), 'b': l.bias.detach().numpy().round(6).tolist()} for l in L]

def export_lstm(model):
    sd = {k: v.detach().numpy().round(6).tolist() for k, v in model.state_dict().items()}
    return {'Wih': sd['l.weight_ih_l0'], 'Whh': sd['l.weight_hh_l0'], 'bih': sd['l.bias_ih_l0'], 'bhh': sd['l.bias_hh_l0'], 'Wo': sd['h.weight'][0], 'bo': sd['h.bias'][0]}

out = {}
for pair in ['XAUUSD', 'EURUSD']:
    C = ml.CFG[pair]
    df, F, X = build(pair, C['years'], '1h')
    F['spread'] = np.maximum(F['spread'], C['floor'])
    yl, ys, *_ = labels(F, 1.5, 1.0, ml.H, 1.2)
    cols = list(X.columns); Xv = X.values.astype(np.float64)
    ok = ~np.isnan(Xv).any(1) & ~np.isnan(yl) & ~np.isnan(ys); ok[:ml.SEQ_LEN + 250] = False
    idx = np.where(ok)[0]
    cut = int(len(idx) * 0.85); tr, va = idx[:cut - ml.H], idx[cut:]
    mu, sd = Xv[tr].mean(0), Xv[tr].std(0) + 1e-9
    Xn = np.nan_to_num((Xv - mu) / sd)
    sf = [cols.index(f) for f in ml.SEQ_FEATS]
    M = {'cols': cols, 'mu': mu.round(8).tolist(), 'sd': sd.round(8).tolist(), 'seqFeats': ml.SEQ_FEATS, 'seqLen': ml.SEQ_LEN,
         'trainedOn': f"{C['years'][0]}–{C['years'][-1]}", 'models': {}, 'median': {}}
    for side, y in (('long', yl), ('short', ys)):
        g = lgb.LGBMClassifier(n_estimators=600, learning_rate=0.02, num_leaves=15, min_child_samples=200, subsample=0.7, subsample_freq=1,
                               colsample_bytree=0.7, reg_lambda=5, verbose=-1)
        g.fit(Xv[tr], y[tr], eval_set=[(Xv[va], y[va])], callbacks=[lgb.early_stopping(50, verbose=False)])
        dump = g.booster_.dump_model(num_iteration=g.best_iteration_ or None)
        trees = dump['tree_info']
        mlp = ml.fit_torch(ml.MLP(len(cols)), Xn[tr], y[tr], Xn[va], y[va])
        # re-create to export: fit_torch returns predict fn; grab the model via closure
        net = [c.cell_contents for c in mlp.__closure__ if isinstance(c.cell_contents, torch.nn.Module)][0]
        S = Xn[:, sf]
        lpred = ml.fit_torch(ml.LSTM(len(sf)), ml.seqs(S, tr), y[tr], ml.seqs(S, va), y[va], epochs=12, bs=512)
        lnet = [c.cell_contents for c in lpred.__closure__ if isinstance(c.cell_contents, torch.nn.Module)][0]
        M['models'][side] = {'lgb': {'trees': trees, 'init': 0}, 'mlp': export_mlp(net), 'lstm': export_lstm(lnet)}
        # validation probabilities → median (filter threshold) + sample predictions for parity tests
        pv = {'lgb': g.predict_proba(Xv[va], num_iteration=g.best_iteration_ or None)[:, 1], 'mlp': mlp(Xn[va]), 'lstm': lpred(ml.seqs(S, va))}
        pv['ens'] = (pv['lgb'] + pv['mlp'] + pv['lstm']) / 3
        M['median'][side] = {k: float(np.median(v)) for k, v in pv.items()}
        acc = {k: float(((v > 0.5) == (y[va] > 0.5)).mean()) for k, v in pv.items()}
        M.setdefault('valAcc', {})[side] = acc
        # parity samples: last 5 valid indices
        test_idx = idx[-5:]
        M.setdefault('parity', {})[side] = {
            'times': [int(df.index[i].timestamp()) for i in test_idx],
            'lgb': g.predict_proba(Xv[test_idx], num_iteration=g.best_iteration_ or None)[:, 1].tolist(),
            'mlp': mlp(Xn[test_idx]).tolist(), 'lstm': lpred(ml.seqs(S, test_idx)).tolist(),
            'X': Xv[test_idx].tolist(),
        }
        print(pair, side, 'trees', len(trees), 'acc', {k: round(v, 3) for k, v in acc.items()}, flush=True)
    out[pair] = M
    # candles for JS parity test
    json.dump([dict(time=int(t.timestamp()), open=o, high=h, low=l, close=c) for t, o, h, l, c in zip(df.index, df.open, df.high, df.low, df.close)][-3000:],
              open(f'/tmp/candles_{pair}.json', 'w'))
json.dump(out, open('/home/claude/novi-fx/src/ml-models.json', 'w'), separators=(',', ':'))
import os; print('size MB', os.path.getsize('/home/claude/novi-fx/src/ml-models.json') / 1e6)
