import os,re,json
S=os.environ["S"];t=open(S+"/dom/tr8.py").read();exec(t[:t.index("OUT={}")])
from collections import Counter
rows=[(x,blk(p)) for p in allr for x in sents(allr[p]) if blk(p) in B]
print(len(allr),"readmes",len(rows),"sentences",Counter(b for _,b in rows).most_common())
print("perms",len(perms)); print(list(allr)[:3])
