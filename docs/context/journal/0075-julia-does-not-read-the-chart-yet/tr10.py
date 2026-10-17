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
def sec(b,h):
    x=open(f"{R}/{b}/README.md").read(); m=re.search(rf"^## {h}\n(.*?)(?=^## )",x,re.S|re.M)
    return re.sub(r"\s+"," ",re.sub(r"\*\*","",re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",m.group(1)))).strip()
CTX={b:fit(f"Part {b}. Does: {sec(b,'Responsibility')} Does not: {sec(b,'Boundary')}",380) for b in B}
QQ="Does this part own this work, given what it does and does not do?"
def own(b,w): return {"state":CTX[b]+" Work: "+w,"question":QQ,"type":"choice","options":["Yes.","No."]}
W={s:fit(title[s]+". "+re.sub(r"\s+"," ",Q[s]),350) for s in Q}
rows,meta=[],[]
for b in B: rows.append(own(b,"N/A")); meta.append((None,b))
for s in Q:
    for b in B: rows.append(own(b,W[s])); meta.append((s,b))
lg=eng.logits(rows); z={};sc={}
for (s,b),x in zip(meta,lg):
    v=float(x[0]-x[1])
    if s is None: z[b]=v
    else: sc[(s,b)]=v
c=lambda s,b: sc[(s,b)]-z[b]
OUT={"julia own alone":{s:sorted(B,key=lambda b:-c(s,b)) for s in Q},"julia own alone raw":{s:sorted(B,key=lambda b:-sc[(s,b)]) for s in Q}}
for k in (2,3): OUT[f"bm25 top{k} -> julia own"]={s:sorted(Bm[s][:k],key=lambda b:-c(s,b))+Bm[s][k:] for s in Q}
cases=[s for s in Q if len(set(Bm[s][:2])&Gd[s])==1]
print("pairs",len(cases),"julia",sum(max(Bm[s][:2],key=lambda b:c(s,b)) in Gd[s] for s in cases),"raw",sum(max(Bm[s][:2],key=lambda b:sc[(s,b)]) in Gd[s] for s in cases),"bm25",sum(Bm[s][0] in Gd[s] for s in cases))
json.dump(OUT,open(S+"/dom/ranks_tr10.json","w"))
