import { describe, expect, it } from 'vitest';
import {
  EDGE_KINDS,
  dependenciesOf,
  dependentsOf,
  explain,
  idOf,
  affectedBy,
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
 * edges: the ones that were read, and the one nobody could read, which is left
 * to the recorded run rather than guessed at.
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
    expect(dependents.nodes.map((id) => relations.names[id])).toEqual([
      'src/Button.tsx',
      'src/Clock.tsx',
      'src/util.ts',
      'Button',
      'Clock',
    ]);

    const dependencies = dependenciesOf(relations, [idOf(relations, 'file', 'src/Button.tsx')!]);
    expect(dependencies.nodes.map((id) => relations.names[id])).toEqual([
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

    expect(dependentsOf(relations, [idOf(relations, 'file', 'a.ts')!]).nodes).toHaveLength(2);
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

    expect(value.nodes.map((id) => relations.names[id])).toEqual(['b.ts', 'types.ts']);
  });

  it('does not cross a type-only import unless asked to', () => {
    const relations = relationsOfFiles([
      { file: 'a.ts', edges: [{ to: 'types.ts', kind: 'type' }] },
      { file: 'b.ts', edges: [{ to: 'types.ts', kind: 'imports' }] },
      { file: 'types.ts' },
    ]);
    const seed = idOf(relations, 'file', 'types.ts')!;

    // Nothing behind `import type` runs, so a change to `types.ts` affects `b.ts`
    // and not `a.ts` — until a caller says its question is
    // about source, not about a runtime.
    expect(dependentsOf(relations, [seed]).nodes.map((id) => relations.names[id])).toEqual(['b.ts', 'types.ts']);
    expect(dependentsOf(relations, [seed], { through: EDGE_KINDS }).nodes.map((id) => relations.names[id]))
      .toEqual(['a.ts', 'b.ts', 'types.ts']);
  });
});

describe('what a change affects', () => {
  it('reaches a component through a stylesheet nothing declares anything in', () => {
    // The case the whole feature exists for. `tokens.css` declares no component,
    // so a scan that only reads declarations can say nothing about it and has to
    // run the entire suite.
    const relations = relationsOfFiles(SUITE);
    const affected = affectedBy(relations, ['src/tokens.css']);

    expect(affected.components).toEqual(['Button']);
    expect(affected.files).toEqual(['src/Button.tsx', 'src/button.css', 'src/tokens.css']);
  });

  it('shows the chain it arrived by', () => {
    const relations = relationsOfFiles(SUITE);
    const affected = affectedBy(relations, ['src/tokens.css']);

    expect(explain(relations, affected, { kind: 'component', name: 'Button' })).toEqual([
      'src/tokens.css',
      'src/button.css',
      'src/Button.tsx',
      'Button',
    ]);
  });

  it('is stable however the changed files were ordered', () => {
    const relations = relationsOfFiles(SUITE);

    expect(affectedBy(relations, ['src/tokens.css', 'src/util.ts']).files).toEqual(
      affectedBy(relations, ['src/util.ts', 'src/tokens.css']).files,
    );
  });

  it('drops a file whose shadow stands on every trail from the change', () => {
    // `Button.tsx` mocks `util.ts`: a change to `util.ts` reaches it only
    // through the module it replaced. `Clock.tsx` imports the real one.
    const relations = relationsOfFiles(SUITE);
    const shadows = new Map([['src/Button.tsx', ['src/util.ts']]]);
    const affected = affectedBy(relations, ['src/util.ts'], { shadows });

    expect(affected.files).toEqual(['src/Clock.tsx', 'src/util.ts']);
    expect(affected.components).toEqual(['Clock']);
    expect(affected.shadowed).toEqual(['src/Button.tsx']);
  });

  it('keeps a file some other trail from the change still reaches', () => {
    const relations = relationsOfFiles(SUITE);
    const shadows = new Map([['src/Button.tsx', ['src/util.ts']]]);
    const affected = affectedBy(relations, ['src/util.ts', 'src/tokens.css'], { shadows });

    expect(affected.files).toContain('src/Button.tsx');
    expect(affected.shadowed).toEqual([]);
  });

  it('reports a changed path the graph never saw rather than ignoring it', () => {
    const relations = relationsOfFiles(SUITE);
    const affected = affectedBy(relations, ['README.md']);

    // Not an error here — a changed `README.md` is genuinely nothing to this
    // graph. It is reported because the caller is the only one that knows
    // whether the path should have been scanned, and a selector that silently
    // drops a source file it never read is the failure mode being avoided.
    expect(affected.missing).toEqual(['README.md']);
    expect(affected.components).toEqual([]);
  });
});

describe('a file whose edges could not be read', () => {
  const UNREADABLE: readonly FileRecord[] = [
    ...SUITE,
    { file: 'src/legacy.js', unknown: 'a require() call with a specifier that is not a literal' },
    { file: 'src/Legacy.tsx', declares: ['Legacy'], edges: [{ to: 'src/legacy.js', kind: 'imports' }] },
  ];

  it('adds nothing to a change it has no written edge to', () => {
    const relations = relationsOfFiles(UNREADABLE);
    const affected = affectedBy(relations, ['src/tokens.css']);

    // `legacy.js` might `require` `tokens.css` by a name built at runtime. The
    // walk does not guess: a recorded run sees the module load, whatever
    // expression named it, and that is the answer for the edge nobody could read.
    expect(affected.components).toEqual(['Button']);
    expect(affected.files).not.toContain('src/legacy.js');
  });

  it('is walked through the edges that were read', () => {
    const relations = relationsOfFiles(UNREADABLE);
    const affected = affectedBy(relations, ['src/legacy.js']);

    expect(affected.components).toEqual(['Legacy']);
    expect(affected.files).toEqual(['src/Legacy.tsx', 'src/legacy.js']);
  });

  it('selects nothing when nothing changed', () => {
    const relations = relationsOfFiles(UNREADABLE);

    expect(affectedBy(relations, []).components).toEqual([]);
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

    const traversal = dependentsOf(relations, [idOf(relations, 'file', 'root.ts')!]);
    const trail = trailOf(traversal, idOf(relations, 'file', 'app.ts')!);

    expect(trail).toHaveLength(3);
    expect(relations.names[trail[0]!]).toBe('root.ts');
    expect(relations.names[trail[2]!]).toBe('app.ts');
  });

  it('is empty for a node the search never visited', () => {
    const relations = relationsOfFiles(SUITE);
    const traversal = dependentsOf(relations, [idOf(relations, 'file', 'src/tokens.css')!]);

    expect(trailOf(traversal, idOf(relations, 'component', 'Clock')!)).toEqual([]);
  });
});
