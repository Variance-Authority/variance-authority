---
'@variance-authority/sense': patch
'@variance-authority/sense-linux-arm64-gnu': patch
---

`@variance-authority/sense-linux-arm64-gnu` carries the prebuilt scanner for
Linux on arm64 against glibc 2.17 or newer, so Docker on Apple Silicon and arm
CI runners load the addon rather than building it.
