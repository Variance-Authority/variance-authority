---
'@variance-authority/observe': patch
---

A subject that paints nothing is no longer `changed` by a random class name or id

When neither side of a subject occupies pixels, its verdict rests on whether its
document moved, and that was read from the digest of the raw markup. A harness
that puts a random `className`, `data-testid` or `Math.random` id on each mount
changes that digest on every run. Material UI's conformance tests do all three,
and two runs of one commit reported 209 of its 1,235 unpainted subjects
`changed`, each naming no component that moved. For such a subject, a moved
digest is now read through the component hashes when the baseline and the run
both carry them: the document moved only if some component, including the nodes
outside every component, moved a band or rendered on one side only. A painted or
incomparable subject still reports the raw answer.
