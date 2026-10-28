import os,re,json,random
S=os.environ["S"]; src=open(S+"/dom/tr3.py").read(); exec(src[:src.index("R={}")])
NULLS=["N/A",".","[task]"]
def opt_bias(opt):
    rows,meta=[],[]
    for n in NULLS:
        for p in perms: rows.append({"state":f"Work: {n}","question":Qn,"type":"choice","options":[opt(b) for b in p]+[NONE]}); meta.append(p)
    lg=eng.logits(rows); bias={b:0.0 for b in B}
    for p,x in zip(meta,lg):
        for b,v in zip(p,x[:-1]): bias[b]+=float(v-x[-1])
    return bias
def runc(QQ,opt,bias):
    rows,meta=[],[]
    for s,q in QQ.items():
        st=f"Work: {fit(re.sub(r'\s+',' ',q),300)}"
        for p in perms: rows.append({"state":st,"question":Qn,"type":"choice","options":[opt(b) for b in p]+[NONE]}); meta.append((s,p))
    lg=eng.logits(rows); sc={s:{b:0.0 for b in B} for s in QQ}
    for (s,p),x in zip(meta,lg):
        for b,v in zip(p,x[:-1]): sc[s][b]+=float(v-x[-1])
    raw={s:sorted(B,key=lambda b:-sc[s][b]) for s in QQ}
    cal={s:sorted(B,key=lambda b:-(sc[s][b]-bias[b]*len(perms)/(len(perms)*len(NULLS)))) for s in QQ}
    return raw,cal

Bm=json.load(open(S+"/dom/ranks_direct.json"))["bm25 all READMEs (max)"]
title={s:next((l for l in open("docs/specs/"+s).read().splitlines() if l.startswith("# ")),"").lstrip("# ") for s in Q}
def sents(t): return [x.strip() for x in re.split(r"(?<=[.;])\s+",re.sub(r"\s+"," ",re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",clean(t)))) if len(x.split())>4]
def reason(q,b):
    qt=tok(q); best=max((p for p in allr if blk(p)==b),key=lambda p:b96.score(qt,p)); qs=set(qt)
    return fit(max(sents(allr[best]) or [""],key=lambda x:sum(b96.idf(w) for w in set(tok(x))&qs)),40)
def row(st,cands): return {"state":st,"question":Qn,"type":"choice","options":[PL[b] for b in cands]+[NONE]}

import random,time,mlx.core as mx,mlx.nn as nn,mlx.optimizers as optim
from julia_mlx.encoding import sequence,collate_encoded
Gd={g["spec"]:set(g["gold"]) for g in json.load(open(S+"/dom/gold.json"))["specs"] if g["gold"]}
paths=[p for p in allr if blk(p) in B]; rv=random.Random(11); VAL=set(rv.sample(paths,10))
def units(ps,rng):
    out=[]
    for p in ps:
        ss=sents(allr[p]); b=blk(p)
        out+=[(x,b) for x in ss]
        for j in range(0,len(ss),3):
            n=rng.randint(3,6); w=ss[j:j+n]
            if len(w)>=3: out.append((" ".join(w),b))
    return out
tk=eng.tokenizer; model=eng.model
def mk(text,b,rng,drop=0.15):
    p=rng.sample(B,len(B))
    if rng.random()<drop: p=[x for x in p if x!=b]; pos=[len(p)]
    else: pos=[p.index(b)]
    return {"state":"Work: "+fit(text,350),"question":Qn,"type":"choice","options":[PL[x] for x in p]+[NONE]},pos
def rank(texts):
    model.eval(); rows,meta=[],[]
    for k,w in texts.items():
        for p in perms: rows.append({"state":"Work: "+w,"question":Qn,"type":"choice","options":[PL[b] for b in p]+[NONE]}); meta.append((k,p))
    lg=eng.logits(rows); sc={k:{b:0.0 for b in B} for k in texts}
    for (k,p),x in zip(meta,lg):
        for b,v in zip(p,x[:-1]): sc[k][b]+=float(v-x[-1])
    return sc

W={s:fit(title[s]+". "+re.sub(r"\s+"," ",Q[s]),350) for s in Q}
G=Gd; cases=[s for s in Q if len(set(Bm[s][:2])&G[s])==1]
import random as _r
def mrr(r,ss): return sum(1/(1+min(r[s].index(b) for b in G[s])) for s in ss)/len(ss)
OUT={}
for tag,f in (("tr11","julia_chart"),("tr12","julia_chartq")):
    model.load_weights(S+f"/dom/{f}.safetensors"); sc=rank(W)
    mu={b:sum(sc[s][b] for s in Q)/len(Q) for b in B}; c=lambda s,b: sc[s][b]-mu[b]
    A={s:sorted(B,key=lambda b:-c(s,b)) for s in Q}; F={s:sorted(Bm[s][:2],key=lambda b:-c(s,b))+Bm[s][2:] for s in Q}
    OUT[f"{tag} centered alone"]=A; OUT[f"{tag} centered top2"]=F
    wr=[s for s in cases if "reach" in Bm[s][:2]]; nr=[s for s in cases if s not in wr]
    print(tag,"pairs",sum(F[s][0] in G[s] for s in cases),"/",len(cases),"| with reach",sum(F[s][0] in G[s] for s in wr),"/",len(wr),"| without",sum(F[s][0] in G[s] for s in nr),"/",len(nr),flush=True)
    from collections import Counter; print(" alone top1",Counter(A[s][0] for s in Q).most_common(4),flush=True)
json.dump(OUT,open(S+"/dom/ranks_tr13.json","w"))
