import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EdgeKind } from '@variance-authority/core/relate';
import type { FileRecord, Tree } from '@variance-authority/mcp/tools';
import { treeOf } from '@variance-authority/mcp/tools';
import type { ImportAsked, NameHit, NamesFound } from '@variance-authority/sense';
import { readsNames } from './discover-operands.js';
import { discover } from './discover.js';

/**
 * Each operand is a set of files, read whole, and the answer is the files in
 * every one of them. The fixture holds a context per area: only the two that
 * are in reach of the nav, made by `createContext`, with a name the question
 * asked for, are in the answer — and each of the other three fails exactly one
 * operand, so an answer holding any of them dropped that operand.
 */

const reads = (file: string, ...to: readonly (string | readonly [string, EdgeKind])[]): FileRecord =>
  to.length === 0
    ? { file }
    : { file, edges: to.map((edge) => (typeof edge === 'string' ? { to: edge, kind: 'imports' as const } : { to: edge[0], kind: edge[1] })) };

/** What a file declares and imports, as the source index's names filter reads it. */
interface FileNames {
  readonly declared: readonly { readonly name: string; readonly line: number }[];
  readonly imported: readonly { readonly from: string; readonly to?: string; readonly name?: string; readonly local?: string; readonly line: number }[];
}

const blank: FileNames = { declared: [], imported: [] };

const context = (name: string): FileNames => ({
  declared: [{ name, line: 2 }],
  imported: [{ from: 'react', name: 'createContext', line: 1 }],
});

const NAMES: ReadonlyMap<string, FileNames> = new Map<string, FileNames>([
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

/**
 * The source index's names filter, answered off the table above: which file
 * names a module or declares a name is the addon's, and its own tests hold it;
 * what is here is how `discover` crosses and says what it answers.
 */
const index = vi.hoisted(() => ({ unread: [] as string[], names: undefined as unknown as ReadonlyMap<string, FileNames> }));
vi.mock('@variance-authority/sense', async (original) => ({
  ...(await original<object>()),
  namesFilterOf: (_at: string, imports: readonly ImportAsked[], declares: readonly string[]): NamesFound => {
    const rows = [...index.names];
    return {
      imports: imports.map(({ spec, name }) =>
        rows.flatMap(([file, held]) =>
          held.imported
            .filter((entry) => (entry.from === spec || entry.to === spec) && (name == null || entry.name === name))
            .map((entry): NameHit => ({ file, line: entry.line, name: entry.name ?? null, from: entry.from, local: entry.local ?? null, through: null }) as NameHit),
        ),
      ),
      declares: declares.map((pattern) => {
        try {
          new RegExp(pattern);
        } catch (error) {
          return { hits: [], refused: String(error) };
        }
        return {
        hits: rows.flatMap(([file, held]) =>
          held.declared.filter((entry) => new RegExp(pattern, 'i').test(entry.name)).map((entry) => ({ file, line: entry.line, name: entry.name }) as NameHit),
        ),
        };
      }),
      unread: index.unread,
    } as NamesFound;
  },
}));
index.names = NAMES;

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

/** Any index: the filter above answers off the table. */
const sourceIndex = { index: 'index', within: '' };
const ask = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, sourceIndex, root });

const CONTEXTS = { from: 'src/TopNav.tsx', imports: 'react#createContext', declares: 'theme|user|account' };

describe('discover crosses whole sets', () => {
  it('answers the files in every operand, nearest first', () => {
    const text = ask(CONTEXTS);
    expect(text).toContain('6 files reached from `src/TopNav.tsx`');
    expect(text).toContain('4 files importing `createContext` from `react`');
    expect(text).toContain('4 files declaring a name matching /theme|user|account/i');
    expect(text.split('\n')[0]).toBe('2 files in all of them, nearest first:');
    expect(text.indexOf('src/state/theme.ts')).toBeLessThan(text.indexOf('src/state/user.ts'));
    for (const outside of ['cart.ts', 'account.ts', 'legacy.ts']) expect(text).not.toContain(outside);
  });

  it('says why each file is in every set, at the line that says so', () => {
    const text = ask(CONTEXTS);
    expect(text).toContain('\n2 src/state/user.ts\n  1: imports createContext from react\n  2: declares UserContext');
    expect(text).not.toContain('imports from src/TopNav.tsx');
  });

  it('finds where a name seen in a file is declared, among every file declaring it', () => {
    const text = ask({ declares: '^selectBalance$', from: 'src/Wallet.tsx' });
    expect(text).toContain('2 files declaring a name matching /^selectBalance$/i');
    expect(text).toContain('1 file in all of them');
    expect(text).toContain('\n1 src/store/selectors.ts\n  3: declares selectBalance');
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
    expect(text).toContain('src/Wallet.tsx\n  1: imports selectBalance from ./store/selectors as balance');
  });

  it('counts the files the tree holds and whose names were not read, so a missing one is not a file declaring nothing', () => {
    index.names = new Map([...NAMES].filter(([file]) => file !== 'src/old/selectors.ts'));
    index.unread = ['src/old/selectors.ts', 'src/gone.ts'];
    try {
      const text = ask({ declares: '^selectBalance$', imports: 'react' });
      expect(text).toContain('1 file declaring a name matching /^selectBalance$/i\n');
      expect(text.split('\nnote: the names of 1 file were not read')).toHaveLength(2);
    } finally {
      index.names = NAMES;
      index.unread = [];
    }
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

  it('reads no names for an import of a name out of a file the tree holds, or one it will refuse', () => {
    const files = new Set(['src/a.ts']);
    expect(readsNames({ imports: ['src/a.ts#x'], exceptImports: ['src/a.ts#'] }, files)).toBe(false);
    expect(readsNames({ imports: ['src/a.ts#x', 'src/b.ts#x'] }, files)).toBe(true);
    expect(readsNames({ imports: ['src/a.ts#x'] })).toBe(true);
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
    expect(text).toContain('4 more not shown; `offset` 2 shows the next 2.');
  });

  it('shows the page an offset asks for, counted from the same order, and says one past the last file shows none', () => {
    const first = ask({ from: 'src/TopNav.tsx', limit: 2 });
    const second = ask({ from: 'src/TopNav.tsx', limit: 2, offset: 2 });
    const rows = (text: string): string[] => text.split('\n').filter((line) => line.startsWith('src/'));
    expect(second).toContain('6 files in all of them');
    expect(second).toContain('Rows 3–4 of 6.');
    expect(second).toContain('2 more not shown; `offset` 4 shows the next 2.');
    expect([...rows(first), ...rows(second)]).toEqual(rows(ask({ from: 'src/TopNav.tsx', limit: 4 })));
    expect(ask({ from: 'src/TopNav.tsx', offset: 6 })).toContain('`offset` 6 is past the last of 6 rows.');
  });
});

describe('discover says how a file reaches what it was asked of', () => {
  it('gives each file one shortest chain of imports to the subject, with the kind of each import that is not plain', () => {
    const text = ask({ to: 'src/chain/base.ts' });
    expect(text).toContain('\nchains end: src/chain/model.ts (type import) → src/chain/base.ts\n');
    expect(text).toContain('\n2 src/chain/view.ts → …\n');
    expect(text).toContain('\n2 src/chain/shell.ts → …\n');
    expect(text).toContain('\n3 src/chain/page.ts → src/chain/view.ts → …\n');
    expect(text).toContain('\n1 src/chain/model.ts\n');
    expect(text.match(/src\/chain\/model\.ts \(type import\)/gu)).toHaveLength(1);
  });

  it('names the files it did not reach that import something unresolved, which may reach the subject through it', () => {
    expect(ask({ to: 'src/chain/base.ts' })).toContain(
      '\nnote: 1 other file imports something the scan could not resolve, and may reach it: src/chain/blind.ts',
    );
  });

  it('names them in a workspace below the graph root too, spelled as the graph spells them', () => {
    const app = join(root, 'app');
    const nested = treeOf([reads('app/base.ts'), reads('app/page.ts', 'app/base.ts'), { file: 'app/blind.ts', unknown: 'an import nobody resolved' }], root, app);
    expect(discover.run(undefined, { to: 'base.ts' }, { tree: nested, names: NAMES, root: app })).toContain(
      'note: 1 other file imports something the scan could not resolve, and may reach it: app/blind.ts',
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
    const text = discover.run(undefined, { to: 'src/chain/base.ts', limit: 3 }, { tree: spied(asked), sourceIndex, root });
    expect(text).toContain('2 more not shown');
    expect(asked).toEqual(['src/chain/shell.ts']);
  });

  it('answers the files it reached, at no line and with no chain, when asked for the set', () => {
    const asked: string[] = [];
    const { files } = discover.files!(undefined, { to: 'src/chain/base.ts' }, { tree: spied(asked), sourceIndex, root });
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

describe('text, inside the files the other operands kept', () => {
  it('answers only files with a matching line', () => {
    const text = ask({ ...CONTEXTS, text: 'dark' });
    expect(text).toContain("  2: export const ThemeContext = createContext('dark');");
    expect(text).toContain(' src/state/theme.ts\n');
    expect(text).toContain('1 file in all of them');
    expect(text).not.toContain('src/state/user.ts');
  });
});

describe('discover refuses', () => {
  it('a question with nothing to cross', () => {
    expect(() => ask({})).toThrow('needs at least one set');
  });

  it('text alone, and teaches the start point it needs', () => {
    const refusal = (): string => ask({ text: 'dark' });
    expect(refusal).toThrow('Pass `from` or `to` with the file or folder you are working in');
    expect(refusal).not.toThrow('rg');
  });

  it('naming the sets as the surface it was asked on takes them', () => {
    const shell = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, sourceIndex, root, shell: 'variance ask' });
    expect(() => ask({})).toThrow('`discover` needs at least one set to cross: `from`, `to`, `imports`, `declares` or `path`.');
    expect(() => shell({})).toThrow('`discover` needs at least one set to cross: `--from`, `--to`, `--imports`, `--declares` or `--path`.');
    expect(() => shell({ text: 'dark' })).toThrow('`--text` searches inside the files the other sets kept');
  });

  it('a path the tree does not hold', () => {
    expect(() => ask({ from: 'src/Nope.tsx', declares: 'x' })).toThrow('`src/Nope.tsx` is not found');
  });

  it('a name operand when neither the host nor the tree names a source index', () => {
    expect(() => discover.run(undefined, CONTEXTS, { tree })).toThrow('are read from the source index, and the tree names no source index it was read off');
  });

  it('a name out of a file for want of a source index, not of names, which it does not read', () => {
    expect(() => discover.run(undefined, { imports: 'src/store/selectors.ts#selectBalance' }, { tree, sourceIndex, root })).toThrow('no source index is published');
  });

  it('a name out of a file when no source index holds who imports it', () => {
    expect(() => ask({ imports: 'src/store/selectors.ts#selectBalance' })).toThrow('read from the source index, and no source index is published; run `variance index`');
  });

  it('a pattern that is not a regular expression', () => {
    expect(() => ask({ declares: '(' })).toThrow('`declares` is not a regular expression the source index reads');
  });

  it('a question asked with no source tree read', () => {
    expect(() => discover.run(undefined, { path: 'x' }, { root })).toThrow('no source tree was read');
  });

  it('an import with nothing after its `#`', () => {
    expect(() => ask({ imports: 'react#' })).toThrow('`react#` has nothing after `#`');
  });
});
