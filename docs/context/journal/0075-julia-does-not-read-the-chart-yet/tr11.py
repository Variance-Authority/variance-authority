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
vu=units(sorted(VAL),random.Random(0)); VT={i:fit(t,350) for i,(t,_) in enumerate(vu)}
def vmrr():
    sc=rank(VT); return sum(1/(1+sorted(B,key=lambda b:-sc[i][b]).index(vu[i][1])) for i in VT)/len(VT)
def loss_fn(model,batch,pos):
    s=model(**batch); return mx.mean(mx.logsumexp(s,axis=-1)-mx.logsumexp(mx.where(pos,s,-1e4),axis=-1))
vg=nn.value_and_grad(model,loss_fn); BS=16; EP=3
tr=[p for p in paths if p not in VAL]; n0=len(units(tr,random.Random(0)))
steps=EP*(n0//BS); sched=optim.join_schedules([optim.linear_schedule(1e-7,3e-5,50),optim.cosine_decay(3e-5,max(1,steps-50),1.5e-6)],[50])
opt=optim.AdamW(learning_rate=sched,weight_decay=0.01)
print("train units",n0,"val units",len(vu),"steps",steps,"val0",round(vmrr(),3),flush=True)
best=-1
for ep in range(1,EP+1):
    rng=random.Random(ep); ex=[mk(t,b,rng) for t,b in units(tr,rng)]; rng.shuffle(ex); model.train(); t0=time.time(); tot=n=0
    for j in range(0,len(ex)-BS+1,BS):
        ch=ex[j:j+BS]; enc=[sequence(tk,r,eng.max_length,eng.head_length,strict=True) for r,_ in ch]
        batch=collate_encoded(tk,enc,32,eng.max_length); O=batch["marker_pos"].shape[1]
        pos=mx.array([[i in p for i in range(O)] for _,p in ch]); l,g=vg(model,batch,pos)
        g,_=optim.clip_grad_norm(g,1.0); opt.update(model,g); mx.eval(model.parameters(),opt.state,l); tot+=l.item(); n+=1
        if n%50==0: print(f" ep{ep} step{n} loss {tot/n:.3f} {(time.time()-t0)/n:.2f}s/step",flush=True)
    v=vmrr(); print(f"epoch {ep} loss {tot/n:.3f} val {v:.3f}",flush=True)
    if v>best: best=v; model.save_weights(S+"/dom/julia_chart.safetensors"); bep=ep
print("selected epoch",bep,flush=True)
model.load_weights(S+"/dom/julia_chart.safetensors")
W={s:fit(title[s]+". "+re.sub(r"\s+"," ",Q[s]),350) for s in Q}; sc=rank(W)
OUT={"julia chart-trained alone":{s:sorted(B,key=lambda b:-sc[s][b]) for s in Q}}
for k in (2,3): OUT[f"bm25 top{k} -> julia chart-trained"]={s:sorted(Bm[s][:k],key=lambda b:-sc[s][b])+Bm[s][k:] for s in Q}
cases=[s for s in Q if len(set(Bm[s][:2])&Gd[s])==1]
print("pairs",len(cases),"julia",sum(max(Bm[s][:2],key=lambda b:sc[s][b]) in Gd[s] for s in cases),"bm25",sum(Bm[s][0] in Gd[s] for s in cases),flush=True)
json.dump(OUT,open(S+"/dom/ranks_tr11.json","w"))
