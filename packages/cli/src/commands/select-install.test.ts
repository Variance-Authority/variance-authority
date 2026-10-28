import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
} from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';
import { checkout, npmLock, snapshot } from './select-install-fixture.js';

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

  /** Commit `left-pad` 1.3.0 and the tests, put `recorded` on disk, and land a run over it the way a runner's teardown does. */
  async function recordedOver(recorded: string): Promise<{ root: string; head: string }> {
    const tests = Object.fromEntries(snapshot('').tests.map((test) => [test.file, "import '../src/pad';\n"]));
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0'), ...tests });
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

  it('runs the tests beside a manifest undone after the recording', async () => {
    const manifest = (type: string) => JSON.stringify({ name: 'pad', type });
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0'), 'src/package.json': manifest('commonjs') });
    writeFileSync(join(root, 'src/package.json'), manifest('module'));
    await landRun(testCoverageFile(root), snapshot(head), root);
    process.chdir(root);
    await indexOutput({ cwd: root });

    writeFileSync(join(root, 'src/package.json'), manifest('commonjs'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain('src/package.json moves what its importers load');
  });

  it('compares a stand from the install its tests ran on once the bump is committed and a subset ran', async () => {
    // Record over an uncommitted bump, commit it, and run one test: the other
    // two now stand at the first commit, on the bumped install, which the next
    // commit holds. Nothing moved for anybody.
    const { root } = await recordedOver('1.4.0');
    execFileSync('git', ['commit', '--quiet', '-am', 'the bump the suite ran on'], { cwd: root });
    const bumped = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const ran = snapshot(bumped);
    const alone = { ...ran, tests: ran.tests.slice(0, 1), modules: ran.modules.map((module) => ({ ...module, blocks: module.blocks.map((block) => ({ ...block, testFiles: [] })) })) };
    await landRun(testCoverageFile(root), alone, root);
    await indexOutput({ cwd: root });

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).not.toContain('resolves');
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
      `the suite ran over a package-lock.json that ${head.slice(0, 12)} does not hold, and that text is not kept here, ` +
        `so the install is compared from ${head.slice(0, 12)}`,
    );
  });

  it('says so for each commit whose recorded install is not kept here', async () => {
    // The first run, over 1.4.0, leaves beta and gamma standing at `head`; the
    // second ran alpha over 1.5.0 at the commit of the bump. Neither text is
    // here, so each is compared from its own commit, and each says so.
    const { root, head } = await recordedOver('1.4.0');
    execFileSync('git', ['commit', '--quiet', '-am', 'the bump the suite ran on'], { cwd: root });
    const bumped = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'package-lock.json'), npmLock('1.5.0'));
    const ran = snapshot(bumped);
    const alone = { ...ran, tests: ran.tests.slice(0, 1), modules: ran.modules.map((module) => ({ ...module, blocks: module.blocks.map((block) => ({ ...block, testFiles: [] })) })) };
    await landRun(testCoverageFile(root), alone, root);
    await indexOutput({ cwd: root });
    const kept = readdirSync(cache, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.texts'));
    for (const path of kept) rmSync(join(cache, path), { recursive: true, force: true });

    const said = await selectOutput({ cwd: root, format: 'plain' });

    for (const at of [head, bumped].map((commit) => commit.slice(0, 12))) {
      expect(said.err).toContain(`the suite ran over a package-lock.json that ${at} does not hold, and that text is not kept here, so the install is compared from ${at}`);
    }
  });

  it('names a lockfile the suite ran without as the reason it cannot compare', async () => {
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    rmSync(join(root, 'package-lock.json'));
    await landRun(testCoverageFile(root), snapshot(head), root);
    expect(await readCommitRuns(testCoverageFile(root))).toMatchObject({ installed: { 'package-lock.json': null } });
    writeFileSync(join(root, 'package-lock.json'), npmLock('1.3.0'));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('');
    expect(said.err).toContain(
      `the suite ran at ${head.slice(0, 12)} with no package-lock.json, so there is no install to compare it against and any package in it may have moved`,
    );
  });
});

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
