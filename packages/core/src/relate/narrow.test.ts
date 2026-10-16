import { describe, expect, it } from 'vitest';
import { affectedBy, dependentsOf, idOf, relationsOfFiles, trailOf, type EdgeUse, type FileRecord } from './index.js';

/**
 * The walk narrowed by the names each importer uses.
 *
 * The safety half is the one to read first: every use the lookup cannot name
 * is charged whole, so a narrower answer is only ever earned by a recorded name.
 */

/**
 * `src/cart.ts` exports `total` and `label`; `src/index.ts` is a barrel over it;
 * each test imports one name, through the barrel or directly.
 */
const RECORDS: readonly FileRecord[] = [
  { file: 'src/cart.ts', declares: ['Cart'] },
  { file: 'src/index.ts', edges: [{ to: 'src/cart.ts', kind: 'reexports' }] },
  { file: 'src/all.ts', edges: [{ to: 'src/cart.ts', kind: 'reexports' }] },
  { file: 'test/total.test.ts', edges: [{ to: 'src/cart.ts', kind: 'imports' }] },
  { file: 'test/label.test.ts', edges: [{ to: 'src/cart.ts', kind: 'imports' }] },
  { file: 'test/barrel-total.test.ts', edges: [{ to: 'src/index.ts', kind: 'imports' }] },
  { file: 'test/barrel-label.test.ts', edges: [{ to: 'src/index.ts', kind: 'imports' }] },
  { file: 'test/star.test.ts', edges: [{ to: 'src/all.ts', kind: 'imports' }] },
  { file: 'test/lazy.test.ts', edges: [{ to: 'src/cart.ts', kind: 'dynamic' }] },
];

const USES: Readonly<Record<string, EdgeUse | undefined>> = {
  'src/index.ts>src/cart.ts': { reexports: [['total', 'sum'], ['label', 'label']] },
  'src/all.ts>src/cart.ts': { reexports: [['*', '*']] },
  'test/total.test.ts>src/cart.ts': { imports: ['total'] },
  'test/label.test.ts>src/cart.ts': { imports: ['label'] },
  'test/barrel-total.test.ts>src/index.ts': { imports: ['sum'] },
  'test/barrel-label.test.ts>src/index.ts': { imports: ['label'] },
  'test/star.test.ts>src/all.ts': { imports: ['label'] },
};

const graph = (uses: Readonly<Record<string, EdgeUse | undefined>> = USES) =>
  relationsOfFiles(RECORDS, { uses: (importer, target) => uses[`${importer}>${target}`] });

const reached = (moved: Record<string, readonly string[]>, uses?: Readonly<Record<string, EdgeUse | undefined>>) =>
  affectedBy(graph(uses), Object.keys(moved), { moved: new Map(Object.entries(moved)) }).files;

describe('a walk narrowed by the names each importer uses', () => {
  it('enters only the importers of an export that moved, directly and through a barrel', () => {
    expect(reached({ 'src/cart.ts': ['total'] })).toEqual([
      'src/all.ts',
      'src/cart.ts',
      'src/index.ts',
      'test/barrel-total.test.ts',
      'test/lazy.test.ts',
      'test/total.test.ts',
    ]);
  });

  it('carries a name through `export *` under its own name', () => {
    expect(reached({ 'src/cart.ts': ['label'] })).toContain('test/star.test.ts');
    expect(reached({ 'src/cart.ts': ['label'] })).not.toContain('test/barrel-total.test.ts');
  });

  it('enters nothing from a file whose change moved no export, but keeps the file', () => {
    expect(reached({ 'src/cart.ts': [] })).toEqual(['src/cart.ts']);
  });

  it('walks whole from a changed file it holds no reading for', () => {
    const whole = affectedBy(graph(), ['src/cart.ts'], { moved: new Map() }).files;
    expect(whole).toEqual(affectedBy(graph(), ['src/cart.ts']).files);
    expect(whole).toContain('test/label.test.ts');
  });

  it('charges an importer whole when the lookup names no use for its edge', () => {
    const unknown = { ...USES, 'test/label.test.ts>src/cart.ts': undefined };
    expect(reached({ 'src/cart.ts': ['total'] }, unknown)).toContain('test/label.test.ts');
  });

  it('charges every dependent of a barrel whose re-exports the parse never recorded', () => {
    const unrecorded = { ...USES, 'src/index.ts>src/cart.ts': {} };
    expect(reached({ 'src/cart.ts': ['total'] }, unrecorded)).toContain('test/barrel-label.test.ts');
  });

  it('walks whole over a graph that carries no lookup', () => {
    const plain = relationsOfFiles(RECORDS);
    const moved = new Map([['src/cart.ts', ['total']]]);
    expect(affectedBy(plain, ['src/cart.ts'], { moved }).files).toContain('test/label.test.ts');
  });

  it('grows a barrel that two changed files reach, and expands it again', () => {
    const records: FileRecord[] = [
      { file: 'src/a.ts' },
      { file: 'src/b.ts' },
      { file: 'src/index.ts', edges: [{ to: 'src/a.ts', kind: 'reexports' }, { to: 'src/b.ts', kind: 'reexports' }] },
      { file: 'test/b.test.ts', edges: [{ to: 'src/index.ts', kind: 'imports' }] },
    ];
    const uses: Record<string, EdgeUse> = {
      'src/index.ts>src/a.ts': { reexports: [['a', 'a']] },
      'src/index.ts>src/b.ts': { reexports: [['b', 'b']] },
      'test/b.test.ts>src/index.ts': { imports: ['b'] },
    };
    const relations = relationsOfFiles(records, { uses: (importer, target) => uses[`${importer}>${target}`] });
    const moved = new Map([['src/a.ts', ['a']], ['src/b.ts', ['b']]]);
    expect(affectedBy(relations, ['src/a.ts', 'src/b.ts'], { moved }).files).toContain('test/b.test.ts');
  });
});

describe('a narrowed walk over cycles, self-imports and mocks', () => {
  const lookup = (uses: Readonly<Record<string, EdgeUse | undefined>>) => (importer: string, target: string) =>
    uses[`${importer}>${target}`];

  it('carries a name round a cycle of re-exports once, and ends', () => {
    const records: FileRecord[] = [
      { file: 'src/a.ts', edges: [{ to: 'src/b.ts', kind: 'reexports' }] },
      { file: 'src/b.ts', edges: [{ to: 'src/a.ts', kind: 'reexports' }] },
      { file: 'test/b.test.ts', edges: [{ to: 'src/b.ts', kind: 'imports' }] },
      { file: 'test/other.test.ts', edges: [{ to: 'src/b.ts', kind: 'imports' }] },
    ];
    const relations = relationsOfFiles(records, {
      uses: lookup({
        'src/a.ts>src/b.ts': { reexports: [['total', 'total']] },
        'src/b.ts>src/a.ts': { reexports: [['total', 'total']] },
        'test/b.test.ts>src/b.ts': { imports: ['total'] },
        'test/other.test.ts>src/b.ts': { imports: ['label'] },
      }),
    });

    expect(affectedBy(relations, ['src/a.ts'], { moved: new Map([['src/a.ts', ['total']]]) }).files).toEqual([
      'src/a.ts',
      'src/b.ts',
      'test/b.test.ts',
    ]);
  });

  it('charges every importer of a file that reads itself through a namespace import', () => {
    const records: FileRecord[] = [
      { file: 'src/cart.ts', edges: [{ to: 'src/cart.ts', kind: 'imports' }] },
      { file: 'test/label.test.ts', edges: [{ to: 'src/cart.ts', kind: 'imports' }] },
    ];
    const relations = relationsOfFiles(records, {
      uses: lookup({ 'src/cart.ts>src/cart.ts': {}, 'test/label.test.ts>src/cart.ts': { imports: ['label'] } }),
    });

    expect(affectedBy(relations, ['src/cart.ts'], { moved: new Map([['src/cart.ts', ['total']]]) }).files).toEqual([
      'src/cart.ts',
      'test/label.test.ts',
    ]);
  });

  it('does not enter a mocked barrel, nor what reaches the change only through it', () => {
    const relations = graph();
    const cart = idOf(relations, 'file', 'src/cart.ts')!;
    const traversal = dependentsOf(relations, [cart], {
      moved: new Map([[cart, ['total']]]),
      avoid: [idOf(relations, 'file', 'src/index.ts')!],
    });

    expect(traversal.nodes.map((node) => relations.names[node])).toEqual([
      'src/all.ts',
      'src/cart.ts',
      'test/lazy.test.ts',
      'test/total.test.ts',
      'Cart',
    ]);
  });

  it('explains a test behind a barrel by the barrel it came through', () => {
    const relations = graph();
    const cart = idOf(relations, 'file', 'src/cart.ts')!;
    const traversal = dependentsOf(relations, [cart], { moved: new Map([[cart, ['total']]]) });
    const test = idOf(relations, 'file', 'test/barrel-total.test.ts')!;

    expect(trailOf(traversal, test).map((node) => relations.names[node])).toEqual([
      'src/cart.ts',
      'src/index.ts',
      'test/barrel-total.test.ts',
    ]);
  });
});

/**
 * A module the walk holds whole — a changed file it has no reading for, or an
 * importer it entered — still republishes through a barrel only the names the
 * barrel names. `src/index.ts` forwards `View` from `src/view.ts` and `other`
 * from `src/other.ts`, the way a package index forwards each component from its
 * own file.
 */
describe('a barrel over a module the walk holds whole', () => {
  const records: readonly FileRecord[] = [
    { file: 'src/cart.ts' },
    { file: 'src/other.ts' },
    { file: 'src/view.ts', edges: [{ to: 'src/cart.ts', kind: 'dynamic' }] },
    { file: 'src/index.ts', edges: [{ to: 'src/view.ts', kind: 'reexports' }, { to: 'src/other.ts', kind: 'reexports' }] },
    { file: 'src/all.ts', edges: [{ to: 'src/view.ts', kind: 'reexports' }] },
    { file: 'src/ns.ts', edges: [{ to: 'src/view.ts', kind: 'reexports' }, { to: 'src/other.ts', kind: 'reexports' }] },
    { file: 'src/page.ts', edges: [{ to: 'src/cart.ts', kind: 'imports' }] },
    { file: 'src/pages.ts', edges: [{ to: 'src/page.ts', kind: 'reexports' }, { to: 'src/other.ts', kind: 'reexports' }] },
    { file: 'test/page.test.ts', edges: [{ to: 'src/pages.ts', kind: 'imports' }] },
    { file: 'test/pages-other.test.ts', edges: [{ to: 'src/pages.ts', kind: 'imports' }] },
    { file: 'test/view.test.ts', edges: [{ to: 'src/index.ts', kind: 'imports' }] },
    { file: 'test/other.test.ts', edges: [{ to: 'src/index.ts', kind: 'imports' }] },
    { file: 'test/star.test.ts', edges: [{ to: 'src/all.ts', kind: 'imports' }] },
    { file: 'test/ns-view.test.ts', edges: [{ to: 'src/ns.ts', kind: 'imports' }] },
    { file: 'test/ns-other.test.ts', edges: [{ to: 'src/ns.ts', kind: 'imports' }] },
  ];
  const uses: Readonly<Record<string, EdgeUse>> = {
    'src/page.ts>src/cart.ts': { imports: ['total'] },
    'src/pages.ts>src/page.ts': { reexports: [['Page', 'Page']] },
    'src/pages.ts>src/other.ts': { reexports: [['other', 'other']] },
    'test/page.test.ts>src/pages.ts': { imports: ['Page'] },
    'test/pages-other.test.ts>src/pages.ts': { imports: ['other'] },
    'src/index.ts>src/view.ts': { reexports: [['View', 'View']] },
    'src/index.ts>src/other.ts': { reexports: [['other', 'other']] },
    'src/all.ts>src/view.ts': { reexports: [['*', '*']] },
    'src/ns.ts>src/view.ts': { reexports: [['*', 'views']] },
    'src/ns.ts>src/other.ts': { reexports: [['other', 'other']] },
    'test/view.test.ts>src/index.ts': { imports: ['View'] },
    'test/other.test.ts>src/index.ts': { imports: ['other'] },
    'test/star.test.ts>src/all.ts': { imports: ['other'] },
    'test/ns-view.test.ts>src/ns.ts': { imports: ['views'] },
    'test/ns-other.test.ts>src/ns.ts': { imports: ['other'] },
  };
  const relations = relationsOfFiles(records, { uses: (importer, target) => uses[`${importer}>${target}`] });
  const from = (file: string, moved: ReadonlyMap<string, readonly string[]>) =>
    affectedBy(relations, [file], { moved, loadsRecorded: true }).files;

  it('enters the barrel whole when no record answers for the files that loaded the module', () => {
    const files = affectedBy(relations, ['src/view.ts'], { moved: new Map() }).files;
    expect(files).toContain('test/other.test.ts');
    expect(files).toContain('test/ns-other.test.ts');
  });

  it('forwards from an importer it entered whole only the names the barrel republishes', () => {
    const files = from('src/cart.ts', new Map([['src/cart.ts', ['total']]]));
    expect(files).toContain('test/view.test.ts');
    expect(files).not.toContain('test/other.test.ts');
  });

  it('forwards from an importer a moved name entered whole only the names the barrel republishes', () => {
    const files = from('src/cart.ts', new Map([['src/cart.ts', ['total']]]));
    expect(files).toContain('test/page.test.ts');
    expect(files).not.toContain('test/pages-other.test.ts');
  });

  it('forwards from a changed file it holds no reading for only the names the barrel republishes', () => {
    const files = from('src/view.ts', new Map());
    expect(files).toContain('test/view.test.ts');
    expect(files).not.toContain('test/other.test.ts');
  });

  it('forwards `export * as` from a whole module under the one name it publishes', () => {
    const files = from('src/view.ts', new Map());
    expect(files).toContain('test/ns-view.test.ts');
    expect(files).not.toContain('test/ns-other.test.ts');
  });

  it('holds a barrel whole behind `export *` from a whole module, whose names the graph does not list', () => {
    expect(from('src/view.ts', new Map())).toContain('test/star.test.ts');
  });
});
