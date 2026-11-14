import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitRunsFile, testCoverageFile } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { suiteEntry } from '../share-entries.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { PUSH, collectedBoth, gitPublished } from './mainline-fixture.js';
import { publishSuite, suiteShare, suiteShareLines } from './suite-share.js';

/**
 * What `variance share --suite` does with a record, in a real repository whose
 * `origin` is a bare repository: what it publishes and what it refuses to.
 */

const run = promisify(execFile);
let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-suite-share-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** The CI checkout, with its cache at `ci-cache`: see `gitPublished`. */
const mainline = (options: { readonly publish?: boolean } = {}) => gitPublished(home, options);

describe('a published record reaches the remote', () => {
  it('as refs/variance/mainline/main on origin, after a push to main', async () => {
    const { origin } = await mainline();
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toMatch(/refs\/variance\/mainline\/main$/u);
  });

  it('is refused for a record made at another commit, rather than published under this one', async () => {
    const { ci } = await mainline({ publish: false });
    await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');
    expect(await publishSuite(ci, 'unit', { env: PUSH })).toMatchObject({ none: expect.stringContaining('was recorded at') });
  });

  it('is refused for a record whose run did not run the whole suite, rather than published as the base', async () => {
    const { ci, origin, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: 'c'.repeat(40), files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));
    const collected = join(home, 'collected.txt');
    await writeFile(collected, 'test/other.test.ts\ntest/total.test.ts\n');

    expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected })).toEqual({
      none: `suite-v1/unit is left out: its record at ${own} is not a whole run: 1 test file(s) the suite collects last ran before ${first}, test/other.test.ts among them`,
    });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toBe('');
  });

  it('is refused without the runner\'s collected list, even when the runs record lists no test as run elsewhere', async () => {
    // `test/other.test.ts` is tracked and never ran; only the runner can say it is a test.
    const { ci, origin, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));

    expect(await publishSuite(ci, 'unit', { env: PUSH })).toEqual({
      none: `suite-v1/unit is left out: its record at ${own} is not a whole run: the runner was not asked which test files it collects, so nothing says the run covered all of them: pass \`--collected\``,
    });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toBe('');
  });
});

describe('`variance share --suite unit`', () => {
  it('publishes the record alone, and says so the way `share --publish` does', async () => {
    const { ci } = await mainline({ publish: false });
    const lines = await suiteShareLines(ci, { suite: 'unit', publish: true, collected: await collectedBoth(home) }, { env: PUSH });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^wrote suite-v1\/unit to mainline main in /u);
    expect(lines[1]).toMatch(/^kept the record at [0-9a-f]{40} beside the latest\.$/u);
  });

  it('says which test files it retired because the suite no longer collects them', async () => {
    const { ci } = await mainline({ publish: false });
    const collected = join(home, 'collected-other.txt');
    await writeFile(collected, 'test/other.test.ts\n');
    const lines = await suiteShareLines(ci, { suite: 'unit', publish: true, collected }, { env: PUSH });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^wrote suite-v1\/unit to mainline main in /u);
    expect(lines[2]).toBe('retired 1 test file(s) from suite-v1/unit that the suite no longer collects, test/total.test.ts among them.');
  });

  it('says nothing was published when this checkout holds no record at this commit', async () => {
    const { ci } = await mainline({ publish: false });
    await rm(testCoverageFile(ci, { suite: 'unit' }));
    expect(await suiteShareLines(ci, { suite: 'unit', publish: true }, { env: PUSH })).toEqual([
      'nothing published: this checkout holds no record of "unit".',
    ]);
  });

  it("refuses the project form's inputs beside it, and takes the records its jobs handed on", () => {
    expect(() => parseArgs(['share', '--suite', 'unit', '--config', 'web.json'])).toThrow(
      '`share --suite` reads the suite and its share from the root variance.config.json, so it takes no `--config`',
    );
    expect(parseArgs(['share', '--suite', 'unit', '--publish', 'ran'])).toMatchObject({ command: 'share', suite: 'unit', reports: ['ran'] });
    expect(parseArgs(['share', '--suite', 'unit', '--publish'])).toMatchObject({ command: 'share', suite: 'unit', publish: true });
  });
});

describe('a mainline publish counts a whole run against what the runner collects', () => {
  it('passes over a file that last ran at an older commit when the runner no longer collects it', async () => {
    const { ci, origin, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: 'c'.repeat(40), files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));
    const collected = join(home, 'collected.txt');
    await writeFile(collected, 'test/total.test.ts\n');

    expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected })).toMatchObject({ published: { written: [suiteEntry('unit')] } });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toMatch(/refs\/variance\/mainline\/main$/u);
  });

  it('counts a file standing at the publish commit itself as run there', async () => {
    const { ci, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: first, files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));
    const collected = join(home, 'collected.txt');
    await writeFile(collected, 'test/other.test.ts\ntest/total.test.ts\n');

    expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected })).toMatchObject({ published: { written: [suiteEntry('unit')] } });
  });

  it('fails the command when a mainline publish writes nothing, and not when a branch\'s does', async () => {
    const { ci } = await mainline({ publish: false });
    await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');

    const refused = await suiteShare(ci, { suite: 'unit', publish: true }, { env: PUSH });
    expect(refused.exit).toBe(EXIT_OPERATOR);
    expect(refused.lines.join('\n')).toContain('was recorded at');
    const branch = { ...PUSH, GITHUB_REF_NAME: 'feature' };
    expect((await suiteShare(ci, { suite: 'unit', publish: true }, { env: branch })).exit).toBe(EXIT_CLEAN);
  });

  it('refuses `--collected` anywhere but beside `--publish`', () => {
    expect(() => parseArgs(['share', '--suite', 'unit', '--collected', 'files.txt'])).toThrow(
      '`--collected` is for `share --publish`, which counts a whole run against it',
    );
    expect(parseArgs(['share', '--suite', 'unit', '--publish', '--collected', 'files.txt'])).toMatchObject({ collected: 'files.txt' });
  });
});
