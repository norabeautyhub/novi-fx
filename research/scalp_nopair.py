import numpy as np, pandas as pd, lightgbm as lgb, scalp_ml as S
cfg=S.CFG[1]; D=S.build(cfg)
feats=[c for c in D.columns if c not in ('y','exitk','year','i','pair')]
P_all=[]
for ty in S.YEARS[1:]:
    tr=D[D.year<ty]; te=D[D.year==ty].copy()
    m=lgb.LGBMRegressor(n_estimators=300,learning_rate=0.03,num_leaves=31,min_child_samples=500,subsample=0.7,subsample_freq=1,colsample_bytree=0.7,verbose=-1)
    m.fit(tr[feats],tr.y.clip(-1.5,3)); te['pred']=m.predict(te[feats]); P_all.append(te)
P=pd.concat(P_all).reset_index(drop=True)
for thr in [0.1,0.15,0.2,0.25]:
    a=S.simulate_pick(P,thr); by={int(y):round(float(S.simulate_pick(P[P.year==y],thr).sum()),1) for y in S.YEARS[1:]}
    print(thr,S.stats(a,780),by)
pp={S.PAIRS[p]:S.stats(S.simulate_pick(P[P.pair==p],0.15),780) for p in range(12)}
print({k:(v.get('n'),v.get('wr'),v.get('pf'),v.get('net')) for k,v in pp.items()})
