import { describe, expect, it } from 'vitest';
import { digestString } from '../format/hash.js';
import { closureOf, driftedBetween, relationsOfFiles, type FileRecord } from './index.js';

/**
 * A digest is a promise that two things are the same, and the only failure that
 * matters here is a digest that keeps the promise it should have broken.
 *
 * So the cases with weight are the ones where something was not read: a file with
 * no content digest, a file whose imports could not be enumerated, and the nodes
 * resting on either. Every one of those must come back marked, and the mark has
 * to reach the component at the top of the chain — otherwise a cache hit skips a
 * subject on the strength of a hash over bytes nobody hashed.
 */

const at = (text: string) => digestString(text);

/** `tokens.css` ← `button.css` ← `Button.tsx` (declares `Button`), and a sibling. */
function suite(tokens: string): readonly FileRecord[] {
  return [
    { file: 'src/tokens.css', digest: at(tokens) },
    {
      file: 'src/button.css',
      digest: at('button'),
      edges: [{ to: 'src/tokens.css', kind: 'asset' }],
    },
    {
      file: 'src/Button.tsx',
      digest: at('Button'),
      declares: ['Button'],
      edges: [{ to: 'src/button.css', kind: 'asset' }],
    },
    { file: 'src/Clock.tsx', digest: at('Clock'), declares: ['Clock'] },
  ];
}

function closureFor(records: readonly FileRecord[]) {
  const content = new Map(
    records.flatMap((record) => (record.digest === undefined ? [] : [[record.file, record.digest]])),
  );

  return closureOf({ relations: relationsOfFiles(records), content });
}

describe('the closure digest', () => {
  it('is the same for the same tree, whatever order it arrived in', () => {
    const forwards = closureFor(suite('accent: purple'));
    const backwards = closureFor([...suite('accent: purple')].reverse());

    expect([...forwards.digests.entries()].sort()).toEqual([...backwards.digests.entries()].sort());
    expect(forwards.volatile.size).toBe(0);
  });

  it('changes every node above the one that moved, and none beside it', () => {
    const before = closureFor(suite('accent: purple'));
    const after = closureFor(suite('accent: green'));

    const drift = driftedBetween(before, after);

    expect(drift.files).toEqual(['src/Button.tsx', 'src/button.css', 'src/tokens.css']);
    expect(drift.components).toEqual(['Button']);
    expect(drift.gone).toEqual([]);
  });

  it('is identical again once the change is reverted', () => {
    // The case a diff cannot answer. Two commits touched `tokens.css`, so every
    // ref-based selector widens; the bytes are the ones the baseline was painted
    // from, so this one does not.
    const before = closureFor(suite('accent: purple'));
    const reverted = closureFor(suite('accent: purple'));

    expect(driftedBetween(before, reverted).changed).toEqual([]);
  });

  it('calls a new node changed rather than absent', () => {
    const before = closureFor(suite('accent: purple'));
    const after = closureFor([
      ...suite('accent: purple'),
      { file: 'src/Badge.tsx', digest: at('Badge'), declares: ['Badge'] },
    ]);

    expect(driftedBetween(before, after).components).toEqual(['Badge']);
  });

  it('reports a node that is gone apart from one that changed', () => {
    const before = closureFor(suite('accent: purple'));
    const after = closureFor(suite('accent: purple').slice(0, 3));

    expect(driftedBetween(before, after).gone).toEqual(['component:Clock', 'file:src/Clock.tsx']);
  });
});

describe('a digest that must not be believed', () => {
  it('marks a file nobody hashed, and everything resting on it', () => {
    const records = suite('accent: purple').map((record) =>
      record.file === 'src/tokens.css' ? { file: record.file } : record,
    );

    const closure = closureFor(records);

    // `Clock` is beside the hole, not above it, so it stays provable.
    expect([...closure.volatile].sort()).toEqual([
      'component:Button',
      'file:src/Button.tsx',
      'file:src/button.css',
      'file:src/tokens.css',
    ]);
  });

  it('marks a file whose own imports could not be read', () => {
    const closure = closureFor([
      { file: 'src/legacy.js', digest: at('legacy'), unknown: 'a computed require()' },
      {
        file: 'src/Legacy.tsx',
        digest: at('Legacy'),
        declares: ['Legacy'],
        edges: [{ to: 'src/legacy.js', kind: 'imports' }],
      },
    ]);

    // Its bytes are known and its *inputs* are not, so an identical digest proves
    // nothing about what it renders.
    expect(closure.volatile.has('file:src/legacy.js')).toBe(true);
    expect(closure.volatile.has('component:Legacy')).toBe(true);
  });

  it('is treated as changed even when it compares equal', () => {
    const records: readonly FileRecord[] = [
      { file: 'src/legacy.js', digest: at('legacy'), unknown: 'a computed require()' },
    ];

    expect(driftedBetween(closureFor(records), closureFor(records)).files).toEqual([
      'src/legacy.js',
    ]);
  });
});

describe('a cycle', () => {
  const CYCLE: readonly FileRecord[] = [
    { file: 'a.ts', digest: at('a'), edges: [{ to: 'b.ts', kind: 'imports' }] },
    { file: 'b.ts', digest: at('b'), edges: [{ to: 'a.ts', kind: 'imports' }] },
    { file: 'app.ts', digest: at('app'), edges: [{ to: 'a.ts', kind: 'imports' }] },
  ];

  it('gives every member of it one digest', () => {
    const closure = closureFor(CYCLE);

    // Not a compromise. No file in a cycle can be called unchanged while another
    // member moved, so one digest for the loop is the true statement.
    expect(closure.digests.get('file:a.ts')).toBe(closure.digests.get('file:b.ts'));
    expect(closure.digests.get('file:app.ts')).not.toBe(closure.digests.get('file:a.ts'));
  });

  it('terminates, and moves the whole loop when one member does', () => {
    const after = closureFor(
      CYCLE.map((record) => (record.file === 'b.ts' ? { ...record, digest: at('b!') } : record)),
    );

    expect(driftedBetween(closureFor(CYCLE), after).files).toEqual(['a.ts', 'app.ts', 'b.ts']);
  });
});

describe('the closure a caller asked to narrow', () => {
  it('walks only the edge kinds it was given', () => {
    const records: readonly FileRecord[] = [
      { file: 'types.ts', digest: at('types') },
      { file: 'a.ts', digest: at('a'), edges: [{ to: 'types.ts', kind: 'type' }] },
    ];
    const content = new Map(records.map((record) => [record.file, record.digest!]));
    const relations = relationsOfFiles(records);

    const everything = closureOf({ relations, content });
    const values = closureOf({ relations, content, through: ['imports', 'asset'] });

    // A type-only import cannot repaint anything, so a caller asking what a
    // render rests on is entitled to leave it out — and gets a different digest
    // for saying so, which is what keeps the two closures from being confused.
    expect(values.digests.get('file:a.ts')).not.toBe(everything.digests.get('file:a.ts'));
  });
});
