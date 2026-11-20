/**
 * A checkout `variance index` runs in: two files committed on `main`, no
 * manifest and nothing recorded, so every follow-up says why it made nothing.
 * Shared by the tests of the in-process run and of the run that waits on a
 * process of its own, which print the same lines.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { encodeAsSetExecutionIndex, encodeTestCoverage, testCoverageFile, withCaseSections } from '@variance-authority/sense/test-selection';

/** The lines after the index's own: no manifest names a package, no dependency, and nothing is recorded. `kept` is the generation of the questions a run that found the index where the last one left it keeps, with the map, reading no lexicon. */
export function unprepared(root: string, kept?: string): string {
  const unchanged = kept !== undefined;
  return `code map: none, because no manifest names a package${unchanged ? '; kept, because the index and the manifests are the ones it was folded from' : ''}\n` +
    `journeys: not prepared: nothing is recorded at ${testCoverageFile(root)}\n` +
    `dependency lexicon: ${unchanged ? 'unchanged, nothing read: ' : ''}0 workspace-dependency pairs, 0 public entrypoints, ${unchanged ? '' : '0 reused, '}0 unavailable, at ${join(dirname(sourceIndexPath(root)), 'dependency-lexicon.bin')}\n` +
    (unchanged ? `questions: kept at ${kept}, because the index and the manifests are the ones it was published from\n` : `questions: published at ${sourceIndexPath(root)}.help.bin\n`);
}

export function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'va-index-'));
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), "import { unit } from './unit.js';\nexport const widget = unit;\n");
  writeFileSync(join(root, 'src/unit.ts'), 'export const unit = 1;\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the checkout']);
  process.chdir(root);
  // The path the process sees, which is the one a recording is keyed by: the temporary directory is a symlink on macOS.
  return realpathSync(root);
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
