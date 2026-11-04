import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { inIndexTurn, indexTurnPath } from './index-turn.js';
import type { NativeScanner } from './native.js';

vi.mock('./addon.js', async (actual) => ({ ...await actual<typeof import('./addon.js')>(), native: vi.fn() }));

/** The addon, throwing `failure` from a take. */
function addon(failure: Error): void {
  const takeIndexTurn = vi.fn(() => { throw failure; });
  vi.mocked(native).mockReturnValue({ takeIndexTurn } as unknown as NativeScanner);
}

describe('what the addon answers for the turn', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-index-turn-')));
  const path = indexTurnPath(root);
  let refused: string[];
  const taken = (): Promise<string> => inIndexTurn(root, async () => 'ran', () => {}, (at, reason) => refused.push(`${at} ${reason}`));

  beforeEach(() => { refused = []; });

  // Read, not reproduced: no file system here refuses `flock`.
  it('takes a lock the file system will not give, ENOLCK on a network mount, as a refusal', async () => {
    addon(new Error(`${path}: No locks available (os error 77)`));

    expect(await taken()).toBe('ran');
    expect(refused).toEqual([`${path} No locks available (os error 77)`]);
  });

  it('never reports a panic as a refusal: it names no path, and the work does not run on it', async () => {
    const panic = new Error('called `Option::unwrap()` on a `None` value');
    addon(panic);

    await expect(taken()).rejects.toBe(panic);
    expect(refused).toEqual([]);
  });
});
