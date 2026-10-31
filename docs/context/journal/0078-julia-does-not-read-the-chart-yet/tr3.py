"""M-tr3: object-first options; specs (act sentences) and history test subjects. One run."""
import os,re,json,random
S=os.environ["S"]; src=open(S+"/dom/eval.py").read(); exec(src[:src.index("# ---- Julia")])
PL=json.load(open(S+"/dom/translate.json"))["blocks"]; OF=json.load(open(S+"/dom/options_objfirst.json"))
A=json.load(open(S+"/dom/acts.json")); A={s:A[s] for s in Q}
D=json.load(open(S+"/ft/data.json")); H={t["sha"]:t["task"] for t in D["tasks"] if t["split"]=="test" and t["concepts"]}
json.dump({t["sha"]:t["concepts"] for t in D["tasks"] if t["split"]=="test" and t["concepts"]},open(S+"/dom/hist_gold.json","w"))
from julia_mlx import load_model
eng=load_model("zainmerchan/Julia-1-MLX",head_length=1024,max_length=1536,strict_encoding=True); tk=eng.tokenizer
def fit(text,n):
    w=text.split()
    while len(tk.encode(" ".join(w)))>n: w=w[:-max(1,len(w)//20)]
    return " ".join(w)
Qn="Which part of the system owns this work?"; NONE="None of these parts."
perms=[B,B[::-1],random.Random(5).sample(B,len(B))]
def run(QQ,opt):
    rows,meta=[],[]
    for s,q in QQ.items():
        st=f"Work: {fit(re.sub(r'\s+',' ',q),300)}"
        for p in perms: rows.append({"state":st,"question":Qn,"type":"choice","options":[opt(b) for b in p]+[NONE]}); meta.append((s,p))
    lg=eng.logits(rows); sc={s:{b:0.0 for b in B} for s in QQ}
    for (s,p),x in zip(meta,lg):
        for b,v in zip(p,x[:-1]): sc[s][b]+=float(v-x[-1])
    return {s:sorted(B,key=lambda b:-sc[s][b]) for s in QQ}
R={}
for setn,QQ in (("spec",A),("hist",H)):
    for on,O in (("name",{b:b for b in B}),("verb-first",PL),("object-first",OF)):
        bm=BM(O); R[f"{setn}|bm25 {on}"]={s:sorted(B,key=lambda b:-bm.score(tok(q),b)) for s,q in QQ.items()}
        R[f"{setn}|julia {on}"]=run(QQ,lambda b:O[b])
json.dump(R,open(S+"/dom/ranks_tr3.json","w"))
