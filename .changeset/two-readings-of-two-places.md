---
'@variance-authority/core': minor
---

Two readings of two places are not a flake

`flake` is an accusation — *this reading is not repeatable* — and it was being
made about a comparison that never claimed repeatability. Lifting two instances
out of two subjects at one commit and parting them produces a case where every
input agrees, the tree holds, and the output moved; the old table had exactly one
row for that.

Where a component sits is decided by the boxes around it, and no component
receives its own position as a prop. Two instances that agreed on everything they
were handed and landed at different coordinates have contradicted nothing.

`partingOf` takes a `PartingPlace`: `same` for one subject read twice, across
revisions or across two moments of one scenario, and `elsewhere` for two
instances at one commit. It decides only between `flake` and the new `placed`
rung and slice, and it defaults to `same`, which is what every comparison across
revisions is. `divergencesOf` is the one caller that says `elsewhere`. The
sentence points outwards, at what put the component there, rather than at the
component.
