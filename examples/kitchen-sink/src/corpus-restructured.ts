/**
 * Real changes in which the **tree** moved: a node, a role, a state, a
 * reference or a string.
 *
 * The other half of the false-negative guard, and the half no amount of style
 * resolution reaches. A landmark appears with every pixel identical; a `for`
 * attribute stops naming anything and no rect moves; five list items rotate.
 * These are the cases that decide whether the semantic stage sits *above*
 * raster rather than beside it, and several are in the corpus for what a differ
 * *says* rather than for the verdict — `reorder/list` and `prepend/list` are
 * both trivially `hash-changed`, and both are here because a positional differ
 * reports five and six changes where the honest answer is one.
 *
 * Kept apart from `corpus-restyled.ts` because a tree change and a value change
 * fail differently: these exercise matching, aliasing and blame, which is why
 * every band declared here is `geometry`, `a11y` or `content` and never `token`.
 *
 * Spliced into `CORPUS` in `corpus.ts`.
 */

import type { CorpusCase } from './corpus-case.js';

export const RESTRUCTURED_CASES: readonly CorpusCase[] = [
  {
    id: 'tertiary-action/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'hero-tertiary-action',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'Button',
    spec: 'spec §5 (`geometry`: boxes appear); `band.ts` `node-added`',
    rationale:
      'A third Button appears in the action row. A node with a role and an accessible name ' +
      'entered the accessibility tree, which is `geometry` by definition and independent ' +
      'of layout — so `jsdom` decides it as confidently as `chromium`, which is the ' +
      'concrete content of ADR-0002\'s claim that JSDOM covers "the structural half of ' +
      'geometry". Under `chromium` the sibling buttons also shift; those are collateral ' +
      'under the same root, not additional roots.\n\n' +
      '`blames` is `Button` rather than the Hero that placed it, and that is the rule ' +
      '`classify` states explicitly: a component appearing or disappearing is credited to ' +
      'the component itself, because crediting whoever placed it would blame a parent for ' +
      'a change it did not make. Only *reordering* is credited to whoever wrote the JSX. ' +
      'The known cost is recorded there and this case is where it shows.',
  },
  {
    id: 'break-association/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'field-break-association',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    blames: 'Field',
    spec: 'ADR-0003 §1 (`#extern:<n>`, "a dangling reference is a real defect")',
    rationale:
      'The single most important case in the corpus, and it must be read against ' +
      '`id-shift/field`. In both, id *values* differ between the two renders; only here ' +
      'does a *relationship* break — `htmlFor` now names an element that does not exist, ' +
      'so the input has lost its accessible name. Nothing else differs: same nodes, same ' +
      'text, same computed styles, and under `chromium` the same rects, so no amount of ' +
      'layout or raster evidence would find it. Masking ids to a constant, which spec ' +
      '§4.2 originally prescribed, makes this render identical to the baseline and reports ' +
      'a real accessibility regression as `unchanged`. It is banded `a11y`: the input lost ' +
      'its accessible name and nothing moved, which is the band existing to carry exactly ' +
      'this. It was declared `geometry` until the bands were split, and the rationale had ' +
      'already been arguing for `a11y` in prose — "a real accessibility regression" — while ' +
      'the declared field said layout.',
  },
  {
    id: 'with-error/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'field-with-error',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    blames: 'Field',
    spec: 'spec §5; `ID_REFERENCE_LIST_ATTRIBUTES`; `aria.ts` `accessibleDescription`',
    rationale:
      'An error message node appears and `aria-describedby` grows from one reference to ' +
      'two. The node is `geometry`; the field gaining a description is `a11y`, and `a11y` ' +
      'is the louder of the two — "the email field is now described by its error" is the ' +
      'sentence a reviewer wants, and "a node appeared" is not. This case was declared ' +
      '`geometry` for as long as nothing captured the description: every `aria-*` attribute ' +
      'is dropped by `ATTRIBUTE_ALLOWLIST` on the stated grounds that they resolve into ' +
      'role/name/state, which was never true of `aria-describedby`. The reference-list ' +
      'growth is the other part worth isolating: the alias sequence shifts for every id ' +
      'after the insertion point, so a differ that compares alias strings positionally will ' +
      'report far more change than occurred. The hash must move — it should — but the ' +
      '*report* should name one added node and one new description, not a rewritten ' +
      'reference graph.',
  },
  {
    id: 'as-region/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'card-as-region',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'Card',
    spec: 'spec §5; ADR-0002 §3; `match.ts` `matchKey`',
    rationale:
      'A `<div>` becomes a `<section aria-label>` with an implicit `region` role. Every ' +
      'computed style, every rect and every pixel is identical; a landmark appeared in the ' +
      'accessibility tree. A pixel differ cannot see this at any threshold, which is the ' +
      'general argument for the semantic stage sitting above raster rather than beside it. ' +
      'It also fixes the tag/role boundary: the snapshot keeps `tag`, so a normalizer that ' +
      'collapsed elements purely by box effect would still have to keep these apart. ' +
      'Banded `geometry` rather than `a11y`, and the reason is a limit worth stating: the ' +
      'element changed tag, so `matchKey` never pairs the two and the report is a removal ' +
      'plus an addition rather than a `role-changed`. The added node is described as ' +
      '`region "Details"`, so the landmark is named — but by `describe()`, not by the band. ' +
      'A tag change is a replacement to this differ, and pairing across one would need a ' +
      'similarity heuristic that nothing here has. Reaching this from one snapshot rather ' +
      'than from a pair is what `judge/a11y.ts` is for.',
  },
  {
    id: 'select-second/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'tabs-second',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    blames: 'Tabs',
    spec: 'spec §5 (state changes); `band.ts` `state-changed`',
    rationale:
      '`aria-selected` moves between tabs, `tabIndex` follows it, and a different panel is ' +
      'in the DOM. State is `a11y` because it changes what is *announced*, not what anything ' +
      'looks like — the visual difference (the accent underline) is downstream of the state, ' +
      'not the change itself. A panel also appears and disappears, which is `geometry`, so ' +
      'this is the case that fixes the ranking: the two bands are both present and the ' +
      'louder one wins. Decidable entirely without a layout engine, which is what makes it ' +
      'a `jsdom`-tier case.',
  },
  {
    id: 'strip-panel-role/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'tabs-strip-panel-role',
    expect: 'hash-changed',
    band: 'a11y',
    roots: 1,
    blames: 'Tabs',
    spec: '`band.ts` (`role-changed` ⇒ a11y); ADR-0002 §3',
    rationale:
      'The panel keeps its element, its id, its text and every style, and loses ' +
      '`role="tabpanel"` and `aria-labelledby`. The tab still points at it via ' +
      '`aria-controls`, so the id graph is intact and aliasing produces the same shape — ' +
      'this is not the broken-reference case, it is the missing-role case, and a ' +
      'normalizer could plausibly get one right and the other wrong. Byte-identical ' +
      'rendering, materially different for a screen reader.',
  },
  {
    id: 'reorder/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-rotated',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'ItemList',
    spec: 'spec §5 (`node-moved`); `snapshot.ts` `NodePath`',
    rationale:
      'The same five items in a different order. The hash must move — the rendered content ' +
      'genuinely differs — so the interesting expectation is not the hash but the report: ' +
      'a differ keyed on `NodePath` alone sees five changed text nodes, while one that ' +
      'matches by shape and provenance first (as `NodePath`\'s own contract requires) sees ' +
      'a rotation. Both produce the same verdict and wildly different review costs, which ' +
      'is the half of M0 that hash stability does not measure.',
  },
  {
    id: 'prepend/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-prepended',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'ItemList',
    spec: '`snapshot.ts` `NodePath` ("a path change alone is evidence of nothing")',
    rationale:
      'One item added at the front — the worst case for positional addressing, since every ' +
      'subsequent path shifts by one. The honest report is one added node. Six reported ' +
      'changes is the failure mode, and it is the one that makes reviewers stop reading ' +
      'diffs, which is the same fatigue the computed-style allowlist exists to avoid.',
  },
  {
    id: 'relabel/list',
    subject: 'list',
    baseVariant: 'base',
    perturbedVariant: 'list-relabelled',
    expect: 'hash-changed',
    band: 'content',
    roots: 1,
    blames: 'ItemList',
    minCollateral: 0,
    spec: '`band.ts` (`text-changed` ⇒ content)',
    rationale:
      'Exactly one item relabelled, at a stable position. The control for the other two ' +
      'list cases: it is the one where "one change" is unambiguously correct, so it ' +
      'calibrates whether their larger reports are over-counting or whether the differ is ' +
      'simply verbose everywhere. It is also the only pure `content` case in the corpus — ' +
      'a string moved and nothing else did — which is what makes it the calibration for ' +
      'the band as well as for the count. The name is the accessible name of the list item ' +
      'too, so this is the one place `content` and `a11y` could be confused; the item is ' +
      'named from content, so the name is a consequence of the text rather than a second ' +
      'edit, and the differ must not report it twice.',
  },
  {
    id: 'dialog-open/dialog',
    subject: 'dialog',
    baseVariant: 'base',
    perturbedVariant: 'dialog-open',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'Dialog',
    spec: 'ADR-0003 (subject subtree, `#extern:<n>`); ADR-0002 (false `unchanged`)',
    contested:
      'No ADR defines the subject subtree for portalled content, and the two readings ' +
      'disagree about the verdict. Under the DOM reading the panel is a child of ' +
      '`document.body`, nothing inside the container changed, and the correct answer is ' +
      '`hash-stable` — a modal dialog appearing is reported as `unchanged`, which ADR-0002 ' +
      'calls the worst possible failure mode. Under the fiber reading the panel belongs to ' +
      'the subject because its owner chain leads back into it, and the answer is ' +
      '`hash-changed`. Declared `hash-changed` because a rule that can report a dialog as ' +
      'unchanged is not one this product can ship, but that is an argument from ' +
      'consequences, not from anything written down. The decision belongs in an ADR, and ' +
      'this case should fail loudly until one exists. `renderCase` returns the portal host ' +
      'alongside the container precisely so a collector can implement either reading.',
    rationale:
      'A modal dialog appears, with a heading, a role, and a nested Card. Every criterion ' +
      'for `geometry` is met several times over. The perturbation is a `useState` flip of ' +
      'the kind every interactive story performs, so if portals are mishandled the failure ' +
      'is neither rare nor exotic.',
  },
  {
    id: 'wrapper-flex-block/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-flex-block',
    expect: 'hash-changed',
    band: 'geometry',
    roots: 1,
    blames: 'Wrappers',
    spec: 'spec §4.2 ("no role, no visual effect on the box tree"); ADR-0008',
    byProfile: {
      jsdom: {
        undecidable:
          'Under `chromium` the inserted `<div>` becomes the flex item, the leaf stops being ' +
          'one, `column-gap` applies between different boxes and the leaves resize: a real ' +
          '`geometry` change, which is the declared answer. Under `jsdom` there is no layout ' +
          'engine and nothing distinguishes this from `wrapper-block/wrappers`. It would ' +
          'answer `hash-stable`, and that is not an expectation — it is a consequence of ' +
          'blindness. Scoring it as a pass credits the profile for an answer it reached by ' +
          'not looking, and inflates the one number that must not be inflated; scoring it as ' +
          'a miss charges the profile for a limitation its `ObservationProfile` already ' +
          'declares. Excluded (ADR-0008 §1).',
      },
    },
    rationale:
      'Spec §4.2 collapses wrappers with "no visual effect on the box tree", but whether a ' +
      '`<div>` has one is a property of its parent\'s formatting context, not of the ' +
      '`<div>`. This case and `wrapper-flex-contents/wrappers` are the same insertion into ' +
      'the same flex row, differing by one declaration that decides inertness — so a ' +
      'collapse rule that treats "generic `<div>`" as sufficient grounds gets one of the ' +
      'two wrong whichever way it answers.',
  },
];
