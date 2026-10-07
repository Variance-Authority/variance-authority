import json,sys
W={"PRIMARY":1.0,"SUPPLIER":0.3,"CONSUMER":0.15,"CONSEQUENCE":0.05,"UNRELATED":0}
for f in sys.argv[1:]:
    d=json.load(open(f)); o=d["out"]; G={s:set(v) for s,v in d["gold"].items()}; cs=list(o)
    def m(ps,k): return sum(p[k] for p in ps)/len(ps)
    fs={"P(primary)":lambda r:m(r["choice"],"PRIMARY"),
        "EU":lambda r:sum(W[k]*m(r["choice"],k) for k in W),
        "noul require":lambda r:r["noul"][0],"noul impossible":lambda r:r["noul"][3],
        "noul mean(0,1,3)":lambda r:(r["noul"][0]+r["noul"][1]+r["noul"][3])/3}
    bm=sum(d["bm"][s][0] in G[s] for s in cs)
    print(f"{f}: n={len(cs)} bm25 top1 {bm}")
    for name,fn in fs.items():
        pick=sum(max(d["bm"][s],key=lambda b:fn(o[s][b])) in G[s] for s in cs)
        gate=sum((d["bm"][s][1] if fn(o[s][d["bm"][s][1]])-fn(o[s][d["bm"][s][0]])>=0.05 else d["bm"][s][0]) in G[s] for s in cs)
        print(f"  {name:18} pick {pick}/{len(cs)}  margin-gated {gate}/{len(cs)}")
    agg={k:0 for k in W}
    for s in cs:
        for b in o[s]:
            for k in W: agg[k]+=m(o[s][b]["choice"],k)
    n=sum(len(o[s]) for s in cs); print("  mean probs:",{k:round(v/n,2) for k,v in agg.items()})
    nr=[s for s in cs if "reach" not in G[s]]
    print(f"  non-reach-gold subset n={len(nr)}: bm25 {sum(d['bm'][s][0] in G[s] for s in nr)}, reach-rule {sum(('reach' if 'reach' in d['bm'][s] else d['bm'][s][0]) in G[s] for s in nr)}",
          {name:sum(max(d["bm"][s],key=lambda b:fn(o[s][b])) in G[s] for s in nr) for name,fn in fs.items()})
