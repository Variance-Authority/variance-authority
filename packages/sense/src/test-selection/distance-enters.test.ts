import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { distanceFromView, type TestDistance } from './distance.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { narrowByExecutionFromView } from './select.js';
import { baseDiff, layerCoverage, layerRecords } from './__fixtures__/layers.js';

const relations = relationsOfFiles(layerRecords);

function read(options: Parameters<typeof distanceFromView>[2] = {}): readonly TestDistance[] {
  const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
  return distanceFromView(coverage, narrowByExecutionFromView(coverage, baseDiff), options);
}

const of = (distances: readonly TestDistance[], test: string): TestDistance =>
  distances.find((distance) => distance.test === test)!;

describe('the files a test enters', () => {
  it('names a changed file a test imports and nothing it imports imports, and not one it loads under another import', () => {
    // The report test imports the base beside the report, which imports the
    // base too: it is written for the report, and loads the base under it.
    const beside = relationsOfFiles(
      layerRecords.map((record) =>
        record.file === 'test/report.test.tsx'
          ? { ...record, edges: [...record.edges, { to: 'src/button/abstract-button.tsx', kind: 'imports' as const }] }
          : record,
      ),
    );
    const distances = read({ relations: beside });

    expect(of(distances, 'test/report.test.tsx')).toMatchObject({ hops: 1 });
    expect(of(distances, 'test/report.test.tsx').enters).toBeUndefined();
    expect(of(distances, 'test/abstract-button.test.tsx').enters).toEqual(['src/button/abstract-button.tsx']);
    expect(of(read({ relations }), 'test/report.test.tsx').enters).toBeUndefined();
  });

  it('names a changed file a test imports beside a module that only republishes it', () => {
    // The button test imports the face, which re-exports the base, and the base
    // itself: a re-export publishes the base rather than using it.
    const beside = relationsOfFiles(
      layerRecords.map((record) =>
        record.file === 'test/button.test.tsx'
          ? { ...record, edges: [...record.edges, { to: 'src/button/abstract-button.tsx', kind: 'imports' as const }] }
          : record,
      ),
    );

    expect(of(read({ relations: beside }), 'test/button.test.tsx').enters).toEqual(['src/button/abstract-button.tsx']);
  });

  it('names no file an importer chain ends at, which did not change', () => {
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const narrowing = narrowByExecutionFromView(coverage, baseDiff);
    // The report's stylesheet changed, and the report, which reads it, answered for it.
    const chain = { kind: 'importer', trail: ['src/report/report.css', 'src/report/report.tsx'] } as const;
    const because = narrowing.because!.map((cause) => (cause.test === 'test/report.test.tsx' ? { ...cause, via: [chain] } : cause));
    const report = of(distanceFromView(coverage, { ...narrowing, because }, { relations }), 'test/report.test.tsx');

    expect(report).toMatchObject({ hops: 2, from: 'src/report/report.css' });
    expect(report.enters).toBeUndefined();
  });

  it('names a changed file with no row that a test imports, unless a module it imports imports it too', () => {
    const DATA = 'src/report/report-data.ts';
    const graph = (reportReads: boolean) =>
      relationsOfFiles([
        ...layerRecords.map((record) =>
          record.file === 'test/report.test.tsx' || (reportReads && record.file === 'src/report/report.tsx')
            ? { ...record, edges: [...record.edges, { to: DATA, kind: 'imports' as const }] }
            : record,
        ),
        { file: DATA, edges: [] },
      ]);
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const narrowing = narrowByExecutionFromView(coverage, baseDiff);
    // The data module is new since the recording, and the test, which imports it, answered for itself.
    const chain = { kind: 'importer', trail: [DATA, 'test/report.test.tsx'] } as const;
    const because = narrowing.because!.map((cause) => (cause.test === 'test/report.test.tsx' ? { ...cause, via: [chain] } : cause));
    const placed = (reportReads: boolean) =>
      of(distanceFromView(coverage, { ...narrowing, because }, { relations: graph(reportReads) }), 'test/report.test.tsx');

    expect(placed(false)).toMatchObject({ hops: 1, from: DATA, enters: [DATA] });
    expect(placed(true).enters).toBeUndefined();
  });

  it('names no changed file a module the test imports reaches under another of its names', () => {
    const BASE = 'src/button/abstract-button.tsx';
    const BUILT = 'dist/button/abstract-button.js';
    const knownAs = (file: string): readonly string[] => (file === BASE || file === BUILT ? [BASE, BUILT] : [file]);
    // The report imports the built button, the test the source one: one file, two names.
    const aliased = relationsOfFiles([
      ...layerRecords.map((record) =>
        record.file === 'test/report.test.tsx'
          ? { ...record, edges: [...record.edges, { to: BASE, kind: 'imports' as const }] }
          : record.file === 'src/report/report.tsx'
            ? { ...record, edges: [{ to: BUILT, kind: 'imports' as const }] }
            : record,
      ),
      { file: BUILT, edges: [] },
    ]);
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const narrowing = narrowByExecutionFromView(coverage, baseDiff);

    expect(of(distanceFromView(coverage, narrowing, { relations: aliased, knownAs }), 'test/report.test.tsx').enters).toBeUndefined();
  });

  it('names no changed file a module the test imports under another of its names imports', () => {
    const BASE = 'src/button/abstract-button.tsx';
    const REPORT = 'src/report/report.tsx';
    const BUILT = 'dist/report/report.js';
    const knownAs = (file: string): readonly string[] => (file === REPORT || file === BUILT ? [REPORT, BUILT] : [file]);
    // The test imports the built report and the source button; the source report imports the button.
    const aliased = relationsOfFiles([
      ...layerRecords.map((record) =>
        record.file === 'test/report.test.tsx'
          ? {
              ...record,
              edges: [...record.edges.filter((edge) => edge.to !== REPORT), { to: BUILT, kind: 'imports' as const }, { to: BASE, kind: 'imports' as const }],
            }
          : record,
      ),
      { file: BUILT, edges: [] },
    ]);
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const narrowing = narrowByExecutionFromView(coverage, baseDiff);

    expect(of(distanceFromView(coverage, narrowing, { relations: aliased, knownAs }), 'test/report.test.tsx').enters).toBeUndefined();
  });

  it('names every changed file a test enters, though the walk measured from one it loads under another', () => {
    const beside = relationsOfFiles(
      layerRecords.map((record) =>
        record.file === 'test/report.test.tsx'
          ? { ...record, edges: [...record.edges, { to: 'src/button/abstract-button.tsx', kind: 'imports' as const }] }
          : record,
      ),
    );
    const coverage = openTestCoverage(encodeTestCoverage(layerCoverage));
    const narrowing = narrowByExecutionFromView(coverage, baseDiff);
    // The report changed too, listed after the base: both are one hop, and the walk keeps the first.
    const report = { kind: 'region', file: 'src/report/report.tsx', name: 'Report', path: 'Report', startLine: 1, endLine: 1 } as const;
    const because = narrowing.because!.map((cause) =>
      cause.test === 'test/report.test.tsx' ? { ...cause, via: [...cause.via, report] } : cause,
    );

    expect(of(distanceFromView(coverage, { ...narrowing, because }, { relations: beside }), 'test/report.test.tsx')).toMatchObject({
      hops: 1,
      from: 'src/button/abstract-button.tsx',
      enters: ['src/report/report.tsx'],
    });
  });
});
