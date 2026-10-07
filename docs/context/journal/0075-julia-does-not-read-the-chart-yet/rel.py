"""ESCI-style relation round: each BM25 top-2 candidate classified independently. ENGINE=julia|clef."""
import os,re,json,random,time
import subprocess; os.chdir(subprocess.run(["git","rev-parse","--show-toplevel"],capture_output=True,text=True).stdout.strip())
S=os.environ["S"]; ENG=os.environ["ENGINE"]
L="docs/context/journal/0075-julia-does-not-read-the-chart-yet/"; C=".compass/variance-authority/"
Bm=json.load(open(L+"ranks_direct.json"))["bm25 all READMEs (max)"]
Gd={g["spec"]:set(g["gold"]) for g in json.load(open(L+"gold.json"))["specs"] if g["gold"]}
cases=[s for s in Bm if s in Gd and len(set(Bm[s][:2])&Gd[s])==1]
def plain(t): return " ".join(re.sub(r"\[([^\]]*)\]\([^)]*\)",r"\1",t).replace("**","").replace("`","").split())
def words(t,n): w=t.split(); return " ".join(w[:n])
def section(md,name):
    m=re.search(rf"^## {name}\n(.*?)(?=^## |\Z)",md,re.S|re.M); return plain(m.group(1)) if m else ""
def comps(md):
    out=[]
    for l in section_raw(md,"Components").splitlines():
        m=re.match(r"\|\s*\[([^\]]+)\]\([^)]*\)\s*\|\s*(.+?)\s*\|$",l)
        if m: out.append(f"{m.group(1)}: {plain(m.group(2))}")
    return out
def section_raw(md,name):
    m=re.search(rf"^## {name}\n(.*?)(?=^## |\Z)",md,re.S|re.M); return m.group(1) if m else ""
def task(s,n=12): return plain(" ".join(open("docs/specs/"+s).read().splitlines()[:n]))
EV={}
for b in os.listdir(C):
    p=C+b+"/README.md"
    if os.path.isfile(p):
        md=open(p).read()
        EV[b]={"name":b,"responsibility":section(md,"Responsibility"),"logical_role":words(section(md,"Logical role"),90),
               "boundary":words(section(md,"Boundary"),90),"components":[words(c,30) for c in comps(md)]}
        if os.environ.get("EXTRA")=="code": EV[b]["code"]=sorted(set(re.findall(r"`([^`\s]+/[^`\s]*)`",section_raw(md,"Implementation coordinates"))))
CR={"PRIMARY":"Changing this candidate's behaviour is required to implement the work.",
    "SUPPLIER":"It provides information or capability the primary owner needs, but the behaviour is not implemented here.",
    "CONSUMER":"It consumes behaviour or data affected by the change.",
    "CONSEQUENCE":"It may need tests, adapters or follow-up, but does not own the behaviour.",
    "UNRELATED":"It has no material role in the work."}
PH=["What role does `candidate` play in implementing `work`?",
    "How is the part of the system described in `candidate` related to the change requested in `work`?",
    "If someone carries out `work`, what is the relation of `candidate` to that change?"]
NQ=["Does implementing the behaviour requested in `work` require changing `candidate`?",
    "Does `candidate` produce the information whose meaning `work` changes?",
    "Does `candidate` merely consume that information?",
    "Would leaving `candidate` unchanged make the behaviour requested in `work` impossible?"]
QS={**{f"c{i}":{"type":"choice","instructions":q,"criteria":CR} for i,q in enumerate(PH)},
    **{f"n{i}":{"type":"noul","instructions":q} for i,q in enumerate(NQ)}}
if ENG=="julia":
    from julia_mlx import load_model
    eng=load_model("zainmerchan/Julia-1-MLX",head_length=1024,max_length=1536,strict_encoding=True)
    if os.environ.get("JW"): eng.model.load_weights(os.environ["JW"])
    ask=lambda st:eng.predict(st,questions=QS)["answers"]
else:
    import sys; sys.path.insert(0,S+"/clef")
    from joint_schema_model import load_release_model,systemone
    model,proc=load_release_model(os.environ["CLEF"],device="mps")
    ask=lambda st:systemone(model,proc,{"model":"clef-flash","state":st,"questions":QS})["answers"]
N=int(os.environ.get("N","99")); rng=random.Random(7); out={}; t0=time.time()
for s in cases[:N]:
    cand=Bm[s][:2]; order=cand[:]; rng.shuffle(order); out[s]={}
    for b in order:
        a=ask({"work":task(s),"candidate":EV[b]})
        out[s][b]={"choice":[a[f"c{i}"]["probabilities"] for i in range(3)],"noul":[a[f"n{i}"]["noul"] for i in range(4)]}
    print(s,f"{time.time()-t0:.0f}s",flush=True)
json.dump({"cases":cases,"gold":{s:sorted(Gd[s]) for s in cases},"bm":{s:Bm[s][:2] for s in cases},"out":out},open(f"{S}/rel/{os.environ.get('OUT',ENG)}.json","w"),indent=1)
