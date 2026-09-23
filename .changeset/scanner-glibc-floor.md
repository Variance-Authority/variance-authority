---
'@variance-authority/sense-linux-x64-gnu': patch
---

Build the Linux scanner against glibc 2.17

The Linux scanner was linked against the build runner's glibc and asked for
2.39, so it failed to load on Debian 12 and Ubuntu 22.04 while Node and oxc ran
there. It now asks for 2.17, below the 2.28 Node 22 itself needs, and a release
refuses a binary that asks for more.
