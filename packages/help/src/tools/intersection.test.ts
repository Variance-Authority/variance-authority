import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileNames, FileRecord, SourceNames, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import { intersection, readsNames } from './intersection.js';

/**
 * Each operand is a set of files, read whole, and the answer is the files in
 * every one of them. The fixture holds a context per area: only the two that
 * are in reach of the nav, made by `createContext`, with a name the question
 * asked for, are in the answer — and each of the other three fails exactly one
 * operand, so an answer holding any of them dropped that operand.
 */

const RG = spawnSync('rg', ['--version']).error === undefined;

const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

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
]);

let root: string;
let tree: Tree;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'intersection-'));
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
    ],
    root,
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ask = (input: Record<string, unknown>): string => intersection.run(undefined, input, { tree, names: NAMES, root });

const CONTEXTS = { from: 'src/TopNav.tsx', imports: 'react#createContext', declares: 'theme|user|account' };

describe('intersection of whole sets', () => {
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
    const text = intersection.run(undefined, { declares: '^selectBalance$', imports: 'react' }, { tree, names, root });
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
    expect(intersection.wants?.({ declares: 'x' })).toBe(true);
  });

  it('asks for the names only when a set is read off them', () => {
    expect(readsNames({ from: ['src/TopNav.tsx'], path: 'theme', text: 'x', exceptFrom: ['src/a.ts'], exceptPath: 'old' })).toBe(false);
    for (const key of ['imports', 'exceptImports']) expect(readsNames({ [key]: ['react'] })).toBe(true);
    for (const key of ['declares', 'exceptDeclares']) expect(readsNames({ [key]: 'x' })).toBe(true);
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

describe.skipIf(!RG)('text, inside the files the other operands kept', () => {
  it('answers only files with a matching line', () => {
    const text = ask({ ...CONTEXTS, text: 'dark' });
    expect(text).toContain("src/state/theme.ts:2  export const ThemeContext = createContext('dark');");
    expect(text).toContain('1 file in all of them');
    expect(text).not.toContain('src/state/user.ts');
  });
});

describe('intersection refuses', () => {
  it('a question with nothing to cross', () => {
    expect(() => ask({})).toThrow('needs at least one set');
  });

  it('text alone, which is ripgrep over the checkout', () => {
    expect(() => ask({ text: 'dark' })).toThrow('run `rg "dark"`');
  });

  it('a path the tree does not hold', () => {
    expect(() => ask({ from: 'src/Nope.tsx', declares: 'x' })).toThrow('`src/Nope.tsx` is not found');
  });

  it('a name operand when no names were read', () => {
    expect(() => intersection.run(undefined, CONTEXTS, { tree })).toThrow('no names were read');
  });

  it('a name out of a file when no source index holds who imports it', () => {
    expect(() => ask({ imports: 'src/store/selectors.ts#selectBalance' })).toThrow('read from the source index, and no source index is published; run `variance index`');
  });

  it('a pattern that is not a regular expression', () => {
    expect(() => ask({ declares: '(' })).toThrow('`declares` is not a regular expression');
  });

  it('a question asked with no source tree read', () => {
    expect(() => intersection.run(undefined, { path: 'x' }, { names: NAMES, root })).toThrow('no source tree was read');
  });

  it('an import with nothing after its `#`', () => {
    expect(() => ask({ imports: 'react#' })).toThrow('`react#` has nothing after `#`');
  });
});
