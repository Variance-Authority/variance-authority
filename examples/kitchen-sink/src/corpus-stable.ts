/**
 * P1 — the no-op refactors, whose hash must not move.
 *
 * Split out of `corpus.ts` along the seam the table already had: a banner
 * comment separated these from the real changes long before the file was worth
 * splitting. Every case here is an edit a developer makes without meaning
 * anything by it — renamed classes, renumbered ids, accreted stylesheets,
 * respelled shorthands, inserted wrappers — and `<2% false semantic misses on
 * no-op refactors` (spec §10) is measured over exactly this list. A case joins
 * it only with the argument for *why* the two renders are the same render
 * written down beside it, because a stable case with no argument is
 * indistinguishable from a normalizer that erases too much.
 *
 * Nothing scores this list on its own; it is spliced into `CORPUS`.
 */

import type { CorpusCase } from './corpus-case.js';

export const STABLE_CASES: readonly CorpusCase[] = [
  {
    id: 'class-churn/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1 (class attributes are not in the semantic snapshot)',
    rationale:
      'Only the salt fed to the class-name generator changed. Every declaration block ' +
      'emitted is byte-identical, so every resolved computed value is identical, so ' +
      'nothing a user or a screen reader can perceive differs. The names themselves ' +
      'record how a style was applied, not what was applied, and the snapshot already ' +
      'records the resolved what. In a real repo this perturbation is produced by ' +
      'editing an unrelated sibling component — the class hash is a function of file ' +
      'contents, not of the rule it names — so treating it as a change means every ' +
      'baseline in the repository invalidates on every CSS-in-JS edit anywhere.',
  },
  {
    id: 'class-churn/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'Same perturbation as `class-churn/button`, on a subject whose generated classes ' +
      'coexist with hand-written ones (`ks-card`, `ks-card__body`). The pair matters: a ' +
      'normalizer that dropped only names matching a generated-looking pattern would ' +
      'pass the Button case and could still churn here when the two kinds of name sit ' +
      'in the same `class` attribute. ADR-0003 does not classify class names, it drops ' +
      'the attribute, and this is where those two policies diverge.',
  },
  {
    id: 'class-churn/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'class-churn',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1; spec §6.2',
    rationale:
      'Hero declares no generated classes of its own; all the churn is in its children. ' +
      'If a hash moves here it localizes the defect to propagation through a composition ' +
      'boundary rather than to the leaf components, because the leaf cases (`button`, ' +
      '`card`) cover the leaves and the difference between the results is the evidence.',
  },
  {
    id: 'id-shift/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1 (structural aliasing)',
    rationale:
      "React's client `useId` draws from a module-global counter, so which stories a " +
      'developer opened first decides the ids in this one. Every id here changed value; ' +
      'no relationship changed — `for` still names the input, `aria-describedby` still ' +
      'names the help text. Aliasing in document order maps both renders onto the same ' +
      '`#a0`/`#a1` shape. The ground truth is not "ids are unimportant": it is that the ' +
      'accessible relationship survived intact, which is exactly what a user of the form ' +
      'experiences. The paired case `break-association/field` shows the same normalizer ' +
      'must not call *those* renders equal.',
  },
  {
    id: 'id-shift/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1; `ID_REFERENCE_LIST_ATTRIBUTES`',
    rationale:
      'Tabs route their renumbered ids through `aria-controls` and `aria-labelledby`, ' +
      'which are space-separated reference *lists*. An aliaser that rewrote single-value ' +
      'references and left list-valued ones alone passes `id-shift/field` and fails here. ' +
      'The two cases exist to be different for that one reason.',
  },
  {
    id: 'id-shift/dialog',
    subject: 'dialog',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'The dialog is closed in both renders, so the whole subject is inside the container ' +
      'and the portal ambiguity does not arise. Isolating renumbering from the portal ' +
      'question is the point: if `dialog-open/dialog` fails and this passes, the portal ' +
      'boundary is implicated and aliasing is not.',
  },
  {
    id: 'id-shift/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'id-shift',
    expect: 'hash-stable',
    spec: 'ADR-0003 §1',
    rationale:
      'Renumbering reaching a nested Field through two composition boundaries. Aliases are ' +
      'assigned in document order of first occurrence, which is a property of the whole ' +
      'subtree rather than of the component that generated the id — so this case checks ' +
      'that the aliaser walks the subject, not each component in isolation.',
  },
  {
    id: 'css-accretion/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-accretion',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 3 (rules matching no node are dropped)',
    rationale:
      'The headline claim. Between the two renders the document gained roughly fifteen ' +
      'times more CSS: harness chrome, 400 dead utility classes, and four generations of ' +
      "generated rules belonging to stories this subject never rendered. Not one of them " +
      'matches a node in the subject, so not one can affect its appearance, so none may ' +
      'affect its digest. Note that the baseline is not clean either — it already carries ' +
      'chrome and one generation of stale rules. The claim under test is the strong one: ' +
      'irrelevant CSS *growing during a session* does not move the hash. That is the shape ' +
      'the real failure takes.',
  },
  {
    id: 'css-accretion/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'css-accretion',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 3',
    rationale:
      'Same accretion against a deeper subtree with more distinct class names, so more ' +
      'opportunities for an accidental match. If this fails while `css-accretion/card` ' +
      'passes, the pruner is matching too loosely rather than not pruning at all.',
  },
  {
    id: 'css-losing-rules/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-losing-rules',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 5 (resolve the cascade; losers cannot affect the digest)',
    rationale:
      'The injected `.ks-card__body { color: #ff0000 }` (0,1,0) does match a node in the ' +
      'subject — so step 3 keeps it — and then loses the cascade to ' +
      '`.ks-card .ks-card__body` (0,2,0). A declaration that loses cannot affect the ' +
      'render, so it must not affect the hash. This is the case that separates "prune by ' +
      'matching" from "prune by matching and then resolve", and it is not academic: ' +
      'specificity churn that reshuffles losers without moving any winner is routine in ' +
      'a maturing design system, and each occurrence would otherwise invalidate baselines.',
  },
  {
    id: 'css-losing-rules/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'css-losing-rules',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 5',
    rationale:
      'The same principle where the loser is a bare type selector (`input`) rather than a ' +
      'class. Worth a second case because a matcher that buckets rules by their rightmost ' +
      'simple selector — the JSDOM strategy ADR-0003 names explicitly — handles type ' +
      'selectors on a different code path than class selectors, and the two paths can ' +
      'disagree about specificity.',
  },
  {
    id: 'css-unmatched-media/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'css-unmatched-media',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 2 (flatten conditionals against the declared environment)',
    rationale:
      'The added rules would visibly change the card — 40px text in bright green — if ' +
      'their conditions held. They do not: the viewport is nowhere near 99999px and ' +
      '`display: nonsense-value` is not supported. Conditions are render inputs, recorded ' +
      'in the environment key, not content to be digested. A normalizer that hashed sheet ' +
      'text would fail this while producing renders that are pixel-identical.',
  },
  {
    id: 'spelling/card',
    subject: 'card',
    baseVariant: 'base',
    perturbedVariant: 'spelling-longhand',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 6; `STYLE_ALLOWLIST` (longhands only)',
    rationale:
      '`padding: 16px 16px` and four `padding-*: 16px` declarations resolve to the same ' +
      'four computed values; likewise `border-radius` and its four corner longhands. The ' +
      'allowlist admits longhands only and shorthands are expanded before matching, so ' +
      'the two renders normalize to the same declarations. The stakes are ordinary: a ' +
      'stylelint `--fix` or a Prettier-adjacent rewrite performs this edit across a whole ' +
      'repository in one commit, and it must not read as a repository-wide regression. ' +
      'Only shorthands with a clean longhand decomposition are used here; see the journal ' +
      'for the ones deliberately left out. Measured caveat: JSDOM discards a shorthand ' +
      'whose value contains `var()` while keeping the equivalent longhands, so a collector ' +
      'that trusts `getComputedStyle` under that profile sees a difference a browser does ' +
      'not. The ground truth is unaffected — the renders are identical in a real engine — ' +
      'but the expansion has to happen from the declared rule text.',
  },
  {
    id: 'spelling/button',
    subject: 'button',
    baseVariant: 'base',
    perturbedVariant: 'spelling-longhand',
    expect: 'hash-stable',
    spec: 'ADR-0003 §2 step 6',
    rationale:
      'The same rewrite where the declarations are emitted by the generated-class runtime ' +
      'rather than a static sheet. Expanding a shorthand also changes the generated class ' +
      'name, so this case is only a clean test of shorthand expansion if class churn is ' +
      'already handled — it depends on `class-churn/button`, and reading them together is ' +
      'how a failure here is attributed to the right rule.',
  },
  {
    id: 'wrapper-block/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-block',
    expect: 'hash-stable',
    spec: 'spec §4.2 (non-semantic wrappers are collapsed)',
    rationale:
      'Three `<div>`s interposed in a block formatting context, carrying no role, no ' +
      'class, no padding, no border and no background. Margins collapse through them, so ' +
      'every leaf occupies the same box it did and the accessibility tree is unchanged: ' +
      'a generic `<div>` contributes no node to it. Adding and removing wrapper elements ' +
      'is among the most common refactors in a React codebase, which is what makes this ' +
      'the load-bearing case for the `<2% false semantic misses` target rather than a ' +
      'curiosity.',
  },
  {
    id: 'wrapper-block/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-block',
    expect: 'hash-stable',
    spec: 'spec §4.2',
    rationale:
      'The same three inert `<div>`s, but wrapped around a real composition rather than ' +
      'a purpose-built fixture, so the subject root itself moves three levels deeper. ' +
      'That is what a "extract this into a layout component" refactor does, and it is ' +
      'the arrangement in which node paths shift for every node in the subject at once: ' +
      'if collapse runs after path assignment rather than before, this fails while ' +
      '`wrapper-block/wrappers` — where the wrappers sit below the root — passes.',
  },
  {
    id: 'wrapper-flex-contents/wrappers',
    subject: 'wrappers',
    baseVariant: 'base',
    perturbedVariant: 'wrapper-flex-contents',
    expect: 'hash-stable',
    spec: 'spec §4.2',
    rationale:
      'Wrappers inside a flex row, but with `display: contents`, so they generate no box ' +
      'at all and the leaves remain the flex items. This is the control for ' +
      '`wrapper-flex-block/wrappers`: same insertion, same context, and the only ' +
      'difference is one declaration that decides whether the wrapper is inert. If both ' +
      'cases produce the same verdict, the collapse rule is not consulting the box tree ' +
      'and its agreement with this case is luck.',
  },
  {
    id: 'all-cruft/hero',
    subject: 'hero',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003 (all rules, composed)',
    rationale:
      'Every no-op perturbation at once — renumbered ids, renamed classes, fifteen times ' +
      'the irrelevant CSS, added losing rules, false conditionals, longhand rewrites, and ' +
      'three inserted wrappers — against the deepest subject. Cruft never arrives one kind ' +
      'at a time, and the rules interact: aliasing assigns numbers in document order, so ' +
      'running it before wrapper collapse can see a different order than running it after. ' +
      'Every individual case can pass while this fails, and that failure is about rule ' +
      'ordering rather than about any single rule.',
  },
  {
    id: 'all-cruft/field',
    subject: 'field',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003',
    rationale:
      'The composed perturbation against the subject with the densest id references. ' +
      'Wrapper insertion moves nodes in document order while id renumbering changes the ' +
      'values being ordered; if alias assignment is order-sensitive in the wrong way, ' +
      'this is where it shows.',
  },
  {
    id: 'all-cruft/tabs',
    subject: 'tabs',
    baseVariant: 'base',
    perturbedVariant: 'all-cruft',
    expect: 'hash-stable',
    spec: 'ADR-0003',
    rationale:
      'The composed perturbation against reference *lists* and ARIA state. State must ' +
      'survive normalization untouched while everything around it is rewritten; a rule ' +
      'that over-reached into `aria-selected` or the tab/panel pairing would show here ' +
      'and not in `all-cruft/field`.',
  },
];
