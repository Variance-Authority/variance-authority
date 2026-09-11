import { describe, expect, it } from 'vitest';
import {
  EDGE_KINDS,
  dependenciesOf,
  dependentsOf,
  explain,
  idOf,
  movedBy,
  nodesOfKind,
  relationsOf,
  relationsOfFiles,
  trailOf,
  type FileRecord,
} from './index.js';

/**
 * The structure, and the one rule that makes it safe to select on.
 *
 * Two halves are asserted here and they fail differently. The graph half — ids,
 * both directions, cycles, determinism — fails loudly and immediately if it is
 * wrong. The **safety** half does not: a graph that quietly drops an edge still
 * answers every query, returns a smaller set, and produces a green run over a
 * surface nobody looked at. So the cases that matter most are the ones about
 * files this could not read.
 */

/** `src/tokens.css` ← `src/button.css` ← `src/Button.tsx`, which declares `Button`. */
const SUITE: readonly FileRecord[] = [
  { file: 'src/tokens.css' },
  { file: 'src/button.css', edges: [{ to: 'src/tokens.css', kind: 'asset' }] },
  {
    file: 'src/Button.tsx',
    declares: ['Button'],
    edges: [
      { to: 'src/button.css', kind: 'asset' },
      { to: 'src/util.ts', kind: 'imports' },
    ],
  },
  { file: 'src/util.ts' },
  { file: 'src/Clock.tsx', declares: ['Clock'], edges: [{ to: 'src/util.ts', kind: 'imports' }] },
];

describe('the graph', () => {
  it('orders nodes by kind and then by code unit, whatever order they arrived in', () => {
    const forwards = relationsOfFiles(SUITE);
    const backwards = relationsOfFiles([...SUITE].reverse());

    // Byte-stability is the property a serialized graph and every report built
    // from one rest on. Files first, because the order is kind-major.
    expect(forwards.names).toEqual(backwards.names);
    expect(forwards.names).toEqual([
      'src/Button.tsx',
      'src/Clock.tsx',
      'src/button.css',
      'src/tokens.css',
      'src/util.ts',
      'Button',
      'Clock',
    ]);
    expect(nodesOfKind(forwards, 'component').map((id) => forwards.names[id])).toEqual([
      'Button',
      'Clock',
    ]);
  });

  it('answers both directions from one build', () => {
    const relations = relationsOfFiles(SUITE);
    const util = idOf(relations, 'file', 'src/util.ts')!;

    // Both components arrive in the same walk, which is the point of holding one
    // graph: the file question and the component question are one traversal.
    const dependents = dependentsOf(relations, [util]);
    expect(dependents.reached.map((id) => relations.names[id])).toEqual([
      'src/Button.tsx',
      'src/Clock.tsx',
      'src/util.ts',
      'Button',
      'Clock',
    ]);

    const dependencies = dependenciesOf(relations, [idOf(relations, 'file', 'src/Button.tsx')!]);
    expect(dependencies.reached.map((id) => relations.names[id])).toEqual([
      'src/Button.tsx',
      'src/button.css',
      'src/tokens.css',
      'src/util.ts',
    ]);
  });

  it('keeps a file that imports nothing', () => {
    // The one file in a diff is very often exactly this file. A graph that only
    // holds nodes with edges cannot answer any question about it.
    const relations = relationsOfFiles([{ file: 'src/lonely.ts' }]);
    expect(idOf(relations, 'file', 'src/lonely.ts')).toBe(0);
  });

  it('terminates on a cycle', () => {
    const relations = relationsOfFiles([
      { file: 'a.ts', edges: [{ to: 'b.ts', kind: 'imports' }] },
      { file: 'b.ts', edges: [{ to: 'a.ts', kind: 'imports' }] },
    ]);

    expect(dependentsOf(relations, [idOf(relations, 'file', 'a.ts')!]).reached).toHaveLength(2);
  });

  it('keeps two kinds of edge between one pair', () => {
    const relations = relationsOf({
      relations: [
        { from: { kind: 'file', name: 'a.ts' }, to: { kind: 'file', name: 'b.ts' }, kind: 'imports' },
        { from: { kind: 'file', name: 'a.ts' }, to: { kind: 'file', name: 'b.ts' }, kind: 'type' },
        { from: { kind: 'file', name: 'a.ts' }, to: { kind: 'file', name: 'b.ts' }, kind: 'imports' },
      ],
    });

    // Deduplicated by (from, to, kind) — so the repeat collapses and the type
    // import does not, because only one of them explains a finding.
    expect([...relations.depends.kind]).toEqual([
      EDGE_KINDS.indexOf('imports'),
      EDGE_KINDS.indexOf('type'),
    ]);
  });

  it('walks only the edge kinds it was asked for', () => {
    const relations = relationsOfFiles([
      { file: 'a.ts', edges: [{ to: 'types.ts', kind: 'type' }] },
      { file: 'b.ts', edges: [{ to: 'types.ts', kind: 'imports' }] },
      { file: 'types.ts' },
    ]);

    const value = dependentsOf(relations, [idOf(relations, 'file', 'types.ts')!], {
      through: ['imports'],
    });

    expect(value.reached.map((id) => relations.names[id])).toEqual(['b.ts', 'types.ts']);
  });

  it('does not cross a type-only import unless asked to', () => {
    const relations = relationsOfFiles([
      { file: 'a.ts', edges: [{ to: 'types.ts', kind: 'type' }] },
      { file: 'b.ts', edges: [{ to: 'types.ts', kind: 'imports' }] },
      { file: 'types.ts' },
    ]);
    const seed = idOf(relations, 'file', 'types.ts')!;

    // Nothing behind `import type` runs, so a change to `types.ts` moves `b.ts`
    // and leaves `a.ts` where it was — until a caller says its question is
    // about source, not about a runtime.
    expect(dependentsOf(relations, [seed]).reached.map((id) => relations.names[id])).toEqual(['b.ts', 'types.ts']);
    expect(dependentsOf(relations, [seed], { through: EDGE_KINDS }).reached.map((id) => relations.names[id]))
      .toEqual(['a.ts', 'b.ts', 'types.ts']);
  });
});

describe('what a change moved', () => {
  it('reaches a component through a stylesheet nothing declares anything in', () => {
    // The case the whole feature exists for. `tokens.css` declares no component,
    // so a scan that only reads declarations can say nothing about it and has to
    // run the entire suite.
    const relations = relationsOfFiles(SUITE);
    const moved = movedBy(relations, ['src/tokens.css']);

    expect(moved.components).toEqual(['Button']);
    expect(moved.files).toEqual(['src/Button.tsx', 'src/button.css', 'src/tokens.css']);
  });

  it('shows the chain it arrived by', () => {
    const relations = relationsOfFiles(SUITE);
    const moved = movedBy(relations, ['src/tokens.css']);

    expect(explain(relations, moved, { kind: 'component', name: 'Button' })).toEqual([
      'src/tokens.css',
      'src/button.css',
      'src/Button.tsx',
      'Button',
    ]);
  });

  it('is stable however the changed files were ordered', () => {
    const relations = relationsOfFiles(SUITE);

    expect(movedBy(relations, ['src/tokens.css', 'src/util.ts']).files).toEqual(
      movedBy(relations, ['src/util.ts', 'src/tokens.css']).files,
    );
  });

  it('reports a changed path the graph never saw rather than ignoring it', () => {
    const relations = relationsOfFiles(SUITE);
    const moved = movedBy(relations, ['README.md']);

    // Not an error here — a changed `README.md` is genuinely nothing to this
    // graph. It is reported because the caller is the only one that knows
    // whether the path should have been scanned, and a selector that silently
    // drops a source file it never read is the failure mode being avoided.
    expect(moved.missing).toEqual(['README.md']);
    expect(moved.components).toEqual([]);
  });
});

describe('a file whose edges could not be read', () => {
  const UNREADABLE: readonly FileRecord[] = [
    ...SUITE,
    { file: 'src/legacy.js', unknown: 'a require() call with a specifier that is not a literal' },
    { file: 'src/Legacy.tsx', declares: ['Legacy'], edges: [{ to: 'src/legacy.js', kind: 'imports' }] },
  ];

  it('is treated as depending on everything that changed', () => {
    const relations = relationsOfFiles(UNREADABLE);
    const moved = movedBy(relations, ['src/tokens.css']);

    // `legacy.js` might import `tokens.css`. Nothing here can tell, so it is
    // seeded, and `Legacy` — which depends on it — is observed. The alternative
    // is a green run over a component nobody looked at.
    expect(moved.components).toEqual(['Button', 'Legacy']);

    // The sentence rides along with the path. A count is something to live
    // with; a named cause is something to fix.
    expect(moved.opaque).toEqual([
      {
        file: 'src/legacy.js',
        because: 'a require() call with a specifier that is not a literal',
      },
    ]);
  });

  it('is counted apart from what was actually reached', () => {
    const relations = relationsOfFiles(UNREADABLE);
    const moved = movedBy(relations, []);

    // No file changed at all, and the unreadable one is still in the answer.
    // "We widened" must never hide inside "we found".
    expect(moved.opaque.map((hole) => hole.file)).toEqual(['src/legacy.js']);
    expect(moved.components).toEqual(['Legacy']);
  });
});

describe('the trail', () => {
  it('is the shortest one, not whichever the search unwound', () => {
    const relations = relationsOfFiles([
      { file: 'root.ts' },
      { file: 'near.ts', edges: [{ to: 'root.ts', kind: 'imports' }] },
      { file: 'far.ts', edges: [{ to: 'root.ts', kind: 'imports' }] },
      {
        file: 'app.ts',
        edges: [
          { to: 'near.ts', kind: 'imports' },
          { to: 'far.ts', kind: 'imports' },
        ],
      },
    ]);

    const reach = dependentsOf(relations, [idOf(relations, 'file', 'root.ts')!]);
    const trail = trailOf(reach, idOf(relations, 'file', 'app.ts')!);

    expect(trail).toHaveLength(3);
    expect(relations.names[trail[0]!]).toBe('root.ts');
    expect(relations.names[trail[2]!]).toBe('app.ts');
  });

  it('is empty for a node the search never reached', () => {
    const relations = relationsOfFiles(SUITE);
    const reach = dependentsOf(relations, [idOf(relations, 'file', 'src/tokens.css')!]);

    expect(trailOf(reach, idOf(relations, 'component', 'Clock')!)).toEqual([]);
  });
});
