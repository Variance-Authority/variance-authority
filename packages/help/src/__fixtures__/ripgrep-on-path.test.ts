import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ripgrepOnPath } from './ripgrep-on-path.js';

/**
 * A machine without `rg` is asked for through a `PATH` that names one empty
 * directory, so the probe finds no `rg` whatever this machine has installed.
 */

const nowhere = mkdtempSync(join(tmpdir(), 'no-rg-'));
afterAll(() => rmSync(nowhere, { recursive: true, force: true }));

describe('the tests that need ripgrep, on a machine without it', () => {
  it('skip on a developer machine', () => {
    expect(ripgrepOnPath({ PATH: nowhere })).toBe(false);
  });

  it('skip where CI is set to nothing', () => {
    expect(ripgrepOnPath({ PATH: nowhere, CI: '' })).toBe(false);
  });

  it('skip where CI is said to be off', () => {
    expect(ripgrepOnPath({ PATH: nowhere, CI: 'false' })).toBe(false);
  });

  it('fail on CI, naming the action that installs it', () => {
    expect(() => ripgrepOnPath({ PATH: nowhere, CI: 'true' })).toThrow('`./.github/actions/ripgrep`');
  });
});
