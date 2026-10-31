import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` says one of three facts about a name: where the
 * workspace declares it, the container it is a member of, or that nothing
 * declares it. The dependency lexicon is named only where it could change
 * that answer — a name the workspace does not declare — and then as what was
 * not checked, never as the whole answer.
 */

const cwd = process.cwd();
const cache = process.env['VARIANCE_AUTHORITY_CACHE'];

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-truth-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

const NATIVE = {
  'packages/lib/src/native.ts':
    'export interface Scanner {\n  resolveThings?(root: string): string[];\n}\n\nfunction edgeKindBetween(left: string, right: string): string {\n  return left + right;\n}\n\nexport const scanner = (): Scanner => ({ edge: edgeKindBetween });\n',
};

/** The two files of the checkout's dependency lexicon, beside its source index. */
function lexiconFiles(root: string): readonly string[] {
  const directory = dirname(sourceIndexPath(root));
  return [join(directory, 'dependency-lexicon.bin'), join(directory, 'dependency-lexicon.sites.bin')];
}

/** The checkout, indexed, with its dependency lexicon removed when `lexicon` is false. */
async function indexed(lexicon: boolean): Promise<string> {
  const root = checkout(NATIVE);
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  expect(lexiconFiles(root).map(existsSync)).toEqual([true, true]);
  if (!lexicon) for (const file of lexiconFiles(root)) rmSync(file);
  return root;
}

describe('variance ask symbol says what is true of a name', () => {
  for (const lexicon of [true, false]) {
    const state = lexicon ? 'published' : 'not published';

    it(`answers a member with its container, the lexicon ${state}`, async () => {
      await indexed(lexicon);
      const { code, out } = await run(['ask', 'symbol', '--name', 'resolveThings']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('a member of `Scanner`, declared at packages/lib/src/native.ts:2');
      expect(out).toContain(
        "`variance ask uses` names the lines that use it through a value written as its container, and the declaration to ask its language's find-references about for the rest.",
      );
      expect(out).not.toContain('Members are read');
      expect(out).not.toContain('lexicon');
    });

    it(`answers a function its file keeps with where it is written, the lexicon ${state}`, async () => {
      await indexed(lexicon);
      const { code, out } = await run(['ask', 'symbol', '--name', 'edgeKindBetween']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('declared, not exported, at packages/lib/src/native.ts:5');
      expect(out).not.toContain('lexicon');
    });
  }

  it('says nothing in the workspace declares an absent name, and that its dependencies were not checked', async () => {
    const root = await indexed(false);
    // An answer not compared with the checkout leaves the lexicon as it found it.
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten', '--just-answer']);
    expect(lexiconFiles(root).map(existsSync)).toEqual([false, false]);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).not.toMatch(/^variance: the dependency lexicon is not published/m);
    expect(out).toContain('No file in this workspace declares `nowhereWritten`, at its top level or as a member.');
    expect(out).toContain(
      'Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and the `variance index` command publishes it.',
    );
  });

  it('says nothing in the workspace or its installed dependencies declares an absent name', async () => {
    await indexed(true);
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('No file in this workspace declares `nowhereWritten`, at its top level or as a member.');
    expect(out).toContain('No installed dependency publishes it either.');
    expect(out).not.toContain('not known');
    expect(out).not.toContain('Members are read');
  });

  it('publishes the lexicon the answer for an absent name needs, and says no installed dependency publishes it', async () => {
    const root = await indexed(false);
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(lexiconFiles(root).map(existsSync)).toEqual([true, true]);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('No installed dependency publishes it either.');
    expect(out).not.toContain('not known');
  });

  it('names only the installed package it checked, when asked about one package', async () => {
    await indexed(true);
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten', '--package', '@acme/lib']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('No installed dependency named `@acme/lib` publishes it either.');
    expect(out).not.toContain('No installed dependency publishes it either.');
  });

  it('says only the files the source index read declare nothing, when it declined one', async () => {
    checkout({
      ...NATIVE,
      // Past the largest file a read opens, so the index holds no parse of it.
      'packages/lib/src/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('No file in this workspace that the source index read declares `nowhereWritten`, at its top level or as a member.');
    expect(out).toContain('The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/lib/src/huge.ts.');
  });

  it('answers a name one file exports and another keeps with both, and gives `intersection` the one it keeps', async () => {
    // The export does not stand for the declaration, and neither is a member.
    checkout({ ...NATIVE, 'packages/lib/src/edges.ts': 'export const edgeKindBetween = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'edgeKindBetween']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/lib/src/edges.ts:1');
    expect(out).toContain('declared, not exported, at packages/lib/src/native.ts:5');
    expect(out).not.toContain('a member of');

    const both = await run(['ask', 'intersection', 'symbol --name edgeKindBetween', 'discover --from packages/lib/src/native.ts']);
    expect(both.err).toBe('');
    expect(both.code).toBe(EXIT_CLEAN);
    expect(both.out).toContain('packages/lib/src/native.ts — 1: line 5');
  });

  it('gives a member\'s declaring file to `intersection` at the line that declares it', async () => {
    await indexed(true);
    const { code, out, err } = await run(['ask', 'intersection', 'symbol --name resolveThings', 'discover --from packages/lib/src/native.ts']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/lib/src/native.ts — 1: line 2');
  });

  // FIXME: a file the chain holds no parse of — written after the source index — is not named among the unread.
  it.todo('names a file written after the source index as one whose declarations were not read — needs the unread list to compare the checkout against what the chain parsed');
  it('answers a member with its container, and names the languages whose members were not read', async () => {
    checkout({ ...NATIVE, 'tools/scan.py': 'class Scanner:\n    def resolveThings(self):\n        return []\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'resolveThings']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('a member of `Scanner`, declared at packages/lib/src/native.ts:2');
    expect(out).toContain(
      "Members are read from JavaScript and TypeScript files only, and this workspace's Python files were not read for them: " +
        "if `resolveThings` is a member there too, ask their language server's workspace symbols for it, then its find-references on the declaration.",
    );
  });

  it('says members were read from JavaScript and TypeScript only, and names the languages the index holds whose members were not', async () => {
    checkout({
      ...NATIVE,
      'tools/scan.py': 'class Scanner:\n    def scan_things(self):\n        return []\n',
      'crates/scan/src/lib.rs': 'pub struct Scanner {\n    pub scan_things: u32,\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out, err } = await run(['ask', 'symbol', '--name', 'scan_things']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).not.toContain('at its top level or as a member.');
    expect(out).toContain(
      'No file in this workspace declares `scan_things` at its top level, and no JavaScript or TypeScript file declares it as a member.',
    );
    expect(out).toContain(
      "Members are read from JavaScript and TypeScript files only, and this workspace's Python and Rust files were not read for them: " +
        "if `scan_things` is a member there, ask their language server's workspace symbols for it, then its find-references on the declaration.",
    );
  });
  const TREE = {
    'packages/lib/src/tree.ts':
      'export interface Tree {\n  chainsTo(path: string): boolean;\n}\n\nfunction chainsTo(path: string): boolean {\n  return path !== \'\';\n}\n\nexport const tree = (): Tree => ({ chainsTo });\n',
  };

  it('answers a dotted name with the member its container declares', async () => {
    checkout(TREE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Tree.chainsTo']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('a member of `Tree`, declared at packages/lib/src/tree.ts:2');
    expect(out).not.toContain('declares it as a member');
  });

  it('answers a dotted name whose member is a property', async () => {
    checkout({ 'packages/lib/src/reverse.ts': 'export interface ExecutionCrossing {\n  readonly distance: number;\n}\n\nexport const distance = 0;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'ExecutionCrossing.distance']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('a member of `ExecutionCrossing`, declared at packages/lib/src/reverse.ts:2');
  });

  it('answers the members of a name that a file also declares at its top level', async () => {
    checkout(TREE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'chainsTo']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/lib/src/tree.ts:5');
    expect(out).toContain('a member of `Tree`, declared at packages/lib/src/tree.ts:2');
  });

  it('answers the members of a published name beside its published declaration', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { chainsTo } from './chains.js';\n",
      'packages/lib/src/chains.ts': "export function chainsTo(path: string): boolean {\n  return path !== '';\n}\n",
      'packages/lib/src/tree.ts': 'export interface Tree {\n  chainsTo(path: string): boolean;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'chainsTo']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/lib/src/chains.ts:1');
    expect(out).toContain('a member of `Tree`, declared at packages/lib/src/tree.ts:2');
  });

  it('refuses a dotted name whose container nothing declares by what was read, and routes it to TypeScript', async () => {
    checkout(TREE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Nope.chainsTo']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('No file read here declares `Nope` at its top level');
    expect(out).not.toContain('declares `Nope.chainsTo`');
    expect(out).toContain("TypeScript's language service's go-to-definition on `Nope.chainsTo`");
    expect(out).not.toContain('as a member');
  });

  it('hands a member its declared container does not declare in its own body to TypeScript', async () => {
    checkout({ ...TREE, 'packages/lib/src/forest.ts': "import type { Tree } from './tree.js';\n\nexport interface Forest extends Tree {\n  readonly size: number;\n}\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    for (const tool of ['symbol', 'uses']) {
      const { code, out } = await run(['ask', tool, '--name', 'Forest.chainsTo']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).not.toContain('as a member');
      expect(out).not.toContain('a member of `Tree`');
      expect(out).toContain('`Forest` is declared at packages/lib/src/forest.ts:3, and no interface, type alias or class body read here declares `chainsTo` on `Forest`.');
      expect(out).toContain("An inherited member is a type checker's answer, and none runs here; the source index reads no enum, namespace or object literal body:");
      expect(out).not.toContain('merged');
      expect(out).not.toContain('declares `Forest.chainsTo`');
      expect(out).toContain("TypeScript's language service's go-to-definition on `Forest.chainsTo`");
    }
  });

  it('never refuses an enum member as undeclared', async () => {
    checkout({ 'packages/lib/src/color.ts': 'export enum Color {\n  Red,\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Color.Red']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('as a member');
    expect(out).toContain('`Color` is declared at packages/lib/src/color.ts:1');
    expect(out).toContain("TypeScript's language service's go-to-definition on `Color.Red`");
  });

  it('answers a member a type alias declares in the literal its intersection joins', async () => {
    checkout({ 'packages/lib/src/options.ts': 'interface Base {\n  root: string;\n}\nexport type Options = Base & {\n  readonly index: string;\n};\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Options.index']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('a member of `Options`, declared at packages/lib/src/options.ts:5');
    expect(out).not.toContain('No file');
  });

  it('never says nothing declares a container a namespace import binds', async () => {
    checkout({
      'packages/lib/src/text.ts': 'export const shout = (said: string): string => said.toUpperCase();\n',
      'packages/lib/src/index.ts': "import * as text from './text.js';\n\nexport const loud = text.shout('hi');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'text.shout']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('none declares');
    expect(out).toContain('a namespace an import or an `export * as` binds is not read as one');
    expect(out).toContain("TypeScript's language service's go-to-definition on `text.shout`");
  });

  it('reads a container written with a dot by the name it starts with', async () => {
    checkout({ 'packages/lib/src/outer.ts': 'export namespace Outer {\n  export const depth = 1;\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Outer.Inner.deep']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`Outer` is declared at packages/lib/src/outer.ts:1, and no interface, type alias or class body read here declares `deep` on `Outer.Inner`.');
  });

  it("routes a member of another language's container to that language's server, never TypeScript", async () => {
    checkout({ 'packages/lib/src/tree.py': 'class Tree:\n    def chains_to(self):\n        return 1\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'symbol', '--name', 'Tree.chains_to']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`Tree` is declared at packages/lib/src/tree.py:1');
    expect(out).toContain("its language server's go-to-definition on `Tree.chains_to`");
    expect(out).not.toContain("TypeScript's language service");
  });

  it('answers the uses of a dotted name as the uses of its member', async () => {
    checkout({ ...TREE, 'packages/lib/src/walk.ts': "import type { Tree } from './tree.js';\n\nexport function walk(tree: Tree): boolean {\n  return tree.chainsTo('a');\n}\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['ask', 'uses', '--name', 'Tree.chainsTo']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/lib/src/tree.ts:2');
    expect(out).toContain('`Tree.chainsTo`, declared at packages/lib/src/tree.ts:2, is used in');
    expect(out).not.toContain('Tree.Tree');
    expect(out).not.toContain('declares it as a member');
  });
});
