"""M-dom2: spec -> owning top-level block. Direct rows vs Julia with domain evidence in the state. One run."""
import re,glob,os,json,math,random,subprocess,sys
S=os.environ["S"]; R=".compass/variance-authority"
G=json.load(open(S+"/dom/gold.json"))["specs"]; T=[g for g in G if g["gold"]]
B=sorted(d for d in os.listdir(R) if os.path.isdir(f"{R}/{d}"))
def clean(t):
    t=re.sub(r"```.*?```"," ",t,flags=re.S); t=re.sub(r"`[^`]*`"," ",t)
    t=re.sub(r"\]\([^)]*\)","]",t); t=re.sub(r"\S+/\S+"," ",t); return t
stem=lambda w:re.sub(r"(ing|ed|es|s)$","",w) if len(w)>4 else w
tok=lambda s:[stem(w) for w in re.findall(r"[a-z]+",s.lower()) if len(w)>2]
def sect(t,h):
    m=re.search(rf"^## {h}\n(.*?)(?=^## |\Z)",t,re.S|re.M); return m.group(1) if m else ""
top={b:open(f"{R}/{b}/README.md").read() for b in B}
allr={p:open(p).read() for p in glob.glob(R+"/*/**/README.md",recursive=True)}
blk=lambda p:os.path.relpath(p,R).split(os.sep)[0]
class BM:
    def __init__(s,docs):
        s.d={k:tok(v) for k,v in docs.items()}; s.N=len(s.d); s.avg=sum(map(len,s.d.values()))/s.N; s.df={}
        for v in s.d.values():
            for w in set(v): s.df[w]=s.df.get(w,0)+1
    def idf(s,w): return math.log(1+(s.N-s.df.get(w,0)+.5)/(s.df.get(w,0)+.5))
    def score(s,q,k):
        d=s.d[k]; out=0
        for w in set(q):
            f=d.count(w)
            if f: out+=s.idf(w)*f*2.2/(f+1.2*(.25+.75*len(d)/s.avg))
        return out
b11=BM(top); b96=BM(allr)
Q={t["spec"]:clean(open("docs/specs/"+t["spec"]).read()) for t in T}
ranks={}
rng=random.Random(0); ranks["random"]={s:rng.sample(B,len(B)) for s in Q}
def prior(s):
    c={b:0 for b in B}
    for t in T:
        if t["spec"]!=s:
            for b in t["gold"]: c[b]+=1
    return sorted(B,key=lambda b:(-c[b],b))
ranks["prior (leave-one-out)"]={s:prior(s) for s in Q}
ranks["bm25 top READMEs"]={s:sorted(B,key=lambda b:-b11.score(tok(q),b)) for s,q in Q.items()}
def b96r(q):
    sc={b:0 for b in B}
    for p in allr: sc[blk(p)]=max(sc[blk(p)],b96.score(tok(q),p))
    return sorted(B,key=lambda b:-sc[b])
ranks["bm25 all READMEs (max)"]={s:b96r(q) for s,q in Q.items()}
def cs(q):
    words=" ".join(re.findall(r"[A-Za-z]+",q)[:60])
    o=subprocess.run(["python3",os.path.expanduser("~/.agents/skills/compass/scripts/compass_search.py"),"--chart-root",".compass",words],capture_output=True,text=True).stdout
    seen=[]
    for m in re.finditer(r"^\[\d+\] variance-authority/([a-z-]+)/",o,re.M):
        if m.group(1) in B and m.group(1) not in seen: seen.append(m.group(1))
    return seen+[b for b in ranks["prior (leave-one-out)"][next(iter(Q))] if b not in seen]
ranks["compass_search (first hit)"]={s:cs(q) for s,q in Q.items()}
json.dump(ranks,open(S+"/dom/ranks_direct.json","w"))
# ---- Julia
if "--julia" in sys.argv:
    from julia_mlx import load_model
    eng=load_model("zainmerchan/Julia-1-MLX",head_length=1024,max_length=1536,strict_encoding=True); tk=eng.tokenizer
    def fit(text,n):
        w=text.split()
        while len(tk.encode(" ".join(w)))>n: w=w[:-max(1,len(w)//20)]
        return " ".join(w)
    sents={b:[x.strip() for x in re.split(r"(?<=[.;])\s+",re.sub(r"\s+"," ",re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",sect(top[b],"Responsibility")+" "+sect(top[b],"Boundary")))) if len(x.split())>3] for b in B}
    def evidence(q):
        qs=set(tok(q)); out=[]
        for b in B:
            sc=sorted(sents[b],key=lambda x:-sum(b11.idf(w) for w in set(tok(x))&qs))[:2]
            out.append(f"{b}: "+fit(" ".join(sc),70))
        return "\n".join(out)
    Qn="Which part of the system owns this work?"; NONE="None of these parts."
    perms=[B,B[::-1],random.Random(5).sample(B,len(B))]
    def run(ev):
        rows,meta=[],[]
        for s,q in Q.items():
            st=f"Work: {fit(re.sub(r'\s+',' ',q),300)}"+(f"\nParts of the system, in their own words:\n{evidence(q)}" if ev else "")
            for p in perms: rows.append({"state":st,"question":Qn,"type":"choice","options":p+[NONE]}); meta.append((s,p))
        lg=eng.logits(rows); sc={s:{b:0.0 for b in B} for s in Q}
        for (s,p),x in zip(meta,lg):
            for b,v in zip(p,x[:-1]): sc[s][b]+=float(v-x[-1])
        return {s:sorted(B,key=lambda b:-sc[s][b]) for s in Q}
    J={"julia, evidence in state":run(True),"julia, no evidence":run(False)}
    def rrf(*rs): return {s:sorted(B,key=lambda b:-sum(1/(60+r[s].index(b)) for r in rs)) for s in Q}
    J["julia evidence + bm25 top (RRF)"]=rrf(J["julia, evidence in state"],ranks["bm25 top READMEs"])
    json.dump(J,open(S+"/dom/ranks_julia.json","w"))
