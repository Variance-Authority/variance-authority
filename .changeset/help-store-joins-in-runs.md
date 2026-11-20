---
'@variance-authority/sense': patch
---

The questions' store that a first `variance index --wait` writes is built with less memory held at once. The addon joins and encodes the published names a run of packages at a time and drops each run once it is written, where it joined every package's names before encoding any; it no longer copies each entry's list of published names, and it holds README mentions only for the names a README mentions. The store is written byte for byte as before. On generated monorepos on macOS the follow-up's live peak fell from about 1.2 GB to 0.9 GB and from about 2.2 GB to 1.85 GB, the first run's peak resident memory fell from about 1.8 GB to 1.5 GB on the one with 16,000 packages, and the index's wall time stayed within its run-to-run noise.
