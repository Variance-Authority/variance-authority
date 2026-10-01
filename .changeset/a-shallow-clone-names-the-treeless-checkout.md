---
"@variance-authority/cli": patch
---

A diff that a shallow clone cannot read names the checkout that can

When `variance run --since` or `variance review` cannot read the diff from the base, the error names a checkout of every commit and no trees: `git clone --filter=tree:0`, or `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`. That checkout has an exact merge base. On material-ui it took 20 s and 252 MB, against 14.7 s and 231 MB for a depth-1 checkout; the cost depends on the repository's history.
