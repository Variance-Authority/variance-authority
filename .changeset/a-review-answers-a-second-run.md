---
'@variance-authority/cli': patch
---

A review after a second run at one commit answers

`variance review` in text, markdown or json exited 2 after a second run at the
same commit had run a test file again, while `--format handover` on the same
change answered: the cases that run retired name no commit to diff from, and
that one refusal took the whole review with it. The review now answers, compares
no case against the base, and says why — `Not compared: …` in the text, beside
the verdict in the markdown, and `motion.undiffed` in `review.json`. A base you
name with `--against` that cannot be diffed is still refused.
