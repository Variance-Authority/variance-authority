import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, testCoverageFile, withCaseSections } from '@variance-authority/sense/test-selection';
import { mainlineMissed } from './mainline-base.js';
import { cloneOf, git, parseReview, publishRaw, published, ranHere, recordIn, selectedIn, BEFORE, DISCOUNTS } from './mainline-fixture.js';
import { review } from './review.js';
import { formatReview } from './review-text.js';
import { selectOutput } from './select-command.js';

/**
 * What `select` and `review` say when this checkout recorded nothing and the
 * mainline's record could not be read either: each miss by name, and never as
 * a record that was read. `select` still has an answer, which is every test;
 * `review` is refused and says why.
 */

let home: string;
const cwd = process.cwd();
const UNSET = 'VARIANCE_MAINLINE_BASE_TEST_TOKEN';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-mainline-miss-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  delete process.env[UNSET];
  await rm(home, { recursive: true, force: true });
});

/** The read layer the clone's cache keeps the mainline's records in. */
const readLayer = () => join(home, 'laptop-cache', 'share', 'read');

/** The record CI made in `dir`, its case index swapped for bytes no index reader reads. */
async function unreadCases(dir: string): Promise<void> {
  const record = testCoverageFile(dir, { suite: 'unit' });
  await writeFile(record, withCaseSections(await readFile(record), { index: Buffer.from('not an index') }));
}

/** The record CI made in `dir`, given an Eyes section this build does not read. */
function unreadEyes(eyes: string): (dir: string) => Promise<void> {
  return async (dir) => {
    const record = testCoverageFile(dir, { suite: 'unit' });
    await writeFile(record, withCaseSections(await readFile(record), { ...caseSectionsAt(record), eyes: Buffer.from(eyes) }));
  };
}

/** A clone with its own cache, and the change `select` is asked about. */
async function laptop(origin: string, at = home): Promise<string> {
  const clone = await cloneOf(at, origin);
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(at, 'laptop-cache');
  await writeFile(join(clone, 'src/total.ts'), BEFORE.replace('0.9', '0.8'));
  return clone;
}

/** Commit `share` as the root config's share section on the mainline, so a clone reads it. */
async function reshared(dir: string, share: object): Promise<void> {
  await writeFile(join(dir, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share }));
  await git(dir, 'commit', '--quiet', '-am', 'another share');
  await git(dir, 'push', '--quiet', 'origin', 'main');
}

describe('`variance select` when the mainline\'s record is not read', () => {
  it('skips nothing, and says what the share answered, when the mainline published no record of the suite', async () => {
    const ci = await published(home, { publish: false });
    const clone = await laptop(ci.origin);

    const said = await selectedIn(clone);

    expect(said.out).toBe('');
    expect(said.err).toContain('skipping nothing: no execution journal at');
    expect(said.err).toContain('record of "unit": the share has none either; mainline main: nothing is published there.');
    const json = JSON.parse((await selectOutput({ cwd: clone, format: 'json' })).out) as { journal: object };
    expect(json.journal).not.toHaveProperty('from');
  });

  it('skips nothing, and says the share was not asked, when the root config\'s share section does not parse', async () => {
    const ci = await published(home, { publish: false });
    await reshared(ci.dir, { kind: 'directory', root: join(home, 'share'), mainlines: [] });

    const said = await selectedIn(await laptop(ci.origin));

    expect(said.out).toBe('');
    expect(said.err).toContain('record of "unit": the share was not asked; ');
    expect(said.err).toContain('variance.config.json: `share.mainlines` must name at least one branch');
  });

  it('skips nothing, and names the variable, when the share\'s token is not set on this machine', async () => {
    const ci = await published(home, { publish: false });
    await reshared(ci.dir, { kind: 'http', endpoint: 'https://share.test/variance', token: { env: UNSET }, mainlines: ['main'] });

    const said = await selectedIn(await laptop(ci.origin));

    expect(said.out).toBe('');
    expect(said.err).toContain('record of "unit": the mainline\'s was not read; mainline main: ');
    expect(said.err).toContain(`names the environment variable "${UNSET}", and it is not set`);
    expect(said.err).not.toContain('none either');
  });

  it('skips nothing, and says where, when the record cannot be kept on this machine', async () => {
    const ci = await published(home);
    const clone = await laptop(ci.origin);
    await mkdir(join(readLayer(), '..'), { recursive: true });
    await writeFile(readLayer(), '');

    const said = await selectedIn(clone);

    expect(said.out).toBe('');
    expect(said.err).toContain(`record of "unit": the mainline's was not read; mainline main: the record published at ${ci.first} could not be kept at ${join(readLayer(), 'unit', ci.first, 'coverage.bin')}: `);
  });

  it('skips nothing, and keeps nothing, when the record published does not read', async () => {
    const ci = await published(home, { publish: false, record: (dir) => writeFile(testCoverageFile(dir, { suite: 'unit' }), 'not a record') });
    await publishRaw(home, ci.dir, ci.first);

    const said = await selectedIn(await laptop(ci.origin));

    expect(said.out).toBe('');
    expect(said.err).toContain(`mainline main: the record published at ${ci.first} does not read: not a variance-authority test coverage artifact.`);
    expect(existsSync(join(readLayer(), 'unit', ci.first))).toBe(false);
  });

  it('selects from the record, and keeps its cases without its Eyes, when only its Eyes section does not read', async () => {
    for (const [at, eyes] of [['newer', '{"version":2,"watched":[],"journals":[]}\n'], ['corrupt', 'not json']] as const) {
      process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, `${at}-ci-cache`);
      await mkdir(join(home, at));
      const ci = await published(join(home, at), { publish: false, record: unreadEyes(eyes) });
      await publishRaw(join(home, at), ci.dir, ci.first);

      const said = await selectedIn(await laptop(ci.origin, join(home, at)));

      expect(said.out).toBe('test/other.test.ts\n');
      const kept = caseSectionsAt(join(home, at, 'laptop-cache', 'share', 'read', 'unit', ci.first, 'coverage.bin'));
      expect(kept.index).toBeDefined();
      expect(kept.eyes).toBeUndefined();
    }
  });

  it('skips nothing when the record published at one commit was recorded at another', async () => {
    const elsewhere = 'a'.repeat(40);
    const ci = await published(home, { publish: false, record: (dir) => recordIn(dir, elsewhere, ['test/total.test.ts'], [DISCOUNTS]) });
    await publishRaw(home, ci.dir, ci.first);

    const said = await selectedIn(await laptop(ci.origin));

    expect(said.out).toBe('');
    expect(said.err).toContain(`the record published at ${ci.first} was recorded at ${elsewhere}, so its regions are not coordinates in the commit it was published at.`);
  });

  it('selects from the record, and says the cases were left out, when only its per-case index does not read', async () => {
    const ci = await published(home, { record: unreadCases });

    const said = await selectedIn(await laptop(ci.origin));

    expect(said.out).toBe('test/other.test.ts\n');
    expect(said.err).toMatch(/record of "unit": read from mainline main, [^\n]*; its per-case index does not read \([^\n]+\), so it is not kept\.\n/);
    expect(await readdir(join(readLayer(), 'unit', ci.first))).toEqual(['coverage.bin', 'coverage.runs.json']);
  });

  it('says the share has none only when the share answered that, and otherwise what it did answer', () => {
    const suite = 'unit';
    const mainline = 'main';
    expect(mainlineMissed({ suite, mainline, miss: { kind: 'absent' }, holds: ['suite-index-v1'] }))
      .toBe('record of "unit": the share has none either; mainline main: it holds only suite-index-v1');
    expect(mainlineMissed({ suite, mainline, miss: { kind: 'refused', detail: 'https://share.test/main: HTTP 401' } }))
      .toBe('record of "unit": the mainline\'s was not read; mainline main: https://share.test/main: HTTP 401');
    expect(mainlineMissed({ suite, mainline, miss: { kind: 'newer', names: ['suite-v2/unit'] } }))
      .toBe('record of "unit": the mainline\'s was not read; mainline main: it holds suite-v2/unit, a format this version does not read');
    expect(mainlineMissed({ suite, miss: { kind: 'unconfigured', detail: 'nothing answered from config, remote-head' } }))
      .toBe('record of "unit": the mainline\'s was not read; no mainline: nothing answered from config, remote-head');
    expect(mainlineMissed({ suite, miss: { kind: 'unconfigured', detail: 'variance.config.json: `share.root` is missing' }, shareAsked: false }))
      .toBe('record of "unit": the share was not asked; variance.config.json: `share.root` is missing');
  });
});

describe('`variance review` when the mainline\'s record is not read', () => {
  it('is refused as unrecorded, with what the share answered, when the mainline published no record', async () => {
    const ci = await published(home, { publish: false });
    const clone = await laptop(ci.origin);
    await ranHere(clone, ci.first);

    await expect(review(parseReview(['--root', clone]))).rejects.toThrow(
      /name no start they descend from[^]*\nrecord of "unit": the share has none either; mainline main: nothing is published there\.$/,
    );
  });

  it('is refused, and says where, when the record cannot be kept on this machine', async () => {
    const ci = await published(home);
    const clone = await laptop(ci.origin);
    await ranHere(clone, ci.first);
    await mkdir(join(readLayer(), '..'), { recursive: true });
    await writeFile(readLayer(), '');

    await expect(review(parseReview(['--root', clone]))).rejects.toThrow(
      `\nrecord of "unit": the mainline's was not read; mainline main: the record published at ${ci.first} could not be kept at `,
    );
  });

  it('starts at the record, and says its cases are not compared, when only its per-case index does not read', async () => {
    const ci = await published(home, { record: unreadCases });
    const clone = await laptop(ci.origin);
    await ranHere(clone, ci.first);

    const answer = await review(parseReview(['--root', clone]));

    expect(answer).toMatchObject({ from: ci.first, base: 'mainline', mainline: { commit: ci.first } });
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toBeUndefined();
    expect(formatReview(answer, 'text')).toMatch(/Cases are not compared with that record's: its per-case index does not read \([^\n]+\), so it is not kept\./);
  });
});
