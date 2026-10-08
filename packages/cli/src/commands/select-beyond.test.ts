import type { BeyondReach } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { installReached } from './select-beyond.js';

/**
 * The sentence a bump writes into the selection's reasons. It names packages in
 * one list, so whatever it says about one package has to read as part of that
 * package's entry, never as more entries.
 */
describe('what a bump reached, said', () => {
  it('names the package most files came through, and counts the rest, so the list stays one list', () => {
    const chains = new Map<string, readonly string[]>([
      ['test/a.test.ts', ['node-addon-api', 'vitest']],
      ['test/b.test.ts', ['node-addon-api', 'vitest']],
      ['test/c.test.ts', ['node-addon-api', '@testing-library/svelte']],
      ['test/d.test.ts', ['node-addon-api', '@vitejs/plugin-react']],
      ['test/e.test.ts', ['left-pad']],
    ]);
    const beyond: BeyondReach = { files: [...chains.keys()], unplaced: [], traced: ['left-pad', 'node-addon-api'], chains };

    const said = installReached(
      new Map([[undefined, { lockfile: 'pnpm-lock.yaml', packages: ['left-pad', 'node-addon-api'], manifests: [], moved: [] }]]),
      new Map([[undefined, beyond]]),
      () => 'at abc',
    );

    expect(said?.says[0]).toBe(
      'pnpm-lock.yaml resolves 2 packages differently than at abc ' +
        '(node-addon-api through vitest and 2 others; left-pad), so 5 files importing them ' +
        '(test/a.test.ts, test/b.test.ts, test/c.test.ts and 2 more) were read as changed whole',
    );
  });
});
