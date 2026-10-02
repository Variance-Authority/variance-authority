import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { selectJourneyFile } from './journey-native.js';

// An addon built before suites could decline relations: it walks the graph and
// answers without `declined`, whatever it was asked.
const walked = { whole: [], entered: ['test/other.test.ts'], unread: [], because: [] };
vi.mock('../native.js', () => ({ native: () => ({ selectJourneys: () => walked }) }));

function journeyFile(): string {
  const sets = new CrossingSets(1);
  const bytes = encodeSetExecutionIndex({
    tests: [{ id: 'other > a', file: 'test/other.test.ts', name: 'a' }],
    modules: [],
    sets: sets.pool(),
  });
  const file = join(mkdtempSync(join(tmpdir(), 'journey-native-skew-')), 'journeys.bin');
  writeFileSync(file, bytes);
  return file;
}

describe('an addon that predates declining relations', () => {
  const added = new Map([['src/added.ts', [{ start: 1, end: 1 }]]]);

  it('is not this suite\'s answer when the suite declines relations, so the reading falls to the JS selector', async () => {
    await expect(selectJourneyFile(journeyFile(), added, { unmeasured: 'nothing' })).resolves.toBeUndefined();
  });

  it('is the answer when the suite allows relations', async () => {
    await expect(selectJourneyFile(journeyFile(), added)).resolves.toMatchObject({ entered: ['test/other.test.ts'] });
  });
});
