import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { native, nativeRefusal } from './addon.js';
import { inIndexTurn, indexTurnPath } from './index-turn.js';
import type { NativeScanner } from './native.js';

vi.mock('./addon.js', async (actual) => ({ ...await actual<typeof import('./addon.js')>(), native: vi.fn(), nativeRefusal: vi.fn() }));

/** The addon, answering each take from `answers` in turn: a turn, `null` while held, or what it throws. */
function addon(...answers: readonly (Error | null)[]): void {
  const takeIndexTurn = vi.fn();
  for (const answer of answers) {
    takeIndexTurn.mockImplementationOnce(() => {
      if (answer !== null) throw answer;
      return null;
    });
  }
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

  it('takes a refusal on a later try as it takes one on the first', async () => {
    addon(null, new Error(`${path}: No such file or directory (os error 2)`));

    expect(await taken()).toBe('ran');
    expect(refused).toEqual([`${path} No such file or directory (os error 2)`]);
  });

  it('never reports a panic as a refusal: it names no path, and the work does not run on it', async () => {
    const panic = new Error('called `Option::unwrap()` on a `None` value');
    addon(panic);

    await expect(taken()).rejects.toBe(panic);
    expect(refused).toEqual([]);
  });

  it('marks an addon that did not load as the operator\'s, and names why', async () => {
    vi.mocked(native).mockReturnValue(undefined);
    vi.mocked(nativeRefusal).mockReturnValue('@variance-authority/sense-darwin-arm64 is not installed');

    await expect(taken()).rejects.toMatchObject({
      varianceOperatorError: true,
      message: expect.stringContaining('which did not load: @variance-authority/sense-darwin-arm64 is not installed'),
    });
  });
});
