import { describe, expect, it } from 'vitest';
import type { BuildDetail, MovementView, SubjectView } from '../review-types.js';
import { rootsOf } from './cause.js';
import type { Appearance, Origin } from './grouping.js';

/**
 * Which cause in the commit each change hangs from.
 *
 * The failures worth guarding are all the same failure: a heading that names
 * something the commit did not do. A declaring file the reviewer never touched,
 * an owner promoted to a cause because a source index knew where it lived, one
 * of a component's two causes standing in for both. Each of those reads as *you
 * edited this*, which is the one sentence a review surface cannot be wrong about.
 */

const CHANGED = [
  'app/src/components/MainNav.tsx',
  'app/src/components/ProductCard.tsx',
  'app/src/components/ui/button.tsx',
];

function build(over: Partial<BuildDetail> = {}): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '10',
    commit: 'a'.repeat(40),
    at: '2026-08-31T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildDetail['identity'],
    retention: 'durable',
    verdicts: { changed: 1 } as BuildDetail['verdicts'],
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects: [],
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    reach: {
      against: 'HEAD~1',
      changed: CHANGED,
      components: [
        { component: 'Button', trail: ['app/src/components/ui/button.tsx', 'Button'] },
        { component: 'MainNav', trail: ['app/src/components/MainNav.tsx', 'MainNav'] },
        { component: 'ProductCard', trail: ['app/src/components/ProductCard.tsx', 'ProductCard'] },
      ],
    },
    ...over,
  };
}

function moved(over: Partial<MovementView> & Pick<MovementView, 'cause'>): MovementView {
  return {
    subject: 'story:product-card--sale',
    component: 'CardFooter',
    bands: ['geometry'],
    because: 'the run said so',
    held: [],
    ...over,
  };
}

function origin(component: string, movements: readonly MovementView[]): Origin {
  const appearances: Appearance[] = movements.map((movement) => ({
    subject: { subject: movement.subject, decision: null } as SubjectView,
    pixels: 10,
    alongside: [],
    movement,
  }));

  return { component, pixels: 10 * movements.length, appearances };
}

describe('what a change hangs from', () => {
  it('roots an edited component under the file the diff named', () => {
    const { roots, loose } = rootsOf(
      [origin('Button', [moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx' })])],
      build(),
    );

    expect(loose).toEqual([]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.kind).toBe('file');
    expect(roots[0]?.name).toBe('app/src/components/ui/button.tsx');
    expect(roots[0]?.changes.map(({ origin: each }) => each.component)).toEqual(['Button']);
  });

  it('roots a component on the owner rung under the file the commit changed', () => {
    // `CardFooter` is declared in a file nothing edited. What explains it is
    // `ProductCard.tsx`, which is in the change set and reaches `ProductCard`,
    // and that is the heading the reviewer recognises as their own work.
    const { roots } = rootsOf(
      [origin('CardFooter', [moved({ cause: 'upstream', upstream: 'ProductCard', through: ['Card'] })])],
      build(),
    );

    expect(roots).toEqual([
      expect.objectContaining({ kind: 'file', name: 'app/src/components/ProductCard.tsx' }),
    ]);
  });

  it('refuses a declaring file the commit did not change', () => {
    // The source index knows where `Sidebar` lives. That is not a cause: a
    // heading naming a path nobody edited is the page inventing an edit, and a
    // reviewer would open it looking for a change that is not in their branch.
    const known = build({
      causes: [
        { component: 'Sidebar', file: 'app/src/components/Sidebar.tsx', subjects: [], pixels: 0, collateralPixels: 0 },
      ],
    });

    const { roots } = rootsOf(
      [origin('Nav', [moved({ cause: 'upstream', upstream: 'Sidebar' })])],
      known,
    );

    expect(roots).toEqual([expect.objectContaining({ kind: 'component', name: 'Sidebar' })]);
  });

  it('prefers a component’s own edited file to the import at the head of its chain', () => {
    // `CartCard` is reached *through* `button.tsx`, and its own file is in the
    // change set too. Both are true; the one a reviewer is looking for is the
    // file they opened in their editor.
    const both = build({
      reach: {
        against: 'HEAD~1',
        changed: [...CHANGED, 'app/src/components/CartCard.tsx'],
        components: [
          {
            component: 'CartCard',
            trail: [
              'app/src/components/ui/button.tsx',
              'app/src/components/CartCard.tsx',
              'CartCard',
            ],
          },
        ],
      },
      causes: [
        { component: 'CartCard', file: 'app/src/components/CartCard.tsx', subjects: [], pixels: 0, collateralPixels: 0 },
      ],
    });

    const { roots } = rootsOf([origin('Badge', [moved({ cause: 'upstream', upstream: 'CartCard' })])], both);

    expect(roots).toEqual([
      expect.objectContaining({ name: 'app/src/components/CartCard.tsx' }),
    ]);
  });

  it('gives a token rung one root per property that moved', () => {
    const { roots } = rootsOf(
      [origin('Chip', [moved({ cause: 'token', tokens: ['--brand-500', '--radius-md'] })])],
      build(),
    );

    expect(roots.map((root) => [root.kind, root.name])).toEqual([
      ['token', '--brand-500'],
      ['token', '--radius-md'],
    ]);
  });

  it('lists a component with two causes under both, each carrying its share', () => {
    // The case a fold would get wrong. One `Button` is `edited` where the diff
    // names its file and `upstream` where a changed parent hands it a label, and
    // filing all seven renders under either heading tells a reviewer the commit
    // did something it did not.
    const { roots } = rootsOf(
      [
        origin('Button', [
          moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx', subject: 'a' }),
          moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx', subject: 'b' }),
          moved({ cause: 'upstream', upstream: 'MainNav', subject: 'c' }),
        ]),
      ],
      build(),
    );

    expect(roots.map((root) => [root.name, root.renders])).toEqual([
      ['app/src/components/MainNav.tsx', 1],
      ['app/src/components/ui/button.tsx', 2],
    ]);
    expect(roots.flatMap((root) => root.changes.map(({ of }) => of))).toEqual([1, 2]);
  });

  it('leaves the share off when the root accounts for every render', () => {
    // Absent is *all of them*, so the row has nothing to print in the ordinary
    // case. `3 of 3 renders` on every row is a denominator that never varies,
    // which is a column of noise a reader learns to skip past the one time it
    // does.
    const { roots } = rootsOf(
      [
        origin('Button', [
          moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx', subject: 'a' }),
          moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx', subject: 'b' }),
        ]),
      ],
      build(),
    );

    expect(roots[0]?.changes[0] && 'of' in roots[0].changes[0]).toBe(false);
  });

  it('leaves a rung with nothing in the commit above it loose', () => {
    // `unexplained` and a movement the store never carried are not causes and
    // must not be filed under one. They are what the docket ranks above every
    // heading here, and a root would bury them under it.
    const { roots, loose } = rootsOf(
      [
        origin('Ghost', [moved({ cause: 'unexplained' })]),
        origin('Silent', []),
        origin('Fickle', [moved({ cause: 'contradicted' })]),
      ],
      build(),
    );

    expect(roots).toEqual([]);
    expect(loose.map((each) => each.component)).toEqual(['Ghost', 'Silent', 'Fickle']);
  });

  it('drops an edited rung the run recorded no file for rather than guessing one', () => {
    const { roots, loose } = rootsOf([origin('Button', [moved({ cause: 'edited' })])], build());

    expect(roots).toEqual([]);
    expect(loose.map((each) => each.component)).toEqual(['Button']);
  });

  it('orders files, then properties, then the owners the commit misses', () => {
    const { roots } = rootsOf(
      [
        origin('A', [moved({ cause: 'upstream', upstream: 'Sidebar' })]),
        origin('B', [moved({ cause: 'token', tokens: ['--brand-500'] })]),
        origin('C', [moved({ cause: 'edited', file: 'app/src/components/ui/button.tsx' })]),
      ],
      build(),
    );

    expect(roots.map((root) => root.kind)).toEqual(['file', 'token', 'component']);
  });
});
