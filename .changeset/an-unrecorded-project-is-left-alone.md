---
"@variance-authority/cli": patch
---

`variance covering --format json` names an unrecorded project as `{"refused":"unrecorded"}` on stdout

A project no run recorded is refused with exit 2 as before, and the sentence
still goes to stderr. An editor asking on every edit reads the kind, stops
asking in that project, and asks again when the window comes back to the front.
