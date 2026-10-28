import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages-fixture.js';

/**
 * `variance ask` about a name a file declares at its top level and does not
 * export. The source index holds every top-level declaration of every file,
 * and `symbol` and `search` read only the exported ones, so a private function
 * `git grep` finds at once was answered with *the dependency lexicon is not
 * published* and *nothing in this repository is named* that.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-declared-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const RELAUNCH = {
  'packages/kit/src/money/restart.ts': [
    'export const restart = (argv: readonly string[]): number => relaunch(argv);',
    '',
    '/** Start the program again in a process of its own. */',
    'function relaunch(argv: readonly string[]): number {',
    '  return argv.length;',
    '}',
    '',
  ].join('\n'),
};

const PRIVATE_RUST = {
  'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
  'packages/kit/src/lib.rs': [
    'pub fn restart(argv: &[String]) -> i32 {',
    '    relaunch(argv)',
    '}',
    '',
    '/// Start the program again,',
    '/// in a process of its own.',
    'fn relaunch(argv: &[String]) -> i32 {',
    '    argv.len() as i32',
    '}',
    '',
  ].join('\n'),
};

const PRIVATE_PYTHON = {
  'packages/kit/kit/restart.py': [
    'def restart(argv):',
    '    return _relaunch(argv)',
    '',
    'def _relaunch(argv):',
    '    """Start the program again in a process of its own."""',
    '    return len(argv)',
    '',
  ].join('\n'),
};

describe('variance ask about a name declared and not exported', () => {
  it('answers `symbol` with where it is declared, its signature and its documentation', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    const block = paragraph(out, /^relaunch \[function\]\n/);
    expect(block).toContain('declared, not exported, at packages/kit/src/money/restart.ts:4 by @acme/kit');
    expect(block).toContain('function relaunch(argv: readonly string[]): number');
    expect(block).toContain('Start the program again in a process of its own.');
    expect(block).toContain('Nothing outside packages/kit/src/money/restart.ts can import it');
  });

  it('answers `symbol` with the declaration beside another file\'s export of the same name', async () => {
    // Two files, two things: the export does not stand for the declaration.
    checkout({ ...RELAUNCH, 'packages/kit/src/again.ts': 'export const relaunch = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/kit/src/again.ts:1');
    expect(paragraph(out, /^relaunch \[function\]\n/)).toContain('declared, not exported, at packages/kit/src/money/restart.ts:4 by @acme/kit');
  });

  it('answers `symbol` with the declaration beside another package\'s import of the name by its path', async () => {
    // `@acme/app` imports `addTax` from a file of `@acme/lib`; this one is another thing.
    checkout({ 'packages/kit/src/money/levy.ts': 'export const levy = (): number => addTax();\n\nfunction addTax(): number {\n  return 1;\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'addTax']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('not published: @acme/lib declares an entry, and this file is not behind it');
    expect(paragraph(out, /^addTax \[function\]\ndeclared, not exported/)).toContain('declared, not exported, at packages/kit/src/money/levy.ts:3 by @acme/kit');
  });

  it('answers `search` with the declaration, under a heading that says it is not exported', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'search', '--query', 'launch']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('Nothing in this repository is named or documented with `launch`');
    expect(out).toMatch(/^1 more name is declared somewhere in the repository without being exported:$/m);
    expect(out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4$/m);
  });

  it('lists a declaration its file exports under its own name once, as the export', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'restart']);
    expect(out).toMatch(/^restart — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:1$/m);
    expect(out).not.toContain('without being exported');
  });

  it('answers `search` from a start point only with the declarations in its reach', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const near = await run(['ask', 'search', '--query', 'launch', '--from', 'packages/kit/src/money/restart.ts']);
    expect(near.out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4$/m);

    const far = await run(['ask', 'search', '--query', 'launch', '--from', 'apps/app/src/hello.ts']);
    expect(far.out).not.toContain('relaunch');
  });

  it('gives `symbol`\'s files to `intersection` at the line that declares the name', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run([
      'ask', 'intersection', 'symbol --name relaunch', 'discover --from packages/kit/src/money/restart.ts',
    ]);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('1 file in all of them.');
    expect(out).toContain('packages/kit/src/money/restart.ts — 1: line 4 · 2: the file');
  });

  it('answers `uses` with where it is declared and that nothing outside that file can import it', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(
      '`relaunch` [function] is declared, not exported, at packages/kit/src/money/restart.ts:4, so nothing outside that file can import it.',
    );
  });

  it('answers `uses` with a declaration and a member of the same name, each where it is', async () => {
    checkout({
      'packages/kit/src/money/tool.ts': 'export class Tool {\n  files(): number {\n    return 0;\n  }\n}\n',
      'packages/kit/src/money/count.ts': 'export const count = (): number => files();\n\nfunction files(): number {\n  return 1;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'files']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`files` [function] is declared, not exported, at packages/kit/src/money/count.ts:3, so nothing outside that file can import it.');
    expect(out).toContain('`files` is a member too, declared in 1 place:');
    expect(out).toContain('packages/kit/src/money/tool.ts:2');
  });

  it('answers `uses` with one line per declaration, and gives `intersection` each of them', async () => {
    checkout({
      'packages/kit/src/money/a.ts': 'export const a = (): number => tally();\n\nfunction tally(): number {\n  return 0;\n}\n',
      'packages/kit/src/money/b.ts': 'export const b = (): number => tally();\n\nconst tally = (): number => 1;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'tally']);
    expect(out).toContain(
      [
        '`tally` is declared, not exported, in 2 files:',
        '  packages/kit/src/money/a.ts:3 [function], so nothing outside that file can import it',
        '  packages/kit/src/money/b.ts:3 [const], so nothing outside that file can import it',
      ].join('\n'),
    );

    const both = await run(['ask', 'intersection', 'uses --name tally', 'discover --from packages/kit/src/money/b.ts']);
    expect(both.err).toBe('');
    expect(both.out).toContain('1 file in all of them.');
    // Line 1 calls the `tally` its own file declares on line 3, so `uses` puts both lines in.
    expect(both.out).toContain('packages/kit/src/money/b.ts — 1: lines 1, 3 · 2: the file');
  });

  it('answers `symbol` with a declaration in source before one in a test', async () => {
    checkout({
      'packages/kit/src/money/a.test.ts': 'function relaunch(): number {\n  return 0;\n}\n\nexport {};\n',
      'packages/kit/src/money/z.ts': 'export const z = (): number => relaunch();\n\nfunction relaunch(): number {\n  return 1;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'relaunch']);
    const source = out.indexOf('declared, not exported, at packages/kit/src/money/z.ts:3');
    const test = out.indexOf('declared, not exported, at packages/kit/src/money/a.test.ts:1');
    expect(source).toBeGreaterThanOrEqual(0);
    expect(test).toBeGreaterThan(source);
  });

  it('answers `search` with a declaration whose documentation holds the words', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'process of its own']);
    expect(out).toMatch(/^relaunch \[function\] — @acme\/kit · packages\/kit\/src\/money\/restart\.ts:4$/m);
  });

  it('answers `search` with a Rust item whose `///` lines hold the words across a line break', async () => {
    checkout(PRIVATE_RUST);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'search', '--query', 'again, in a process']);
    expect(out).toMatch(/^relaunch \[function\] — .* · packages\/kit\/src\/lib\.rs:7$/m);
  });

  it('answers `symbol` for a Rust item that is not `pub`, with its doc lines and who can name it', async () => {
    checkout(PRIVATE_RUST);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    const block = paragraph(out, /^relaunch \[function\]\n/);
    expect(block).toContain('declared, not exported, at packages/kit/src/lib.rs:7');
    expect(block).toContain('fn relaunch(argv: &[String]) -> i32');
    expect(block).toContain('Start the program again,\nin a process of its own.');
    expect(block).not.toContain('///');
    expect(block).toContain('Only the module it is declared in, and the modules inside that one, can name it: it is not `pub`.');
  });

  it('answers `symbol` for a Rust item inside an inline module on its module path, asked by its own name or by the path', async () => {
    checkout({
      ...PRIVATE_RUST,
      'packages/kit/src/lib.rs': `${PRIVATE_RUST['packages/kit/src/lib.rs']}#[cfg(test)]\nmod tests {\n    use super::*;\n\n    /// A program to restart.\n    fn fixture() -> Vec<String> {\n        Vec::new()\n    }\n}\n`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const name of ['fixture', 'tests::fixture']) {
      const { code, out, err } = await run(['ask', 'symbol', '--name', name]);
      expect(err).toBe('');
      expect(code).toBe(EXIT_CLEAN);
      const block = paragraph(out, /^tests::fixture \[function\]\n/);
      expect(block).toContain('declared, not exported, at packages/kit/src/lib.rs:15');
      expect(block).toContain('fn fixture() -> Vec<String>');
      expect(block).toContain('A program to restart.');
      expect(block).toContain('Only the module it is declared in, and the modules inside that one, can name it: it is not `pub`.');
    }
  });

  it('answers `uses` for a Rust item that is not `pub` with who can name it', async () => {
    checkout(PRIVATE_RUST);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'relaunch']);
    expect(out).toContain(
      '`relaunch` [function] is declared, not exported, at packages/kit/src/lib.rs:7, so only its module and the modules inside it can name it.',
    );
  });

  it('answers `uses` for a Rust name declared at the top and in an inline module with each declaration on its own path', async () => {
    checkout({
      ...PRIVATE_RUST,
      'packages/kit/src/lib.rs': `${PRIVATE_RUST['packages/kit/src/lib.rs']}#[cfg(test)]\nmod tests {\n    fn relaunch() {}\n}\n`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'relaunch']);
    expect(out).toContain([
      '`relaunch` is declared, not exported, in 2 places:',
      '  packages/kit/src/lib.rs:7 [function], so only its module and the modules inside it can name it',
      '  packages/kit/src/lib.rs:12 as `tests::relaunch` [function], so only its module and the modules inside it can name it',
    ].join('\n'));
  });

  it('answers `uses` for a Rust module apart from the function of the same name it declares: the importers under the export, the module named as a module', async () => {
    checkout({
      'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
      'packages/kit/src/lib.rs': 'mod walk;\n\nuse crate::walk::walk;\n\npub fn run() {\n    walk();\n}\n',
      'packages/kit/src/walk.rs': 'pub(crate) fn walk() {}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'walk']);
    expect(out).toContain('it is exported at packages/kit/src/walk.rs:1');
    const [exported, kept] = out.split('`walk` [module]');
    expect(exported).toContain('packages/kit/src/lib.rs:3 — @acme/kit');
    expect(kept).not.toContain('lib.rs:3');
    expect(out).toContain('`walk` [module] is declared, not exported, at packages/kit/src/lib.rs:1, so only its module and the modules inside it can name it.');
  });

  it('answers `symbol` and `uses` for a Swift `fileprivate` and a Kotlin `private` as declared and kept to their files', async () => {
    checkout({
      'packages/kit/Sources/Kit/Restart.swift': 'public func restart() -> Int { relaunch() }\n\nfileprivate func relaunch() -> Int { 0 }\n',
      'packages/kit/src/main/kotlin/kit/Restart.kt': 'package kit\n\nfun restart(): Int = rerun()\n\nprivate fun rerun(): Int = 0\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, at] of [['relaunch', 'packages/kit/Sources/Kit/Restart.swift:3'], ['rerun', 'packages/kit/src/main/kotlin/kit/Restart.kt:5']] as const) {
      const { out } = await run(['ask', 'symbol', '--name', name]);
      const block = paragraph(out, new RegExp(`^${name} \\[function\\]\\n`));
      expect(block).toContain(`declared, not exported, at ${at}`);
      expect(block).toContain(`Nothing outside ${at.slice(0, at.lastIndexOf(':'))} can import it`);
      expect((await run(['ask', 'uses', '--name', name])).out)
        .toContain(`\`${name}\` [function] is declared, not exported, at ${at}, so nothing outside that file can import it.`);
    }
  });

  it('answers `symbol` for an underscored Python name with its docstring, and says another module can still import it', async () => {
    checkout(PRIVATE_PYTHON);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'symbol', '--name', '_relaunch']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    const block = paragraph(out, /^_relaunch \[function\]\n/);
    expect(block).toContain('declared, not exported, at packages/kit/kit/restart.py:4');
    expect(block).toContain('def _relaunch(argv)');
    expect(block).toContain('Start the program again in a process of its own.');
    expect(block).toContain('Another module can still import it by name: a leading underscore keeps it out of `from … import *` only.');
  });

  it('answers `uses` for an underscored Python name with the grep that finds the modules spelling it', async () => {
    checkout(PRIVATE_PYTHON);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', '_relaunch']);
    expect(out).toContain(
      "`_relaunch` [function] is declared, not exported, at packages/kit/kit/restart.py:4; another module can still import it by name, which `variance ask grep --query '\\b_relaunch\\b' --to packages/kit/kit/restart.py` finds.",
    );
  });

  it('answers `symbol` for a Python name `__all__` leaves out with what keeps it out', async () => {
    checkout({ 'packages/kit/kit/restart.py': "__all__ = ['restart']\n\ndef restart(argv):\n    return relaunch(argv)\n\ndef relaunch(argv):\n    return len(argv)\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'relaunch']);
    expect(paragraph(out, /^relaunch \[function\]\n/)).toContain(
      'Another module can still import it by name: `__all__` keeps it out of `from … import *` only.',
    );
  });

  it('answers `symbol` for a `macro_rules!` and a CommonJS function without a reach their readers cannot tell', async () => {
    checkout({
      ...PRIVATE_RUST,
      'packages/kit/src/again.rs': '#[macro_export]\nmacro_rules! again {\n    () => {};\n}\n',
      'packages/kit/src/money/legacy.cjs': 'function rerun(argv) {\n  return argv.length;\n}\nexports.rerun = rerun;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const [name, kind] of [['again', 'macro'], ['rerun', 'function']] as const) {
      const { out } = await run(['ask', 'symbol', '--name', name]);
      const block = paragraph(out, new RegExp(`^${name} \\[${kind}\\]\\n`));
      expect(block).toContain('Who can reach it is not recorded: its reader cannot tell how this file hands it out.');
      expect(block).not.toContain('can import it');
      expect(block).not.toContain('can name it');
    }
  });

  it('names the files whose declarations were not read, in an answer and in a refusal', async () => {
    checkout({
      ...RELAUNCH,
      // Past the largest file a read opens, so the index holds no parse of it.
      'packages/kit/src/money/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const unread = 'The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/kit/src/money/huge.ts.';
    for (const question of [
      ['symbol', '--name', 'nowhere'], ['uses', '--name', 'nowhere'], ['search', '--query', 'nowhere'],
      ['symbol', '--name', 'relaunch'], ['uses', '--name', 'relaunch'], ['search', '--query', 'relaunch'],
    ]) {
      const { out, err } = await run(['ask', ...question]);
      expect(`${out}${err}`).toContain(unread);
    }
  });

  it('answers `symbol` and `uses` for a name declared in a file changed since the last index', async () => {
    checkout(RELAUNCH);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    // The branch edits the file: the update reads it again, and must read its declarations too.
    writeFileSync(
      'packages/kit/src/money/restart.ts',
      `${RELAUNCH['packages/kit/src/money/restart.ts']}\n/** Pick the program up where it stopped. */\nfunction resume(argv: readonly string[]): number {\n  return relaunch(argv);\n}\n`,
    );
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const symbol = await run(['ask', 'symbol', '--name', 'resume']);
    expect(symbol.code).toBe(EXIT_CLEAN);
    const block = paragraph(symbol.out, /^resume \[function\]\n/);
    expect(block).toContain('declared, not exported, at packages/kit/src/money/restart.ts:9 by @acme/kit');
    expect(block).toContain('Pick the program up where it stopped.');
    expect(symbol.out).not.toContain('were not read into the source index');

    const uses = await run(['ask', 'uses', '--name', 'resume']);
    expect(uses.code).toBe(EXIT_CLEAN);
    expect(uses.out).toContain(
      '`resume` [function] is declared, not exported, at packages/kit/src/money/restart.ts:9, so nothing outside that file can import it.',
    );
    expect(uses.out).not.toContain('were not read into the source index');
  });

  it('names the files whose declarations were not read when `symbol` finds nothing before `variance index` ran', async () => {
    checkout({
      ...RELAUNCH,
      'packages/kit/src/money/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}`,
    });

    const { out, err } = await run(['ask', 'symbol', '--name', 'nowhere']);
    expect(`${out}${err}`).toContain('The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/kit/src/money/huge.ts.');
  });

  it('writes out five declarations of one name and counts the rest', async () => {
    const files = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((part) => [
        `packages/kit/src/money/${part}.ts`,
        `export const ${part} = (): number => tally();\n\nfunction tally(): number {\n  return 0;\n}\n`,
      ]),
    );
    checkout(files);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'tally']);
    expect(out.match(/^tally \[function\]$/gm)).toHaveLength(5);
    expect(out).toContain('declared, not exported, at packages/kit/src/money/a.ts:3 by @acme/kit');
    expect(out).not.toContain('packages/kit/src/money/f.ts');
    expect(out).toContain('1 more declaration of `tally` not shown.');
  });
});
