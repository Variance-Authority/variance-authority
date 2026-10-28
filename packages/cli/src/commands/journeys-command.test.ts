import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { journeysOutput } from './journeys-command.js';
import { probedModule } from './mainline-fixture.js';

describe('the file `variance journeys --file` reads', () => {
  it('is a path in the checkout, and one outside it is refused as one before anything is read', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'variance-journeys-file-'));
    await expect(journeysOutput({ cwd, all: true, shards: [], file: '../CartCard.tsx' })).rejects.toThrow(
      `../CartCard.tsx is outside the checkout at ${cwd}, and the recording holds only paths inside it.`,
    );
  });
});

describe('a record cut under probes this build does not place', () => {
  it('is read as it holds it, with the note before the reading', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'variance-journeys-probes-')));
    execFileSync('git', ['init', '--quiet', cwd]);
    const record = testCoverageFile(cwd);
    await writeTestCoverage(record, {
      version: 3,
      instrumentation: 'sense:instrument/presence-v5',
      commit: 'c0ffee',
      tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
      modules: [probedModule(['a.test.ts'])],
    });

    const out = await journeysOutput({ cwd, all: true, shards: [] });

    expect(out.split('\n')[0]).toBe(
      `\`${record}\` was cut under the probes \`sense:instrument/presence-v5\`, and this build places \`${INSTRUMENTATION_ID}\`: ` +
        'what ran and which cases ran it is read from the record as it holds it, at its own commit; ' +
        'a region this build cuts that those probes did not is not in it, so whether such a region ran is not answered, ' +
        'and `variance covering --file <path>` names any such region in one file.',
    );
    expect(out.split('\n').length).toBeGreaterThan(3);
  });
});
