import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { landRun, testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * A partial run landed over an edit, then a selection on the same edit: the
 * agent's loop of edit, run one file, select again.
 *
 * The landing moves the record to the edited text, so the selection after it
 * reads no diff for the file, and every test the record carries from before the
 * edit is answered by whether the landing demoted it. The selection should
 * charge what the record before the landing would have charged for the same
 * edit, less the tests the partial run just ran over it: a body edit runs the
 * tests that entered the edited body, and not every test that loaded the file.
 *
 * Each case below also moves the digest of the module's own region, as a type
 * annotation or a new function does in the real cut, so that what demotes is the
 * landing's reading of the edit and not which digests moved.
 */
describe('selecting after a partial run over an edit', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-partial-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs every test that loaded a module whose load sequence a partial run recorded over', async () => {
    // A top-level call runs as the module loads, so `delta`, which only loaded
    // it, ran different code than it will now.
    const said = await afterPartialRun(`${SOURCE}widget();\n`, ['module']);

    expect(said.out).toBe('test/beta.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs the tests that entered a body a partial run recorded over, and skips those that only loaded it', async () => {
    // `alpha` entered `widget`, which the edit changed. `delta` loaded the
    // module and entered nothing in it, so nothing it ran moved.
    const said = await afterPartialRun(SOURCE.replace("return 'a';", "return 'A';"), ['module', 'widget']);

    expect(said.out).toBe('test/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it('skips the tests that ran a module whose runtime text a partial run did not move', async () => {
    // A type annotation is not code: every test ran the program it would run now.
    const said = await afterPartialRun(SOURCE.replace('widget(): string', 'widget(): "a"'), ['module', 'widget']);

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs the tests a partial run recorded over an edit, once the edit is undone', async () => {
    // `beta` last ran `other` returning 'B'. The tree is back at the commit's
    // text, which the diff from the commit cannot see, and `beta` has not run it.
    const said = await afterPartialRun(SOURCE.replace("return 'b';", "return 'B';"), ['module', 'other'], { undo: true });

    expect(said.out).toBe('test/alpha.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it('skips them again once they have run the undone text', async () => {
    // `beta` ran the commit's text after the undo, so nothing it ran has moved.
    const said = await afterPartialRun(SOURCE.replace("return 'b';", "return 'B';"), ['module', 'other'], { undo: true, rerun: true });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it('reads a patch handed in as the whole change, and not the edit a run recorded over', async () => {
    // The edit is still on disk and `beta` ran it. The patch names another
    // file, and a patch handed in is the change as given.
    const said = await afterPartialRun(SOURCE.replace("return 'b';", "return 'B';"), ['module', 'other'], { patch: NOTES });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/delta.test.ts\ntest/gamma.test.ts\n');
  });

  it.todo(
    'runs the tests a partial run recorded over an edit once it is undone, when the landing kept no text for it — needs the undone files named without the kept store, from the ledger\'s dirty-run tree',
  );

  it.todo(
    'runs a test file a partial run ran edited, once its edit is undone — needs a text kept, or a tree read, for files with no instrumented row',
  );

  it.todo(
    'runs a test that declared a file as a precondition, once an edit a partial run recorded over is undone — needs the owner to decide whether an undone file governs the precondition table',
  );
});

/**
 * Land the full record at the commit, write `edited` over the module, land a
 * run of `beta` alone over it with the named regions' digests moved, and select,
 * with `undo` after writing the commit's text back, `rerun` after landing `beta`
 * again over that text, and with `patch` handed in as the diff.
 */
async function afterPartialRun(
  edited: string,
  moved: readonly string[],
  { undo = false, rerun = false, patch }: { undo?: boolean; rerun?: boolean; patch?: string } = {},
) {
  const { root, head } = checkout();
  await landRun(testCoverageFile(root), snapshot(head), root);

  writeFileSync(join(root, 'src/widget.ts'), edited);
  const recorded = snapshot(head);
  const [module] = recorded.modules;
  await landRun(testCoverageFile(root), {
    ...recorded,
    tests: recorded.tests.filter((test) => test.file === 'test/beta.test.ts'),
    modules: [{
      ...module!,
      sourceDigest: digestString(edited),
      blocks: module!.blocks.map((block) => ({
        ...block,
        digest: moved.includes(block.path) ? digestString(`${block.path}, edited`) : block.digest,
        testFiles: block.testFiles.filter((test) => test === 'test/beta.test.ts'),
      })),
    }],
  }, root);
  if (undo) writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  if (rerun) {
    const again = snapshot(head);
    await landRun(testCoverageFile(root), {
      ...again,
      tests: again.tests.filter((test) => test.file === 'test/beta.test.ts'),
      modules: again.modules.map((recordedModule) => ({
        ...recordedModule,
        blocks: recordedModule.blocks.map((block) => ({
          ...block,
          testFiles: block.testFiles.filter((test) => test === 'test/beta.test.ts'),
        })),
      })),
    }, root);
  }
  process.chdir(root);

  await indexOutput({ cwd: root });
  if (patch === undefined) return selectOutput({ cwd: root, format: 'plain' });
  const handed = join(mkdtempSync(join(tmpdir(), 'va-partial-patch-')), 'change.patch');
  writeFileSync(handed, patch);
  return selectOutput({ cwd: root, format: 'plain', diff: handed });
}

/** A patch that adds a file nothing ran. */
const NOTES = [
  'diff --git a/notes.txt b/notes.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/notes.txt',
  '@@ -0,0 +1 @@',
  '+a note',
  '',
].join('\n');

const SOURCE = [
  'export function widget(): string {',
  "  return 'a';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');

/** A checkout holding exactly the text the snapshot below is recorded against. */
function checkout(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-partial-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

/**
 * One module, two functions, four tests: `alpha` entered `widget`, `beta`
 * entered `other`, `delta` loaded the module and entered neither, and `gamma`
 * entered nothing at all.
 */
function snapshot(commit: string): TestCoverage {
  const loaders = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/delta.test.ts'];
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: ['alpha', 'beta', 'delta', 'gamma'].map((name) => ({
      file: `test/${name}.test.ts`,
      complete: true,
      preconditions: [],
    })),
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: digestString('module'), name: 'widget.ts', path: 'module', startLine: 1, endLine: 8, source: true, testFiles: loaders },
          { ordinal: 1, kind: 'function', owner: 0, digest: digestString('widget'), name: 'widget', path: 'widget', startLine: 1, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
          { ordinal: 2, kind: 'function', owner: 0, digest: digestString('other'), name: 'other', path: 'other', startLine: 5, endLine: 7, source: true, testFiles: ['test/beta.test.ts'] },
        ],
      },
    ],
  };
}
