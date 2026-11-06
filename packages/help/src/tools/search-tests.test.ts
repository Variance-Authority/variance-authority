import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordedTests, suiteCaseNames } from './search-tests.js';

/** What `ask search` keeps of an answer whose recorded cases could not be reached. */

describe('a root config that cannot name its suites', () => {
  it('leaves every case unread and says why, for the rest of the answer to stand', () => {
    const root = mkdtempSync(join(tmpdir(), 'va-search-tests-'));
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: 'nope' }));

    const answer = recordedTests(suiteCaseNames(root), 'route', undefined, 5);

    expect(answer).toMatchObject({ total: 0, shown: [], unread: [{ why: expect.stringContaining('variance.config.json') }] });
  });
});
