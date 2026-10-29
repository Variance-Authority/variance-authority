---
'@variance-authority/sense': patch
---

An index written at format 37 is rebuilt once

Two changes each moved the source index to format 37, one for the lines an
import is used on and the `implement` members, one for a Rust doc across a
plain comment. An index written by a build that carried only one of them was
read as current, so a Rust item could keep no doc or an import no lines. The
format moves to 38, and the first scan after the upgrade reads every file
again.
