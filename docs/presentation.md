# Inspect presentation relationships during a UI edit

A screenshot can show that an interface changed without explaining what changed
about the way it reads. One repeated row may have drifted from its peers, a
heading may no longer stand apart from its body, or two groups may have become
hard to distinguish even though every word is still present.

[Presentation evidence](presentation-reference.md) makes those relationships
inspectable inside the Playwright session that already reaches the interface.
A coding agent can read the rendered subject, narrow one finding to the box
that owns it, paint that evidence over the live page, make the product-authorized
edit, and read the same subject again. The comparison then answers two separate
questions: did the measured relationship change, and did the interface preserve
its information?

Use this path when those answers would change an edit or review decision. It
does not decide that a design is good, choose a layout, or turn density,
whitespace, page length, or a spacing value into a target.

## Where it enters the workflow

Presentation reading begins after your existing Playwright setup has brought the
page to the state you care about. It does not replace navigation, fixtures,
authentication, or the product interaction that reveals that state.

Read before the edit, focus and paint one relationship, make the change, return
to the same state, then read and compare again. The evidence enters while it
can still change the next move; it does not make the product decision. If all
you need is a baseline verdict or screenshot approval, keep using the
visual-regression path instead.

## Follow one relationship through an edit

Assume Playwright has already opened a page containing repeated work items and
one item appears out of step with the rest. The package installation and full
API signatures live in the
[`@variance-authority/presentation` package reference](../packages/presentation/README.md).

### Read the rendered subject

Start with the smallest locator that contains the relationship you are asking
about. A named region is usually more useful than the whole document because the
locator is an evidence boundary, not a claim that every descendant is a peer.

```ts
import { comparePresentation, focusPresentation } from '@variance-authority/presentation';
import {
  clearPresentationPaint,
  paintPresentationFocus,
  sensePresentation,
} from '@variance-authority/presentation/playwright';

const subject = page.getByRole('main', { name: 'Work queue' });
const before = await sensePresentation(page, subject, {
  subjectId: 'work:queue',
});
```

The first reading keeps the rendered relationships together with semantic and
browser accessibility evidence. It creates no baseline and no pass/fail result.

### Focus and paint one question

Choose a finding that matches the product question rather than treating the
whole report as a diagnosis of the whole page. Here the question is whether one
repeated item departs from the presentation its peers share.

```ts
const target = before.findings?.find(
  (finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT',
);

if (target === undefined) {
  throw new Error('no unexplained repeated-item drift was observed');
}

const focusedBefore = focusPresentation(before, target.owner, {
  findings: [target.id],
  paint: ['findings'],
});

await paintPresentationFocus(page, focusedBefore);
```

The paint marks only that owned relationship, from the report already in hand.
It does not re-read the page. Inspect the highlighted nodes and the finding's
measurements before choosing an edit; the same visual difference may be valid
when selection, validation, or another observed state explains it.

If no automatic finding matches the product question, stop rather than forcing
one. Product-known alignments, spacing runs, and relationship roles can be
measured explicitly; the [technical reference](presentation-reference.md#choose-a-reading)
routes those cases.

### Edit, return to the state, and sense again

Remove the diagnostic overlay before continuing, make the edit through the
repository's normal workflow, and let Playwright return to the same state. Then
sense the same boundary again.

```ts
await clearPresentationPaint(page);
```

After the product-authorized source edit, reload and return to the same state.

```ts
const after = await sensePresentation(page, subject, {
  subjectId: 'work:queue',
});
const comparison = comparePresentation(before, after);
if (!comparison.information.content.preserved) {
  throw new Error('the edit changed product information as well as presentation');
}

const focusedAfter = focusPresentation(after, target.owner, {
  paint: ['repetition', 'findings'],
});
await paintPresentationFocus(page, focusedAfter);

const drift = comparison.findings?.find(
  (finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT',
);
console.log(drift, comparison.information);
```

The second focus shows the relationship at the same structural owner after the
edit. The comparison reports finding counts by rule beside content identity and
the element, character, and repeated-object counts. Those signals remain
separate so fewer findings cannot hide missing or substituted information.

### Make the decision the evidence supports

For this example, the edit has support when the drift finding is gone from the
focused owner, the count for `PRESENTATION_GRAMMAR_DRIFT` decreased, content
identity held, the information counts show no unexplained loss, and the
repainted owner confirms that the comparison concerns the intended relationship.

That result supports the statement “this edit removed the measured peer drift
without changing the interface's information.” It does not support “the design
is better.” Product intent still decides whether the peer should match, whether
another distinction matters more, and whether the edit should ship.

An unchanged finding means the attempted edit did not resolve the measured
relationship. A changed content identity means presentation and information
moved together, so the product task must justify both. If either report lacks
layout evidence, the relationship comparison is unavailable rather than clean.

## What this path can and cannot establish

Presentation evidence applies to grouping, separation, alignment, repetition,
surface distinction, and emphasis in one rendered state. It is especially
useful when a coding agent needs a concrete relationship to inspect instead of
the instruction “make this look better.”

It remains deliberately narrower than a design review:

- A report with no findings means no implemented relationship rule fired. It
  does not certify the interface.
- Dimensions, utilization, density, whitespace, and content volume are context,
  never defects on their own.
- Browser accessibility evidence is retained independently; this path is not an
  accessibility audit and does not repair or reinterpret the browser's tree.
- Findings belong to structural owners. A broad locator does not make every
  descendant comparable, and evidence inside a nested box is not automatically
  evidence about its parent.
- The product owns meaning. A design token can explain how a distance was
  implemented, but cannot prove what that distance is supposed to communicate.

Use the [presentation evidence reference](presentation-reference.md) to choose
an explicit alignment, spacing, or hierarchy reading; understand findings and
missing evidence; or carry a before/after consequence into a run report. The
[package reference](../packages/presentation/README.md) owns installation,
complete signatures, and integration details.
