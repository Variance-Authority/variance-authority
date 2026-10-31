import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';
import { BEFORE, git, published, totalModule } from './mainline-fixture.js';

/**
 * A test file the change edits is entered by definition: it runs at 0 hops,
 * whatever the record knows about it — seen whole or not, with its own
 * precondition declared or not, laid before checkouts kept a ledger or after.
 */

const EDIT = '// the edit\n';

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-edited-test-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/**
 * A checkout that edits `test/total.test.ts`, under a record that holds it as
 * `complete`. With `ranEdit`, the record holds the test's own row at the
 * edited text, as the recorder writes it for a run over the dirty tree;
 * without, it holds no precondition of its own, as a record laid before the
 * ledger does.
 */
async function editedUnder(complete: boolean, ranEdit = false): Promise<string> {
  const ci = await published(home, {
    publish: false,
    record: async (dir) => {
      await writeTestCoverage(testCoverageFile(dir, { suite: 'unit' }), {
        version: 3,
        instrumentation: 'fixture',
        commit: await git(dir, 'rev-parse', 'HEAD'),
        tests: [
          { file: 'test/other.test.ts', complete: true, preconditions: [] },
          { file: 'test/total.test.ts', complete, preconditions: ranEdit ? [{ name: 'test/total.test.ts', digest: digestString(`${await readFile(join(dir, 'test/total.test.ts'), 'utf8')}${EDIT}`) }] : [] },
        ],
        modules: [{ file: 'src/total.ts', sourceDigest: digestString(BEFORE), instrumented: true, blocks: [totalModule(['test/total.test.ts'])] }],
      });
    },
  });
  const test = join(ci.dir, 'test/total.test.ts');
  await writeFile(test, `${await readFile(test, 'utf8')}${EDIT}`);
  process.chdir(ci.dir);
  await indexOutput({ cwd: ci.dir });
  return ci.dir;
}

describe('`variance select` over a change that edits a test file', () => {
  it('runs an edited test a run over the edit left unseen whole at 0 hops, and leaves it for no later leg', async () => {
    const dir = await editedUnder(false, true);
    const got = await selectOutput({ cwd: dir, format: 'json', atDistance: { from: 0, to: 0 } });
    const json = JSON.parse(got.out);
    expect(json.skip).toEqual(['test/other.test.ts']);
    expect(json.left).toEqual([]);
    expect(json.unread).toEqual([]);
    expect(got.err).not.toContain('records nothing about');
    expect(got.err).not.toContain('the record was taken over this text');
    expect(json.distances).toEqual([
      { test: 'test/total.test.ts', hops: 0, bearing: 'precondition', from: 'test/total.test.ts', trail: ['test/total.test.ts'] },
    ]);
  });

  it('runs an edited test the record saw whole and holds no precondition for', async () => {
    const dir = await editedUnder(true);
    const got = await selectOutput({ cwd: dir, format: 'json' });
    const json = JSON.parse(got.out);
    expect(json.skip).toEqual(['test/other.test.ts']);
    expect(json.unread).toEqual([]);
    expect(got.err).not.toContain('records nothing about');
  });

  it('names the edited test among the readings', async () => {
    const dir = await editedUnder(true);
    const got = await selectOutput({ cwd: dir, format: 'plain' });
    expect(got.err).toContain('read test/total.test.ts: none');
    const json = JSON.parse((await selectOutput({ cwd: dir, format: 'json' })).out);
    expect(json.readings.map((reading: { file: string }) => reading.file)).toEqual(['test/total.test.ts']);
  });
});
