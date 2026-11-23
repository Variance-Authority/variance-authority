---
'@variance-authority/eyes': patch
---

When the page agent cannot read a Locator before an action, a read or an
`expect` assertion, the call now runs anyway and the test gets back exactly what
it returned or threw. Before, Eyes threw the read's error and the call never
ran, so a passing assertion failed with Eyes' message. The journal entry leaves
`before` out, as it already left out a lost `after`.
