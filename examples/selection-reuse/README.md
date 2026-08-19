# Selection reuse

**Showcase:** advanced cached source-graph selection, not ordinary visual
regression.

One token file reaches `Button` through `button.css` and not `Badge`. The
example scans the same small repository cold, then warm from persistent parse
and relation caches, then after editing the token. All three scans choose the
same affected story. It prints cold and warm duration as a measurement and
counts the records reused rather than rebuilt.

**What it proves:** the warm scan reuses every unchanged record and rebuilds
none, while choosing the same story as the cold scan. A token edit still collects
`story:catalog` and skips `story:account`; `parse.json` and `records.json` are
present only after the first scan. The printed duration compares the resulting
cold and warm decision on the machine that ran it; the invariant is reused work,
not a timing threshold that would vary with machine load.

**Boundary:** one local source graph and a regenerable cache. It does not
measure browser collection, rendering, a shared CI cache, cross-machine reuse,
or a repository's complete `variance run --since` workflow.

Run it with:

```bash
yarn workspace @variance-authority/example-selection-reuse demo
```
