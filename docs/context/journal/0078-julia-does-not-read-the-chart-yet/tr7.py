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

import glob
CR=".compass/variance-authority"
subs={b:sorted(set(p.split("/")[3] for p in glob.glob(f"{CR}/{b}/*/README.md")+glob.glob(f"{CR}/{b}/*/*/README.md"))) for b in B}
GL={b:fit(f"{b} ({' '.join(subs[b])}): {PL[b]}",46) for b in B}
title={s:next((l for l in open("docs/specs/"+s).read().splitlines() if l.startswith("# ")),"").lstrip("# ") for s in Q}
S7a={s:A[s]+" Named: "+title[s] for s in Q}
S7b={s:clean(open("docs/specs/"+s).read()) for s in Q}
bias=opt_bias(lambda b:GL[b]); bm=BM(GL); R={}
for tag,QQ in (("7a",S7a),("7b",S7b)):
    raw,cal=runc(QQ,lambda b:GL[b],bias); R[f"julia gloss {tag}"]=raw; R[f"julia gloss {tag} calibrated"]=cal
    R[f"bm25 gloss {tag}"]={s:sorted(B,key=lambda b:-bm.score(tok(q),b)) for s,q in QQ.items()}
json.dump(R,open(S+"/dom/ranks_tr7.json","w")); print(GL["reach"])
