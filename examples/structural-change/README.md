# Structural change

**Showcase:** advanced structural change, not ordinary visual regression.

The same `AccountCard` paints the same pixels in both variants. The second
variant changes the card from an unlabelled `div` to a labelled `section`, so a
screenshot has no difference to report while the captured document gains
structure and accessible semantics.

**What it proves:** a structural change is an `AccountCard`-owned finding,
rather than a smaller pixel threshold. The runnable test verifies identical PNGs
and one semantic finding owned by `AccountCard`.

**Boundary:** one controlled Chromium fixture. It does not establish general
accessibility coverage or replace an accessibility audit.

Run it with:

```bash
yarn workspace @variance-authority/example-structural-change test
```
