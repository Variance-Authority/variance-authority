import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { commitRunsFile, repositoryLayers, testCoverageFile } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { main } from '../bin.js';
import { textOver } from './coverage-over-text.js';
import { ask, atRecord, CART, CART_TEST, checkout, FEE_TEST, json, landed, made, PAY, PAY_FILE, PAY_TEST, REFUNDED, TESTS } from './coverage-over-text.fixture.js';

// `ci-info` decides CI once, when it loads, so the module is cut: a test that runs as CI sets `ci.isCI`.
const ci = vi.hoisted(() => ({ isCI: false }));
vi.mock('ci-info', () => ({ get isCI() { return ci.isCI; } }));
// Cut so a test can refuse the update as a full disk would, whoever runs the suite: a directory's mode does not stop root.
const update = vi.hoisted(() => ({ fails: undefined as string | undefined }));
vi.mock('@variance-authority/sense', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense')>();
  const updateSourceIndex: typeof original.updateSourceIndex = (...args) =>
    update.fails === undefined ? original.updateSourceIndex(...args) : Promise.reject(new Error(update.fails));
  return { ...original, updateSourceIndex };
});
// Counted, not changed: which texts a split hashes and diffs, and whether a review asks for the split at all.
vi.mock('@variance-authority/core/format', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/core/format')>();
  return { ...original, digestString: vi.fn(original.digestString) };
});
vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense/test-selection')>();
  // Every pair of texts a reader of edits is asked for, by file and the two names.
  const editsBetween: typeof original.editsBetween = (...args) => {
    const edits = original.editsBetween(...args);
    return (file, from, to) => {
      asked.push(`${file} ${from} ${to}`);
      return edits(file, from, to);
    };
  };
  return { ...original, editsBetween: vi.fn(editsBetween) };
});
/** The pairs of texts the readers of edits were asked for, the same pair read once. */
const asked: string[] = [];
/** The distinct pairs of two different texts asked: each is one reading of an edit. */
const read = () => new Set(asked.filter((pair) => { const [, from, to] = pair.split(' '); return from !== to; })).size;
vi.mock('./coverage-over-text.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./coverage-over-text.js')>();
  return { ...original, textOver: vi.fn(original.textOver) };
});

let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-coverage-over-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all([cache, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('coverage parts what ran by the text it ran over', () => {
  it('counts an edited function as run over an older text, and the file\'s other regions as run over this one', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    expect(said.count.suites[0]!.over).toEqual({ older: 1, notKnown: 0 });
    expect(answer.out).toMatch(/unit\s+unit\s+3\s+.*1 over an older text/u);
  });

  it('parts an edit committed after the runs the same way, and names the commit the record was made at', async () => {
    const { at, git, recorded } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    git('commit', '--quiet', '-am', 'refund twice');

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0 } });
    expect(answer.out.split('\n')[0]).toContain(`coverage at ${git('rev-parse', 'HEAD').slice(0, 8)}, recorded at ${recorded.slice(0, 8)}`);
  });

  it('counts a region a test file entered at an older commit as older, though a test run at the record entered its module elsewhere', async () => {
    const { at } = await checkout({
      charge: [0],
      refund: [1],
      recorded: REFUNDED,
      second: true,
      runs: (first, recorded) => ({
        commit: recorded, ...landed([PAY_TEST, CART_TEST]),
        standing: [{ commit: first, files: [FEE_TEST], first: new Date().toISOString(), latest: new Date().toISOString(), runs: 1, texts: {} }],
      }),
    });

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0 } });
  });

  it('parts each package row, and the scope of --from', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const packages = await ask('--root', at, '--packages');
    const owned = await json('--root', at, '--packages');
    const from = await json('--root', at, '--from', 'libs/pay');

    expect(owned.entries?.map((entry) => [entry.from, entry.own.over])).toEqual([
      ['libs/pay', { older: 1, notKnown: 0 }],
      ['libs/shop', { older: 0, notKnown: 0 }],
    ]);
    expect(packages.out).toMatch(/ {2}libs\/pay\s+.*1 over an older text/u);
    expect(from.source?.over).toEqual({ older: 1, notKnown: 0 });
  });

  it('counts a region whose test ran a text that cannot be found as not known, and says why, never as run over this text', async () => {
    const lost = digestString('a text no landing kept');
    const { at } = await checkout({ ...atRecord, runs: (_, recorded) => ({ commit: recorded, ...landed(TESTS, { [PAY_FILE]: lost }) }) });
    await writeFile(join(at, PAY_FILE), REFUNDED);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 2 } });
    expect(answer.out).toContain(`not known: the text of ${PAY_FILE} that run ran over is neither kept nor committed`);
  });

  it('counts a region as older when the rows were cut from an uncommitted text no listed run ran, though every run ran the commit\'s text and the tree holds it', async () => {
    // A run since moved on cut the rows from `REFUNDED` at the record's commit, which holds `PAY`, as the tree does,
    // and kept the text it ran over, as a landing keeps every text its commit does not hold.
    const { at } = await checkout({ ...atRecord, recorded: REFUNDED });
    const kept = join(repositoryLayers(at).top, '.texts');
    await mkdir(kept, { recursive: true });
    await writeFile(join(kept, digestString(REFUNDED).replace(/^[^:]+:/u, '')), REFUNDED);

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
  });

  it('counts a region as older when the tree holds another text than the rows, by the name the source index gives the tree\'s text', async () => {
    // Every run ran the commit's text, which the rows were cut from; the tree's text is not that one.
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    await updateSourceIndex(at);

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
  });

  it('counts an unchanged file git cleans on the way in (core.autocrlf) as run over this text', async () => {
    const { at } = await checkout({ ...atRecord, crlf: true });

    expect((await json('--root', at)).count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
  });

  it('changes no number when nothing changed since the runs, and counts nothing as older', async () => {
    const { at, recorded } = await checkout(atRecord);

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
    expect(answer.out.split('\n')[0]).toBe(`coverage at ${recorded.slice(0, 8)} — 5 regions in 2 files the suites loaded`);
    expect(answer.out).toMatch(/any suite\s+3\s+60\.0%/u);
  });

  it('names the tree\'s texts by the source index and hashes none of them, diffing one pair once per answer', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    await updateSourceIndex(at);
    vi.mocked(digestString).mockClear();
    asked.length = 0;

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    // The tree's texts are the index's `git:` names: neither `REFUNDED` nor `CART` is hashed to name it.
    expect(vi.mocked(digestString).mock.calls.filter(([text]) => text === REFUNDED || text === CART)).toEqual([]);
    // The record ran `PAY`, the tree holds `REFUNDED`: one edit read, and none for `cart.ts`, which no edit touched.
    expect(read()).toBe(1);
  });
});

describe('coverage names why a text is not known', () => {
  /** The record's runs record, written as `runs` gives it. */
  const runsBeside = (at: string, runs: string) => writeFile(commitRunsFile(testCoverageFile(at, { suite: 'unit' })), runs);

  it('counts every region run as not known when no runs record lies beside the record, and says so once', async () => {
    const { at } = await checkout(atRecord);
    await rm(commitRunsFile(testCoverageFile(at, { suite: 'unit' })));

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: ['no runs record lies beside the record, so where its tests ran is not known'] } });
    expect(answer.out.split('no runs record lies beside the record').length).toBe(2);
  });

  it('names a runs record of another commit, one that does not read, and one that leaves a test file out', async () => {
    const other = await checkout({ ...atRecord, recorded: REFUNDED, second: true, runs: (first) => ({ commit: first, ...landed(TESTS) }) });
    const unread = await checkout(atRecord);
    await runsBeside(unread.at, 'not a runs record');
    const partial = await checkout({ ...atRecord, refund: [1], runs: (_, recorded) => ({ commit: recorded, ...landed([PAY_TEST, CART_TEST]) }) });

    expect((await json('--root', other.at)).count).toMatchObject({
      over: { notKnown: 3, why: ['the runs record beside the record lists the runs of another commit, so where its tests ran is not known'] },
    });
    expect((await json('--root', unread.at)).count).toMatchObject({ over: { notKnown: 3, why: [expect.stringMatching(/^the runs record beside the record does not read: /u)] } });
    expect((await json('--root', partial.at)).count).toMatchObject({ over: { older: 0, notKnown: 1, why: ['the runs record does not say where some test files ran'] } });
  });

  it('writes the older text and each reason a text is not known into the markdown breakdown', async () => {
    // `fee.test.ts` alone called `refund`, and the runs record leaves it out; `charge` was rewritten since its run.
    const { at } = await checkout({ ...atRecord, refund: [1], runs: (_, recorded) => ({ commit: recorded, ...landed([PAY_TEST, CART_TEST]) }) });
    await writeFile(join(at, PAY_FILE), PAY.replace('  return amount;', '  return amount + 1;'));

    const answer = await ask('--root', at, '--format', 'markdown');

    expect(answer.out).toContain('| Executed over an older text | 1 | 20.0% |\n');
    expect(answer.out).toContain('| Executed over a text not known | 1 | 20.0% |\n');
    expect(answer.out).toContain('\n- Not known: the runs record does not say where some test files ran\n');
  });

  it('counts every region of a file whose rows name no text as not known, and says so', async () => {
    const { at } = await checkout({ ...atRecord, unkeyed: true });

    const answer = await ask('--root', at);
    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: ['the record names no text its rows were cut from, so which text ran is not known'] } });
    expect(answer.out.split('the record names no text its rows were cut from').length).toBe(2);
  });

  describe('in CI, where coverage takes the source index as published and builds none', () => {
    afterEach(() => {
      ci.isCI = false;
    });

    it('counts every region run as not known when no source index is published, says so once, and reads no text', async () => {
      const { at } = await checkout(atRecord);
      await rm(sourceIndexPath(at), { recursive: true, force: true });
      // An edit a read of the disk would see: with no index, nothing reads it.
      await writeFile(join(at, PAY_FILE), REFUNDED);
      ci.isCI = true;

      const answer = await ask('--root', at);
      const said = await json('--root', at);
      const markdown = await ask('--root', at, '--format', 'markdown');

      expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why: [expect.stringMatching(/^which text ran is not known: no source index is published at /u)] } });
      expect(answer.out.split('not known: which text ran is not known: no source index is published at').length).toBe(2);
      expect(markdown.out).toMatch(/\n- Not known: which text ran is not known: no source index is published at /u);
    });

    it('parts what ran by the index as published', async () => {
      const { at } = await checkout(atRecord);
      await writeFile(join(at, PAY_FILE), REFUNDED);
      await updateSourceIndex(at);
      ci.isCI = true;

      const said = await json('--root', at);

      expect(said.count).toMatchObject({ run: 3, over: { older: 1, notKnown: 0, why: [] } });
    });

    it('counts a file the published index does not hold as not known when the disk holds it, since the index does not name its text', async () => {
      const { at } = await checkout(atRecord);
      await rm(join(at, PAY_FILE));
      await updateSourceIndex(at);
      await writeFile(join(at, PAY_FILE), PAY);
      ci.isCI = true;

      expect((await json('--root', at)).count).toMatchObject({
        over: { older: 0, notKnown: 2, why: [`the source index does not hold ${PAY_FILE}, though the checkout does, so which text it holds now is not known`] },
      });
    });
  });

  it('counts every region run as not known when the source index cannot be brought up to the checkout, gives the reason, and reads the index as it stands for the rest', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    update.fails = 'ENOSPC: no space left on device, write';
    try {
      const said = await json('--root', at);
      const from = await json('--root', at, '--from', 'libs/pay');
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      await ask('--root', at);
      const told = stderr.mock.calls.map(([line]) => String(line)).join('');
      stderr.mockRestore();

      const why = [expect.stringMatching(/^which text ran is not known: the source index at .+ could not be updated to the checkout: .*no space left on device/u)];
      expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 3, why } });
      expect(said.source).toMatchObject({ over: { older: 0, notKnown: 3 } });
      expect(from.source).toMatchObject({ over: { older: 0, notKnown: 2 } });
      expect(told.match(/could not be updated to the checkout: .*; reading it as it stands\./gu)).toHaveLength(1);
    } finally {
      update.fails = undefined;
    }
  });

  it('counts the regions run in a file that does not read as not known, and says its text cannot be found', async () => {
    // The index names the edit, so the text on disk must be read to diff it, and it does not read.
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    await updateSourceIndex(at);
    // A directory where the file was: no reader opens it as a text, root included.
    await rm(join(at, PAY_FILE));
    await mkdir(join(at, PAY_FILE));
    ci.isCI = true;
    try {
      expect((await json('--root', at)).count).toMatchObject({
        run: 3,
        over: { older: 0, notKnown: 2, why: [`a text of ${PAY_FILE} the record or a run names cannot be found`] },
      });
    } finally {
      ci.isCI = false;
    }
  });

  it('counts the regions run in a file git ignores as not known, and says the index does not hold it because git ignores it', async () => {
    // An import of an ignored file reads it into the index, so the test files no longer import it.
    const { at, git } = await checkout(atRecord);
    git('rm', '--quiet', '--cached', PAY_FILE);
    await writeFile(join(at, '.gitignore'), `${PAY_FILE}\n`);
    for (const test of [PAY_TEST, FEE_TEST]) await writeFile(join(at, test), 'export {};\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'ignore pay');

    expect((await json('--root', at)).count).toMatchObject({
      run: 3,
      over: { older: 0, notKnown: 2, why: [`git ignores ${PAY_FILE}, and the source index does not hold it, so which text it holds now is not known`] },
    });
  });

  it('counts the regions run in a file the source index does not read as not known, and says so', async () => {
    const coffee = 'libs/pay/src/pay.coffee';
    const { at } = await checkout({ ...atRecord, payAt: coffee });

    expect((await json('--root', at)).count).toMatchObject({
      run: 3,
      over: { older: 0, notKnown: 2, why: [`the source index does not read ${coffee}, so which text it holds now is not known`] },
    });
  });

  it('keeps a function whose body gained only a comment as run over this text', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), PAY.replace('  return -amount;', '  // refunds are negative\n  return -amount;'));

    const said = await json('--root', at);

    expect(said.count).toMatchObject({ run: 3, over: { older: 0, notKnown: 0, why: [] } });
  });

  it('counts every region of a file gone from the checkout as run over an older text, since the text it ran is no longer there', async () => {
    const { at } = await checkout(atRecord);
    await rm(join(at, PAY_FILE));

    expect((await json('--root', at)).count).toMatchObject({ over: { older: 2, notKnown: 0, why: [] } });
  });
});

describe('a review that counts coverage', () => {
  it('passes coverage no reader of the text each region ran over, and says none', async () => {
    const { at } = await checkout(atRecord);
    await writeFile(join(at, PAY_FILE), REFUNDED);
    vi.mocked(textOver).mockClear();
    let out = '';
    let err = '';
    const review = (format: string) => main(['review', '--root', at, '--since', 'HEAD', '--coverage', '--format', format], {
      out: (text) => (out += text), err: (text) => (err += text),
    });

    expect(await review('json'), err).toBe(0);
    const said = JSON.parse(out) as { readonly coverage: readonly unknown[] };
    out = '';
    expect(await review('text'), err).toBe(0);

    expect(said.coverage.length).toBeGreaterThan(0);
    expect(vi.mocked(textOver)).not.toHaveBeenCalled();
    expect(JSON.stringify(said.coverage)).not.toMatch(/"over"/u);
    expect(out).not.toMatch(/older text/u);
  });
});
