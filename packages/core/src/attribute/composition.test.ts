import { describe, expect, it } from 'vitest';
import { capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import { composeSubjects } from './composition.js';
import { SUITE, chip, instance } from './composition-fixture.js';
import { componentInstances } from './instances.js';
import { attributeMovement } from './movement.js';

/**
 * The suite as one graph, tested on instance lists rather than on trees.
 *
 * `instances.test.ts` proves the digests join. This proves what is made of them,
 * and the tests that matter are the two that must *not* fire: an echo inside one
 * subject is not a finding, and a divergence between instances whose props are
 * unknown is not a finding either — it is missing data wearing a finding's
 * clothes.
 */

describe('the census', () => {
  const composition = composeSubjects(SUITE);
  const chipEntry = composition.components.find((entry) => entry.component === 'Chip');

  it('counts subjects and instances separately', () => {
    expect(chipEntry).toMatchObject({ instances: 3, subjects: [
      'story:ds-chip--done',
      'story:page--default',
    ] });
  });

  it('names the subject that exists to show a component', () => {
    expect(chipEntry?.examples).toEqual([]);
    expect(
      composition.components.find((entry) => entry.component === 'Story')?.examples,
    ).toEqual(['story:ds-chip--done']);
  });

  it('records the graph in both directions', () => {
    expect(chipEntry?.within).toEqual(['Footer', 'Story']);
    expect(
      composition.components.find((entry) => entry.component === 'Footer')?.renders,
    ).toEqual(['Chip']);
  });

  it('splits a component by the props it received', () => {
    expect(chipEntry?.classes.map((group) => group.props)).toEqual(['v1:chip', 'v1:chip-all']);
  });

  it('sorts components in code-unit order, never by locale', () => {
    const names = composition.components.map((entry) => entry.component);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('drops the unattributed bucket, which is not a component', () => {
    const withBroken = composeSubjects([
      { subject: 's', instances: [instance({ component: '(unattributed)' })] },
    ]);

    expect(withBroken.components).toEqual([]);
  });
});

describe('echoes — the dots, connected', () => {
  it('reports one rendering shared by two subjects', () => {
    const [echo] = composeSubjects(SUITE).echoes;

    expect(echo).toMatchObject({ component: 'Chip', rendering: 'v1:chip-done' });
    expect(echo?.sites.map((site) => site.subject)).toEqual([
      'story:ds-chip--done',
      'story:page--default',
    ]);
  });

  it('says nothing about two identical instances inside one subject', () => {
    // Three identical chips in a list are three identical chips. The finding is
    // a rendering that survives being mounted somewhere else, because that is
    // the one a second subject is watching.
    const oneSubject = composeSubjects([
      {
        subject: 'story:page--default',
        instances: [chip('0/0', 'Footer'), chip('0/1', 'Footer')],
      },
    ]);

    expect(oneSubject.echoes).toEqual([]);
  });
});

describe('divergences — one commit, two answers', () => {
  const diverging = composeSubjects([
    SUITE[0]!,
    {
      subject: 'story:page--dark',
      instances: [chip('0/0', 'Footer', { rendering: 'v1:chip-dark', style: 'v1:dark' })],
    },
  ]);

  it('reports the same props rendering two ways, and which band differs', () => {
    expect(diverging.divergences).toHaveLength(1);
    expect(diverging.divergences[0]).toMatchObject({ component: 'Chip', bands: ['token'] });
  });

  it('refuses to compare instances whose props are unknown', () => {
    // Absent provenance is not evidence of shared inputs, and reporting a
    // divergence between two instances that are merely both mysterious would
    // manufacture a finding out of missing data.
    const unknown = composeSubjects([
      { subject: 'a', instances: [instance({ component: 'Chip', rendering: 'v1:one' })] },
      { subject: 'b', instances: [instance({ component: 'Chip', rendering: 'v1:two' })] },
    ]);

    expect(unknown.divergences).toEqual([]);
  });

  it('refuses two renderings that occur together in one subject', () => {
    // A component whose nodes are interrupted by a nested boundary is walked as
    // two boundaries under one owner frame — one `TextField` becomes a label
    // shape and an input shape sharing a props digest. Measured on
    // `examples/todomvc`: one instance, two pieces, and it looks exactly like a
    // component that renders two ways.
    const fragmented = composeSubjects([
      {
        subject: 'story:ds-field--empty',
        instances: [
          instance({ component: 'Field', path: '0/0', props: 'v1:f', rendering: 'v1:label' }),
          instance({ component: 'Field', path: '0/1', props: 'v1:f', rendering: 'v1:input' }),
        ],
      },
    ]);

    expect(fragmented.divergences).toEqual([]);
  });

  it('refuses two renderings that mounted different children', () => {
    // `propsDigest` excludes `children` by design, so `<Card><Stack/></Card>` and
    // `<Card><Text/></Card>` share a digest. Their different output is their
    // caller's doing, and blaming the component for it is a finding pointed at
    // the wrong file.
    const withChildren = composeSubjects([
      {
        subject: 'a',
        instances: [
          instance({ component: 'Card', props: 'v1:card', rendering: 'v1:one', renders: ['Stack'] }),
        ],
      },
      {
        subject: 'b',
        instances: [
          instance({ component: 'Card', props: 'v1:card', rendering: 'v1:two', renders: ['Text'] }),
        ],
      },
    ]);

    expect(withChildren.divergences).toEqual([]);
  });

  it('refuses two renderings whose own text differs, which is where a string child lands', () => {
    const withText = composeSubjects([
      {
        subject: 'a',
        instances: [
          instance({ component: 'Text', props: 'v1:t', rendering: 'v1:one', text: 'v1:contents' }),
        ],
      },
      {
        subject: 'b',
        instances: [
          instance({ component: 'Text', props: 'v1:t', rendering: 'v1:two', text: 'v1:body' }),
        ],
      },
    ]);

    expect(withText.divergences).toEqual([]);
  });
});

describe('the graph upwards has two edges, and they are not the same edge', () => {
  const composition = composeSubjects([
    {
      subject: 'story:page--default',
      instances: [
        instance({ component: 'Stack', path: '0', depth: 0, createdBy: 'TodoFooter' }),
        instance({
          component: 'Chip',
          path: '0/0',
          depth: 1,
          within: 'Stack',
          createdBy: 'TodoFooter',
        }),
      ],
    },
  ]);

  const chipEntry = composition.components.find((entry) => entry.component === 'Chip');

  it('separates where a boundary sits from who mounted it', () => {
    expect(chipEntry?.within).toEqual(['Stack']);
    expect(chipEntry?.createdBy).toEqual(['TodoFooter']);
  });

  it('names a caller that owns no node of its own and is therefore a boundary nowhere', () => {
    // `TodoFooter` renders nothing but other components. It appears in this graph
    // only as a caller, and it is the file a reviewer has to open.
    expect(composition.components.map((entry) => entry.component)).toEqual(['Chip', 'Stack']);
  });

  it('attributes an edit to the caller, not only to the enclosing wrapper', () => {
    const attribution = attributeMovement(
      [{ subject: 'story:page--default', component: 'Chip', bands: ['content'] }],
      composition,
      {
        changed: ['src/app/todo.tsx'],
        declaredIn: new Map([
          ['Chip', ['src/ds/components.tsx']],
          ['TodoFooter', ['src/app/todo.tsx']],
        ]),
      },
    );

    expect(attribution.movements[0]).toMatchObject({ cause: 'upstream', upstream: 'TodoFooter' });
  });
});

/**
 * A divergence that says which input moved.
 *
 * The claim a pixel differ structurally cannot make, with the half that makes it
 * actionable. `Price` declares a weight and no colour; the card it sits in
 * declares the colour. Two cards, two colours, one props digest — and the
 * finding is not "these disagree", it is *`color`, from above*.
 */
describe('why a divergence diverged', () => {
  const card = (subject: string, color: string) => {
    const snapshot = normalize(
      capture({
        subjectId: subject,
        inheritedSeed: { color },
        root: node({
          tag: 'div',
          owners: [{ name: 'Card', props: { tone: color } }],
          children: [
            node({
              tag: 'span',
              text: '$12.00',
              owners: [{ name: 'Price', props: { amount: 1200 } }, { name: 'Card' }],
              rules: [{ selector: '.price', declare: { 'font-weight': '600' } }],
            }),
          ],
        }),
      }),
    );
    return { subject, instances: componentInstances(snapshot), snapshot };
  };

  const SPLIT: readonly SubjectComposition[] = [
    card('receipt', '#111111'),
    card('promo', '#ffffff'),
  ];

  it('names the ancestor cascade rather than reporting a count', () => {
    const divergence = composeSubjects(SPLIT).divergences.find(
      (entry) => entry.component === 'Price',
    )!;

    expect(divergence.renderings).toHaveLength(2);
    expect(divergence.partings?.map((parting) => parting.rendering)).toEqual([1]);
    expect(divergence.partings![0]!.lines).toContain(
      'Price inherited a different `color` — an ancestor declared it',
    );
  });

  it('compares the component to itself, not the pages it was found in', () => {
    // Read as whole subjects these two are a receipt and a promo card and differ
    // everywhere. Lifted, they differ in one property, which is the answer.
    const parting = composeSubjects(SPLIT).divergences.find(
      (entry) => entry.component === 'Price',
    )!.partings![0]!;

    expect(parting.lines[0]).toBe('variation — an input moved and the page followed');
  });

  it('is absent, never empty, when the run kept no documents', () => {
    const withoutDocuments = SPLIT.map(({ subject, instances }) => ({ subject, instances }));

    const divergence = composeSubjects(withoutDocuments).divergences.find(
      (entry) => entry.component === 'Price',
    )!;

    expect(divergence.renderings).toHaveLength(2);
    expect(divergence.partings).toBeUndefined();
  });
});
