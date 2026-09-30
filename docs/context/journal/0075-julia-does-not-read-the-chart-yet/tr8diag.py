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

Gd={g["spec"]:set(g["gold"]) for g in json.load(open(S+"/dom/gold.json"))["specs"] if g["gold"]}
cases=[s for s in Q if len(set(Bm[s][:2])&Gd[s])==1]  # exactly one of the two is gold
print("decidable pairs",len(cases))
for order in ("bm25 order","swapped"):
    rows=[];nulls=[]
    for s in cases:
        c=Bm[s][:2] if order=="bm25 order" else Bm[s][:2][::-1]
        rows.append(row(f"Work: {A[s]} Named: {title[s]}",c)); nulls.append(row("Work: N/A",c))
    lg=eng.logits(rows+nulls); n=len(cases); raw=cal=first=0
    for i,s in enumerate(cases):
        c=Bm[s][:2] if order=="bm25 order" else Bm[s][:2][::-1]; x,z=lg[i],lg[n+i]
        r=c[0] if x[0]>x[1] else c[1]; k=c[0] if (x[0]-z[0])>(x[1]-z[1]) else c[1]
        raw+=r in Gd[s]; cal+=k in Gd[s]; first+=(x[0]>x[1])
    print(order,f"raw {raw}/{n} calibrated {cal}/{n} picks-first-option {first}/{n}")
