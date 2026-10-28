import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EdgeKind } from '@variance-authority/core/relate';
import type { FileNames, FileRecord, SourceNames, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { discover, readsNames } from './discover.js';

/**
 * Each operand is a set of files, read whole, and the answer is the files in
 * every one of them. The fixture holds a context per area: only the two that
 * are in reach of the nav, made by `createContext`, with a name the question
 * asked for, are in the answer — and each of the other three fails exactly one
 * operand, so an answer holding any of them dropped that operand.
 */

const RG = spawnSync('rg', ['--version']).error === undefined;

const reads = (file: string, ...to: readonly (string | readonly [string, EdgeKind])[]): FileRecord =>
  to.length === 0
    ? { file }
    : { file, edges: to.map((edge) => (typeof edge === 'string' ? { to: edge, kind: 'imports' as const } : { to: edge[0], kind: edge[1] })) };

const blank: FileNames = { declared: [], imported: [] };

const context = (name: string): FileNames => ({
  declared: [{ name, line: 2 }],
  imported: [{ from: 'react', name: 'createContext', line: 1 }],
});

const NAMES: SourceNames = new Map<string, FileNames>([
  ['src/TopNav.tsx', { declared: [{ name: 'TopNav', line: 4 }], imported: [{ from: './nav/Menu', to: 'src/nav/Menu.tsx', name: 'Menu', line: 1 }] }],
  ['src/nav/Menu.tsx', { declared: [{ name: 'Menu', line: 3 }], imported: [] }],
  ['src/state/theme.ts', context('ThemeContext')],
  ['src/state/user.ts', context('UserContext')],
  ['src/state/cart.ts', context('CartContext')],
  ['src/state/account.ts', context('AccountContext')],
  ['src/state/legacy.ts', { declared: [{ name: 'ThemeLegacy', line: 1 }], imported: [] }],
  ['src/Other.tsx', { declared: [], imported: [{ from: 'react-dom/client', name: 'createRoot', line: 1 }] }],
  ['src/Wallet.tsx', { declared: [], imported: [{ from: './store/selectors', to: 'src/store/selectors.ts', name: 'selectBalance', local: 'balance', line: 1 }] }],
  ['src/store/selectors.ts', { declared: [{ name: 'selectBalance', line: 3 }], imported: [] }],
  ['src/old/selectors.ts', { declared: [{ name: 'selectBalance', line: 8 }], imported: [] }],
  ...['src/chain/base.ts', 'src/chain/model.ts', 'src/chain/view.ts', 'src/chain/page.ts', 'src/chain/shell.ts', 'src/chain/blind.ts'].map(
    (file): [string, FileNames] => [file, blank],
  ),
]);

let root: string;
let tree: Tree;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'discover-'));
  write('src/state/theme.ts', "import { createContext } from 'react';\nexport const ThemeContext = createContext('dark');\n");
  write('src/state/user.ts', "import { createContext } from 'react';\nexport const UserContext = createContext(null);\n");
  tree = treeOf(
    [
      reads('src/TopNav.tsx', 'src/nav/Menu.tsx', 'src/state/theme.ts', 'src/state/legacy.ts'),
      reads('src/nav/Menu.tsx', 'src/state/user.ts', 'src/state/cart.ts'),
      reads('src/state/theme.ts'),
      reads('src/state/user.ts'),
      reads('src/state/cart.ts'),
      reads('src/state/account.ts'),
      reads('src/state/legacy.ts'),
      reads('src/Other.tsx', 'src/state/account.ts'),
      reads('src/Wallet.tsx', 'src/store/selectors.ts'),
      reads('src/store/selectors.ts'),
      reads('src/old/selectors.ts'),
      // What rests on `base.ts`: `model.ts` through a type import, and `shell.ts`
      // two ways, the shorter through `model.ts`. `blind.ts` reaches nothing the
      // scan resolved, and imports something it did not.
      reads('src/chain/base.ts'),
      reads('src/chain/model.ts', ['src/chain/base.ts', 'type']),
      reads('src/chain/view.ts', 'src/chain/model.ts'),
      reads('src/chain/page.ts', 'src/chain/view.ts'),
      reads('src/chain/shell.ts', 'src/chain/page.ts', 'src/chain/model.ts'),
      { file: 'src/chain/blind.ts', unknown: 'an import nobody resolved' },
      // No reader claims it, so it has no names to read, rather than names unread.
      reads('README.md'),
    ],
    root,
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, names: NAMES, root });

const CONTEXTS = { from: 'src/TopNav.tsx', imports: 'react#createContext', declares: 'theme|user|account' };

describe('discover crosses whole sets', () => {
  it('answers the files in every operand, nearest first', () => {
    const text = ask(CONTEXTS);
    expect(text).toContain('6 files reached from `src/TopNav.tsx`');
    expect(text).toContain('4 files importing `createContext` from `react`');
    expect(text).toContain('4 files declaring a name matching /theme|user|account/i');
    expect(text).toContain('2 files in all of them, nearest first.');
    expect(text.indexOf('src/state/theme.ts')).toBeLessThan(text.indexOf('src/state/user.ts'));
    for (const outside of ['cart.ts', 'account.ts', 'legacy.ts']) expect(text).not.toContain(outside);
  });

  it('says why each file is in every set, at the line that says so', () => {
    const text = ask(CONTEXTS);
    expect(text).toContain('src/state/user.ts:1  imports createContext from react');
    expect(text).toContain('src/state/user.ts:2  declares UserContext');
    expect(text).toContain('2 imports from src/TopNav.tsx');
  });

  it('finds where a name seen in a file is declared, among every file declaring it', () => {
    const text = ask({ declares: '^selectBalance$', from: 'src/Wallet.tsx' });
    expect(text).toContain('2 files declaring a name matching /^selectBalance$/i');
    expect(text).toContain('1 file in all of them');
    expect(text).toContain('src/store/selectors.ts:3  declares selectBalance');
    expect(text).not.toContain('src/old/selectors.ts');
  });

  it('crosses two start points rather than joining them', () => {
    const text = ask({ from: ['src/TopNav.tsx', 'src/nav/Menu.tsx'] });
    expect(text).toContain('6 files reached from `src/TopNav.tsx`');
    expect(text).toContain('3 files reached from `src/nav/Menu.tsx`');
    expect(text).toContain('3 files in all of them');
    expect(text).not.toContain('src/state/theme.ts');
  });

  it('matches an import by the file it resolved to, as well as by what was written', () => {
    const text = ask({ imports: 'src/store/selectors.ts' });
    expect(text).toContain('src/Wallet.tsx:1  imports selectBalance from ./store/selectors as balance');
  });

  it('matches a package by any subpath of it, and a relative import only as written', () => {
    expect(ask({ imports: 'react-dom#createRoot' })).toContain('src/Other.tsx:1  imports createRoot from react-dom/client');
    expect(ask({ imports: './store' })).toContain('No file is in all of them.');
  });

  it('counts the files whose names were not read, so a missing one is not a file declaring nothing', () => {
    const names = new Map([...NAMES].filter(([file]) => file !== 'src/old/selectors.ts'));
    const text = discover.run(undefined, { declares: '^selectBalance$', imports: 'react' }, { tree, names, root });
    expect(text).toContain('1 file declaring a name matching /^selectBalance$/i — the names of 1 file were not read');
    expect(text).toContain('4 files importing `react` — the names of 1 file were not read');
  });

  it('takes out every file an except operand holds', () => {
    const text = ask({ ...CONTEXTS, exceptPath: 'user' });
    expect(text).toContain('1 file with a path matching /user/, taken out');
    expect(text).toContain('1 file in all of them');
    expect(text).not.toContain('src/state/user.ts');
  });

  it('takes out what a path reaches, what reaches it, what imports a name and what declares one', () => {
    const reached = ask({ ...CONTEXTS, exceptFrom: 'src/nav/Menu.tsx' });
    expect(reached).toContain('1 file in all of them');
    expect(reached).not.toContain('src/state/user.ts');

    expect(ask({ from: 'src/TopNav.tsx', exceptTo: 'src/nav/Menu.tsx' })).toContain('4 files in all of them');

    const imported = ask({ from: 'src/TopNav.tsx', exceptImports: 'react#createContext' });
    expect(imported).toContain('3 files in all of them');
    expect(imported).not.toContain('src/state/theme.ts');

    const declared = ask({ from: 'src/TopNav.tsx', imports: 'react#createContext', exceptDeclares: '^Theme' });
    expect(declared).toContain('2 files in all of them');
    expect(declared).not.toContain('src/state/theme.ts');
  });

  it('keeps a file by its path alone, with no line to show for it', () => {
    const text = ask({ from: 'src/Wallet.tsx', path: '^src/store/' });
    expect(text).toContain('1 file with a path matching /^src/store/');
    expect(text).toContain('1 file in all of them');
    expect(text).toContain('src/store/selectors.ts');
  });

  it('asks its host for the tree whatever it was given, since every set is read from it', () => {
    expect(discover.wants?.({ declares: 'x' })).toBe(true);
  });

  it('asks for the names only when a set is read off them', () => {
    expect(readsNames({ from: ['src/TopNav.tsx'], path: 'theme', text: 'x', exceptFrom: ['src/a.ts'], exceptPath: 'old' })).toBe(false);
    for (const key of ['imports', 'exceptImports']) expect(readsNames({ [key]: ['react'] })).toBe(true);
    for (const key of ['declares', 'exceptDeclares']) expect(readsNames({ [key]: 'x' })).toBe(true);
  });

  it('reads no names for a name set said empty, which names no set', () => {
    expect(readsNames({ from: ['src/TopNav.tsx'], imports: [], exceptImports: [''], declares: '', exceptDeclares: '  ' })).toBe(false);
  });

  it('says so when nothing is in all of them', () => {
    expect(ask({ ...CONTEXTS, path: '^src/old/' })).toContain('No file is in all of them.');
  });

  it('counts every file and shows the nearest', () => {
    const text = ask({ from: 'src/TopNav.tsx', limit: 2 });
    expect(text).toContain('6 files in all of them');
    expect(text).toContain('4 more not shown; a higher `limit` shows them.');
  });
});

describe('discover says how a file reaches what it was asked of', () => {
  it('gives each file one shortest chain of imports to the subject, with the kind of each import that is not plain', () => {
    const text = ask({ to: 'src/chain/base.ts' });
    expect(text).toContain('2 imports to src/chain/base.ts: src/chain/view.ts → src/chain/model.ts (type import) → src/chain/base.ts');
    expect(text).toContain('2 imports to src/chain/base.ts: src/chain/shell.ts → src/chain/model.ts (type import) → src/chain/base.ts');
    expect(text).toContain('3 imports to src/chain/base.ts: src/chain/page.ts → src/chain/view.ts → src/chain/model.ts (type import) → src/chain/base.ts');
    expect(text).toContain('1 import to src/chain/base.ts');
  });

  it('names the files it did not reach that import something unresolved, which may reach the subject through it', () => {
    expect(ask({ to: 'src/chain/base.ts' })).toContain(
      '5 files reaching `src/chain/base.ts` — 1 other file imports something the scan could not resolve, and may reach it: src/chain/blind.ts',
    );
  });

  // Records every file a chain is asked of, so a chain built for a file nobody sees is caught.
  const spied = (asked: string[]): Tree => ({
    ...tree,
    chainsTo: (seeds) => {
      const chains = tree.chainsTo(seeds);
      return { distance: chains.distance, chain: (file) => (asked.push(file), chains.chain(file)) };
    },
  });

  it('builds a chain only for the files it shows', () => {
    const asked: string[] = [];
    const text = discover.run(undefined, { to: 'src/chain/base.ts', limit: 3 }, { tree: spied(asked), names: NAMES, root });
    expect(text).toContain('2 more not shown');
    expect(asked).toEqual(['src/chain/shell.ts']);
  });

  it('answers the files it reached, at no line and with no chain, when asked for the set', () => {
    const asked: string[] = [];
    const { files } = discover.files!(undefined, { to: 'src/chain/base.ts' }, { tree: spied(asked), names: NAMES, root });
    expect(asked).toEqual([]);
    expect([...files]).toEqual([
      ['src/chain/base.ts', []],
      ['src/chain/model.ts', []],
      ['src/chain/shell.ts', []],
      ['src/chain/view.ts', []],
      ['src/chain/page.ts', []],
    ]);
  });
});

describe.skipIf(!RG)('text, inside the files the other operands kept', () => {
  it('answers only files with a matching line', () => {
    const text = ask({ ...CONTEXTS, text: 'dark' });
    expect(text).toContain("src/state/theme.ts:2  export const ThemeContext = createContext('dark');");
    expect(text).toContain('1 file in all of them');
    expect(text).not.toContain('src/state/user.ts');
  });
});

describe('discover refuses', () => {
  it('a question with nothing to cross', () => {
    expect(() => ask({})).toThrow('needs at least one set');
  });

  it('text alone, which is ripgrep over the checkout', () => {
    expect(() => ask({ text: 'dark' })).toThrow('run `rg "dark"`');
  });

  it('naming the sets as the surface it was asked on takes them', () => {
    const shell = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, names: NAMES, root, shell: 'variance ask' });
    expect(() => ask({})).toThrow('`discover` needs at least one set to cross: `from`, `to`, `imports`, `declares` or `path`.');
    expect(() => shell({})).toThrow('`discover` needs at least one set to cross: `--from`, `--to`, `--imports`, `--declares` or `--path`.');
    expect(() => shell({ text: 'dark' })).toThrow('`--text` searches inside the files the other sets kept');
  });

  it('a path the tree does not hold', () => {
    expect(() => ask({ from: 'src/Nope.tsx', declares: 'x' })).toThrow('`src/Nope.tsx` is not found');
  });

  it('a name operand when no names were read', () => {
    expect(() => discover.run(undefined, CONTEXTS, { tree })).toThrow('no names were read');
    expect(() => discover.run(undefined, { declares: 'Theme' }, { tree, root })).toThrow('no names were read');
  });

  it('a name out of a file for want of a source index, not of names, which it does not read', () => {
    expect(() => discover.run(undefined, { imports: 'src/store/selectors.ts#selectBalance' }, { tree, root })).toThrow('no source index is published');
  });

  it('a name out of a file when no source index holds who imports it', () => {
    expect(() => ask({ imports: 'src/store/selectors.ts#selectBalance' })).toThrow('read from the source index, and no source index is published; run `variance index`');
  });

  it('a pattern that is not a regular expression', () => {
    expect(() => ask({ declares: '(' })).toThrow('`declares` is not a regular expression');
  });

  it('a question asked with no source tree read', () => {
    expect(() => discover.run(undefined, { path: 'x' }, { names: NAMES, root })).toThrow('no source tree was read');
  });

  it('an import with nothing after its `#`', () => {
    expect(() => ask({ imports: 'react#' })).toThrow('`react#` has nothing after `#`');
  });
});
