import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * `variance select` over a diff that moved the install and no source line.
 *
 * A bumped package changes no line a test covered, so a journal read over the
 * diff alone reaches nobody and hands the runner every test it recorded as a
 * skip. The install is compared at the diff's base, and the moved names are
 * answered by the measured modules that import them; a lockfile that cannot be
 * compared skips nothing.
 */
describe('a diff that moved the install', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Every journal these cases write is addressed through this, so none of them
    // can read or overwrite the recording this repository keeps for itself.
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-install-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs the tests that entered a module importing the bumped package', async () => {
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    // `beta` entered `src/pad.ts`, which imports `left-pad`; the other two never
    // did. The reason names the lockfile, the package it moved and the file that
    // imports it, and the lockfile is not also a path the journal could not read.
    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(
      'skipping 2 of 3 test files recorded whole: none covered a changed line or entered a file the install moved',
    );
    expect(said.err).toContain(
      `package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (left-pad), so 1 file ` +
        'importing it (src/pad.ts) was read as changed whole',
    );
    expect(said.err).not.toContain('records nothing about');
  });

  it('names the package a bump reached a file through', async () => {
    // `pad-core` moved and no file imports it: `src/pad.ts` loads it through
    // `left-pad`, and the reason says so rather than that a line was covered.
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0', '2.0.0') });
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.3.0', '2.1.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'json' });

    expect(JSON.parse(said.out)).toMatchObject({
      skip: ['test/alpha.test.ts', 'test/gamma.test.ts'],
      because:
        'skipping 2 of 3 test files recorded whole: none covered a changed line or entered a file the install ' +
        'moved; every other test file runs',
      notes: expect.arrayContaining([
        `package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (pad-core through left-pad), ` +
          'so 1 file importing it (src/pad.ts) was read as changed whole',
      ]),
      install: { lockfile: 'package-lock.json', packages: ['pad-core'], reached: 1 },
      unread: [],
    });
  });

  it('names the manifest whose move changed the files beside it', async () => {
    // No package resolved differently: `src/package.json` turned its files into
    // modules, so every file under it loads differently and is read whole.
    const manifest = (type: string) => JSON.stringify({ name: 'pad', type });
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0'), 'src/package.json': manifest('commonjs') });
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'src/package.json'), manifest('module'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'json' });

    expect(JSON.parse(said.out)).toMatchObject({
      skip: ['test/alpha.test.ts', 'test/gamma.test.ts'],
      notes: expect.arrayContaining([
        'src/package.json moves what its importers load, so 1 file beside it (src/pad.ts) was read as changed whole',
      ]),
      install: { packages: [], moved: ['src/package.json'], reached: 1 },
    });
    expect(JSON.parse(said.out).install).not.toHaveProperty('lockfile');
  });

  it('compares a pnpm lockfile that opens on its environment document', async () => {
    // pnpm 11 and later write the package manager they pinned as a first YAML
    // document; the install is the second. TanStack Query's lockfile is this
    // shape, and a bump in it is answered like any other.
    const { root, head } = checkout({ 'pnpm-lock.yaml': pnpmLock('1.3.0') });
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'pnpm-lock.yaml'), pnpmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).not.toContain('skipping nothing');
  });

  it('skips nothing when the install cannot be compared', async () => {
    // No lockfile at the base, one in the tree: any package in it may have
    // moved, and nothing here can say which.
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    process.chdir(root);

    await indexOutput({ cwd: root });
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing');
    expect(said.err).toContain(`package-lock.json is not in the tree at ${head.slice(0, 12)}, where this install is compared from`);
  });
});

/**
 * A suite is recorded by being run, and the tree is often dirty when it runs:
 * bump, `yarn test`, then commit. The tests ran on the install on disk, not
 * the one the commit holds, so that install is what a later change is
 * compared from.
 */
describe('the install a recording ran on', () => {
  const cwd = process.cwd();
  let cache: string;

  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'va-select-install-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  /** Commit `left-pad` 1.3.0, put `recorded` on disk, and land a run over it the way a runner's teardown does. */
  async function recordedOver(recorded: string): Promise<{ root: string; head: string }> {
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    writeFileSync(join(root, 'package-lock.json'), npmLock(recorded));
    await landRun(testCoverageFile(root), snapshot(head), root);
    process.chdir(root);
    await indexOutput({ cwd: root });
    return { root, head };
  }

  it('skips every test when the install is the one the run was recorded over, bump uncommitted', async () => {
    const { root } = await recordedOver('1.4.0');

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).not.toContain('resolves');
  });

  it('runs the tests that entered a bumped package when the bump came after a clean recording', async () => {
    const { root, head } = await recordedOver('1.3.0');
    expect(await readCommitRuns(testCoverageFile(root))).toMatchObject({ installed: {} });

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(`package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (left-pad)`);
  });

  it('compares a later bump from the install the run was recorded over', async () => {
    const { root, head } = await recordedOver('1.4.0');

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.5.0'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(
      `package-lock.json resolves 1 package differently than the install recorded at ${head.slice(0, 12)} (left-pad)`,
    );
  });

  it('runs the tests that entered a bump undone after the recording', async () => {
    // Back to the commit's own lockfile: no change from the commit, and a
    // change from what the tests ran on.
    const { root } = await recordedOver('1.4.0');

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.3.0'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
  });

  it('compares from the commit when some test read there is placed on an assumption', async () => {
    // The runs at this commit observed `alpha` alone over the bump; `beta` is
    // read from the commit because nothing says where it ran, so nothing says
    // on which install either.
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    writeFileSync(join(root, 'package-lock.json'), npmLock('1.4.0'));
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    const at = new Date().toISOString();
    writeFileSync(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      commit: head,
      first: at,
      latest: at,
      runs: 1,
      files: ['test/alpha.test.ts'],
      installed: { 'package-lock.json': digestString(npmLock('1.4.0')) },
    }));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(`package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (left-pad)`);
  });

  it('compares from the commit, and says so, when the recorded install is not kept here', async () => {
    const { root, head } = await recordedOver('1.4.0');
    const kept = readdirSync(cache, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.texts'));
    expect(kept).not.toEqual([]);
    for (const path of kept) rmSync(join(cache, path), { recursive: true, force: true });

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(
      `the suite ran over a package-lock.json ${head.slice(0, 12)} does not hold, and that text is not kept here, ` +
        `so the install is compared from ${head.slice(0, 12)}`,
    );
  });
});

const PAD = [
  "import leftPad from 'left-pad';",
  '',
  'export function pad(text: string): string {',
  '  return leftPad(text, 4);',
  '}',
  '',
].join('\n');

/** `left-pad` at `version`, and `pad-core` beneath it when `core` is given. */
function npmLock(version: string, core?: string): string {
  return JSON.stringify(
    {
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', dependencies: { 'left-pad': '^1.0.0' } },
        'node_modules/left-pad': {
          version,
          resolved: `https://registry.npmjs.org/left-pad/-/left-pad-${version}.tgz`,
          integrity: `sha512-${version}==`,
          ...(core === undefined ? {} : { dependencies: { 'pad-core': '^2.0.0' } }),
        },
        ...(core === undefined
          ? {}
          : {
              'node_modules/pad-core': {
                version: core,
                resolved: `https://registry.npmjs.org/pad-core/-/pad-core-${core}.tgz`,
                integrity: `sha512-${core}==`,
              },
            }),
      },
    },
    null,
    2,
  );
}

/** Two documents: the pinned package manager, then the install. */
function pnpmLock(version: string): string {
  return [
    '---',
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    configDependencies: {}',
    '    packageManagerDependencies:',
    '      pnpm:',
    '        specifier: 12.4.2',
    '        version: 12.4.2',
    '',
    'packages:',
    '',
    '  pnpm@12.4.2:',
    '    resolution: {integrity: sha512-CK3GYTGAJ1x8ntraOdzwjJxhrU5==}',
    '',
    'snapshots:',
    '',
    '  pnpm@12.4.2: {}',
    '',
    '---',
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      left-pad:',
    '        specifier: ^1.0.0',
    `        version: ${version}`,
    '',
    'packages:',
    '',
    `  left-pad@${version}:`,
    `    resolution: {integrity: sha512-${version}==}`,
    '',
    'snapshots:',
    '',
    `  left-pad@${version}: {}`,
    '',
  ].join('\n');
}

/** A checkout holding exactly the text the snapshot below is recorded against. */
function checkout(files: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-install-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/pad.ts'), PAD);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);

  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** One module importing one package, entered by one of three tests. */
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
        file: 'src/pad.ts',
        sourceDigest: digestString(PAD),
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: digestString('module'),
            name: 'pad.ts',
            path: 'module',
            startLine: 1,
            endLine: 6,
            source: true,
            testFiles: ['test/beta.test.ts'],
          },
        ],
      },
    ],
  };
}
