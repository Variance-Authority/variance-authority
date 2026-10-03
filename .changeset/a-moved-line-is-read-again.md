---
'@variance-authority/store': patch
---

A publish to a git share whose line moved while the push was in flight reads
the line again and decides again, as it already did when the line had moved
before the push started. A hosted remote refuses that push at its own ref
update, `[remote rejected]`, and the publish used to report that refusal as
`nothing published … failed to push some refs`. A refused push is now a lost
race when the remote holds the line at a commit other than the one the publish
started from. The publish reports any other refusal as before.
