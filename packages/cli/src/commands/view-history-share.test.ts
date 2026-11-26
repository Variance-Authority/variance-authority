// compass: variance-authority.reach.crossings
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../parse.js';
import { answerConfigless, withoutConfig } from './configless.js';
import { cloneOf, gitPublished } from './mainline-fixture.js';
import { viewOutput } from './view-command.js';

/** `variance view` reading its series from the git share a mainline publishes to on each push. */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-view-history-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const historyIn = (html: string): unknown => JSON.parse(/<script id="history" type="application\/json">([^<]*)<\/script>/u.exec(html)![1]!);

describe('the series a git share keeps', () => {
  it('carries a point per kept commit, says on stderr what it reads from the command line, and reads nothing the second time', async () => {
    const { origin, first, record } = await gitPublished(home);
    // A laptop's clone, with its own cache and a record of its own to draw.
    const clone = await cloneOf(home, origin);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
    const at = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, record);
    const parsed = parseArgs(['view']);
    if (!withoutConfig(parsed)) throw new Error('`view` answers without a config');
    process.chdir(clone);
    let out = '';
    let said = '';

    await answerConfigless(parsed, { out: (text) => (out += text), err: (text) => (said += text) });
    const again: string[] = [];
    await viewOutput({ command: 'view' }, clone, { progress: (line) => again.push(line) });

    expect(historyIn(await readFile(out.trim(), 'utf8'))).toMatchObject({
      points: [{ commit: first, suite: 'unit', testFiles: 2 }],
      files: [{ file: 'test/other.test.ts', runs: 1, timed: 0 }, { file: 'test/total.test.ts', runs: 1, timed: 0 }],
      skipped: [],
    });
    expect(said).toBe('view: reading 1 commit kept on main in the last 14 days\nview: read 1 of 1\n');
    expect(again).toEqual([]);
  }, 60_000);
});
