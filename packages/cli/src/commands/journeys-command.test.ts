import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { journeysOutput } from './journeys-command.js';

describe('the file `variance journeys --file` reads', () => {
  it('is a path in the checkout, and one outside it is refused as one before anything is read', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'variance-journeys-file-'));
    await expect(journeysOutput({ cwd, all: true, shards: [], file: '../CartCard.tsx' })).rejects.toThrow(
      `../CartCard.tsx is outside the checkout at ${cwd}, and the recording holds only paths inside it.`,
    );
  });
});

describe('a record cut under probes this build no longer places', () => {
  // `covering` and `review` refuse one through `currentProbes`; `journeys` reads `suiteRecord`'s without asking.
  it.todo('is refused by name rather than read as current — needs the record `journeysOutput` resolves passed through `currentProbes`');
});
