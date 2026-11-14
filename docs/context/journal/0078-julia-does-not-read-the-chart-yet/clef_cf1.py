"""M-cf1: Clef-flash routes the 44 gold specs. G1 11-way, G2 BM25's top two, G3 boundary noul. Carries BM25 lists and questions from M-or4."""
import os, re, sys, json, time, torch
S = os.environ["S"]; ROOT = ".compass/variance-authority"; sys.path.insert(0, S + "/clef")
from joint_schema_model import load_release_model, systemone
def section(md, name, level=2):
    m = re.search(rf"^{'#' * level} {re.escape(name)}\s*$(.*?)(?=^#{{1,{level}}} |\Z)", md, re.M | re.S); return m.group(1).strip() if m else ""
def plain(t): return re.sub(r"\s+", " ", re.sub(r"[*`«»]", "", re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t))).strip()
def sents(t): return [s for s in re.split(r"(?<=[.;:])\s+(?=[A-Z`*\[])", plain(t)) if len(s.split()) > 3]
STOP = set("the a an of to and or in on for is it its this that be by as at with from not no are was what which who when each one any".split())
def tok(t): return [w for w in re.findall(r"[a-z][a-z0-9]+", t.lower()) if w not in STOP]
blocks = sorted(b for b in os.listdir(ROOT) if os.path.isfile(f"{ROOT}/{b}/README.md"))
md = {b: open(f"{ROOT}/{b}/README.md").read() for b in blocks}
crit = {b: plain(section(md[b], "Responsibility")) + " Boundary: " + plain(section(md[b], "Boundary")) for b in blocks}
rows = json.load(open(S + "/orient/oracle_chart.json"))
dev = "mps"; t0 = time.time()
model, proc = load_release_model(S + "/clef/flash", device=dev); print("loaded", round(time.time() - t0), "s", flush=True)
def ask(state, questions): return systemone(model, proc, {"model": "clef-flash", "state": state, "questions": questions})["answers"]
Q1 = "Which part of the system owns this work: where would the change be made?"
out = []
for x in rows:
    task = " ".join(open("docs/specs/" + x["spec"]).read().splitlines()[:12]); G = set(x["gold"]); t = time.time()
    a1 = ask(task, {"owner": {"type": "choice", "instructions": Q1, "criteria": crit}})["owner"]["probabilities"]
    a, b = x["bm25"][:2]
    a2 = ask(task, {"owner": {"type": "choice", "instructions": Q1, "criteria": {a: crit[a], b: crit[b]}}})["owner"]["probabilities"]
    g3 = []; words = set(tok(task))
    for k in x["bm25"]:
        for s in sents(section(md[k], "Boundary")):
            if not set(tok(s)) & words: continue
            p = ask(f"Work: {task}\n\nBoundary of {k}: {s}", {"outside": {"type": "noul", "instructions": f"Does this boundary sentence say the work is not done by {k}?"}})["outside"]["noul"]
            g3.append(dict(block=k, sentence=s, p_outside=p))
    out.append(dict(spec=x["spec"], gold=sorted(G), bm25=x["bm25"], g1=a1, g2=a2, g3=g3)); print(x["spec"], round(time.time() - t, 1), "s", flush=True)
    json.dump(out, open(S + "/clef/cf1.json", "w"), indent=1)
