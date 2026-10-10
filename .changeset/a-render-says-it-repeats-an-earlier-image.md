---
'@variance-authority/tribunal': minor
---

A subject page says when an earlier build kept the same image

Each subject a reviewer decides on that kept a candidate now has `repeats` on
its view: the earlier builds of the project, rendered by the same identity, in
which the same subject kept the same candidate, matched on its content key, each
with the decision it ended on. `count` is every such build, and `builds` names up
to eight, the decided ones first. The field is absent on an `unchanged` or
`ignored` subject and on one that kept no candidate, and `{ count: 0, builds: [] }`
when no earlier build kept that image.

The subject page names the earlier build in its Decision card and links to it. An
image an earlier build rejected is drawn as a rejection. An image approved before
this build ran, on a render that still differs from its baseline, is drawn as a
warning that states just that.

No upload field and no migration: the candidate's key and the decisions are
already stored, and the existing index on `after_key` answers the lookup.
