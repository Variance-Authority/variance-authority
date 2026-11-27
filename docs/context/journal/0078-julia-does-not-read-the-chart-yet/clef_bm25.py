"""BM25 beside Clef on the same query: full READMEs, the Responsibility+Boundary text Clef saw, and RRF (k=60) of BM25 and Clef."""
import os, re, json, math
from collections import Counter
S = os.environ["S"]; ROOT = ".compass/variance-authority"
def section(md, name):
    m = re.search(rf"^## {re.escape(name)}\s*$(.*?)(?=^#{{1,2}} |\Z)", md, re.M | re.S); return m.group(1).strip() if m else ""
def plain(t): return re.sub(r"\s+", " ", re.sub(r"[*`«»]", "", re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t))).strip()
STOP = set("the a an of to and or in on for is it its this that be by as at with from not no are was what which who when each one any".split())
def tok(t): return [w for w in re.findall(r"[a-z][a-z0-9]+", t.lower()) if w not in STOP]
class BM25:
    def __init__(s, docs):
        s.docs = {k: Counter(tok(v)) for k, v in docs.items()}; s.len = {k: sum(c.values()) for k, c in s.docs.items()}
        s.avg = sum(s.len.values()) / len(s.len); N = len(s.docs); df = Counter(w for c in s.docs.values() for w in c)
        s.idf = {w: math.log(1 + (N - n + .5) / (n + .5)) for w, n in df.items()}
    def score(s, q, k):
        c = s.docs[k]; return sum(s.idf.get(w, 0) * c[w] * 2.2 / (c[w] + 1.2 * (.25 + .75 * s.len[k] / s.avg)) for w in tok(q))
    def rank(s, q): return sorted(s.docs, key=lambda k: -s.score(q, k))
blocks = sorted(b for b in os.listdir(ROOT) if os.path.isfile(f"{ROOT}/{b}/README.md"))
md = {b: open(f"{ROOT}/{b}/README.md").read() for b in blocks}
full = BM25({b: plain(md[b]) for b in blocks})
rb = BM25({b: plain(section(md[b], "Responsibility")) + " Boundary: " + plain(section(md[b], "Boundary")) for b in blocks})
out = json.load(open(S + "/clef/cf1.json"))
def clef(q, x): return sorted(x["g1"], key=lambda k: -x["g1"][k])
def rrf(q, x, k=60):
    a, b = full.rank(q), clef(q, x); return sorted(a, key=lambda z: -(1 / (k + a.index(z)) + 1 / (k + b.index(z))))
def ev(rank):
    t = m = 0
    for x in out:
        q = " ".join(open("docs/specs/" + x["spec"]).read().splitlines()[:12]); r = rank(q, x); G = set(x["gold"])
        t += r[0] in G; m += 1 / (1 + min(r.index(g) for g in G))
    return f"{t}/{len(out)} MRR {m / len(out):.3f}"
print("BM25 full READMEs", ev(lambda q, x: full.rank(q)))
print("BM25 Responsibility+Boundary", ev(lambda q, x: rb.rank(q)))
print("Clef G1", ev(clef)); print("RRF k=60", ev(rrf))
