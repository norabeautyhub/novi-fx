import json, numpy as np, pandas as pd, lightgbm as lgb, scalp_ml as S
cfg=S.CFG[1]; D=S.build(cfg)
feats=[c for c in D.columns if c not in ('y','exitk','year','i')]
# WF predictions (same as research) to get the selection rate at thr .15
P_all=[]
for ty in S.YEARS[1:]:
    tr=D[D.year<ty]; te=D[D.year==ty].copy()
    m=lgb.LGBMRegressor(n_estimators=300,learning_rate=0.03,num_leaves=31,min_child_samples=500,subsample=0.7,subsample_freq=1,colsample_bytree=0.7,verbose=-1)
    m.fit(tr[feats],tr.y.clip(-1.5,3)); te['pred']=m.predict(te[feats]); P_all.append(te)
P=pd.concat(P_all)
best=P.groupby(['pair','year','i'])['pred'].max()
for thr in (0.10,0.15,0.2): print('WF rate >',thr, (best>thr).mean())
final=lgb.LGBMRegressor(n_estimators=300,learning_rate=0.03,num_leaves=31,min_child_samples=500,subsample=0.7,subsample_freq=1,colsample_bytree=0.7,verbose=-1,random_state=1)
final.fit(D[feats],D.y.clip(-1.5,3)); D['pred']=final.predict(D[feats])
fb=D.groupby(['pair','year','i'])['pred'].max()
for thr in (0.10,0.15,0.2): print('final rate >',thr,(fb>thr).mean())
for q in (0.10,0.15,0.2):
    r=(best>q).mean(); print('thr',q,'-> final equivalent', np.quantile(fb,1-r))
print(fb.groupby(level=[0,1]).apply(lambda x:(x>0.15).mean()).unstack().round(4))
