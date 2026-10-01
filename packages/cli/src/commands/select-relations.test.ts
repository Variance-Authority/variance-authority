import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` where the record cannot answer: the file graph answers
 * instead, for a suite whose tests reach their code by import.
 *
 * The walk is `variance reach --since`'s, and the skip list is the files nothing
 * imports that it did not reach. A suite declared `e2e`, `visual` or
 * `integration` reaches its code through pages and processes no import shows,
 * so only a record rules one of its tests out, and without one every test runs.
 */
describe('selecting by the file graph when the record cannot answer', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Every journal these cases write is addressed through this, so none of them
    // can read or overwrite the recording this repository keeps for itself.
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-relations-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('skips the test files the change cannot reach by import, when nothing has been recorded', async () => {
    const { root } = checkout();
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('test/other.test.ts\n');
    expect(said.err).toContain('no execution journal at');
    expect(said.err).toContain('by the file graph');
    expect(said.err).not.toContain('skipping nothing');
  });

  it('keeps a test file whose imports the scan could not all read', async () => {
    const { root } = checkout({
      'test/computed.test.ts': "const name = './other';\nawait import(`../src/${name}`);\n",
    });
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('test/other.test.ts\n');
  });

  it('selects by the file graph when the record holds no whole observation of any test file', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture',
      commit: head,
      tests: [{ file: 'test/widget.test.ts', complete: false, preconditions: [] }],
      modules: [],
    });
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/other.test.ts\n');
    expect(said.err).toContain('no whole observation');
    expect(said.err).toContain('by the file graph');
  });

  it('skips nothing for a suite declared e2e, and says only its record can rule a test out', async () => {
    const { root } = checkout({
      'variance.config.json': JSON.stringify({ suites: { journeys: { kind: 'e2e' } } }),
    });
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD', suite: 'journeys' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('declared e2e');
  });

  it('skips nothing when there is no record and no ref to walk from, and names the flag', async () => {
    const { root } = checkout();
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('--since');
  });

  it('skips nothing for a patch handed in, which names no ref to walk from', async () => {
    const { root } = checkout();
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    const patch = join(root, '..', `${root.split('/').pop()}.patch`);
    writeFileSync(patch, execFileSync('git', ['diff'], { cwd: root, encoding: 'utf8' }));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', diff: patch });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('`--diff` names none');
  });

  it('keeps a test file whose import the lockfile moved, beside an edit the walk reads', async () => {
    const { root } = checkout({
      'src/other.ts': "import leftPad from 'left-pad';\nexport const other = (): string => leftPad('b', 2);\n",
      'package-lock.json': npmLock('1.3.0'),
    });
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('');
    expect(said.err).not.toContain('skipping nothing');
  });

  it('skips nothing when the install cannot be compared', async () => {
    const { root, head } = checkout();
    writeFileSync(join(root, 'src/widget.ts'), "export const widget = (): string => 'c';\n");
    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain(`package-lock.json is not in the tree at ${head.slice(0, 12)}`);
  });

  it('skips nothing when the change reaches a file a runner loads before every test', async () => {
    // Nothing imports a setup module: the runner's config names it as a string,
    // so no edge leads from it to the tests it runs before.
    const { root } = checkout({ 'test/setup.ts': "globalThis.ready = true;\n" });
    writeFileSync(join(root, 'test/setup.ts'), "globalThis.ready = false;\n");
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('test/setup.ts');
  });

  it('skips nothing when the walk refuses, and gives its reason', async () => {
    // A deleted file is in no graph, so the walk cannot say what it reached —
    // and the test that imported it is the one that has to run.
    const { root } = checkout();
    rmSync(join(root, 'src/other.ts'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain', since: 'HEAD' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain('a deleted file is in no graph');
  });
});

/** Two modules, a test for each, committed; nothing recorded. */
function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-relations-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const all: Record<string, string> = {
    'src/widget.ts': "export const widget = (): string => 'a';\n",
    'src/other.ts': "export const other = (): string => 'b';\n",
    'test/widget.test.ts': "import { widget } from '../src/widget';\nwidget();\n",
    'test/other.test.ts': "import { other } from '../src/other';\nother();\n",
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'two modules and a test for each']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

function npmLock(version: string): string {
  return JSON.stringify({
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture', dependencies: { 'left-pad': '^1.0.0' } },
      'node_modules/left-pad': {
        version,
        resolved: `https://registry.npmjs.org/left-pad/-/left-pad-${version}.tgz`,
        integrity: `sha512-${version}==`,
      },
    },
  }, null, 2);
}
