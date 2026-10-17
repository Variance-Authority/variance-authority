---
'@variance-authority/cli': patch
---

`variance review --format handover` names the changed source files that no record holds, in any language the source index reads, such as Rust. It no longer says the change touched no function when it could not read those files. The review comment's *not in the record* list now carries those files too. It drops test files whose cases the record holds.
