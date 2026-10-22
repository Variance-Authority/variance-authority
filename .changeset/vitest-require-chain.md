---
'@variance-authority/sense': patch
---

Under Vitest, the files a CommonJS module `require`s, and the dependencies Vitest leaves to Node, are recorded when `include` takes them. Before, only what Vite transformed was probed, so a `require` chain was recorded as its first file.
