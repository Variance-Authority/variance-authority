---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
'@variance-authority/observe': minor
'@variance-authority/playwright-test': minor
'@variance-authority/raster': minor
'@variance-authority/report': minor
'@variance-authority/tribunal': minor
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
than on every later run. `variance_explain` names the moved identity as the
cause of a change, and the tribunal no longer counts or lists an
`incomparable` verdict. `bulkSkips`, the options of `promotionOf` and Playwright Test's
`overwriting` run field are removed. The pull-request comment groups these
subjects under "Painted under another identity", one line per identity that
moved.
