# Inspect presentation relationships during a UI edit

You make a UI edit and the screenshot moves, which tells you the interface
changed without saying what changed about the way it reads. One repeated row may
have drifted from its peers, a heading may no longer stand apart from its body,
or two groups may have become hard to tell apart even though every word is still
present. Measure those relationships before the edit and again after it, and a
person or a coding agent can say whether the edit did what it claimed.

New here? Start with [your first run](start.md).

[Presentation evidence](presentation-reference.md) measures those
relationships inside the Playwright session that already reaches the interface.
You read the rendered **subject** — one named UI state you asked for and can ask
for again, identified by a stable id like `work:queue` — narrow one measurement
to the element that owns it, draw that evidence over the live page, edit your
source, and read the same subject again. The comparison then answers two
separate questions: did the measured relationship change, and did the interface
preserve its information?

Use this path when those answers would change an edit or review decision. It
does not decide that a design is good, choose a layout, or turn density,
whitespace, page length, or a spacing value into a target.

## Where it enters the workflow

Reading begins after your existing Playwright setup has brought the page to the
state you care about. It does not replace navigation, fixtures, authentication,
or the product interaction that reveals that state.

Read before the edit, narrow and draw one relationship, make the change, return
to the same state, then read and compare again. If all you need is a baseline
verdict or screenshot approval, use the visual-regression path in
[your first run](start.md) instead.

## Follow one relationship through an edit

Assume a page containing repeated work items, where one item appears out of step
with the rest.

```bash
npm install --save-dev @variance-authority/presentation @playwright/test
npx playwright install chromium
```

### Read the rendered subject

Start with the smallest locator that contains the relationship you are asking
about. A named region is usually more useful than the whole document: the
locator bounds the evidence, and it does not claim that every descendant inside
it is a peer.

```ts
// tests/work-queue-presentation.spec.ts
import { expect, test } from '@playwright/test';
import { comparePresentation, focusPresentation } from '@variance-authority/presentation';
import {
  clearPresentationPaint,
  paintPresentationFocus,
  sensePresentation,
} from '@variance-authority/presentation/playwright';

test('the drifting queue item is brought back to its peers', async ({ page }) => {
  await page.goto('http://localhost:5173/queue');

  const subject = page.getByRole('main', { name: 'Work queue' });
  const before = await sensePresentation(page, subject, {
    subjectId: 'work:queue',
  });
```

The reading keeps the rendered relationships together with semantic and browser
accessibility evidence. It writes no file, creates no baseline, and returns no
pass or fail result — every assertion in the rest of this test is one you wrote
about the data it handed back.

`sensePresentation` holds the page still to measure it — animations pinned,
scrollbars and caret hidden, fonts and the subject's images awaited — and the
hold is not lifted when the read returns. Reload if you need the live page back.

### Narrow and draw one question

Choose a finding that matches the product question rather than treating the
whole report as a diagnosis of the whole page. Here the question is whether one
repeated item departs from the presentation its peers share.

The rest of the snippets continue inside the same test, with the `page`,
`subject` and `before` values above.

```ts
  const target = before.findings?.find(
    (finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT',
  );
  expect(target, 'no unexplained repeated-item drift was observed').toBeDefined();

  const focusedBefore = focusPresentation(before, target!.owner, {
    findings: [target!.id],
    paint: ['findings'],
  });

  await paintPresentationFocus(page, focusedBefore);
```

`focusPresentation` reads one structural level out of the report you already
have. Every finding names an **owner**: the element whose immediate arrangement
of its children produced the measurement, not the children themselves.

**Painting** draws an SVG overlay of those measurements onto the page you just
read, from the report already in hand; it does not read the page again. The
overlay is a real element in the document, so a screenshot taken while it is up
contains it. Inspect the highlighted nodes and the finding's measurements before
choosing an edit — the same visual difference may be correct when selection,
validation, or another observed state explains it.

If no automatic finding matches the product question, stop rather than forcing
one. Alignments, spacing runs, and relationship roles your product defines can
be measured explicitly instead; the
[technical reference](presentation-reference.md#choose-a-reading) routes those
cases.

### Edit, return to the state, and read again

Remove the overlay before continuing, change your own source, and let Playwright
return to the same state.

```ts
  await clearPresentationPaint(page);
```

Then read the same region again and compare the two reports.

```ts
  const after = await sensePresentation(page, subject, {
    subjectId: 'work:queue',
  });
  const comparison = comparePresentation(before, after);
  expect(
    comparison.information.content.preserved,
    'the edit changed product information as well as presentation',
  ).toBe(true);

  const focusedAfter = focusPresentation(after, target!.owner, {
    paint: ['repetition', 'findings'],
  });
  await paintPresentationFocus(page, focusedAfter);

  const drift = comparison.findings?.find(
    (finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT',
  );
  console.log(drift, comparison.information);
  await clearPresentationPaint(page);
});
```

The second focus shows the relationship at the same owner after the edit. The
comparison reports finding counts by rule beside content identity and the
element, character, and repeated-object counts. Those counts stay separate from
the findings, so fewer findings cannot hide missing or substituted information.

### Make the decision the evidence supports

For this example, the edit has support when the drift finding is gone from the
focused owner, the count for `PRESENTATION_GRAMMAR_DRIFT` decreased, content
identity held, the information counts show no unexplained loss, and the
repainted owner confirms that the comparison concerns the intended relationship.

That result supports the statement "this edit removed the measured peer drift
without changing the interface's information." It does not support "the design
is better." Product intent still decides whether the peer should match, whether
another distinction matters more, and whether the edit should ship.

An unchanged finding means the attempted edit did not resolve the measured
relationship. A changed content identity means presentation and information
moved together, so the product task must justify both. If either report lacks
layout evidence, the relationship comparison is unavailable rather than clean.

## What this path can and cannot establish

Presentation evidence applies to grouping, separation, alignment, repetition,
surface distinction, and emphasis in one rendered state. It gives a coding agent
a concrete relationship to inspect instead of the instruction "make this look
better."

It is narrower than a design review:

- A report with no findings means no implemented relationship rule fired. It
  does not certify the interface.
- Dimensions, utilization, density, whitespace, and content volume are context,
  never defects on their own.
- Browser accessibility evidence is retained independently; this path is not an
  accessibility audit and does not repair or reinterpret the browser's tree.
- Findings belong to owners. A broad locator does not make every descendant
  comparable, and evidence inside a nested element is not automatically evidence
  about its parent.
- A design token can explain how a distance was implemented, but cannot prove
  what that distance is supposed to communicate. Your product owns that.

Use the [presentation evidence reference](presentation-reference.md) to choose
an explicit alignment, spacing, or hierarchy reading; understand findings and
missing evidence; or carry a before/after consequence into a run report. The
[`@variance-authority/presentation` package reference](https://variance-authority.dev/reference/packages/presentation)
owns installation, complete signatures, and integration details.
