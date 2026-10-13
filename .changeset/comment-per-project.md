---
'@variance-authority/cli': minor
---

`variance comment` keys its pull-request comment by the config's `project`, so a repository gating one pull request with two configs keeps a docket for each instead of the two rewriting one comment.

- `variance comment --marker` reads the config and prints `<!-- variance-authority: pr-docket v2 project=<project> -->`, the project spelled as `variance carry` spells it. It needs a config now, and refuses without one.
- `COMMENT_MARKER` is gone from the package's exports; `commentMarker(project)` replaces it, and `renderComment` takes a required `project`.
- A poster you wrote for another platform finds the new marker and nothing else. To keep an open pull request at one comment through the upgrade, the gate that posted before it takes over a comment carrying the old `<!-- variance-authority: pr-docket v1 -->` when none carries the new one. The composite action does so by default; a job that never commented before sets `adopt-unkeyed-comment: 'false'`, so it does not take another gate's docket.
- `variance carry --format github` prints `project`, the config's `project` as one path segment a ref and an artifact name both take: every UTF-8 byte but a letter, a digit, `_` or `-` written as `%XX`. A project holding a lone surrogate is refused. The action names the report page artifact `variance-report-<project>.html` with it, so two jobs in one run each upload their own.
- The composite action's `image-ref` input is replaced by `image-ref-prefix`, a prefix: the action pushes the images to `<prefix>/<project>/images/<head branch>`, so each job's comment links its own pictures. A workflow that passed `image-ref: refs/variance/images/<branch>` passes `image-ref-prefix: refs/variance/project` instead, and its cleanup deletes every project's ref for the branch. `image-ref` is still declared, and set, it fails the run rather than leaving the comment without pictures behind a warning.
