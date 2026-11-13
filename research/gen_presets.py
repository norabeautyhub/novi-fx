import json
R = json.load(open('verify_results.json'))
NAMES = {'XAGUSD':'Silver','GBPUSD':'GBPUSD','AUDUSD':'AUDUSD','USDJPY':'USDJPY','USDCAD':'USDCAD','USDCHF':'USDCHF','GBPJPY':'GBPJPY','EURJPY':'EURJPY','NZDUSD':'NZDUSD','EURGBP':'EURGBP'}
def js(v):
    if isinstance(v, list) and v == list(range(7,17)): return 'LONDON_NY'
    if v is None: return 'null'
    if isinstance(v, str): return f"'{v}'"
    return str(v)
lines = []
for p, tfs in R.items():
    for tf, t in tfs.items():
        f = t['full'] or {}; wf = t['wf']
        def num(x):
            try: return float(str(x).replace('np.float64(','').rstrip(')'))
            except: return 0
        params = ', '.join(f"{k}: {js(v)}" for k, v in t['params'].items())
        tp = t['exits']['tp_r']
        wfn, wfpf = num(wf['net']), num(wf['pf'])
        res = f"research: {{ data: '{NAMES[p]} 2015–2018', trades: {int(num(f.get('n')))}, winRate: {round(num(f.get('wr')))}, pf: {num(f.get('pf'))}, netR: {round(num(f.get('net')))}, posYears: '{t['pos']}/4', walkForward: {{ netR: {round(wfn,1)}, pf: {wfpf} }} }}"
        note = ''
        if t['status'] == 'weak':
            note = f"\n    note: 'Edge එක දුර්වලයි (නොදැකපු අවුරුදු වල PF {wfpf}) — lot එක අඩු කරන්න / ප්‍රවේශමෙන්.',"
        elif t['status'] == 'disabled':
            note = f"\n    note: '{NAMES[p]} {tf} — නොදැකපු අවුරුදු වල පාඩුයි ({wfn:+.1f}R) — signals off.',"
        lines.append(f"  '{p}|{tf}': {{\n    status: '{t['status']}', strategy: '{t['strategy']}',\n    params: {{ {params} }}, exits: {{ tpR: {tp} }},\n    {res},{note}\n  }},")
open('presets_new.js','w').write('\n'.join(lines)+'\n')
