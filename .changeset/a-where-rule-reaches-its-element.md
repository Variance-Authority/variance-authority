---
'@variance-authority/dom': patch
'@variance-authority/raster': patch
---

A page styled with Tailwind v4 renders at the height the browser laid it out at

The capture keeps only the style rules that can match the subject, and five
ways of losing one, or its place in the cascade, made the render shorter or
taller than the page. On this project's own site the home page painted 1,486
pixels short and reference pages up to 7% tall; every page now paints within
a pixel of its live height.

- A rule written inside `:where()` or `:is()` reaches the element it names. Each
  rule was filed under the last compound of its selector, and for
  `:where(.docs-content h2)` that compound was read inside the arguments, as
  `.docs-content`, so the rule was never tested against an `h2`. A rule is now
  filed by the compound outside any arguments or attribute values, and an
  escaped character in a class or id, `\+`, the hex escape in `.\32 xl\:p-4`
  or the `\#` in `.accent-\[\#ff4a19\]`, is part of the name.
- A shorthand whose value holds a `var()` is carried under the name it was
  declared with. Chromium leaves such a shorthand's longhands empty until the
  value is substituted and answers only for the shorthand, and the capture
  recovered only shorthands from a fixed list, which held neither
  `padding-block` nor `padding-inline`: Tailwind v4's `py-*` and `px-*`.
- A rule keeps its cascade layer. A rule read out of `@layer base { … }` was
  ranked by specificity alone, so the preflight's `h2 { font-size: inherit }`
  beat an unlayered `:where(.prose h2) { font-size: 1.65rem }`. The render
  document now declares the page's layer order and writes each rule back into
  its layer.
- The values the subject inherits no longer override the root's own rules.
  `assemble` placed them on `:root`, where they beat a carried
  `html { line-height: 1.5 }` with its computed `24px`, and every line below the
  root that set only a font size was laid out 24 pixels tall. They now sit in a
  cascade layer of their own, below every rule the document carries.
- A body the page styles in a cascade layer keeps its padding, and the subject
  is as wide as the box it sat in. The render's reset of the page margin was
  unlayered, so it beat a layered `body { padding-inline: 20px }`, and the
  container width carried was the parent's border box, so the subject painted
  40 pixels wider than it was laid out. The reset now sits in the inherited
  values' layer, and the width carried is the parent's own `width`, written
  back on the same box in its own box sizing.

A document captured from a page styled any of these ways changes its digest
once, and its baseline renders again on the next run.
