"""M-tr5: sub-block grain, calibrated Julia over grouped options, block = max of its options."""
import os,re,json,random
S=os.environ["S"]; src=open(S+"/dom/tr3.py").read(); exec(src[:src.index("R={}")])
SUB=json.load(open(S+"/dom/sub_plain.json"))
def run_grouped(OPTS,QQ,tag):
    keys=sorted(OPTS); owner={k:k.split("/")[0] for k in keys}
    parts=[]
    for k in range(3):
        p=keys[:]; random.Random(f"g{k}").shuffle(p); n=-(-len(p)//12); parts.append([p[i::n] for i in range(n)])
    def logits(states):
        rows,meta=[],[]
        for sid,st in states:
            for grp in (g for part in parts for g in part):
                rows.append({"state":st,"question":Qn,"type":"choice","options":[OPTS[o] for o in grp]+[NONE]}); meta.append((sid,grp))
        lg=eng.logits(rows); out={}
        for (sid,grp),x in zip(meta,lg):
            for o,v in zip(grp,x[:-1]): out.setdefault(sid,{}).setdefault(o,[]).append(float(v-x[-1]))
        return {sid:{o:sum(v)/len(v) for o,v in d.items()} for sid,d in out.items()}
    nulls=logits([(n,f"Work: {n}") for n in ("N/A",".","[task]")]); bias={o:sum(nulls[n][o] for n in nulls)/len(nulls) for o in keys}
    sc=logits([(s,f"Work: {fit(re.sub(r'\s+',' ',q),300)}") for s,q in QQ.items()])
    res={}
    for cal in (False,True):
        r={}
        for s in QQ:
            bs={b:-1e9 for b in B}
            for o in keys: bs[owner[o]]=max(bs[owner[o]],sc[s][o]-(bias[o] if cal else 0))
            r[s]=sorted(B,key=lambda b:-bs[b])
        res[f"julia {tag}"+(" calibrated" if cal else "")]=r
    bm=BM(OPTS); res[f"bm25 {tag} (max)"]={s:sorted(B,key=lambda b:-max([bm.score(tok(q),o) for o in keys if owner[o]==b] or [-1])) for s,q in QQ.items()}
    return res
R={}
R.update(run_grouped(SUB,A,"sub-block"))
R.update(run_grouped({**SUB,**{f"{b}/README.md":PL[b] for b in B}},A,"sub+top"))
json.dump(R,open(S+"/dom/ranks_tr5.json","w"))
