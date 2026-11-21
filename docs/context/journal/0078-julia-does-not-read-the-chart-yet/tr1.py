"""M-tr1: plain-language translation layer, Julia zero-shot as the gauge. One run, pre-registered in HELIX."""
import os,re,json,random
S=os.environ["S"]; src=open(S+"/dom/eval.py").read(); exec(src[:src.index("# ---- Julia")])
TR=json.load(open(S+"/dom/translate.json")); PL=TR["blocks"]; LX=TR["lexicon"]
keys=sorted(LX,key=len,reverse=True)
pat=re.compile(r"(?<![A-Za-z])("+"|".join(re.escape(k) for k in keys)+r")(?![A-Za-z])",re.I)
tr=lambda q:pat.sub(lambda m:LX[m.group(1).lower()] if m.group(1).lower() in LX else m.group(1),q)
QT={s:tr(q) for s,q in Q.items()}
bp=BM(PL); R={}
R["bm25 plain descriptions, translated spec"]={s:sorted(B,key=lambda b:-bp.score(tok(q),b)) for s,q in QT.items()}
R["bm25 plain descriptions, raw spec"]={s:sorted(B,key=lambda b:-bp.score(tok(q),b)) for s,q in Q.items()}
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
R["J0 raw spec, name options"]=run(Q,lambda b:b)
R["J1 raw spec, plain options"]=run(Q,lambda b:PL[b])
R["J2 translated spec, plain options"]=run(QT,lambda b:PL[b])
json.dump(R,open(S+"/dom/ranks_tr1.json","w"))
json.dump({s:QT[s][:600] for s in list(QT)[:3]},open(S+"/dom/tr1_sample.json","w"),indent=1)
