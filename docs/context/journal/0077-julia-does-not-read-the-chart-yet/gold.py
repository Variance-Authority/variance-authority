"""Spec -> owning top-level blocks, labelled by the chart's own Implementation coordinates (longest path prefix)."""
import re,glob,os,json,subprocess
R=".compass/variance-authority"
files=subprocess.run(["git","ls-files"],capture_output=True,text=True).stdout.split()
coord={}
for p in glob.glob(R+"/**/README.md",recursive=True):
    rel=os.path.relpath(os.path.dirname(p),R)
    if rel==".": continue
    top=rel.split(os.sep)[0]
    t=open(p).read(); m=re.search(r"^## Implementation coordinates\n(.*?)(?=^## |\Z)",t,re.S|re.M)
    if not m: continue
    for c in re.findall(r"`([^`\s]+)`",m.group(1)):
        c=c.rstrip("/")
        if "/" in c and any(f==c or f.startswith(c+"/") for f in files): coord.setdefault(c,set()).add(top)
def owner(path):
    best=max((c for c in coord if path==c or path.startswith(c+"/")),key=len,default=None)
    return coord[best] if best else set()
out=[]
for f in sorted(glob.glob("docs/specs/0*.md")):
    t=open(f).read()
    paths=set()
    for c in re.findall(r"`([^`\s]+)`|\]\(([^)\s]+)\)",t):
        for x in c:
            x=re.sub(r"^(\.\./)+","",x).split("#")[0].split(":")[0]
            if x: paths.add(x)
    # resolve bare file names to tracked paths when unique
    res=set()
    for x in paths:
        if x in files or any(g.startswith(x+"/") for g in files): res.add(x)
        elif "." in x and "/" not in x:
            m=[g for g in files if g.endswith("/"+x) and not g.startswith(("docs/","cases/"))]
            if len(m)==1: res.add(m[0])
    gold=set().union(*[owner(p) for p in res]) if res else set()
    out.append({"spec":os.path.basename(f),"gold":sorted(gold),"paths":sorted(res)})
json.dump({"coord":{k:sorted(v) for k,v in coord.items()},"specs":out},open(os.environ["S"]+"/dom/gold.json","w"),indent=1)
print("coords",len(coord)); lab=[o for o in out if o["gold"]]
print("specs",len(out),"labelled",len(lab)); from collections import Counter
print(Counter(len(o["gold"]) for o in lab)); print(Counter(b for o in lab for b in o["gold"]))
