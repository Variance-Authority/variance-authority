import { describe, expect, it } from 'vitest';
import { cappedLayers, relationBetween, restrictedImports, type RuleFile } from './restrictions.js';

const record = (file: string, ...targets: string[]) => ({ file, edges: targets.map((to) => ({ to, kind: 'value' as const })) });

/** `packages/core` is closed to the outside; inside it everything may reach everything. */
const fenced: RuleFile[] = [
  {
    directory: 'packages/core',
    rules: [
      { from: '.', to: '.', type: 'allowed' },
      { to: '.', type: 'restricted', message: 'core is internal' },
    ],
  },
];

describe('relationBetween', () => {
  it('lets a folder reach itself and closes it to the outside, first match winning', () => {
    expect(relationBetween(fenced, 'packages/core/a.ts', 'packages/core/b.ts')?.rule.type).toBe('allowed');
    expect(relationBetween(fenced, 'packages/app/a.ts', 'packages/core/b.ts')?.rule.message).toBe('core is internal');
  });

  it('decides nothing for an import no rule names', () => {
    expect(relationBetween(fenced, 'packages/app/a.ts', 'packages/app/b.ts')).toBeUndefined();
  });

  it('reads the rules of a file above both ends, and lets the deeper file override', () => {
    const files: RuleFile[] = [
      { directory: '', rules: [{ from: '*', to: '**/__tests__/**', type: 'restricted', message: 'do not import tests' }] },
      { directory: 'packages/web', rules: [{ from: '.', to: '**/__tests__/**', type: 'allowed' }] },
    ];
    expect(relationBetween(files, 'packages/api/a.ts', 'packages/api/__tests__/x.ts')?.rule.type).toBe('restricted');
    expect(relationBetween(files, 'packages/web/a.test.ts', 'packages/web/__tests__/x.ts')?.rule.type).toBe('allowed');
  });

  it('matches a glob against the path or any folder above it', () => {
    const files: RuleFile[] = [{ directory: '', rules: [{ from: 'pages/*', to: 'pages/*', type: 'restricted' }] }];
    expect(relationBetween(files, 'pages/a/index.ts', 'pages/b/index.ts')?.rule.type).toBe('restricted');
  });
});

describe('a family of packages named alike, in one flat directory', () => {
  /** `postoffice` is the face; `postoffice-*` are its internals, open to the family and no one else. */
  const family: RuleFile[] = [
    {
      directory: 'packages',
      rules: [
        { from: 'postoffice', to: 'postoffice-*', type: 'allowed' },
        { from: 'postoffice-*', to: 'postoffice-*', type: 'allowed' },
        { to: 'postoffice-*', type: 'restricted', message: 'postoffice-* is internal to postoffice' },
      ],
    },
  ];
  const violations = (...pairs: [string, string][]) =>
    restrictedImports(pairs.map(([from, to]) => record(from, to)), family).map((v) => `${v.from} > ${v.to}`);

  it('lets the face and every member use the members', () => {
    expect(
      violations(
        ['packages/postoffice/index.ts', 'packages/postoffice-stamps/index.ts'],
        ['packages/postoffice-stamps/index.ts', 'packages/postoffice-routes/graph.ts'],
      ),
    ).toEqual([]);
  });

  it('lets anyone use the face', () => {
    expect(violations(['packages/checkout/pay.ts', 'packages/postoffice/index.ts'])).toEqual([]);
  });

  it('closes the members to every other package, whatever else it is named', () => {
    expect(
      violations(
        ['packages/checkout/pay.ts', 'packages/postoffice-stamps/index.ts'],
        ['packages/postofficer/a.ts', 'packages/postoffice-routes/graph.ts'],
      ),
    ).toEqual([
      'packages/checkout/pay.ts > packages/postoffice-stamps/index.ts',
      'packages/postofficer/a.ts > packages/postoffice-routes/graph.ts',
    ]);
  });
});

describe('a public package inside a folder of internals', () => {
  /** `src/houses/cards` is closed to the outside except its `house-of-cards` entry. */
  const cards: RuleFile[] = [
    {
      directory: 'src/houses/cards',
      rules: [
        { to: 'house-of-cards', type: 'allowed' },
        { from: '.', to: '.', type: 'allowed' },
        { to: '.', type: 'restricted', message: 'use house-of-cards; the rest of cards is internal' },
      ],
    },
  ];
  const decide = (from: string, to: string) => relationBetween(cards, from, to)?.rule.type;

  it('opens house-of-cards to everyone', () => {
    expect(decide('src/app/table.ts', 'src/houses/cards/house-of-cards/index.ts')).toBe('allowed');
    expect(decide('src/houses/other/hand.ts', 'src/houses/cards/house-of-cards/index.ts')).toBe('allowed');
  });

  it('lets what is inside cards use the rest of cards', () => {
    expect(decide('src/houses/cards/house-of-cards/index.ts', 'src/houses/cards/deck/shuffle.ts')).toBe('allowed');
  });

  it('closes the rest of cards to what is outside it', () => {
    expect(decide('src/app/table.ts', 'src/houses/cards/deck/shuffle.ts')).toBe('restricted');
    expect(decide('src/houses/other/hand.ts', 'src/houses/cards/deck/shuffle.ts')).toBe('restricted');
  });

  it('leaves imports elsewhere in src/houses unrestricted', () => {
    expect(decide('src/app/table.ts', 'src/houses/other/hand.ts')).toBeUndefined();
  });
});

describe('a ceiling on the layer of a package', () => {
  const layer = (name: string, layer: number) => ({ package: name, directory: `packages/${name}`, layer });
  const layers = [layer('ui', 6), layer('ui-forms', 4), layer('postoffice', 2), layer('postoffice-stamps', 4), layer('postoffice-routes', 3), layer('app', 9)];
  const listed = (files: RuleFile[]) => cappedLayers(layers, files).map((v) => `${v.package} ${v.layer}>${v.maxLayer}`);

  it('caps every package under a folder', () => {
    const files: RuleFile[] = [{ directory: 'packages', rules: [], caps: [{ for: 'ui', maxLayer: 5 }] }];
    expect(listed(files)).toEqual(['ui 6>5']);
    expect(listed([{ directory: 'packages', rules: [], caps: [{ for: '.', maxLayer: 5 }] }])).toEqual(['app 9>5', 'ui 6>5']);
  });

  it('caps the packages a naming glob holds and none named otherwise', () => {
    const files: RuleFile[] = [{ directory: 'packages', rules: [], caps: [{ for: 'postoffice-*', maxLayer: 3 }] }];
    expect(listed(files)).toEqual(['postoffice-stamps 4>3']);
  });

  it('lets the lowest ceiling decide and reports the file that wrote it', () => {
    const files: RuleFile[] = [
      { directory: '', rules: [], caps: [{ for: 'packages', maxLayer: 8 }] },
      { directory: 'packages', rules: [], caps: [{ for: 'ui*', maxLayer: 3, message: 'ui stays shallow' }] },
    ];
    expect(cappedLayers(layers, files)).toEqual([
      { package: 'app', layer: 9, maxLayer: 8, directory: '' },
      { package: 'ui', layer: 6, maxLayer: 3, directory: 'packages', message: 'ui stays shallow' },
      { package: 'ui-forms', layer: 4, maxLayer: 3, directory: 'packages', message: 'ui stays shallow' },
    ]);
  });

  it('fails a capped package when a dependency below it makes its derived layer exceed the ceiling', () => {
    const files: RuleFile[] = [{ directory: 'packages', rules: [], caps: [{ for: 'payments', maxLayer: 5 }] }];
    const at = (ledger: number, payments: number) => [layer('ledger', ledger), layer('payments', payments)];

    expect(cappedLayers(at(4, 5), files)).toEqual([]);
    expect(cappedLayers(at(5, 6), files).map((v) => `${v.package} ${v.layer}>${v.maxLayer}`)).toEqual(['payments 6>5']);
  });

  it('finds nothing without ceilings', () => {
    expect(listed([{ directory: '', rules: [] }])).toEqual([]);
  });
});

describe('restrictedImports', () => {
  it('lists each restricted import once, in code-unit order, with the rule file that decided it', () => {
    const records = [
      record('packages/app/z.ts', 'packages/core/a.ts', 'packages/core/a.ts'),
      record('packages/app/a.ts', 'packages/core/a.ts', 'packages/app/z.ts'),
      record('packages/core/a.ts', 'packages/core/b.ts'),
    ];

    expect(restrictedImports(records, fenced)).toEqual([
      { from: 'packages/app/a.ts', to: 'packages/core/a.ts', message: 'core is internal', directory: 'packages/core' },
      { from: 'packages/app/z.ts', to: 'packages/core/a.ts', message: 'core is internal', directory: 'packages/core' },
    ]);
  });

  it('finds nothing without rules', () => {
    expect(restrictedImports([record('a.ts', 'b.ts')], [])).toEqual([]);
  });
});
