import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { distanceByExecution } from './index.js';
import { distanceFromView, nearestFirst, type TestDistance } from './distance.js';
import { eitherFace, indexFaces } from './faces.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import type { TestCoverage } from './format.js';
import { baseDiff, layerCoverage, layerRecords } from './__fixtures__/layers.js';

const relations = relationsOfFiles(layerRecords);

function read(options: Parameters<typeof distanceFromView>[2] = {}): readonly TestDistance[] {
  const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
  return distanceFromView(coverage, narrowByExecutionFromView(coverage, baseDiff), options);
}

const of = (distances: readonly TestDistance[], test: string): TestDistance =>
  distances.find((distance) => distance.test === test)!;

describe('distanceFromView', () => {
  it('counts the hops a change travelled, not the ones it could have', () => {
    // Every one of these tests entered the base, so the narrowing selects all
    // six and says nothing about their order. The layers are the answer.
    const distances = read({ relations });

    expect(distances.map(({ test, hops }) => [test, hops])).toEqual([
      ['test/abstract-button.test.tsx', 1],
      ['test/button.test.tsx', 2],
      ['test/report.test.tsx', 2],
      ['test/card.test.tsx', 3],
      ['test/checkout.test.tsx', 4],
      ['test/registry.test.ts', undefined],
    ]);
  });

  it('names the chain it counted, change first', () => {
    // The count is the headline and the trail is what makes it checkable: an
    // operator who disagrees with a 4 can see which edge is wrong.
    expect(of(read({ relations }), 'test/checkout.test.tsx')).toMatchObject({
      hops: 4,
      from: 'src/button/abstract-button.tsx',
      trail: [
        'src/button/abstract-button.tsx',
        'src/button/index.ts',
        'src/card/card.tsx',
        'src/checkout/checkout.tsx',
        'test/checkout.test.tsx',
      ],
    });
  });

  it('refuses to place a test the change reached by no route it executed', () => {
    // The registry test entered the changed module and imports nothing that
    // leads to it. That is effect at a distance in the literal sense, and the
    // distance is *absent* rather than zero — zero is `precondition`, which is
    // the nearest thing there is and would sort this first.
    const registry = of(read({ relations }), 'test/registry.test.ts');

    expect(registry.bearing).toBe('unexplained');
    expect(registry).not.toHaveProperty('hops');
    expect(registry).not.toHaveProperty('trail');
  });

  it('calls a hop past a unit face a reach-through, and names the door', () => {
    const report = of(read({ relations, faces: indexFaces(relations) }), 'test/report.test.tsx');

    expect(report.bearing).toBe('reach-through');
    expect(report.through).toEqual([
      {
        importer: 'src/report/report.tsx',
        reached: 'src/button/abstract-button.tsx',
        unit: 'src/button',
        entry: 'src/button/index.ts',
      },
    ]);
  });

  it('leaves a path that entered every unit on its face alone', () => {
    // `card.tsx` imports the button through `src/button/index.ts`, which is what
    // the face is for. Three hops and no complaint: distance is not a defect.
    const distances = read({ relations, faces: indexFaces(relations) });

    expect(of(distances, 'test/card.test.tsx')).toMatchObject({ hops: 3, bearing: 'transitive' });
    expect(of(distances, 'test/card.test.tsx')).not.toHaveProperty('through');
  });

  it('places a test whose own source changed at no distance at all', () => {
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const diff = `${baseDiff}
--- a/test/card.test.tsx
+++ b/test/card.test.tsx
@@ -1,1 +1,1 @@
-old
+new`;
    const distances = distanceFromView(coverage, narrowByExecutionFromView(coverage, diff), { relations });

    expect(of(distances, 'test/card.test.tsx')).toEqual({
      test: 'test/card.test.tsx',
      bearing: 'precondition',
      hops: 0,
      from: 'test/card.test.tsx',
      trail: ['test/card.test.tsx'],
    });
  });

  it('places nothing without a graph, and says so as absence', () => {
    // No graph is not "everything is far away". Every test comes back unplaced,
    // which is what a caller banding on this must see rather than a flat zero.
    const distances = read();

    expect(distances.every(({ bearing }) => bearing === 'unmeasured')).toBe(true);
    expect(distances.some((distance) => 'hops' in distance)).toBe(false);
  });

  it('separates a route nothing described from a graph that could not look', () => {
    // The two absences a report must never merge. `test/registry.test.ts`
    // entered the base along no import it ran, and the graph was in a position
    // to know that; the same test measured against a graph that has never heard
    // of the module is not a finding about anybody's code.
    const found = of(read({ relations }), 'test/registry.test.ts');
    expect(found.bearing).toBe('unexplained');
    expect(found.because).toBeUndefined();

    const blind = of(read({ relations, knownAs: () => [] }), 'test/registry.test.ts');
    expect(blind.bearing).toBe('unmeasured');
    expect(blind.because).toContain('test/registry.test.ts');
  });

  it('withholds the finding from a run the graph barely accounted for', () => {
    // `test/registry.test.ts` ran the base and one module the graph connects it
    // to nothing else by. Whatever carried the change into it carried the rest
    // of that run too, and one unexplained edge inside a run with six of them is
    // not an address — it is a note that this graph is not the one that ran.
    const elsewhere: TestCoverage = {
      ...layerCoverage,
      modules: [
        ...layerCoverage.modules,
        {
          file: 'src/harness/harness.ts',
          sourceDigest: 'source:src/harness/harness.ts',
          instrumented: true,
          blocks: [
            {
              ordinal: 0,
              kind: 'module' as const,
              digest: 'block:src/harness/harness.ts',
              name: '',
              path: 'module',
              startLine: 1,
              endLine: 10,
              source: true,
              testFiles: ['test/registry.test.ts'],
            },
          ],
        },
      ],
    };
    const view = openTestCoverage(encodeTestCoverage(elsewhere));
    const distances = distanceFromView(view, narrowByExecutionFromView(view, baseDiff), {
      relations: relationsOfFiles([...layerRecords, { file: 'src/harness/harness.ts', edges: [] }]),
    });

    expect(of(distances, 'test/registry.test.ts')).toMatchObject({
      bearing: 'unmeasured',
      because: 'it ran 1 other module(s) the graph cannot connect it to',
    });
  });

  it('walks a module the graph holds under a second name', () => {
    // A workspace package is imported through its manifest, so an importer's
    // edge lands on the built copy while the snapshot recorded the source. Both
    // names are one module, and a walk that honoured one of them would be cut at
    // the hop where it mattered.
    const built = 'dist/card/card.js';
    const twin = relationsOfFiles([
      ...layerRecords.filter((record) => record.file !== 'test/card.test.tsx'),
      { file: built, edges: [{ to: 'src/button/index.ts', kind: 'imports' }] },
      { file: 'test/card.test.tsx', edges: [{ to: built, kind: 'imports' }] },
    ]);
    const both = (file: string) => (file === 'src/card/card.tsx' ? [file, built] : [file]);

    // The snapshot only ever says `src/card/card.tsx`; the only edge out of the
    // test names the other copy. Same module, same three hops.
    expect(of(read({ relations: twin, knownAs: both }), 'test/card.test.tsx')).toMatchObject({
      hops: 3,
      trail: ['src/button/abstract-button.tsx', 'src/button/index.ts', built, 'test/card.test.tsx'],
    });
  });
});

describe('distanceByExecution', () => {
  it('reads the snapshot once and answers both questions from it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-distance-'));
    const file = resolve(root, 'coverage.bin');
    try {
      await writeFile(file, encodeTestCoverage(layerCoverage));
      const { narrowing, distances } = await distanceByExecution(file, baseDiff, { relations });

      expect([...distances].map(({ test }) => test).sort()).toEqual([...narrowing.entered].sort());
      expect(of(distances, 'test/checkout.test.tsx').hops).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('nearestFirst', () => {
  it('puts a shorter path first and everything unplaced behind all of them', () => {
    // The comparison every consumer sorts by, including the bands next door, so
    // a caller that keeps its own list of distances orders it the same way.
    const placed = (test: string, hops?: number): TestDistance =>
      hops === undefined ? { test, bearing: 'unexplained' } : { test, bearing: 'transitive', hops };

    expect(
      [placed('c', 2), placed('z'), placed('a', 2), placed('b', 1)]
        .sort(nearestFirst)
        .map(({ test }) => test),
    ).toEqual(['b', 'a', 'c', 'z']);
  });
});

describe('indexFaces', () => {
  const faces = indexFaces(relations);

  it('reports the outermost unit the importer is outside of', () => {
    expect(faces('src/button/abstract-button.tsx', 'src/checkout/checkout.tsx')).toEqual({
      unit: 'src/button',
      entry: 'src/button/index.ts',
    });
  });

  it('holds a unit against nobody inside it', () => {
    // The face reaching its own directory's files is the face doing its job.
    expect(faces('src/button/abstract-button.tsx', 'src/button/index.ts')).toBeUndefined();
  });

  it('makes no claim about a directory that declared no face', () => {
    expect(faces('src/card/card.tsx', 'src/checkout/checkout.tsx')).toBeUndefined();
  });

  it('defers to a caller who knows a face the tree does not show', () => {
    // ADR-0013: the manifest reader is the caller's, not this package's. A
    // provider that knows `src/card` is published stacks in front of the one
    // that only reads the tree, and the first answer wins.
    const manifest = eitherFace(
      (reached, importer) =>
        reached.startsWith('src/card/') && !importer.startsWith('src/card/')
          ? { unit: 'src/card', entry: 'src/card/card.tsx', as: '@acme/card' }
          : undefined,
      faces,
    );

    expect(manifest('src/card/card.tsx', 'src/checkout/checkout.tsx')).toEqual({
      unit: 'src/card',
      entry: 'src/card/card.tsx',
      as: '@acme/card',
    });
    expect(manifest('src/button/abstract-button.tsx', 'src/checkout/checkout.tsx')?.unit).toBe(
      'src/button',
    );
  });
});
