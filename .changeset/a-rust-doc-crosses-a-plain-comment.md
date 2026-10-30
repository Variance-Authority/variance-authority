---
'@variance-authority/sense': patch
---

A Rust doc reaches its item across a plain comment

A `///` doc with a `// TODO` or a `/* … */` between it and its item was
recorded as no doc, so `ask symbol` printed the item bare and `ask search`
could not find it by the words of its doc. rustdoc attaches that doc, because a
plain comment is not a token, and the Rust reader now does the same. An inner
`//!` doc between them still documents the module around it, not the item. The
source index format moves to version 38, so the first scan after the upgrade
reads every file again.
