---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
'@variance-authority/observe': minor
'@variance-authority/playwright-test': minor
'@variance-authority/raster': minor
'@variance-authority/remote': patch
'@variance-authority/report': minor
'@variance-authority/store': minor
'@variance-authority/tribunal': minor
'@variance-authority/unit-test': patch
'@variance-authority/vitest-browser': minor
---

A baseline painted under another identity is compared, and the identity is the cause

There is no `incomparable` verdict: a subject with two images is always
compared, and reads `unchanged`, `changed`, `new` or `ignored`. When the two
were painted under different identities, such as another browser version,
platform, scale factor, font stack or recipe of this tool, the observation
carries `signals.identity` (`recipe` or `machine`) and `signals.moved`, each
moved field with both values, and its `because` opens with that cause. A
`changed` subject fails the gate whatever its cause, and `variance accept --all`,
Playwright Test's `--update-snapshots` and Vitest's `--update` adopt it like any
other change. An `unchanged` subject under a moved identity is re-stamped
under this run's identity by the same three, so an upgrade is named once rather
than on every later run. A re-stamp approves nothing: `variance accept` counts
it in `restamped` and its summary, not among the accepted subjects or the
commit message, and the `variance_changelog` preview says so. A durable store's
`put` moves a baseline: the subject's copy under every other identity is
removed, so a lookup never compares against a superseded image. `variance_explain` names the moved identity as the
cause of a change, and the tribunal no longer counts or lists an
`incomparable` verdict. `@variance-authority/raster` exports `identityCause`,
which says whether two identities differ in the recipe alone or in the machine,
with its `IdentityCause` and `ComparedSides` types. `variance doctor` reports a
store painted by another machine as `PAINTED ELSEWHERE` and exits `0`: the run
compares it. Its `baselines.comparable` field is now `baselines.paintedHere`.
The pull-request comment groups these
subjects under "Painted under another identity", one line per identity that
moved. Its section for subjects with no image to point at is headed "Nothing to
point at", which was "Not compared".
