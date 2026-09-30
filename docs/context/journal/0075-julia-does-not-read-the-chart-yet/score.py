import json,random,os
S=os.environ["S"]; G={g["spec"]:set(g["gold"]) for g in json.load(open(S+"/dom/gold.json"))["specs"] if g["gold"]}
R={**json.load(open(S+"/dom/ranks_direct.json")),**json.load(open(S+"/dom/ranks_julia.json")),**json.load(open(S+"/dom/ranks_julia_dom.json"))}
def per(r): return {s:(1/(1+min(r[s].index(b) for b in g))) for s,g in G.items()}
ref="bm25 top READMEs"; P={k:per(v) for k,v in R.items()}
for k,p in P.items():
    v=list(p.values()); h=sum(x==1 for x in v)/len(v); m=sum(v)/len(v)
    d=[p[s]-P[ref][s] for s in G]; rng=random.Random(0)
    bs=sorted(sum(rng.choice(d) for _ in d)/len(d) for _ in range(2000))
    print(f"{k:34} hit@1 {h:.3f} mrr {m:.3f}  Δmrr vs bm25 {sum(d)/len(d):+.3f} [{bs[50]:+.3f},{bs[1949]:+.3f}]")
