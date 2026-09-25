import { describe, expect, it } from 'vitest';
import { affectedBy, relationsOfFiles, type EdgeUse, type FileRecord } from './index.js';

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
