import json, os, sys
S = os.environ["S"]; out = json.load(open(S + "/clef/cf1.json")); top1 = mrr = p2 = n2 = 0; b3 = []
for x in out:
    G = set(x["gold"]); r = sorted(x["g1"], key=lambda k: -x["g1"][k]); top1 += r[0] in G; mrr += 1 / (1 + min(r.index(g) for g in G))
    a, b = x["bm25"][:2]
    if (a in G) != (b in G): n2 += 1; p2 += max((a, b), key=lambda k: x["g2"][k]) in G
    for q in x["g3"]:
        inG = q["block"] in G; b3.append((inG, q["p_outside"] > .5, q["block"]))
n = len(out); right = sum(inG != out_ for inG, out_, _ in b3); nr = [(i, o) for i, o, k in b3 if k != "reach"]
print(f"n={n} G1 top1 {top1}/{n} (BM25 31) MRR {mrr/n:.3f} (BM25 .883) | G2 {p2}/{n2} (BM25 29, reach-prior 32) | G3 all boundary qs {right}/{len(b3)} always-exclude {sum(not i for i,_,_ in b3)} ; non-reach {sum(i!=o for i,o in nr)}/{len(nr)} always-exclude {sum(not i for i,_ in nr)}")
