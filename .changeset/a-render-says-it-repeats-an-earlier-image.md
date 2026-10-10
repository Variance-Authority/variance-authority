---
'@variance-authority/tribunal': minor
---

A subject page says when an earlier build kept the same image

Each subject that kept a candidate now has `repeats` on its view: the earlier
builds of the project, rendered by the same identity, in which the same subject
kept the same candidate, matched on its content key, each with the decision it ended on. `count` is every such
build, and `builds` names up to eight, the decided ones first. The field is
absent when the subject kept no candidate, and `{ count: 0, builds: [] }` when
no earlier build kept that image.

The subject page names the earlier build in its Decision card and links to it. An
image an earlier build rejected is drawn as a failure. An image approved before
this build ran, on a subject that differs from its baseline here, is drawn as a
warning: the subject renders one image and then another in turn, so either the
render is unstable or a change was reverted.

No upload field and no migration: the candidate's key and the decisions are
already stored, and the existing index on `after_key` answers the lookup.
