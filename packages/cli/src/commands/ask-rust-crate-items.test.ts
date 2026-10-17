import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` and `ask uses` about a Rust item its crate keeps to
 * itself, `pub(crate)` or `pub(super)`, whose name another package also
 * publishes. The published one is one thing and each crate item another, so
 * the published name answers beside them and never in their place, and each
 * crate item is answered with the uses whose path resolves to it. What no
 * path says, a glob `use` among them, is named as unread.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-rust-crate-items-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const WALK = {
  'packages/lib/src/index.ts': [
    "export { greet } from './greet.js';",
    'export interface Reached {',
    '  readonly at: string;',
    '}',
    'export const settle = (): void => {};',
    '',
  ].join('\n'),
  'packages/walk/Cargo.toml': '[package]\nname = "walk"\nversion = "0.1.0"\n',
  'packages/walk/src/lib.rs': 'mod resolve;\nmod origin;\nmod update;\nmod pick;\nmod chosen;\nmod outer;\nmod glob;\n',
  'packages/walk/src/resolve.rs': '/// Where a walk ends.\n#[derive(Debug)]\npub(crate) enum Reached {\n    Declaration,\n    Nothing,\n}\n',
  'packages/walk/src/origin.rs': 'use crate::resolve::Reached;\n\nfn ends() -> Reached {\n    Reached::Nothing\n}\n',
  'packages/walk/src/update.rs': 'struct Reached;\n\nfn walk() -> Reached {\n    Reached\n}\n',
  'packages/walk/src/pick.rs': 'pub(crate) struct Reached;\n',
  'packages/walk/src/chosen.rs': 'use super::pick::Reached;\n\nfn chosen(reached: Reached) {}\n',
  'packages/walk/src/glob.rs': 'use crate::pick::*;\n\nfn globbed(reached: Reached) {}\n',
  'packages/walk/src/outer.rs': 'mod inner;\n\nuse self::inner::settle;\n',
  'packages/walk/src/outer/inner.rs': 'pub(super) fn settle() {}\n',
};

/** The block of `out` that opens with a sentence about `name`'s declaration in `file`. */
function about(out: string, name: string, file: string): string {
  const blocks = out.split(new RegExp(`\\n(?=\`${name}\` is )`, 'u'));
  return blocks.find((block) => block.includes(` at ${file}:`)) ?? '';
}

describe('variance ask about a Rust item its crate keeps to itself', () => {
  it('answers `symbol` with every crate item beside another package\'s published name', async () => {
    checkout(WALK);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'Reached']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('declared at packages/lib/src/index.ts:2');
    expect(out).toContain('exported, without being published, at packages/walk/src/resolve.rs:3');
    expect(out).toContain('exported, without being published, at packages/walk/src/pick.rs:1');
    expect(out).toContain('declared, not exported, at packages/walk/src/update.rs:1');

    const settle = await run(['ask', 'symbol', '--name', 'settle']);
    expect(settle.out).toContain('exported, without being published, at packages/walk/src/outer/inner.rs:1');
  });

  it('answers `uses` for each crate item with the uses whose path resolves to it', async () => {
    checkout(WALK);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'Reached']);
    expect(code).toBe(EXIT_CLEAN);
    const resolve = about(out, 'Reached', 'packages/walk/src/resolve.rs');
    expect(resolve).toMatch(/^packages\/walk\/src\/origin\.rs:1\b/m);
    expect(resolve).not.toMatch(/chosen\.rs/u);
    const pick = about(out, 'Reached', 'packages/walk/src/pick.rs');
    expect(pick).toMatch(/^packages\/walk\/src\/chosen\.rs:1\b/m);
    expect(pick).not.toMatch(/origin\.rs/u);
    // A glob `use` is not read by path, and the answer says so rather than guessing.
    expect(pick).not.toMatch(/glob\.rs/u);
    // Said once, last, after every declaration the answer read.
    const unread = 'In Rust, a name a glob `use` brings in, a method called on a value and a macro are not read by path; rust-analyzer\'s find-references has those.';
    expect(out).toContain(`\n\n${unread}\nSnapshot `);
    expect(out.split(unread)).toHaveLength(2);
    expect(about(out, 'Reached', 'packages/walk/src/update.rs')).toMatch(/^packages\/walk\/src\/update\.rs:3\b/m);

    const settle = await run(['ask', 'uses', '--name', 'settle']);
    expect(about(settle.out, 'settle', 'packages/walk/src/outer/inner.rs')).toMatch(/^packages\/walk\/src\/outer\.rs:3\b/m);
  });

  it('answers `uses` for two private items of one name with the imports of each from its own file', async () => {
    checkout({
      ...WALK,
      'packages/walk/src/lib.rs': 'mod left;\nmod right;\n',
      'packages/walk/src/left.rs': 'mod child;\n\nfn step() {}\n',
      'packages/walk/src/left/child.rs': 'use super::step;\n',
      'packages/walk/src/right.rs': 'mod child;\n\nfn step() {}\n',
      'packages/walk/src/right/child.rs': 'fn again() {\n    super::step();\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'step']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('Imported from packages/walk/src/left.rs in 1 place.');
    const left = out.slice(out.indexOf('Imported from packages/walk/src/left.rs'), out.indexOf('Imported from packages/walk/src/right.rs'));
    expect(left).toMatch(/^packages\/walk\/src\/left\/child\.rs:1\b/m);
    expect(left).not.toMatch(/right\/child\.rs/u);
    expect(out.slice(out.indexOf('Imported from packages/walk/src/right.rs'))).toMatch(/^packages\/walk\/src\/right\/child\.rs:2\b/m);
  });
});
