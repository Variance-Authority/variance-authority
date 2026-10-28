---
'@variance-authority/cli': patch
---

A review after a second run at one commit answers

`variance review` in text, markdown or json exited 2 after a second run at the
same commit had run a test file again, while `--format handover` on the same
change answered: the cases that run retired name no commit to diff from, and
that one refusal took the whole review with it. The review now answers, compares
no case against the base, and says why — `Not compared: …` in the text, beside
the verdict in the markdown, and `motion.undiffed` in `review.json` — and still
names the test files no run at that commit wrote a case index for. Only a layer
that names no commit is answered this way: one recorded at a commit this clone
does not have, as in a shallow clone, is refused with what to fetch, and so is
a base you name with `--against` that cannot be diffed.
