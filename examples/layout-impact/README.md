# Source cause and layout impact

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at. This example is the
small fixture that exercises that path end to end, and it also sorts each change
into a **band**: the kind of difference it is — `a11y`, `geometry`, `token`,
`content` or `texture` — rather than a pixel count.

The fixture is one React component tree rooted at `Workspace`
(`src/workspace.tsx`): a `SidePanel` labelled Sidebar (`src/side-panel.tsx`)
holding a `Heading` (`src/heading.tsx`) and an `ActionButton`
(`src/action-button.tsx`). It has four readings: a base state, a Heading paint
change, a wider SidePanel with a taller button, and a Sidebar landmark change.
The readings are driven from `src/page-agent.tsx`, which renders the tree into
`page/harness.html` and asks React which component rendered each DOM node, so a
pixel region can be named after the component that drew it.

Running it asserts three results, one per reading:

- The changed Heading pixel region is located inside `complementary "Sidebar"`,
  named as caused by `Heading`, and resolved to `src/heading.tsx:<line>`. The
  change is style-only, so it lands in the `token` band with structure intact.
- The SidePanel grows by 50 CSS pixels and the button by 4 CSS pixels. Their
  changed style values land in `token`; their resized boxes land in `geometry`,
  with `ActionButton` reported as collateral rather than as the root of the
  change.
- Changing the Sidebar from an `aside` to a `nav` is reported as structural and
  semantic, with no style change at all — a separate result from paint and size.

A region's location is not its cause. A wider SidePanel is not a structural
change merely because surrounding pixels move, and a component that React names
as the renderer of a region is not automatically the root of the change unless
the semantic comparison establishes it.

## Run it

You need a checkout of this repository, `yarn install`, `yarn build` (the
fixture imports the built workspace packages), and a browser:
`npx playwright install chromium`. Without the browser the test prints a hint
and skips rather than failing.

From the repository root:

```bash
yarn vitest run examples/layout-impact/src/layout-impact.chromium.test.ts --reporter=verbose
```

```
 RUN  v2.1.9 /path/to/variance-authority

 ✓ examples/layout-impact/src/layout-impact.chromium.test.ts > source cause and layout impact > places the changed Heading pixels in the Sidebar and resolves the responsible source
 ✓ examples/layout-impact/src/layout-impact.chromium.test.ts > source cause and layout impact > reports the 50px panel and 4px button growth as geometry caused by style values
 ✓ examples/layout-impact/src/layout-impact.chromium.test.ts > source cause and layout impact > reports the sidebar landmark change as structural/semantic, separately from paint and size

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The assertions behind those three lines are in
`src/layout-impact.chromium.test.ts`; read it to see the exact shapes the
comparison produces.
