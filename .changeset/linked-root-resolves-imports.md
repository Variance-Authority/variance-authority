---
'@variance-authority/sense': patch
---

A checkout whose path runs through a symbolic link, such as a macOS temporary directory under `/var`, now lands its imports on the same files as the canonical path does. The resolver follows links and answers with canonical paths, and those paths were compared with the path as the caller spelled it, so every import the resolver answered was recorded as resolving nowhere.
