---
'@variance-authority/cli': minor
---

`variance comment` names the config's `project` in its heading, so two gates on one pull request can be told apart: ``## Visual variance in project `storybook` — 2 subject(s) need review``. A script that matches the old start of the heading, `## Visual variance —`, matches `## Visual variance` instead. `variance comment --cleared` prints what a poster writes over a docket once a later run finds nothing to review, under the same heading. An older CLI still renders and posts under the moved `v1`; only clearing a previous docket needs this version.
