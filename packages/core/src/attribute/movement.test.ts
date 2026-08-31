import { describe, expect, it } from 'vitest';
import { composeSubjects } from './composition.js';
import { SUITE, chip, instance } from './composition-fixture.js';
import { attributeMovement } from './movement.js';

/**
 * Why a component moved, and what the answer costs when it is wrong.
 *
 * The ladder had no test file of its own, and the rung that suffered for it was
 * the third one. `upstream` reads *an ancestor was edited*, was implemented as
 * *a parent was edited*, and a React tree is mostly components that draw one
 * wrapper each — so on every real suite it returned nothing and the movement
 * fell to `unexplained` over an edit the run was holding the graph for. Two
 * rungs is the case, and it is here.
 *
 * The other half of the cost is an answer that is confident and about the wrong
 * file. The enclosure graph is folded over the whole suite, so the walk has the
 * cart available as an explanation for a product page and has to refuse it.
 */


describe('the ancestor rung climbs, and only inside the subject that moved', () => {
  /**
   * The shape every React application is made of, and the one that made this rung
   * dead code: `ProductCard` writes a `Card`, `Card` writes a `CardFooter`, and
   * the edit is two rungs above the thing the pixels named. The wrong answer is
   * also available and reached — `CartCard` draws the same `Card` in the cart —
   * which is what the subject constraint is for.
   */
  const NESTED = composeSubjects([
    {
      subject: 'story:product-card--sale',
      instances: [
        instance({ component: 'ProductCard', path: '0', depth: 0, renders: ['Card'] }),
        instance({
          component: 'Card',
          path: '0/0',
          depth: 1,
          within: 'ProductCard',
          renders: ['CardFooter'],
        }),
        instance({
          component: 'CardFooter',
          path: '0/0/1',
          depth: 2,
          within: 'Card',
          props: 'v1:footer',
        }),
      ],
    },
    {
      subject: 'story:cart-card--item',
      instances: [
        instance({ component: 'CartCard', path: '0', depth: 0, renders: ['Card'] }),
        instance({
          component: 'Card',
          path: '0/0',
          depth: 1,
          within: 'CartCard',
          renders: ['CardFooter'],
        }),
        instance({
          component: 'CardFooter',
          path: '0/0/1',
          depth: 2,
          within: 'Card',
          props: 'v1:footer',
        }),
      ],
    },
  ]);

  const FOOTER = [
    { subject: 'story:product-card--sale', component: 'CardFooter', bands: ['geometry'] as const },
  ];

  const DECLARED = new Map([
    ['CardFooter', ['src/ds/card.tsx']],
    ['Card', ['src/ds/card.tsx']],
    ['ProductCard', ['src/product-card.tsx']],
    ['CartCard', ['src/cart-card.tsx']],
  ]);

  it('reaches an edit two rungs up, past a wrapper nobody touched', () => {
    // One look up arrives at `Card`, whose file is not in the change set, and the
    // movement falls to `unexplained` over an edit the run is holding the graph
    // for. That was every `unexplained` this ladder produced on a real suite.
    const attribution = attributeMovement(FOOTER, NESTED, {
      changed: ['src/product-card.tsx'],
      declaredIn: DECLARED,
    });

    expect(attribution.movements[0]).toMatchObject({
      cause: 'upstream',
      upstream: 'ProductCard',
      through: ['Card'],
    });
    expect(attribution.suspects).toEqual([]);
  });

  it('says how the edit reaches it, because that is the reviewer’s next question', () => {
    const attribution = attributeMovement(FOOTER, NESTED, {
      changed: ['src/product-card.tsx'],
      declaredIn: DECLARED,
    });

    expect(attribution.movements[0]?.because).toBe(
      '`ProductCard` was edited and reaches it through `Card`; nothing edited its own file, ' +
        'so it moved on what it was given',
    );
  });

  it('refuses an edited ancestor that encloses it in some other subject', () => {
    // `Card` is drawn by the cart too, so a walk over the suite-wide enclosure
    // list hands a reviewer the cart as the reason a product story moved — an
    // answer that is confident, actionable, and about the wrong file.
    const attribution = attributeMovement(FOOTER, NESTED, {
      changed: ['src/cart-card.tsx'],
      declaredIn: DECLARED,
    });

    expect(attribution.movements[0]?.cause).toBe('unexplained');
    expect(attribution.movements[0]?.upstream).toBeUndefined();
  });

  /**
   * The same `CardFooter`, written by a different component on each page.
   *
   * `createdBy` is what a development build knows and enclosure does not: whose
   * JSX produced the element. Folded onto the entry it is the suite's whole set —
   * `['CartCard', 'ProductCard']` for this one name — and it is consulted
   * *before* the walk that refuses a cross-subject answer, so an unconstrained
   * read there wins over the constrained one underneath it and nothing further
   * down can catch it.
   */
  const WRITTEN = composeSubjects([
    {
      subject: 'story:product-card--sale',
      instances: [
        instance({ component: 'ProductCard', path: '0', depth: 0, renders: ['Card'] }),
        instance({
          component: 'Card',
          path: '0/0',
          depth: 1,
          within: 'ProductCard',
          renders: ['CardFooter'],
        }),
        instance({
          component: 'CardFooter',
          path: '0/0/1',
          depth: 2,
          within: 'Card',
          createdBy: 'ProductCard',
          props: 'v1:footer',
        }),
      ],
    },
    {
      subject: 'story:cart-card--item',
      instances: [
        instance({ component: 'CartCard', path: '0', depth: 0, renders: ['Card'] }),
        instance({
          component: 'Card',
          path: '0/0',
          depth: 1,
          within: 'CartCard',
          renders: ['CardFooter'],
        }),
        instance({
          component: 'CardFooter',
          path: '0/0/1',
          depth: 2,
          within: 'Card',
          createdBy: 'CartCard',
          props: 'v1:footer',
        }),
      ],
    },
  ]);

  it('refuses a creator that wrote it on some other page', () => {
    const attribution = attributeMovement(FOOTER, WRITTEN, {
      changed: ['src/cart-card.tsx'],
      declaredIn: DECLARED,
    });

    expect(attribution.movements[0]?.cause).toBe('unexplained');
    expect(attribution.movements[0]?.upstream).toBeUndefined();
  });

  it('takes the creator over the enclosure when it wrote it here', () => {
    // `ProductCard` both writes this footer and encloses it two rungs up. The
    // creator is the closer relationship and the sentence says so: it mounts it,
    // rather than reaching it through a wrapper that knows nothing about it.
    const attribution = attributeMovement(FOOTER, WRITTEN, {
      changed: ['src/product-card.tsx'],
      declaredIn: DECLARED,
    });

    expect(attribution.movements[0]).toMatchObject({
      cause: 'upstream',
      upstream: 'ProductCard',
    });
    expect(attribution.movements[0]?.through).toBeUndefined();
  });

  it('takes the nearest edit when two of them are above it', () => {
    const attribution = attributeMovement(FOOTER, NESTED, {
      changed: ['src/ds/card.tsx', 'src/product-card.tsx'],
      declaredIn: DECLARED,
    });

    // `Card` is edited too, and it is the rung a reviewer opens first. The
    // component's own file is in that same change set, so the `edited` rung takes
    // it before this one is consulted at all — which is the ladder working.
    expect(attribution.movements[0]).toMatchObject({ cause: 'edited', file: 'src/ds/card.tsx' });
  });
});

describe('attributing a movement', () => {
  const composition = composeSubjects(SUITE);
  const moved = [{ subject: 'story:page--default', component: 'Chip', bands: ['content'] as const }];

  it('names the file when the change set holds one', () => {
    const attribution = attributeMovement(moved, composition, {
      changed: ['src/ds/chip.tsx'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
    });

    expect(attribution.movements[0]).toMatchObject({ cause: 'edited', file: 'src/ds/chip.tsx' });
    expect(attribution.suspects).toEqual([]);
  });

  it('names the token when one this component reads moved', () => {
    const themed = composeSubjects([
      { subject: 'a', instances: [chip('0', 'Footer', { tokens: ['--brand'] })] },
    ]);

    const attribution = attributeMovement([{ subject: 'a', component: 'Chip', bands: [] }], themed, {
      changed: [],
      tokens: ['--brand', '--unused'],
    });

    expect(attribution.movements[0]).toMatchObject({ cause: 'token', tokens: ['--brand'] });
  });

  it('names an edited ancestor when the component’s own file held', () => {
    const attribution = attributeMovement(moved, composition, {
      changed: ['src/footer.tsx'],
      declaredIn: new Map([
        ['Chip', ['src/ds/chip.tsx']],
        ['Footer', ['src/footer.tsx']],
      ]),
    });

    expect(attribution.movements[0]).toMatchObject({ cause: 'upstream', upstream: 'Footer' });
  });

  it('calls it contradicted when one commit produced two renderings from one input', () => {
    const diverging = composeSubjects([
      SUITE[0]!,
      { subject: 'b', instances: [chip('0', 'Footer', { rendering: 'v1:other' })] },
    ]);

    const attribution = attributeMovement([{ subject: 'b', component: 'Chip', bands: [] }], diverging, {
      changed: [],
    });

    expect(attribution.movements[0]?.cause).toBe('contradicted');
  });

  it('calls it unexplained, and names the control group it held against', () => {
    const attribution = attributeMovement(moved, composition, {
      changed: ['docs/readme.md'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
    });

    expect(attribution.movements[0]?.cause).toBe('unexplained');
    expect(attribution.movements[0]?.held.map((site) => site.subject)).toEqual([
      'story:ds-chip--done',
    ]);
    expect(attribution.suspects).toHaveLength(1);
    expect(attribution.flakes).toEqual([]);
  });

  it('refuses a control whose hashes moved where no region named it', () => {
    // The movements are the *causal* regions, so a component whose digests moved
    // and whose box the pixels attributed to something else is not among them.
    // Read as a control, that render says the component held still in the one
    // place it demonstrably did not — and on the example that was every entry in
    // the list, all thirty-two of them.
    const attribution = attributeMovement(moved, composition, {
      changed: ['docs/readme.md'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
      hashesMoved: new Map([
        ['story:page--default', new Set(['Chip'])],
        ['story:ds-chip--done', new Set(['Chip'])],
      ]),
    });

    expect(attribution.movements[0]?.held).toEqual([]);
    expect(attribution.movements[0]?.because).toContain('every other render of it');
  });

  it('keeps a control the hashes agree held still', () => {
    const attribution = attributeMovement(moved, composition, {
      changed: ['docs/readme.md'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
      hashesMoved: new Map([
        ['story:page--default', new Set(['Chip'])],
        ['story:ds-chip--done', new Set(['Footer'])],
      ]),
    });

    expect(attribution.movements[0]?.held.map((site) => site.subject)).toEqual([
      'story:ds-chip--done',
    ]);
  });

  it('refuses a control in a subject whose hashes nobody read', () => {
    // Absent from a present map is *no baseline digests were there to compare*.
    // Unmeasured is not unchanged, and a control group is exactly the claim that
    // cannot be made from a render nobody looked at.
    const attribution = attributeMovement(moved, composition, {
      changed: ['docs/readme.md'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
      hashesMoved: new Map([['story:page--default', new Set(['Chip'])]]),
    });

    expect(attribution.movements[0]?.held).toEqual([]);
  });

  it('falls back to the movements when the run compared no hashes at all', () => {
    // An absent map is a run that never read digests — a raster-only tier. It
    // still has the movements, and the control group it can build from them is
    // weaker rather than unavailable.
    const attribution = attributeMovement(moved, composition, {
      changed: ['docs/readme.md'],
      declaredIn: new Map([['Chip', ['src/ds/chip.tsx']]]),
    });

    expect(attribution.movements[0]?.held.map((site) => site.subject)).toEqual([
      'story:ds-chip--done',
    ]);
  });

  it('keeps *nothing to compare against* apart from *they all moved*', () => {
    // Two empty control groups, opposite findings. `Footer` renders once in this
    // suite and has no comparison at all; `Chip` renders twice and moved in both,
    // which is the comparison, made, and answering.
    const alone = attributeMovement(
      [{ subject: 'story:page--default', component: 'Footer', bands: [] }],
      composition,
      { changed: ['docs/readme.md'] },
    );

    expect(alone.movements[0]?.because).toContain('renders nowhere else in this run');
  });

  it('will not produce a confident unexplained from a run that never asked', () => {
    // No `--since`, so the first rung is unreachable and nothing has established
    // that nobody edited anything. The movement still lands in `suspects` — it
    // is still worth a second reading — but the sentence says why it is there.
    const attribution = attributeMovement(moved, composition, {});

    expect(attribution.movements[0]?.because).toContain('--against');
  });

  it('separates a subject already proven unstable from one nobody read twice', () => {
    const attribution = attributeMovement(moved, composition, {
      changed: [],
      unstable: new Set(['story:page--default']),
    });

    expect(attribution.flakes).toHaveLength(1);
    expect(attribution.suspects).toEqual([]);
  });

  it('folds one cause across the subjects it moved in', () => {
    const attribution = attributeMovement(
      [
        { subject: 'story:page--default', component: 'Chip', bands: [] },
        { subject: 'story:ds-chip--done', component: 'Chip', bands: [] },
      ],
      composition,
      { changed: [] },
    );

    expect(attribution.movements[0]?.alsoIn).toEqual(['story:ds-chip--done']);
    // Nothing held: every site of it moved, so the suite offers no control.
    expect(attribution.movements[0]?.held).toEqual([]);
  });
});
