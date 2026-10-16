import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over the paths a Rust file names an item by. A `use` is
 * one; a type or an expression written as `crate::a::Name`, and a `super::`
 * that climbs from a module `#[path]` put beside its parent, are the others,
 * each resolved through the module tree the crate's `mod` lines declare.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-rust-paths-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const KIT = {
  'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
  'packages/kit/src/lib.rs': 'mod graph;\nmod flows;\nmod lexicon;\n',
  'packages/kit/src/graph.rs': 'pub(crate) struct Limits;\n\npub(crate) fn reach() {}\n',
  'packages/kit/src/flows.rs': [
    'struct Flows {',
    '    limits: crate::graph::Limits,',
    '}',
    '',
    'fn walk() {',
    '    crate::graph::reach();',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/lexicon.rs': '#[path = "lexicon_catalogue.rs"]\nmod catalogue;\n#[path = "lexicon_view.rs"]\nmod view;\n\nfn flag() {}\n',
  'packages/kit/src/lexicon_catalogue.rs': 'pub(crate) struct Catalogue;\n',
  'packages/kit/src/lexicon_view.rs': 'use super::catalogue::Catalogue;\nuse super::flag;\n',
};

describe('variance ask uses over the paths a Rust file names an item by', () => {
  it('counts a type and a call written through the crate path', async () => {
    checkout(KIT);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const limits = await run(['ask', 'uses', '--name', 'Limits']);
    expect(limits.code).toBe(EXIT_CLEAN);
    expect(limits.out).toMatch(/^packages\/kit\/src\/flows\.rs:2\b/m);

    const reach = await run(['ask', 'uses', '--name', 'reach']);
    expect(reach.out).toMatch(/^packages\/kit\/src\/flows\.rs:6\b/m);
  });

  it('counts a `use super::` from a module `#[path]` puts beside the file that declares it', async () => {
    checkout(KIT);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'Catalogue']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/kit\/src\/lexicon_view\.rs:1\b/m);
  });

  it('lists the modules inside a module that import an item it does not make `pub`', async () => {
    checkout(KIT);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'flag']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`flag` is declared, not exported, at packages/kit/src/lexicon.rs:6');
    expect(out).toMatch(/^packages\/kit\/src\/lexicon_view\.rs:2\b/m);
  });

  it('lists an item a module keeps beside another package\'s export of the same name', async () => {
    checkout({
      ...KIT,
      'packages/web/package.json': JSON.stringify({ name: '@acme/web', version: '1.0.0', main: './src/index.ts' }),
      'packages/web/src/index.ts': 'export function flag(): void {}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'flag']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`flag` is declared, not exported, at packages/kit/src/lexicon.rs:6');
    expect(out).toMatch(/^packages\/kit\/src\/lexicon_view\.rs:2\b/m);
  });
});
