# Source cause and layout impact

**Showcase:** specific Variance attribution and band classification, not an
ordinary screenshot diff.

The fixture is one React workspace with a named Sidebar. It has four readings:
a base state, a Heading paint change, a wider SidePanel with a taller button, and
a Sidebar landmark change.

**What it proves:** a changed Heading pixel region is located in the Sidebar,
connected through its React Fiber boundary to `Heading`, and resolved to
`src/heading.tsx`. The style-only Heading change is `token` evidence with
structure intact. The SidePanel grows by 50 CSS pixels and the button by 4 CSS
pixels: their changed style values are `token` evidence and their resized boxes
are `geometry` evidence. Changing the Sidebar from an `aside` to a `nav` is a
separate structural and accessibility result, not a style label.

**Boundary:** a region's location is not its cause. A wider SidePanel is not a
structural change merely because surrounding pixels move, and a component named
by Fiber is not automatically the source root unless the semantic comparison
establishes it.

Run it with:

```bash
yarn workspace @variance-authority/example-layout-impact test
```
