import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { machinesBeside } from './recorded-durations.js';
import { commitRunsFile } from './test-selection/commit-runs.js';
import { commitRunsText } from './test-selection/commit-runs-text.js';

/** The machine each test file ran on, as the runs record beside a record names it, or why it names none: what `view` shows. */

const commit = 'f'.repeat(40);
const LANDED = '2026-10-01T12:00:00.000Z';
const runner = { arch: 'x64', cores: 2 };
let recording: string;

beforeEach(() => {
  recording = join(mkdtempSync(join(tmpdir(), 'va-machines-')), 'coverage.bin');
});

describe('the machines the runs beside a record name', () => {
  it('names each file\'s machine where the runs stand at the record\'s commit', () => {
    writeFileSync(commitRunsFile(recording), commitRunsText({ commit, latest: LANDED, runs: 1, landings: [{ files: ['test/a.test.ts'], machine: runner }] }));

    expect(machinesBeside(recording, commit)).toEqual({ files: { 'test/a.test.ts': 'x64, 2 cores' } });
  });

  it('answers nothing where no runs record is beside it', () => {
    expect(machinesBeside(recording, commit)).toBeUndefined();
  });

  it('says why none is named where the runs cannot be read, stand elsewhere, carry no commit, or name none', () => {
    const landings = [{ files: ['test/a.test.ts'], machine: runner }];
    for (const [text, why] of [
      ['not json', /^the runs record at .* is not JSON/u],
      [commitRunsText({ commit: 'e'.repeat(40), latest: LANDED, runs: 1, landings }), /^the runs record beside it stands at another commit$/u],
      [commitRunsText({ latest: LANDED, runs: 1, landings }), /^the runs record beside it carries no commit to match the record's$/u],
      [commitRunsText({ commit, latest: LANDED, runs: 1, landings: [{ files: ['test/a.test.ts'] }] }), /^the runs record beside it names no machine$/u],
    ] as const) {
      writeFileSync(commitRunsFile(recording), text);
      expect(machinesBeside(recording, commit)).toEqual({ unread: expect.stringMatching(why) });
    }
  });

  it('says why none is named where the runs record is there and cannot be read as a file', () => {
    mkdirSync(commitRunsFile(recording));

    expect(machinesBeside(recording, commit)).toEqual({ unread: expect.stringMatching(/EISDIR/u) });
  });
});
