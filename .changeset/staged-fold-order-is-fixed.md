---
"@variance-authority/sense": patch
---

A run is now read back in the order it was written, every run. The test-file journals, the case journals and the trees a case runner reports finishing — under Vitest, Rstest, Jest and the runner API — and the contributions staged workers leave all used to be named at random and read in whatever order the file system listed them, so the same run could fold a retry before the attempt it retried on one run and after it on the next, and could report its heads in a different order each time. Every writer now names its file by when it wrote it, and every reader reads them in that order.
