---
'@variance-authority/ioc': patch
---

`package.json` declares `sideEffects: true`: the reset registry is state every test shares, so a bundler keeps it and `@variance-authority/isolator` leaves it as it is.
