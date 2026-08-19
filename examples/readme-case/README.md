# README example

**Showcase:** ordinary visual regression at the smallest useful scale, with
semantic attribution as the advanced step.

This is the executable source of the root README's opening comparison. One
`Button` keeps the same text, role, size, props, and DOM structure while its
`background-color` changes.

**What it proves:** the displayed before/after/diff artifacts agree with one
paint-only semantic delta, and the report names the changed component and its
source line.

**Boundary:** one controlled Button mutation in Chromium. It proves the
reporting shape and artifact relationship, not general attribution across an
arbitrary application.

Generate the committed before, after, diff, and report artifacts with:

```bash
yarn workspace @variance-authority/example-readme-case generate
```

The Chromium test proves that the semantic comparison contains exactly one
paint-only `style-changed` delta and that the displayed diff is derived from the
displayed before and after PNGs:

```bash
yarn vitest run examples/readme-case/src/readme.chromium.test.ts
```
