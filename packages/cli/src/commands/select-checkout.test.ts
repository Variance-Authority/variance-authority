import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  landRun,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * The same rules with a real snapshot, a real checkout and a real diff under
 * them.
 *
 * The fixtures above assert the decision; these assert that the four things the
 * decision needs are actually fetched — the journal's path, the commit its line
 * ranges are coordinates in, the hunks, and the text at that commit. Every one
 * of them has a failure mode that reads as a clean answer, so none of them is
 * stood in for here.
 */
describe('reading this checkout', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Every journal these cases write is addressed through this, so none of them
    // can read or overwrite the recording this repository keeps for itself.
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('skips nothing and names the file when nothing has been recorded here', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-select-bare-'));

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing: no execution journal at');
    expect(said.err).toContain(testCoverageFile(root));
  });

  it('refuses a snapshot it cannot read, rather than reporting nothing recorded', async () => {
    // The failure this whole subsystem is written to refuse. Something wrote
    // this file, and an answer that skipped it would look exactly like a
    // repository that never recorded anything.
    const root = mkdtempSync(join(tmpdir(), 'va-select-broken-'));
    const file = testCoverageFile(root);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'this is not a snapshot');

    await expect(selectOutput({ cwd: root, format: 'plain' })).rejects.toThrow(
      /could not be read/,
    );
  });

  it('refuses a readable snapshot that names no commit when no change is given', async () => {
    // Its line ranges are coordinates in no text, so there is nothing to measure
    // a diff from, and the refusal says so rather than calling it unreadable.
    const root = mkdtempSync(join(tmpdir(), 'va-select-uncommitted-'));
    const { commit: _, ...uncommitted } = snapshot('c0ffee');
    await writeTestCoverage(testCoverageFile(root), uncommitted);

    await expect(selectOutput({ cwd: root, format: 'plain' })).rejects.toThrow(/names no commit.*`--since <ref>`/su);
  });

  it('skips the test files a real journal and a real diff rule out', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    // One line inside `other`, which only one recorded test ever entered.
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
    // The frame check ran and agreed: the module was read at its line ranges
    // rather than charged whole for being unrecognisable.
    expect(said.err).not.toContain('was recorded from a text');
  });

  it('reads a snapshot named by path, as a recorder in another runtime writes one', async () => {
    // The JVM agent writes `coverage.va` under the build's own output, never
    // into this repository's cache, and the run hands its path over.
    const { root, head } = checkout();
    const at = join(root, 'target/coverage.va');
    mkdirSync(join(at, '..'), { recursive: true });
    await writeTestCoverage(at, snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', execution: at });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
  });

  it('reads a snapshot named by path against a patch handed in', async () => {
    const { root, head } = checkout();
    const at = join(root, 'target/coverage.va');
    mkdirSync(join(at, '..'), { recursive: true });
    await writeTestCoverage(at, snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    const patch = join(root, 'change.patch');
    writeFileSync(patch, execFileSync('git', ['diff'], { cwd: root, encoding: 'utf8' }));
    execFileSync('git', ['checkout', '--', 'src/widget.ts'], { cwd: root });
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', execution: at, diff: patch });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
  });

  it('charges every region of a module whose recorded text is not the text at its commit', async () => {
    // The check `sourceAt` exists for, end to end. The snapshot is labelled with
    // a commit but describes a text that commit does not hold — a suite recorded
    // over a dirty tree, which is how a suite is normally recorded. Its line
    // numbers are coordinates in nothing, so no range may be read and every test
    // that touched the module runs.
    const { root, head } = checkout();
    const drifted = snapshot(head);
    const [module] = drifted.modules;
    await writeTestCoverage(testCoverageFile(root), {
      ...drifted,
      modules: [{ ...module!, sourceDigest: digestString(`${SOURCE}// another text\n`) }],
    });

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // Both tests that ever entered the module run, and the one that never did is
    // still skipped: a stale frame is a fact about one module's line numbers, so
    // it widens over that module's observers and no further.
    expect(said.out).toBe('test/gamma.test.ts\n');
    expect(said.err).toContain(
      "1 changed module was recorded from a text the journal's own commit does not hold and the cache did not keep",
    );
    expect(said.err).toContain('the next run that loads it records it again');
    expect(said.err).not.toContain('clean tree');
  });

  it('reads a change against the text a run recorded over an edit, once the edit is reverted', async () => {
    // The ordinary loop: edit, run the suite, revert. The run lands over an
    // edit that moved every line of `widget.ts` down one, so the commit it names
    // does not hold the text its line numbers count; the landing keeps that
    // text. A later edit to `other` is read from it, and only `beta` entered
    // `other`.
    const { root, head } = checkout();
    const edited = `// scratch\n${SOURCE}`;
    writeFileSync(join(root, 'src/widget.ts'), edited);
    const recorded = snapshot(head);
    const [module] = recorded.modules;
    await landRun(testCoverageFile(root), {
      ...recorded,
      modules: [{
        ...module!,
        sourceDigest: digestString(edited),
        // The module still starts at line 1; everything inside it moved down one.
        blocks: module!.blocks.map((block) =>
          ({ ...block, startLine: block.kind === 'module' ? 1 : block.startLine + 1, endLine: block.endLine + 1 })),
      }],
    }, root);

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
    expect(said.err).not.toContain('was recorded from a text');
  });

  it('runs a test a partial run did not observe, over a body edited since it ran', async () => {
    // `alpha` runs at the commit and enters `widget`. `widget`'s body is edited
    // and not committed, and a run of `beta` alone lands over the edit. `beta`
    // loads the module but not `widget`, so nothing has run the edited body.
    const { root, head } = checkout();
    await landRun(testCoverageFile(root), snapshot(head), root);

    const edited = SOURCE.replace("return 'a';", "return 'A';");
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
          digest: block.name === 'widget' ? digestString('widget, edited') : block.digest,
          testFiles: block.testFiles.filter((test) => test === 'test/beta.test.ts'),
        })),
      }],
    }, root);
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).not.toContain('test/alpha.test.ts');
    expect(said.out).toContain('test/gamma.test.ts');
  });

  it('runs a test a partial run did not observe, over a body edited in a module the run never loaded', async () => {
    // As above, but the run is `gamma` alone, which loads nothing: the landing
    // cuts `widget.ts`'s carried rows again in the edited text.
    const { root, head } = checkout();
    await landRun(testCoverageFile(root), snapshot(head), root);

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'a';", "return 'A';"));
    const recorded = snapshot(head);
    await landRun(testCoverageFile(root), {
      ...recorded,
      tests: recorded.tests.filter((test) => test.file === 'test/gamma.test.ts'),
      modules: [],
    }, root);
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).not.toContain('test/alpha.test.ts');
  });

  it('charges nothing for a comment deleted above the first statement, beside a changed body', async () => {
    // The recorder starts a module's region at its first statement, so no
    // region holds the comment above it, and deleting the comment ran nothing.
    const licensed = `// Licensed under MIT.\n${SOURCE}`;
    const { root, head } = checkout({ 'src/widget.ts': licensed });
    const recorded = snapshot(head);
    const [module] = recorded.modules;
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      modules: [{ ...module!, sourceDigest: digestString(licensed), blocks: below(module!.blocks, 1) }],
    });

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
  });

  it('charges nothing for a comment a run recorded over, once the comment is reverted beside a changed body', async () => {
    // The loop from the case above it, with the module's region where the
    // recorder puts it: at the first statement, below the comment. Against the
    // kept text, reverting the comment deletes a line no region holds.
    const { root, head } = checkout();
    const edited = `// scratch\n${SOURCE}`;
    writeFileSync(join(root, 'src/widget.ts'), edited);
    const recorded = snapshot(head);
    const [module] = recorded.modules;
    await landRun(testCoverageFile(root), {
      ...recorded,
      modules: [{ ...module!, sourceDigest: digestString(edited), blocks: below(module!.blocks, 1) }],
    }, root);

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('skipping 2 of 3 test files recorded whole');
  });

  it('skips a test that mocked the changed module, where it entered only while the module evaluated', async () => {
    // The mock ran the real module to learn its shape, so the recording holds
    // `beta` inside `other` while `widget.ts` loaded. What `other` contains
    // cannot fail a test that replaced it, and only the file graph knows the
    // replacement is there.
    const said = await mockedBeta({ loaded: true });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/gamma.test.ts\n');
  });

  it('runs a test that mocked the changed module, where a case of it called in', async () => {
    // A mock is installed before the file's first case, so a crossing a case
    // made ran the real `other`: a passthrough, a restored implementation.
    const said = await mockedBeta({ loaded: false });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
  });

  async function mockedBeta({ loaded }: { loaded: boolean }) {
    const { root, head } = checkout({
      'test/beta.test.ts': "import { vi } from 'vitest';\nimport { other } from '../src/widget';\nvi.mock('../src/widget');\nother();\n",
    });
    const recorded = snapshot(head);
    const [module] = recorded.modules;
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      modules: [{
        ...module!,
        blocks: module!.blocks.map((block) => block.name === 'other' && loaded ? { ...block, loadedBy: ['test/beta.test.ts'] } : block),
      }],
    });

    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    return selectOutput({ cwd: root, format: 'plain' });
  }

  it('narrows past a changed file no probe was ever in', async () => {
    // The scan holds `src/elsewhere.ts` and no measured module imports it, so
    // it is connected to nothing the suite ran: it keeps no test and is not
    // `unread`, which names only a path the graph does not hold either.
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'src/elsewhere.ts'), 'export const other = 2;\n');
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'vitest' });

    expect(said.out).toBe(
      ['alpha', 'beta', 'gamma'].map((name) => `--exclude=${join(root, `test/${name}.test.ts`)}\n`).join(''),
    );
    expect(said.err).not.toContain('skipping nothing');
    expect(said.err).not.toContain('records nothing about');
    expect(said.err).toContain('skipping 3 of 3 test files recorded whole');
  });

  it('hands vitest paths from the top of the checkout when run from a directory inside it', async () => {
    // The journal names files from the top, so an exclude resolved against `src/`
    // names `src/test/alpha.test.ts`, which is no file, and the run skips nothing.
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'b';", "return 'c';"));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: join(root, 'src'), format: 'vitest' });

    expect(said.out).toBe(['alpha', 'gamma'].map((name) => `--exclude=${join(root, `test/${name}.test.ts`)}\n`).join(''));
  });
});

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
function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** Every region `lines` further down, the module's own included, as a comment above the first statement puts them. */
function below(blocks: TestCoverage['modules'][number]['blocks'], lines: number): TestCoverage['modules'][number]['blocks'] {
  return blocks.map((block) => ({ ...block, startLine: block.startLine + lines, endLine: block.endLine + lines }));
}

/**
 * One module, two functions, three tests — and the third entered nothing at all,
 * which is what makes the skip list bigger than the diff.
 */
function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/alpha.test.ts', complete: true, preconditions: [] },
      { file: 'test/beta.test.ts', complete: true, preconditions: [] },
      { file: 'test/gamma.test.ts', complete: true, preconditions: [] },
    ],
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(SOURCE),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'widget.ts',
            path: 'module',
            startLine: 1,
            endLine: 8,
            source: true,
            testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
          },
          {
            ordinal: 1,
            kind: 'function',
            owner: 0,
            digest: digestString('widget'),
            name: 'widget',
            path: 'widget',
            startLine: 1,
            endLine: 3,
            source: true,
            testFiles: ['test/alpha.test.ts'],
          },
          {
            ordinal: 2,
            kind: 'function',
            owner: 0,
            digest: digestString('other'),
            name: 'other',
            path: 'other',
            startLine: 5,
            endLine: 7,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
