---
'@variance-authority/cli': minor
---

`Variance-Authority/action/images` deletes the images the action pushed under
`image-ref-prefix` when the pull request closes, merged or not: one step, given
the same prefix, in a job on `pull_request` `closed`. It deletes every project's
ref for that branch and no other branch's, and skips a fork's pull request with
a line. Without it, those refs stay in the repository after the branch is gone.
