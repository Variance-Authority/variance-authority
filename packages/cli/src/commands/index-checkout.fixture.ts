/**
 * A checkout `variance index` runs in: two files committed on `main`, no
 * manifest and nothing recorded, so every follow-up says why it made nothing.
 * Shared by the tests of the in-process run and of the run that waits on a
 * process of its own, which print the same lines.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { committedCheckout } from './committed-checkout.fixture.js';
import { encodeAsSetExecutionIndex, encodeTestCoverage, testCoverageFile, withCaseSections } from '@variance-authority/sense/test-selection';

/** The lines after the index's own: no manifest names a package, no dependency, and nothing is recorded. `kept` is the generation of the questions a run that found the index where the last one left it keeps, with the map, reading no lexicon. */
export function unprepared(root: string, kept?: string): string {
  const unchanged = kept !== undefined;
  return `code map: none, because no manifest names a package${unchanged ? '; kept, because the index and the manifests are the ones it was folded from' : ''}\n` +
    `journeys: not prepared: nothing is recorded at ${testCoverageFile(root)}\n` +
    `dependency lexicon: ${unchanged ? 'unchanged, nothing read: ' : ''}0 workspace-dependency pairs, 0 public entrypoints, ${unchanged ? '' : '0 reused, '}0 unavailable, at ${join(dirname(sourceIndexPath(root)), 'dependency-lexicon.bin')}\n` +
    (unchanged ? `questions: kept at ${kept}, because the index and the manifests are the ones it was published from\n` : `questions: published at ${sourceIndexPath(root)}.help.bin\n`);
}

export async function checkout(): Promise<string> {
  const root = await committedCheckout('va-index-', {
    'src/widget.ts': "import { unit } from './unit.js';\nexport const widget = unit;\n",
    'src/unit.ts': 'export const unit = 1;\n',
  });
  process.chdir(root);
  return root;
}

/** A recording at a commit this checkout's object store does not hold, which no walk can read. */
export function unwalkable(root: string): void {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  const coverage = encodeTestCoverage({
    version: 3, instrumentation: 'fixture', tests: [], modules: [], commit: '0123456789abcdef0123456789abcdef01234567',
  });
  const block = { kind: 'function', name: 'unit', path: 'unit', startLine: 1, endLine: 1, source: true };
  writeFileSync(at, withCaseSections(coverage, {
    index: encodeAsSetExecutionIndex({
      tests: [{ id: 'test/unit.test.ts > one', file: 'test/unit.test.ts', name: 'one', stopped: false }],
      modules: [{ file: 'src/unit.ts', blocks: [{ ...block, crossings: [{ test: 0, distance: 0 }] }] }],
    }),
  }));
}
