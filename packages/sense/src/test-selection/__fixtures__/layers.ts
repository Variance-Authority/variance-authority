/**
 * A component stack with tests at every layer, which is what a distance is
 * measured over.
 *
 * `src/button/abstract-button.tsx` is the base. `src/button/index.ts` is the
 * unit's face and re-exports it; `src/card/card.tsx` imports the button the way
 * anybody outside that directory is meant to, through the face. `src/checkout/checkout.tsx`
 * imports the card. One file, `src/report/report.tsx`, reaches past the face
 * straight at `abstract-button.tsx`, which is the defect the reading exists to
 * name.
 *
 * Each layer has a test that imports it directly, and every test entered every
 * module below it, which is what a run of this stack would have recorded.
 * `test/registry.test.ts` entered the base without importing anything that
 * reaches it — a subject wired up through a registry at runtime, and the one
 * shape no import graph can explain.
 */

import type { FileRecord } from '@variance-authority/core/relate';
import type { TestCoverage } from '../index.js';

const BASE = 'src/button/abstract-button.tsx';
const FACE = 'src/button/index.ts';
const CARD = 'src/card/card.tsx';
const CHECKOUT = 'src/checkout/checkout.tsx';
const REPORT = 'src/report/report.tsx';

/** Which modules each test's run entered, base last. */
const ENTERED: Readonly<Record<string, readonly string[]>> = {
  'test/abstract-button.test.tsx': [BASE],
  'test/button.test.tsx': [FACE, BASE],
  'test/card.test.tsx': [CARD, FACE, BASE],
  'test/checkout.test.tsx': [CHECKOUT, CARD, FACE, BASE],
  'test/report.test.tsx': [REPORT, BASE],
  // Entered the base, imports nothing that reaches it.
  'test/registry.test.ts': [BASE],
};

export const layerTests = Object.keys(ENTERED).sort();

export const layerRecords: readonly FileRecord[] = [
  { file: BASE, edges: [] },
  { file: FACE, edges: [{ to: BASE, kind: 'reexports' }] },
  { file: CARD, edges: [{ to: FACE, kind: 'imports' }] },
  { file: CHECKOUT, edges: [{ to: CARD, kind: 'imports' }] },
  // The reach-through: past `src/button/index.ts`, straight at the file behind it.
  { file: REPORT, edges: [{ to: BASE, kind: 'imports' }] },
  { file: 'test/abstract-button.test.tsx', edges: [{ to: BASE, kind: 'imports' }] },
  { file: 'test/button.test.tsx', edges: [{ to: FACE, kind: 'imports' }] },
  { file: 'test/card.test.tsx', edges: [{ to: CARD, kind: 'imports' }] },
  { file: 'test/checkout.test.tsx', edges: [{ to: CHECKOUT, kind: 'imports' }] },
  { file: 'test/report.test.tsx', edges: [{ to: REPORT, kind: 'imports' }] },
  { file: 'test/registry.test.ts', edges: [] },
];

export const layerCoverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: layerTests.map((file) => ({
    file,
    complete: true,
    preconditions: [{ name: file, digest: `source:${file}` }],
  })),
  modules: [BASE, FACE, CARD, CHECKOUT, REPORT].sort().map((file) => ({
    file,
    sourceDigest: `source:${file}`,
    instrumented: true,
    blocks: [
      {
        ordinal: 0,
        kind: 'module' as const,
        digest: `block:${file}`,
        name: '',
        path: 'module',
        startLine: 1,
        endLine: 10,
        source: true,
        testFiles: layerTests.filter((test) => ENTERED[test]!.includes(file)),
      },
    ],
  })),
};

/** A one-line edit to the base, in the coordinates the snapshot holds it under. */
export const baseDiff = `--- a/${BASE}
+++ b/${BASE}
@@ -4,1 +4,1 @@
-  const size = 'small';
+  const size = 'medium';`;
