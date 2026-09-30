import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { selection } from '../vitest.config.mjs';
import { NATIVE } from './native-sources.mjs';
import { ROOT } from './workspaces.js';

/**
 * The crate the addon is built from is declared to the unit suite's recording.
 *
 * Nothing else would notice it going. A test reaches `packages/sense/native`
 * only through the `.node` Node loads with `dlopen`, so no journal ever names a
 * `.rs` file, and without the declaration a change confined to the crate
 * selects nothing under `yarn test:since` — which reads as "nothing reached the
 * change", the one answer that is never checked twice. Asked here of git
 * directly rather than of `nativeSources`, so the helper cannot agree with
 * itself.
 */
describe('the native crate governs the unit suite', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', NATIVE], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '');
  const declared = new Set(selection.preconditions);

  it('lists the manifest and the sources, so the sweep below has something to sweep', () => {
    expect(tracked).toContain(`${NATIVE}/Cargo.toml`);
    expect(tracked).toContain(`${NATIVE}/Cargo.lock`);
    expect(tracked.filter((path) => path.startsWith(`${NATIVE}/src/`) && path.endsWith('.rs')).length).toBeGreaterThan(0);
  });

  it('declares every file git holds for the crate as a precondition', () => {
    expect(tracked.filter((path) => !declared.has(path))).toEqual([]);
  });
});
