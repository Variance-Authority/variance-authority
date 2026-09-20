---
'@variance-authority/cli': patch
---

`select --format vitest` names each file's place on disk

A Vitest project matches an exclude pattern against its own directory, not
against the root the record counts from. The exclusions were printed relative to
that root, so in any workspace of more than one project they matched nothing:
the command answered, the runner accepted the arguments, and the whole suite ran
anyway. Nothing failed, which is the worst shape for this to take — a selector
that is silently ignored looks exactly like a selector with nothing to say.

`--format vitest` now resolves each path against the root it was recorded from,
so the argument means the same thing from wherever the runner is invoked. The
other formats are unchanged: `plain` and `json` are answers for you to read or
parse, and they stay in the record's own coordinates.
