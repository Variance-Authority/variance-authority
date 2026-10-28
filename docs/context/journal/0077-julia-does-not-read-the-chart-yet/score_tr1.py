import json,random,os
S=os.environ["S"]; G={g["spec"]:set(g["gold"]) for g in json.load(open(S+"/dom/gold.json"))["specs"] if g["gold"]}
R={**json.load(open(S+"/dom/ranks_direct.json")),**json.load(open(S+"/dom/ranks_tr1.json"))}
def per(r): return {s:(1/(1+min(r[s].index(b) for b in g))) for s,g in G.items()}
P={k:per(v) for k,v in R.items()}; ref="bm25 all READMEs (max)"
subsets={"all":list(G),"non-reach":[s for s,g in G.items() if "reach" not in g],"single-gold":[s for s,g in G.items() if len(g)==1]}
for name,ss in subsets.items():
    print(f"\n{name} (n={len(ss)}) — Δ vs '{ref}'")
    for k in ["random","prior (leave-one-out)",ref,"bm25 plain descriptions, raw spec","bm25 plain descriptions, translated spec","J0 raw spec, name options","J1 raw spec, plain options","J2 translated spec, plain options"]:
        p=P[k]; m=sum(p[s] for s in ss)/len(ss); d=[p[s]-P[ref][s] for s in ss]; rng=random.Random(0)
        bs=sorted(sum(rng.choice(d) for _ in d)/len(d) for _ in range(2000))
        print(f"  {k:34} mrr {m:.3f}  Δ {sum(d)/len(d):+.3f} [{bs[50]:+.3f},{bs[1949]:+.3f}]")
