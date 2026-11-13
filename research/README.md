# Strategy research (Python)

Novi FX signals වල strategies සහ settings තෝරගත්තේ මේ scripts වලින්.

- `fetch.sh` + `agg.py` — GitHub `FX-Data` repos වලින් ඇත්ත tick data download කරලා 15m candles හදනවා (spread එකත් එක්ක)
- `engine.py` — indicators, strategies (baseline, pullback, breakout, meanrev), costs එක්ක trade simulator
- `research.py` — settings 550+ grid search + walk-forward (පරණ අවුරුදු වලින් තෝරලා ඊළඟ අවුරුද්දේ test)

Data: Gold 2014–2018 (4.5 yrs), EURUSD 2017–2021 (5 yrs). Costs: gold ≥ $0.35, EURUSD ≥ 1.2 pips (×1.2).

```bash
pip install pandas numpy
./fetch.sh XAUUSD 100 2014 2015 2016 2017 2018
./fetch.sh EURUSD 1 2017 2018 2019 2020 2021
python3 research.py 1h,4h
```

App එකේ JS strategy code එක (`src/strategy.js`) මේ Python engine එකටම 100% match වෙනවා (trades ගණන සහ R ප්‍රතිඵල එකමයි).

## 10 more markets (2015–2018) — `verify_markets.py`
Data: `fetch_many.sh PAIR...` (tick → 15m), `rescale.py` for XAG/JPY files (×100).
Grid: pullback 48 + breakout 64 settings × 1h/4h, spread floor, costs ×1.2.
Verified = walk-forward (unseen years) net > 0 & PF ≥ 1.2, final PF ≥ 1.2, 30+ trades, ≥ 3/4 years profitable.

| Market | 1h | 4h |
|---|---|---|
| USDCAD | disabled | ✅ verified (breakout, WF +9.8R PF 1.28) |
| NZDUSD | weak | ✅ verified (pullback, WF +7.9R PF 1.21) |
| EURGBP | ✅ verified (pullback, WF +23.3R PF 1.47) | weak |
| XAGUSD | weak | disabled |
| GBPUSD | weak | disabled |
| USDCHF | disabled | weak |
| EURJPY | disabled | weak |
| AUDUSD, USDJPY, GBPJPY | disabled | disabled |
Results: `verify_results.json`. Presets generated with `gen_presets.py`.
