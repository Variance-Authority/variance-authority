import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishLine } from '@variance-authority/core/share';
import { encodeSuiteIndex, type SuiteIndex } from '@variance-authority/report/suite-index';
import type { Config } from '../config.js';
import { lineCellOf } from '../share-lines.js';
import { published, shareConfig, PUSH } from './mainline-fixture.js';
import { mainlineIndex, publishRun } from './share.js';

/**
 * A suite index is published under the name of the format its bytes are in,
 * so a reader that does not read that format says so instead of failing to
 * decode it, and a line that holds an older format this CLI reads is read.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-share-suite-index-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

const indexAt = (commit: string): SuiteIndex => ({ commit, subjects: ['page/footer'], components: [] });

/** Put `name` on the mainline at `commit`, the way another CLI's publish would. */
async function holding(name: string, commit: string): Promise<void> {
  const cell = await lineCellOf(shareConfig(home));
  if (cell === undefined || !('load' in cell)) throw new Error(`the share in ${home} is not a line cell`);
  const done = await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name, commit, bytes: encodeSuiteIndex(indexAt(commit)) }], {
    descends: async () => undefined,
    image: async (digest) => { throw new Error(`no image ${digest}`); },
  });
  if (!('written' in done) || !done.written.includes(name)) throw new Error(`${name} was to reach mainline main: ${JSON.stringify(done)}`);
}

/** A reader on a machine that kept no index of its own. */
async function readFresh(dir: string): ReturnType<typeof mainlineIndex> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = await mkdtemp(join(home, 'cold-'));
  return mainlineIndex(shareConfig(home), { env: {}, cwd: dir });
}

describe('the suite index on a line', () => {
  it('is published as suite-index-v2, the format its bytes are in, and read back', async () => {
    const { dir, first } = await published(home, { publish: false });
    const report = join(home, 'run.json');
    await writeFile(report, JSON.stringify({
      runVersion: 1,
      identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
      observations: [],
      run: { id: 'run-1', commit: first },
      composition: { subjects: ['page/footer'], components: [] },
    }));
    const config = { ...shareConfig(home), suites: [] } as Config;

    expect(await publishRun(config, report, { env: PUSH, cwd: dir })).toMatchObject({ published: { written: ['suite-index-v2'] } });
    expect(await readFresh(dir)).toMatchObject({ mainline: 'main', commit: first, from: 'share', index: { subjects: ['page/footer'] } });
  });

  it('is read from a line that holds only suite-index-v1', async () => {
    const { dir, first } = await published(home, { publish: false });
    await holding('suite-index-v1', first);

    expect(await readFresh(dir)).toMatchObject({ mainline: 'main', commit: first, from: 'share', index: { subjects: ['page/footer'] } });
  });

  it('is not read from a line that holds a format this version does not read, and says which', async () => {
    const { dir, first } = await published(home, { publish: false });
    await holding('suite-index-v3', first);

    expect(await readFresh(dir)).toEqual({ mainline: 'main', miss: { kind: 'newer', names: ['suite-index-v3'] } });
  });
});
