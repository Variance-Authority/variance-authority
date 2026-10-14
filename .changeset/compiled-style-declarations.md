---
"@variance-authority/sense": patch
---

Preserve Compiled CSS-in-JS style callbacks when placing execution probes before the compiler. Imported `styled`, `css`, and `cssMap` declarations keep their original callback syntax, while runtime functions still record entries. Instrumentation identities advance so older recordings cannot be read against the changed regions.
