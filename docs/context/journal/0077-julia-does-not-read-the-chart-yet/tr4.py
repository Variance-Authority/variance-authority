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
R={}
for on,O in (("verb-first",PL),("object-first",OF)):
    bias=opt_bias(lambda b:O[b]); print(on,"bias",{b:round(v,1) for b,v in sorted(bias.items(),key=lambda x:-x[1])})
    for setn,QQ in (("spec",A),("hist",H)):
        raw,cal=runc(QQ,lambda b:O[b],bias); R[f"{setn}|julia {on}"]=raw; R[f"{setn}|julia {on} calibrated"]=cal
json.dump(R,open(S+"/dom/ranks_tr4.json","w"))
