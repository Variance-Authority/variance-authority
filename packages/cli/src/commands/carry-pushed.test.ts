import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGAINST, keepPushed, movePushed, takePushed, takenLines } from './carry-pushed.js';
import { carry, git, pullRequest, runsAt, streams } from './carry-pushed.fixture.js';
import { gitPublished, recordIn } from './mainline-fixture.js';
import { suiteBase } from './suite-base.js';

/**
 * What a pull request's earlier push left, kept by `carry keep` and taken by
 * `carry take` as this checkout's own layer.
 *
 * The record names the commits its tests last ran at, and a selection diffs
 * each test from its commit. Those are the merge commits of earlier pushes:
 * GitHub moves `refs/pull/<n>/merge` on every push, so no ref a clone fetches
 * holds them, and they are fetched by name. A suite whose commits cannot all
 * be had is not taken, and the checkout reads the mainline's record as it
 * would with nothing carried.
 */

/** The bytes of a record that keeps its cases, as a mainline run leaves one. */
async function keptRecord(): Promise<Buffer> {
  const at = await mkdtemp(join(tmpdir(), 'carry-pushed-record-'));
  await writeFile(join(at, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
  await recordIn(at, 'a'.repeat(40), [], []);
  return readFile(testCoverageFile(at, { suite: 'unit' }));
}

const MAINLINE = await keptRecord();

describe('a pull request reads from what its last push ran', () => {
  it('takes a suite whose commits the clone holds as its own layer', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const taken = await takePushed(clone, carried);

    expect(taken).toEqual({ taken: ['unit'], left: [] });
    const own = testCoverageFile(clone, { suite: 'unit' });
    expect(readFileSync(own, 'utf8')).toBe('carried');
    expect(existsSync(join(dirname(own), 'coverage.runs.json'))).toBe(true);
  });

  it('fetches by name a commit a test stands on that no ref holds', async () => {
    const { clone, kept, gone } = await pullRequest();
    expect(() => git(clone, 'cat-file', '-e', `${gone}^{commit}`)).toThrow();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept, [gone]));

    expect(await takePushed(clone, carried)).toEqual({ taken: ['unit'], left: [] });
    expect(git(clone, 'cat-file', '-t', gone)).toBe('commit');
  });

  it('leaves a suite whose commit the remote no longer has, and says which', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(kept, [lost]));
    await carry(carried, 'chromium', runsAt(kept));

    const taken = await takePushed(clone, carried);

    expect(taken.taken).toEqual(['chromium']);
    expect(taken.left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(false);
    expect(takenLines(taken)).toContain(
      `unit reads the mainline's record: neither the commits kept beside the records nor the remote hold ${lost.slice(0, 12)}, which the last push's record stands on.`,
    );
  });

  it('leaves a suite whose record names no commit its tests ran at', async () => {
    const { clone } = await pullRequest();
    const carried = join(clone, '.carried');
    await mkdir(join(carried, 'unit'), { recursive: true });
    await writeFile(join(carried, 'unit', 'coverage.bin'), 'carried');

    expect(await takePushed(clone, carried)).toEqual({ taken: [], left: [{ suite: 'unit', unlisted: true }] });
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(false);
  });

  it('replaces the record a restore laid from the mainline, which the last push already stood on', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    await writeFile(join(dirname(own), 'stray'), 'mainline');
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const aside = join(clone, AGAINST, 'unit', 'coverage.bin');
    expect(await takePushed(clone, carried)).toEqual({ taken: ['unit'], left: [], against: { unit: aside } });
    expect(readFileSync(own, 'utf8')).toBe('carried');
    expect(existsSync(join(dirname(own), 'stray'))).toBe(false);
    // The review compares the change's cases with the mainline's, not the last push's.
    expect(readFileSync(aside)).toEqual(MAINLINE);
  });

  it("leaves the mainline's cases it set aside out of the change, in a project that ignores nothing of ours", async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));

    await takePushed(clone, join(clone, '.carried'));

    expect(existsSync(join(clone, AGAINST, 'unit', 'coverage.bin'))).toBe(true);
    const untracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.variance'], { cwd: clone, encoding: 'utf8' });
    expect(untracked).toBe('');
  });

  it("keeps the mainline's cases it set aside when this push is kept before the review reads them", async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const against = (await takePushed(clone, carried)).against?.unit;
    await keepPushed(clone, carried, 'refs/remotes/origin/main');

    expect(against).toBeDefined();
    expect(readFileSync(against!)).toEqual(MAINLINE);
  });

  it('leaves the record a restore laid when the last push\'s cannot be taken', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(kept, [lost]));

    expect((await takePushed(clone, carried)).left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(readFileSync(own)).toEqual(MAINLINE);
  });

  it('leaves a suite the last push recorded under other probes, which no run here can be laid over', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));
    await writeTestCoverage(join(carried, 'unit', 'coverage.bin'), { version: 3, instrumentation: 'earlier-probes', tests: [], modules: [] });

    const taken = await takePushed(clone, carried, { instrumentation: 'these-probes' });

    expect(taken).toEqual({
      taken: [],
      left: [{ suite: 'unit', instrumentation: 'earlier-probes', run: 'these-probes' }],
      against: { unit: join(clone, AGAINST, 'unit', 'coverage.bin') },
    });
    expect(readFileSync(own)).toEqual(MAINLINE);
    expect(takenLines(taken)).toEqual([
      "unit reads the mainline's record: the last push recorded under the probes `earlier-probes`, and this run records under `these-probes`, so no run here can be laid over it.",
      `unit: the mainline's cases are at ${join(clone, AGAINST, 'unit', 'coverage.bin')}, for \`review --against\`.`,
    ]);
  });

  it('keeps every suite this push recorded, with what a run left half-written left out', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(join(dirname(own), '.run-1'), { recursive: true });
    await writeFile(own, 'this push');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    await writeFile(join(dirname(own), '.run-1', 'part'), 'half');
    const pushed = join(clone, '.pushed');
    await carry(pushed, 'chromium', runsAt(kept));

    expect(await keepPushed(clone, pushed, 'refs/remotes/origin/main')).toEqual({ kept: ['unit'], bundled: [] });
    expect(readFileSync(join(pushed, 'unit', 'coverage.bin'), 'utf8')).toBe('this push');
    expect(existsSync(join(pushed, 'unit', '.run-1'))).toBe(false);
    // What an earlier push kept and this one did not record is not carried twice.
    expect(existsSync(join(pushed, 'chromium'))).toBe(false);
  });

  it('keeps the suites a repository declares, whatever their names', async () => {
    const { clone, kept } = await pullRequest();
    await writeFile(join(clone, 'variance.config.json'), JSON.stringify({ suites: { jest: { kind: 'unit' } } }));
    const own = testCoverageFile(clone, { suite: 'jest' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'this push');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    const pushed = join(clone, '.pushed');

    expect(await keepPushed(clone, pushed, 'refs/remotes/origin/main')).toEqual({ kept: ['jest'], bundled: [] });
    expect(readFileSync(join(pushed, 'jest', 'coverage.bin'), 'utf8')).toBe('this push');
  });

  it('leaves a suite the last push kept that the repository no longer declares', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'renamed', runsAt(kept));
    await carry(carried, 'unit', runsAt(kept));

    expect(await takePushed(clone, carried)).toEqual({ taken: ['unit'], left: [{ suite: 'renamed', undeclared: true }] });
  });

  it('takes nothing when nothing was carried', async () => {
    const { clone } = await pullRequest();
    expect(await takePushed(clone, join(clone, '.nothing'))).toEqual({ taken: [], left: [] });
  });
});

describe('what a review compares with once the last push is taken', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the mainline's cases the share holds, for a suite whose restore laid no record", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'carry-pushed-share-')));
    const { origin, first } = await gitPublished(home);
    const fresh = join(home, 'fresh');
    git(home, 'clone', '-q', origin, fresh);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'fresh-cache'));
    const carried = join(fresh, '.carried');
    await carry(carried, 'unit', runsAt(first));
    const base = await suiteBase(fresh, { env: {} });
    if (base.from !== 'mainline' || base.mainline.cases === undefined) throw new Error(`expected the mainline's cases, read ${JSON.stringify(base)}`);

    expect(await takePushed(fresh, carried, { env: {} })).toEqual({ taken: ['unit'], left: [], against: { unit: base.mainline.cases } });
  });

  it('is nothing for a suite the share holds and it does not take, which a review reads from the share itself', async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'carry-pushed-share-')));
    const { origin } = await gitPublished(home);
    const fresh = join(home, 'fresh');
    git(home, 'clone', '-q', origin, fresh);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'fresh-cache'));

    expect(await takePushed(fresh, join(fresh, '.nothing'), { env: {} })).toEqual({ taken: [], left: [] });
  });

  it('is nothing for a restored record that kept no cases, which a review could not read', async () => {
    const { clone } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'no cases');

    expect(await takePushed(clone, join(clone, '.nothing'))).toEqual({ taken: [], left: [] });
    expect(existsSync(join(clone, AGAINST, 'unit', 'coverage.bin'))).toBe(false);
  });
});

describe('`carry take|keep` as a workflow step reads it', () => {
  it('writes the taken suites and the mainline\'s record set aside as outputs, and the lines to the log', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));
    await mkdir(join(carried, 'chromium'), { recursive: true });
    await writeFile(join(carried, 'chromium', 'coverage.bin'), 'carried');
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: carried, format: 'github' }, clone, to);

    const aside = join(clone, AGAINST, 'unit', 'coverage.bin');
    expect(said.out).toBe(`taken=unit\nleft=chromium\nagainst-unit=${aside}\n`);
    expect(said.err).toBe(
      `unit reads from what the last push ran. The mainline's cases are at ${aside}, for \`review --against\`.\n` +
        "chromium reads the mainline's record: the last push's record has no runs record naming the commit it was recorded at.\n",
    );
  });

  it("sets the mainline's cases aside on a first push, when the run is about to write over them", async () => {
    const { clone } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: join(clone, '.nothing'), format: 'github' }, clone, to);

    const aside = join(clone, AGAINST, 'unit', 'coverage.bin');
    expect(said.out).toBe(`taken=\nleft=\nagainst-unit=${aside}\n`);
    expect(readFileSync(aside)).toEqual(MAINLINE);
    expect(readFileSync(own)).toEqual(MAINLINE);
  });

  it("sets the mainline's cases aside for a suite the last push could not give", async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept, ['f'.repeat(40)]));

    const aside = join(clone, AGAINST, 'unit', 'coverage.bin');
    expect((await takePushed(clone, carried)).against).toEqual({ unit: aside });
    expect(readFileSync(aside)).toEqual(MAINLINE);
  });

  it('writes the kept suites as an output, and to a person reading text says what it kept', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'this push');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    const pushed = join(clone, '.pushed');

    const github = streams();
    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'github' }, clone, github.streams, 'main');
    expect(github.said).toEqual({ out: 'kept=unit\n', err: `kept unit in ${pushed}.\n` });

    const text = streams();
    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'text' }, clone, text.streams, 'main');
    expect(text.said).toEqual({ out: `kept unit in ${pushed}.\n`, err: '' });
  });

  it('says when neither the restore nor the share gave a taken suite a mainline record', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: carried, format: 'text' }, clone, to);

    expect(said.out).toBe(
      "unit reads from what the last push ran. Neither the restore nor the share gave a mainline record, so a review compares its cases with the last push's.\n",
    );
  });

  it('takes a suite against the probes the run it precedes records under', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));
    const record = join(carried, 'unit', 'coverage.bin');
    await writeTestCoverage(record, { version: 3, instrumentation: 'earlier-probes', tests: [], modules: [] });

    const earlier = streams();
    await movePushed({ command: 'carry', direction: 'take', dir: carried, format: 'github' }, clone, earlier.streams);
    expect(earlier.said.out).toBe('taken=\nleft=unit\n');

    const again = join(clone, '.again');
    await carry(again, 'unit', runsAt(kept));
    await writeTestCoverage(join(again, 'unit', 'coverage.bin'), { version: 3, instrumentation: instrumentationId(), tests: [], modules: [] });
    const these = streams();
    await movePushed({ command: 'carry', direction: 'take', dir: again, format: 'github' }, clone, these.streams);
    expect(these.said.out).toBe('taken=unit\nleft=\n');
  });

  it('says nothing was carried, and keeps nothing when no suite recorded', async () => {
    const { clone } = await pullRequest();
    const { said, streams: to } = streams();
    await movePushed({ command: 'carry', direction: 'take', dir: join(clone, '.nothing'), format: 'text' }, clone, to);
    await movePushed({ command: 'carry', direction: 'keep', dir: join(clone, '.pushed'), format: 'text' }, clone, to);
    expect(said.out).toBe("no earlier push kept a record, so every suite reads the mainline's.\nthis push recorded no suite, so nothing is kept.\n");
  });

  it("names where a suite it did not take has the mainline's cases, and the suite with none", async () => {
    const { clone } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, MAINLINE);
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: join(clone, '.nothing'), format: 'text' }, clone, to);

    const aside = join(clone, AGAINST, 'unit', 'coverage.bin');
    expect(said.out).toBe(`unit: the mainline's cases are at ${aside}, for \`review --against\`.\n`);
  });
});
