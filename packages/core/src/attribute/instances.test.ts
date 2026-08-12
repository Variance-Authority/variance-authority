import { describe, expect, it } from 'vitest';
import { componentInstances } from './instances.js';
import { hashComponents } from './component-hash.js';
import { CHROMIUM_PROFILE, JSDOM_PROFILE } from '../format/profile.js';
import type { Rect } from '../format/capture.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * Per-instance hashing, tested on hand-written trees.
 *
 * The property under test is the one the aggregate cannot have: **two boundaries
 * that rendered the same thing agree, wherever they are and whatever else is on
 * the page.** Every test below is a way that could be false, and the three that
 * matter are the subject-ordinal alias, the sibling that shifts a path, and the
 * association that must survive being re-aliased.
 */

interface Spec {
  readonly tag: string;
  readonly owner?: string;
  readonly props?: string;
  readonly alias?: string;
  readonly text?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly style?: Readonly<Record<string, string>>;
  readonly tokens?: Readonly<Record<string, string>>;
  readonly rect?: Rect;
  readonly children?: readonly Spec[];
}

function tree(spec: Spec, path = '0', inherited?: string): SemanticNode {
  const owner = spec.owner ?? inherited;
  const own = spec.owner !== undefined && spec.owner !== inherited;

  return {
    path,
    tag: spec.tag,
    attributes: spec.attributes ?? {},
    style: spec.style ?? {},
    ...(spec.alias !== undefined ? { alias: spec.alias } : {}),
    ...(spec.text !== undefined ? { text: spec.text } : {}),
    ...(spec.tokens !== undefined ? { tokens: spec.tokens } : {}),
    ...(spec.rect !== undefined ? { rect: spec.rect } : {}),
    ...(owner !== undefined
      ? {
          provenance: {
            owners: [{ name: owner, propsDigest: own ? (spec.props ?? 'v1:default') : 'v1:inherited' }],
          },
        }
      : {}),
    children: (spec.children ?? []).map((child, index) => tree(child, `${path}/${index}`, owner)),
  };
}

function snapshotOf(spec: Spec, layout = false): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'story' },
    profile: layout ? CHROMIUM_PROFILE : JSDOM_PROFILE,
    environment: { semanticDigest: 'v1:e', rasterDigest: 'v1:r', inputs: {} } as never,
    renderHash: 'v1:0',
    structureHash: 'v1:0',
    styleHash: 'v1:0',
    root: tree(spec),
    styleProvenance: [],
    diagnostics: [],
  };
}

const CHIP = (label: string, props = 'v1:chip'): Spec => ({
  tag: 'span',
  owner: 'Chip',
  props,
  children: [{ tag: 'em', text: label }],
});

/** The narrow example: one Chip, on its own. */
const STORY = snapshotOf({ tag: 'div', owner: 'Story', children: [CHIP('done')] });

/** The page: the same Chip, third in a list, inside two more components. */
const PAGE = snapshotOf({
  tag: 'div',
  owner: 'App',
  children: [
    { tag: 'h1', owner: 'Header', children: [{ tag: 'span', text: 'todos' }] },
    {
      tag: 'footer',
      owner: 'Footer',
      children: [CHIP('all'), CHIP('active'), CHIP('done')],
    },
  ],
});

function find(snapshot: SemanticSnapshot, component: string, nth = 0) {
  const found = componentInstances(snapshot).filter((each) => each.component === component);
  const instance = found[nth];
  if (instance === undefined) throw new Error(`no instance ${nth} of ${component}`);
  return instance;
}

describe('an instance is addressable where a name is not', () => {
  it('produces one record per boundary, in document order', () => {
    expect(componentInstances(PAGE).map((each) => each.component)).toEqual([
      'App',
      'Header',
      'Footer',
      'Chip',
      'Chip',
      'Chip',
    ]);
  });

  it('counts the same boundaries the aggregate counts', () => {
    const aggregate = hashComponents(PAGE).find((each) => each.component === 'Chip');
    const perInstance = componentInstances(PAGE).filter((each) => each.component === 'Chip');

    expect(perInstance).toHaveLength(aggregate?.instances ?? 0);
  });

  it('carries the path, so a finding can name which one', () => {
    expect(find(PAGE, 'Chip', 2).path).toBe('0/1/2');
  });

  it('carries the enclosing boundary and the depth', () => {
    expect(find(PAGE, 'Chip', 0)).toMatchObject({ within: 'Footer', depth: 2 });
    expect(find(PAGE, 'App')).toMatchObject({ depth: 0 });
    expect(find(PAGE, 'App').within).toBeUndefined();
  });

  it('carries the child boundaries as the edges of the graph', () => {
    expect(find(PAGE, 'Footer').renders).toEqual(['Chip', 'Chip', 'Chip']);
    expect(find(PAGE, 'Chip', 0).renders).toEqual([]);
  });
});

describe('the join across subjects', () => {
  it('agrees between a narrow example and the same component inside a page', () => {
    // The whole feature in one assertion. `Chip` renders `done` in a
    // one-component story and third-in-a-list inside two enclosing components,
    // and the two are the same bytes.
    expect(find(STORY, 'Chip').rendering).toBe(find(PAGE, 'Chip', 2).rendering);
  });

  it('disagrees when the rendering differs, at the band that differs', () => {
    const all = find(PAGE, 'Chip', 0);
    const done = find(PAGE, 'Chip', 2);

    expect(all.rendering).not.toBe(done.rendering);
    expect(all.structure).toBe(done.structure);
    expect(all.text).not.toBe(done.text);
  });

  it('is not disturbed by a sibling inserted above it', () => {
    const shifted = snapshotOf({
      tag: 'div',
      owner: 'Story',
      children: [{ tag: 'hr' }, CHIP('done')],
    });

    expect(find(shifted, 'Chip').rendering).toBe(find(STORY, 'Chip').rendering);
    expect(find(shifted, 'Chip').path).not.toBe(find(STORY, 'Chip').path);
  });

  it('survives the subject-ordinal alias, which is the reason it can', () => {
    // Identical fields, mounted at different points in two subjects, so the
    // normalizer hands them different `#aN`. Under the aggregate's alias space
    // these two never agree, and the disagreement is about nothing.
    const field = (alias: string, forId: string): Spec => ({
      tag: 'div',
      owner: 'Field',
      children: [
        { tag: 'input', alias, attributes: { type: 'text' } },
        { tag: 'label', attributes: { for: forId }, text: 'Name' },
      ],
    });

    const early = snapshotOf({ tag: 'div', owner: 'Story', children: [field('#a0', '#a0')] });
    const late = snapshotOf({
      tag: 'div',
      owner: 'App',
      children: [
        { tag: 'nav', alias: '#a0', children: [{ tag: 'a', alias: '#a1', text: 'x' }] },
        field('#a2', '#a2'),
      ],
    });

    expect(find(late, 'Field').rendering).toBe(find(early, 'Field').rendering);
  });

  it('keeps a broken association broken', () => {
    // The point of aliasing rather than masking (ADR-0003), and it must not be
    // lost when the alias space is re-scoped: a label pointing at nothing is an
    // accessibility regression, not a renumbering.
    const joined = snapshotOf({
      tag: 'div',
      owner: 'Field',
      children: [
        { tag: 'input', alias: '#a0' },
        { tag: 'label', attributes: { for: '#a0' } },
      ],
    });
    const broken = snapshotOf({
      tag: 'div',
      owner: 'Field',
      children: [
        { tag: 'input', alias: '#a0' },
        { tag: 'label', attributes: { for: '#a9' } },
      ],
    });

    expect(find(broken, 'Field').rendering).not.toBe(find(joined, 'Field').rendering);
  });

  it('does not fold a child component’s internal ids into its parent', () => {
    const parent = (childAlias: string): SemanticSnapshot =>
      snapshotOf({
        tag: 'div',
        owner: 'Card',
        children: [
          { tag: 'p', alias: '#a0' },
          { tag: 'div', owner: 'Inner', children: [{ tag: 'span', alias: childAlias }] },
        ],
      });

    expect(find(parent('#a1'), 'Card').rendering).toBe(find(parent('#a7'), 'Card').rendering);
  });

  it('leaves geometry out of the joining digest and beside it', () => {
    const boxed = (x: number): SemanticSnapshot =>
      snapshotOf(
        {
          tag: 'div',
          owner: 'Story',
          children: [{ ...CHIP('done'), rect: { x, y: 0, width: 10, height: 10 } }],
        },
        true,
      );

    expect(find(boxed(0), 'Chip').rendering).toBe(find(boxed(400), 'Chip').rendering);
    expect(find(boxed(0), 'Chip').geometry).not.toBe(find(boxed(400), 'Chip').geometry);
  });

  it('omits geometry entirely under a profile with no layout', () => {
    expect(find(STORY, 'Chip').geometry).toBeUndefined();
  });
});

describe('what an instance carries beside its digests', () => {
  it('carries the props digest of the boundary it is', () => {
    expect(find(PAGE, 'Chip', 0).props).toBe('v1:chip');
  });

  it('omits props when the collector supplied no provenance', () => {
    const bare = snapshotOf({ tag: 'div', children: [{ tag: 'span' }] });
    expect(find(bare, '(unattributed)').props).toBeUndefined();
  });

  it('carries the tokens its own nodes resolve through, and not a child’s', () => {
    const themed = snapshotOf({
      tag: 'div',
      owner: 'Card',
      style: { color: 'red' },
      tokens: { '--brand': 'red' },
      children: [
        { tag: 'div', owner: 'Inner', style: { gap: '8px' }, tokens: { '--space': '8px' } },
      ],
    });

    expect(find(themed, 'Card').tokens).toEqual(['--brand']);
    expect(find(themed, 'Inner').tokens).toEqual(['--space']);
  });
});
