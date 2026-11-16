import json, numpy as np, pandas as pd, lightgbm as lgb, scalp_ml as S
from engine import load
cfg=S.CFG[1]; D=S.build(cfg)
feats=[c for c in D.columns if c not in ('y','exitk','year','i')]
m=lgb.LGBMRegressor(n_estimators=300,learning_rate=0.03,num_leaves=31,min_child_samples=500,subsample=0.7,subsample_freq=1,colsample_bytree=0.7,verbose=-1,random_state=1)
m.fit(D[feats],D.y.clip(-1.5,3))
dump=m.booster_.dump_model()
imp=sorted(zip(m.booster_.feature_importance('gain'),feats),reverse=True)[:8]
print('top features',[(f,round(g)) for g,f in imp])
# parity sample: last 1200 15m bars of XAUUSD 2018, python features+pred for both dirs at last 50 bars
df=load('XAUUSD',[2018],'15m').iloc[-1200:]
X,a=S.features(df)
rows=[]
for d in (1,-1):
    Z=X.copy(); Z['dir']=d; Z['pair']=0
    for col in ['d20','d50','d200','tr1h','s20','macd','r1','r4','r16','r96','body','bbz','di']: Z[col]=Z[col]*d
    Z['rsi_d']=np.where(d>0,Z['rsi'],100-Z['rsi']); Z['rsi7_d']=np.where(d>0,Z['rsi7'],100-Z['rsi7'])
    Z['hi_d']=np.where(d>0,Z['hi20'],Z['lo20']); Z['lo_d']=np.where(d>0,Z['lo20'],Z['hi20'])
    Z=Z.drop(columns=['rsi','rsi7','hi20','lo20'])[feats]
    p=m.predict(Z.iloc[-50:])
    rows.append(dict(dir=d,X=Z.iloc[-50:].values.tolist(),pred=p.tolist()))
cand=[dict(time=int(t.timestamp()),open=o,high=h,low=l,close=c) for t,o,h,l,c in zip(df.index,df.open,df.high,df.low,df.close)]
M=dict(trainedOn='15m candles 2015–2018, 12 markets', cfg=cfg, feats=feats, pairs=S.PAIRS, threshold=0.15,
  research=dict(walkForward='2016–2018 (unseen years)', thr={'0.10':dict(n=1420,wr=48.7,pf=1.01,net=10.2,perDay=1.8),'0.15':dict(n=766,wr=53.1,pf=1.22,net=92.4,perDay=1.0,years={'2016':75.8,'2017':14.4,'2018':2.2}),'0.20':dict(n=402,wr=55.0,pf=1.31,net=66.0,perDay=0.5),'0.30':dict(n=88,wr=59.1,pf=1.52,net=22.5,perDay=0.1)}, untrained=dict(n=5049,wr=45.1,pf=0.89)),
  trees=dump['tree_info'])
json.dump(M,open('/home/claude/novi-fx/src/scalp-model.json','w'))
json.dump(dict(candles=cand,spread=float(np.maximum(df.spread.values,S.FLOOR['XAUUSD'])[-1]),spreads=np.maximum(df.spread.values,S.FLOOR['XAUUSD']).tolist(),rows=rows,feats=feats),open('/tmp/scalp_parity.json','w'))
print('trees',len(dump['tree_info']))
