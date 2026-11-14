import re,glob,os,json,random,subprocess,sys,time
import mlx.core as mx, mlx.nn as nn, mlx.optimizers as optim
from julia_mlx import load_model
from julia_mlx.encoding import sequence, collate_encoded
S=os.environ["S"]; R=".compass/variance-authority"
B=sorted(d for d in os.listdir(R) if os.path.isdir(f"{R}/{d}"))
coord={k:v for k,v in json.load(open(S+"/dom/gold.json"))["coord"].items() if len(v)==1}
GP=[x for g in json.load(open(S+"/dom/gold.json"))["specs"] if g["gold"] for x in g["paths"]]
EXCL=lambda f:any(f==x or f.startswith(x.rstrip("/")+"/") for x in GP)
files=[f for f in subprocess.run(["git","ls-files"],capture_output=True,text=True).stdout.split() if re.search(r"\.(ts|tsx|mjs|js|rs)$",f) and not re.search(r"\.(test|check|measure)\.",f) and not EXCL(f)]
def owner(p):
    c=max((c for c in coord if p.startswith(c+"/") or p==c),key=len,default=None); return coord[c][0] if c else None
def unit(p):
    t=open(p,errors="ignore").read(6000)
    head=" ".join(re.findall(r"^\s*(?://|\*|/\*\*|///|//!)\s?(.*)$",t[:2500],re.M))
    head=re.sub(r"compass:\s*\S+","",head)
    ex=" ".join(re.findall(r"export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)",t)+re.findall(r"pub\s+fn\s+(\w+)",t))
    ex=re.sub(r"([a-z])([A-Z])",r"\1 \2",ex)
    s=re.sub(r"\S+/\S+"," ",head+" Names: "+ex); return s if len(s.split())>8 else None
rng=random.Random(1); per={b:[] for b in B}
for f in files:
    o=owner(f)
    if o and (u:=unit(f)): per[o].append(u)
units=[]
for b in B:
    rng.shuffle(per[b]); units+=[(u,b) for u in per[b][:150]]
for p in glob.glob(R+"/*/*/README.md")+glob.glob(R+"/*/*/*/README.md"):
    t=open(p).read(); b=os.path.relpath(p,R).split(os.sep)[0]
    sec=" ".join(re.findall(r"^## (?:Responsibility|Boundary)\n(.*?)(?=^## |\Z)",t,re.S|re.M))
    sec=re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",sec)
    if len(sec.split())>8: units.append((sec,b))
rng.shuffle(units); nv=len(units)*15//100; val,train=units[:nv],units[nv:]
print("train",len(train),"val",len(val),{b:sum(1 for _,x in train if x==b) for b in B},flush=True)
eng=load_model("zainmerchan/Julia-1-MLX",head_length=1024,max_length=1536,strict_encoding=True); tk=eng.tokenizer; model=eng.model
def fit(text,n):
    w=re.sub(r"\s+"," ",text).split()
    while len(tk.encode(" ".join(w)))>n: w=w[:-max(1,len(w)//20)]
    return " ".join(w)
Qn="Which part of the system owns this work?"; NONE="None of these parts."
PERMS=[B,B[::-1],random.Random(5).sample(B,len(B))]
def rank(texts):
    model.eval(); rows=[]
    for t in texts:
        for p in PERMS: rows.append({"state":t,"question":Qn,"type":"choice","options":p+[NONE]})
    lg=eng.logits(rows); out=[]
    for i in range(len(texts)):
        sc={b:0.0 for b in B}
        for k,p in enumerate(PERMS):
            x=lg[i*3+k]
            for b,v in zip(p,x[:-1]): sc[b]+=float(v-x[-1])
        out.append(sorted(B,key=lambda b:-sc[b]))
    return out
def mrr(rs,gold): return sum(1/(1+r.index(g)) for r,g in zip(rs,gold))/len(gold)
VT=[f"Work: {fit(u,400)}" for u,_ in val]; VG=[b for _,b in val]
def loss_fn(model,batch,pos):
    s=model(**batch); return mx.mean(mx.logsumexp(s,axis=-1)-mx.logsumexp(mx.where(pos,s,-1e4),axis=-1))
vg=nn.value_and_grad(model,loss_fn); BS=16; EP=5
steps=EP*(len(train)//BS)
sched=optim.join_schedules([optim.linear_schedule(1e-7,3e-5,30),optim.cosine_decay(3e-5,max(1,steps-30),1.5e-6)],[30])
opt=optim.AdamW(learning_rate=sched,weight_decay=0.01)
print("val mrr ep0",round(mrr(rank(VT),VG),3),flush=True); best=(-1,0)
for ep in range(1,EP+1):
    model.train(); r=random.Random(ep); ex=[]
    for u,b in train:
        p=r.sample(B,len(B))
        if r.random()<0.1: p=[x for x in p if x!=b]; pos=[len(p)]
        else: pos=[p.index(b)]
        ex.append(({"state":f"Work: {fit(u,400)}","question":Qn,"type":"choice","options":p+[NONE]},pos))
    r.shuffle(ex); t0=time.time()
    for i in range(0,len(ex)-BS+1,BS):
        ch=ex[i:i+BS]; enc=[sequence(tk,x,eng.max_length,eng.head_length,strict=True) for x,_ in ch]
        batch=collate_encoded(tk,enc,32,eng.max_length); O=batch["marker_pos"].shape[1]
        pos=mx.array([[j in p for j in range(O)] for _,p in ch])
        l,g=vg(model,batch,pos); g,_=optim.clip_grad_norm(g,1.0); opt.update(model,g); mx.eval(model.parameters(),opt.state,l)
    v=mrr(rank(VT),VG); print(f"ep{ep} val mrr {v:.3f} ({time.time()-t0:.0f}s)",flush=True)
    if v>best[0]: best=(v,ep); model.save_weights(S+"/dom/julia_dom4.safetensors")
print("selected ep",best[1],flush=True)
model.load_weights(S+"/dom/julia_dom4.safetensors")
# ---- test once on specs, same shapes as M-dom2
sys.argv=["x","--julia"]; import importlib.util
exec(open(S+"/dom/eval.py").read().split("# ---- Julia")[0])
b11=BM(top)
sents={b:[x.strip() for x in re.split(r"(?<=[.;])\s+",re.sub(r"\s+"," ",re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",sect(top[b],"Responsibility")+" "+sect(top[b],"Boundary")))) if len(x.split())>3] for b in B}
def evidence(q):
    qs=set(tok(q)); return "\n".join(f"{b}: "+fit(" ".join(sorted(sents[b],key=lambda x:-sum(b11.idf(w) for w in set(tok(x))&qs))[:2]),70) for b in B)
names=list(Q); J={}
J["julia-dom4, no evidence"]=dict(zip(names,rank([f"Work: {fit(Q[s],300)}" for s in names])))
J["julia-dom4, evidence in state"]=dict(zip(names,rank([f"Work: {fit(Q[s],300)}\nParts of the system, in their own words:\n{evidence(Q[s])}" for s in names])))
UB=BM({i:u for i,(u,_) in enumerate(train+val)}); UL=[b for _,b in train+val]
def ubr(q):
    sc={b:0.0 for b in B}
    for i in range(len(UL)): sc[UL[i]]=max(sc[UL[i]],UB.score(tok(q),i))
    return sorted(B,key=lambda b:-sc[b])
J["bm25 over identical units (max)"]={s:ubr(Q[s]) for s in names}
json.dump(J,open(S+"/dom/ranks_julia_dom4.json","w")); print("done")
