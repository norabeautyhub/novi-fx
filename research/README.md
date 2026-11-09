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
