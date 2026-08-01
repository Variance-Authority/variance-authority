import { describe, expect, it } from 'vitest';
import { buildDocket, summarize } from './docket.js';
import { diffSnapshots } from './diff/index.js';
import { normalize } from './normalize/index.js';
import { capture, node } from './normalize/fixture.js';
import type { SemanticDiff } from './diff/index.js';

/**
 * Design-system collateral: the question a per-subject diff cannot answer.
 *
 * One token edit reaches every subject that consumes it. Reviewed per subject
 * that is three hundred things to click through, and the three-hundred-and-first
 * gets approved without being read. The docket inverts the unit: one cause, one
 * entry, with the count of what it reached — which is the only shape in which
 * spec §6.2's "approval MUST be one action" is achievable at all.
 */

/** A subject consuming `--brand` through `color`, plus its own component. */
function themedSubject(subjectId: string, component: string, brand: string): SemanticDiff {
  const build = (value: string) =>
    capture({
      subjectId,
      root: node({
        rules: [{ selector: ':root', declare: { '--brand': value } }],
        owners: [{ name: 'Page', props: {} }],
        children: [
          node({
            tag: 'button',
            owners: [{ name: component, props: {} }, { name: 'Page', props: {} }],
            rules: [{ selector: '.x', declare: { color: 'var(--brand)' } }],
          }),
        ],
      }),
    });

  return diffSnapshots(normalize(build('#000000')), normalize(build(brand)));
}

/** A subject nothing touched. */
function unchangedSubject(subjectId: string): SemanticDiff {
  const build = () => capture({ subjectId, root: node({ tag: 'p', text: 'static' }) });
  return diffSnapshots(normalize(build()), normalize(build()));
}

describe('collapsing a design-system change', () => {
  const diffs = [
    themedSubject('story:button', 'Button', '#ff0000'),
    themedSubject('story:card', 'Card', '#ff0000'),
    themedSubject('story:hero', 'Hero', '#ff0000'),
    unchangedSubject('story:legal-text'),
  ];

  it('reports one entry for one token, however many subjects it reached', () => {
    const docket = buildDocket(diffs);

    expect(docket.entries).toHaveLength(1);
    expect(docket.entries[0]!.kind).toBe('token');
    expect(docket.entries[0]!.label).toBe('--brand');
  });

  it('counts the collateral rather than listing it as separate findings', () => {
    const docket = buildDocket(diffs);
    const [entry] = docket.entries;

    expect(entry!.subjectCount).toBe(3);
    expect(entry!.deltaCount).toBeGreaterThanOrEqual(3);
  });

  it('says structure is intact, which is what makes it one action', () => {
    // "One token change, N collateral" is only reassuring alongside this. Without
    // it, a reviewer still has to check whether anything moved.
    expect(buildDocket(diffs).entries[0]!.structureIntact).toBe(true);
  });

  it('reports the change as paint, so no geometric collateral is possible', () => {
    // A colour token cannot move a box. That conclusion needs no layout engine
    // and no screenshot — it follows from the property that changed.
    expect(buildDocket(diffs).entries[0]!.impact).toBe('paint');
  });

  it('names every component the token reached', () => {
    const components = buildDocket(diffs).entries[0]!.components.map((c) => c.name);

    expect(components).toContain('Button');
    expect(components).toContain('Card');
    expect(components).toContain('Hero');
  });

  it('flags the whole change set as a single-root review', () => {
    expect(buildDocket(diffs).singleRoot).toBe(true);
  });

  it('excludes subjects that did not change from the count', () => {
    const docket = buildDocket(diffs);

    expect(docket.subjectsCompared).toBe(4);
    expect(docket.subjectsChanged).toBe(3);
    expect(docket.subjectsUnchanged).toBe(1);
  });

  it('offers a sample to spot-check rather than everything to review', () => {
    // Mass re-baselining is only survivable if approval is informed, and nobody
    // informs themselves by reviewing three hundred identical diffs (spec §7.3).
    const docket = buildDocket(diffs, { sampleSize: 2 });

    expect(docket.entries[0]!.sample).toHaveLength(2);
    expect(docket.entries[0]!.subjects).toHaveLength(3);
  });
});

describe('a spacing token, which is the same band but not the same risk', () => {
  function spacedSubject(subjectId: string, pad: string): SemanticDiff {
    const build = (value: string) =>
      capture({
        subjectId,
        root: node({
          rules: [{ selector: ':root', declare: { '--space': value } }],
          owners: [{ name: 'Page', props: {} }],
          children: [
            node({
              tag: 'div',
              owners: [{ name: 'Card', props: {} }, { name: 'Page', props: {} }],
              rules: [{ selector: '.x', declare: { 'padding-top': 'var(--space)' } }],
            }),
          ],
        }),
      });

    return diffSnapshots(normalize(build('4px')), normalize(build(pad)));
  }

  it('reports layout impact where the colour token reported paint', () => {
    // Same band, same shape of docket entry, opposite answer to "can this have
    // moved anything?". That is the distinction the frequency bands do not carry.
    const docket = buildDocket([spacedSubject('story:card', '12px')]);

    expect(docket.entries[0]!.band).toBe('token');
    expect(docket.entries[0]!.impact).toBe('layout');
  });
});

describe('several causes at once', () => {
  it('keeps them as separate entries, widest first', () => {
    const diffs = [
      themedSubject('story:a', 'Button', '#ff0000'),
      themedSubject('story:b', 'Card', '#ff0000'),
      diffSnapshots(
        normalize(
          capture({
            subjectId: 'story:c',
            root: node({
              tag: 'p',
              owners: [{ name: 'Legal', props: {} }],
              rules: [{ selector: '.x', declare: { 'font-size': '12px' } }],
            }),
          }),
        ),
        normalize(
          capture({
            subjectId: 'story:c',
            root: node({
              tag: 'p',
              owners: [{ name: 'Legal', props: {} }],
              rules: [{ selector: '.x', declare: { 'font-size': '14px' } }],
            }),
          }),
        ),
      ),
    ];

    const docket = buildDocket(diffs);

    expect(docket.entries).toHaveLength(2);
    expect(docket.entries[0]!.subjectCount).toBe(2);
    expect(docket.singleRoot).toBe(false);
  });
});

describe('the sentence', () => {
  it('states the cause, the reach, and whether structure held', () => {
    const summary = summarize(
      buildDocket([
        themedSubject('story:button', 'Button', '#ff0000'),
        themedSubject('story:card', 'Card', '#ff0000'),
        unchangedSubject('story:legal-text'),
      ]),
    );

    expect(summary).toContain('2 of 3 subjects changed');
    expect(summary).toContain('--brand');
    expect(summary).toContain('2 subjects');
    expect(summary).toContain('token/paint');
    expect(summary).toContain('structure intact');
  });

  it('says so plainly when nothing changed', () => {
    const summary = summarize(buildDocket([unchangedSubject('story:a'), unchangedSubject('story:b')]));
    expect(summary).toBe('2 subjects compared, nothing changed.');
  });
});
