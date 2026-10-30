import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over the lines of the file that declares a name. An
 * import names a declaration in another file; the declaring file uses it by
 * scope, so those lines are read off the source index, where the scan recorded
 * them with the file's parse, and a local of the same name is another name.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-own-file-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

/** The sites listed under `heading`. */
function section(out: string, heading: string): readonly string[] {
  const lines = out.split('\n');
  const at = lines.indexOf(heading);
  if (at === -1) return [];
  const after = lines.slice(at + 2);
  const end = after.findIndex((line) => !/^\S+:\d+ — /.test(line));
  return end === -1 ? after : after.slice(0, end);
}

/** The heading over the lines of `file` that use a name it declares. */
const own = (file: string): string => `Used in ${file}, which declares it:`;

describe('variance ask uses over the file that declares the name', () => {
  it('lists the lines of a TypeScript file that use a name it exports, and not a local that shadows it', async () => {
    checkout({
      'packages/lib/src/greet.ts': [
        'export function greet(name: string): string {',
        '  return name;',
        '}',
        'export const twice = (name: string) => greet(greet(name));',
        'function shadowed(greet: (name: string) => string) {',
        "  return greet('local');",
        '}',
        'const o = { greet: 1 };',
        'o.greet;',
        "export const card = { greet, shadowed: shadowed((name) => greet(name)) };",
        '',
      ].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(section(out, own('packages/lib/src/greet.ts'))).toEqual([
      'packages/lib/src/greet.ts:4 — @acme/lib',
      'packages/lib/src/greet.ts:10 — @acme/lib',
    ]);
  });

  it('lists the lines of a TypeScript file that use a name it exports, when every declaration in the file is exported', async () => {
    checkout({
      'packages/lib/src/greet.ts': [
        'export function greet(name: string): string {',
        '  return name;',
        '}',
        "export const hello = greet('hello');",
        "export const hi = greet('hi');",
        "export const hey = greet('hey');",
        '',
      ].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, own('packages/lib/src/greet.ts'))).toEqual([
      'packages/lib/src/greet.ts:4 — @acme/lib',
      'packages/lib/src/greet.ts:5 — @acme/lib',
      'packages/lib/src/greet.ts:6 — @acme/lib',
    ]);
  });

  it('lists the lines of a TypeScript file that use a name it declares and does not export', async () => {
    checkout({
      'packages/lib/src/kept.ts': 'function keptAside(): number {\n  return 1;\n}\nexport const held = keptAside() + keptAside();\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'keptAside']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`keptAside` [function] is declared, not exported, at packages/lib/src/kept.ts:1');
    expect(section(out, own('packages/lib/src/kept.ts'))).toEqual(['packages/lib/src/kept.ts:4 — @acme/lib']);
  });

  it('lists the lines of a Rust file that use an item it declares, through an inline test module too', async () => {
    checkout({
      'packages/kit/src/lib.rs': [
        'mod graph;',
        'pub fn run() -> u32 {',
        '    graph::passed_on(1)',
        '}',
        '',
      ].join('\n'),
      'packages/kit/src/graph.rs': [
        'pub(crate) fn passed_on(at: u32) -> u32 {',
        '    at',
        '}',
        'pub(crate) fn walk(passed_on: u32) -> u32 {',
        '    passed_on',
        '}',
        'pub(crate) fn fold() -> u32 {',
        '    passed_on(2) + self::passed_on(3)',
        '}',
        '#[cfg(test)]',
        'mod tests {',
        '    use super::*;',
        '    #[test]',
        '    fn passes() { assert_eq!(passed_on(4), 4); }',
        '}',
        '',
      ].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'passed_on']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, own('packages/kit/src/graph.rs'))).toEqual([
      'packages/kit/src/graph.rs:8 — @acme/kit',
      'packages/kit/src/graph.rs:14 — @acme/kit',
    ]);
  });

  it('lists a kept Rust item once: a child file that takes it is an import, a line of its own file is not', async () => {
    checkout({
      'packages/kit/src/lib.rs': ['mod graph;', 'pub fn run() -> u32 {', '    0', '}', ''].join('\n'),
      'packages/kit/src/graph.rs': [
        'mod child;',
        'fn helper() -> u32 {',
        '    1',
        '}',
        'pub(crate) fn fold() -> u32 {',
        '    helper()',
        '}',
        '#[cfg(test)]',
        'mod tests {',
        '    use super::helper;',
        '    #[test]',
        '    fn helps() { assert_eq!(helper(), 1); }',
        '}',
        '',
      ].join('\n'),
      'packages/kit/src/graph/child.rs': ['use super::helper;', 'pub(crate) fn again() -> u32 {', '    helper()', '}', ''].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'helper']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`helper` [function] is declared, not exported, at packages/kit/src/graph.rs:2');
    expect(out).toMatch(/^packages\/kit\/src\/graph\/child\.rs:1 — @acme\/kit$/m);
    expect(section(out, own('packages/kit/src/graph.rs'))).toEqual([
      'packages/kit/src/graph.rs:6 — @acme/kit',
      'packages/kit/src/graph.rs:10 — @acme/kit',
      'packages/kit/src/graph.rs:12 — @acme/kit',
    ]);
    expect(out.match(/^packages\/kit\/src\/graph\.rs:\d+ — /gm)).toHaveLength(3);
  });

  it('marks a child that takes a kept Rust item under another name, and lists the lines of its own file unmarked', async () => {
    checkout({
      'packages/kit/src/lib.rs': ['mod graph;', 'pub fn run() -> u32 {', '    0', '}', ''].join('\n'),
      'packages/kit/src/graph.rs': ['mod child;', 'fn helper() -> u32 {', '    1', '}', 'pub(crate) fn fold() -> u32 {', '    helper()', '}', ''].join('\n'),
      'packages/kit/src/graph/child.rs': ['use super::helper as aid;', 'pub(crate) fn again() -> u32 {', '    aid()', '}', ''].join('\n'),
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'helper']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/kit\/src\/graph\/child\.rs:1 — @acme\/kit \(as aid\)$/m);
    expect(section(out, own('packages/kit/src/graph.rs'))).toEqual(['packages/kit/src/graph.rs:6 — @acme/kit']);
  });

  it('lists the lines of each file that keeps a name of its own under that file, and none under another', async () => {
    checkout({
      'packages/lib/src/one.ts': "function tally(): number {\n  return 1;\n}\nexport const first = tally();\n",
      'packages/lib/src/two.ts': "const tally = (): number => 2;\nexport const second = tally() + tally();\nexport const third = tally();\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'tally']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, own('packages/lib/src/one.ts'))).toEqual(['packages/lib/src/one.ts:4 — @acme/lib']);
    expect(section(out, own('packages/lib/src/two.ts'))).toEqual([
      'packages/lib/src/two.ts:2 — @acme/lib',
      'packages/lib/src/two.ts:3 — @acme/lib',
    ]);
  });

  // FIXME: the Python, Swift and JVM readers record no lines of a file that
  // use what it declares, so `ask uses` answers them by imports alone.
  it.todo('lists the lines of a Python, Swift, Java or Kotlin file that use a name it declares — needs a scope walk in each of those readers');
});
