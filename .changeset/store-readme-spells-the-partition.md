---
'@variance-authority/store': patch
---

The README's "What you get" example now names the identity directory the way
the store writes it, `v1-<hex>`. It used to show `v1:<hex>`, the digest itself,
which is not a portable file name and not a path the store creates.
