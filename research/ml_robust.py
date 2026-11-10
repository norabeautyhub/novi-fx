import numpy as np, torch, ml
from engine import STRATS, simulate, stats
out=[]
for seed in [1,2,3,4,5]:
    torch.manual_seed(seed); np.random.seed(seed)
    res, filt = ml.run('XAUUSD', 1.0)
    row={m: (len(np.concatenate([x['r'] for x in filt[m]])), round(float(np.concatenate([x['r'] for x in filt[m]]).sum()),1), round(100*float((np.concatenate([x['r'] for x in filt[m]])>0).mean()),1)) for m in filt}
    print('SEED',seed,row,flush=True); out.append(row)
# random filter baseline: strategy trades in test years, keep random subsets of same size as mlp filter (~30 of 46)
from ml_features import build
C=ml.CFG['XAUUSD']; df,F,X=build('XAUUSD',C['years'],'1h'); F['spread']=np.maximum(F['spread'],C['floor'])
s,sp,mp=C['strat']; sig,sl=STRATS[s](F,sp); yrs=df.index.year.values
sig=np.where(np.isin(yrs,C['tests']),sig,0); idx=np.where(sig!=0)[0]
rng=np.random.default_rng(0); nets=[]; wrs=[]
for k in range(2000):
    keep=rng.choice(idx, size=int(len(idx)*0.65), replace=False); s2=np.zeros_like(sig); s2[keep]=sig[keep]
    r,_=simulate(F,s2,sl,cost_mult=1.2,**mp); nets.append(r.sum()); wrs.append((r>0).mean()*100)
nets=np.array(nets); wrs=np.array(wrs)
print('RANDOM filter (keep 65%): net mean %.1f, 95th pct %.1f, P(net>=19)=%.3f; winrate mean %.1f, 95th %.1f, P(wr>=43)=%.3f'%(nets.mean(),np.percentile(nets,95),(nets>=19).mean(),wrs.mean(),np.percentile(wrs,95),(wrs>=43).mean()))
