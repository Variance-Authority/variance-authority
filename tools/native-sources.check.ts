import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selection } from '../vitest.config.mjs';
import { NATIVE, NATIVE_EXTRA_INPUTS } from '../packages/sense/native/build-inputs.mjs';
import { ROOT } from './workspaces.js';

const ADDON = 'packages/sense/src/addon.ts';

/**
 * The crate the addon is built from is declared by the one module that loads it.
 *
 * A test reaches `packages/sense/native` only through the `.node` Node loads
 * with `dlopen`, so no journal ever names a `.rs` file. `addon.ts` states that
 * read with `/// <depends>`, and a crate edit charges the tests that import it,
 * at any distance, and no other. A precondition would charge every test file
 * in the suite, whatever it loads.
 *
 * The crate's root module reaches every module through `mod`, and the vendored
 * and instrument crates through `use`; what no Rust line names — the manifests,
 * the lockfile, the toolchain pin, the build scripts and the layout Rust
 * compiles with `include_str!` — is named one by one. Asked here of git
 * directly, so the directive cannot agree with itself.
 */
describe('the native crate is declared by the module that loads it', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', NATIVE], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '');
  const unnamed = tracked.filter((path) => /(?:^|\/)(?:build\.rs|Cargo\.lock|[^/]+\.toml)$/.test(path));
  const declared = [...readFileSync(join(ROOT, ADDON), 'utf8').matchAll(/^\/\/\/ <depends path="([^"]+)" \/>$/gm)].map(
    ([, path]) => posix.join(posix.dirname(ADDON), path!),
  );

  it('lists the manifest and the root module, so the sweep below has something to sweep', () => {
    expect(tracked).toContain(`${NATIVE}/Cargo.toml`);
    expect(tracked).toContain(`${NATIVE}/src/lib.rs`);
  });

  it('names the root module and every input no Rust line names', () => {
    expect(declared.sort()).toEqual([`${NATIVE}/src/lib.rs`, ...unnamed, ...NATIVE_EXTRA_INPUTS].sort());
  });

  it('is not a precondition of the suite', () => {
    const crate = (path: string) => path.startsWith(`${NATIVE}/`) || NATIVE_EXTRA_INPUTS.includes(path);
    expect(selection.preconditions.filter(crate)).toEqual([]);
  });
});
