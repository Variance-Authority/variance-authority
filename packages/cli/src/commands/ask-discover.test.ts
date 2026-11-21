import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discover } from '@variance-authority/help/tools';
import { readTree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from './ask-packages.fixture.js';
import { askSource, type SourceRequest } from './ask.js';

/**
 * `variance ask discover` reads its tree and its names from what `variance
 * index` published, and nothing else: a file edited since answers as the index
 * read it, and the index is not written. A file the index serves is not a file
 * that declares nothing.
 *
 * Asked as `variance ask` asks it, from the checkout's root and with the flags
 * as the command line carries them, so the question reaches the reading that
 * holds names and every set reaches the tool.
 */

const cwd = process.cwd();
let root: string;
const firstLine = `export const marker = 'needle: ${'source evidence '.repeat(10)}';`;
const secondLine = "export const marker = 'needle: second file';";

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ask-discover-'));
  write('package.json', '{"name":"ask-discover-fixture","private":true}\n');
  write('src/Wallet.ts', "import { selectBalance } from './store';\nexport const balance = selectBalance;\n");
  write('src/store/index.ts', "import { selectBalance } from './selectors';\nexport { selectBalance };\n");
  write('src/store/selectors.ts', 'export const selectBalance = (state: { balance: number }) => state.balance;\n');
  write('src/old/selectors.ts', 'export const selectBalance = () => 0;\n');
  write('src/Nav.ts', "import { useTheme } from './theme';\nexport const nav = useTheme;\n");
  write('src/theme.ts', "const ThemeContext = { theme: 'light' };\nexport const useTheme = () => ThemeContext;\n");
  write('src/deep/feature/first.ts', `${firstLine}\n// needle: keep this line too\n`);
  write('src/deep/feature/second.ts', `${secondLine}\n// needle: the same line number belongs to this file\n`);
  // `greet` reaches its users through two barrels; `wave` passes through the same ones.
  write('src/lib/greet.ts', "export const greet = () => 'hi';\nexport const wave = () => 'o/';\n");
  write('src/lib/index.ts', "export { greet, wave } from './greet';\n");
  write('src/lib/all.ts', "export * from './index';\n");
  write('src/Hello.ts', "import { greet } from './lib';\nexport const hello = greet;\n");
  write('src/Deep.ts', "import { greet } from './lib/all';\nexport const deep = greet;\n");
  write('src/Waver.ts', "import { wave } from './lib';\nexport const waver = wave;\n");
  write('src/Page.ts', "import { hello } from './Hello';\nexport const page = hello;\n");
  // An ES module loads CommonJS through what `createRequire` made, whatever its name.
  write('src/legacy.cjs', 'exports.size = 1;\n');
  const made = "import { createRequire } from 'node:module';\n";
  write('src/Required.mts', `${made}const require = createRequire(import.meta.url);\nexport const { size } = require('./legacy.cjs');\n`);
  write('src/Loaded.mts', `${made}const load = createRequire(import.meta.url);\nexport const { size } = load('./legacy.cjs');\n`);
  write('src/Inline.mts', `${made}export const { size } = createRequire(import.meta.url)('./legacy.cjs');\n`);
  const commit = (...args: string[]): void => void execFileSync('git', ['-C', root, ...args]);
  commit('init', '--quiet');
  commit('add', '.');
  commit('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'fixture');
  process.chdir(root);
  const { code, err } = await run(['index']);
  if (code !== 0) throw new Error(`variance index failed on the fixture: ${err}`);
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

const ask = (flags: Omit<SourceRequest, 'question'>): Promise<string> => askSource({ question: 'discover', ...flags });
const declaresBalance = (): Promise<string> => ask({ declares: '^selectBalance$', from: 'src/Wallet.ts' });

describe('ask discover over a checkout', () => {
  it('prints each file once above every matching evidence line', async () => {
    const text = await ask({ path: '^src/deep/feature/', text: 'needle' });
    expect(text).toContain('2 files in all of them:');
    expect(text).toContain(`\nsrc/deep/feature/first.ts\n  1: ${firstLine.trimStart()}\n  2: // needle: keep this line too`);
    expect(text).toContain(`\nsrc/deep/feature/second.ts\n  1: ${secondLine.trimStart()}\n  2: // needle: the same line number belongs to this file`);
    expect(text).not.toContain('  src/deep/feature/');
    expect(text.indexOf('\nsrc/deep/feature/first.ts\n')).toBeLessThan(text.indexOf('\nsrc/deep/feature/second.ts\n'));
  });

  it('finds the declaration a file can reach, among every file declaring the name, past the barrel that re-exports it', async () => {
    const text = await declaresBalance();
    expect(text).toContain('2 files declaring a name matching /^selectBalance$/i');
    expect(text).toContain('\n2 src/store/selectors.ts\n  1: declares selectBalance');
    expect(text).not.toContain('src/old/selectors.ts');
    expect(text).not.toContain('src/store/index.ts');
  });

  it('takes out the files an `--except-` set names', async () => {
    const text = await ask({ declares: '^selectBalance$', exceptPath: '/store/' });
    expect(text).toContain('src/old/selectors.ts\n  1: declares selectBalance');
    expect(text).not.toContain('src/store/selectors.ts');
  });

  it('finds who imports a name out of a file through the barrel that passes it on, as `uses` does', async () => {
    const text = await ask({ imports: 'src/store/selectors.ts#selectBalance' });
    expect(text).toContain('2 files importing `selectBalance` from `src/store/selectors.ts`, through 1 file that passes it on');
    expect(text).toContain('src/Wallet.ts\n  1: imports selectBalance from ./store');
    expect(text).toContain('src/store/index.ts\n  1: imports selectBalance from ./selectors');
  });

  it('finds what rests on a name out of a file, through the barrels that pass it on, and not what imports another name through them', async () => {
    const text = await ask({ to: 'src/lib/greet.ts#greet' });
    expect(text).toContain('4 files reaching `greet` from `src/lib/greet.ts`, through 2 files that pass it on');
    expect(text).toContain('1 src/Hello.ts\n  1: imports greet from ./lib');
    expect(text).toContain('1 src/Deep.ts\n  1: imports greet from ./lib/all');
    expect(text).toContain('\n2 src/Page.ts → src/Hello.ts:1 imports greet from ./lib\n');
    expect(text).not.toContain('src/Waver.ts');
    expect(text).not.toContain('src/lib/index.ts');
  });

  it('finds a module that loads a file through a function `createRequire` made, bound to any name or called inline', async () => {
    const text = await ask({ to: 'src/legacy.cjs' });
    expect(text).toMatch(/^1 src\/Required\.mts$/m);
    expect(text).toMatch(/^1 src\/Loaded\.mts$/m);
    expect(text).toMatch(/^1 src\/Inline\.mts$/m);
  });

  it('crosses paths alone, with no names to read', async () => {
    const text = await ask({ from: 'src/Wallet.ts', path: '^src/store/' });
    expect(text).toContain('2 files in all of them');
    expect(text).toContain('src/store/selectors.ts');
    expect(text).not.toContain('src/old/selectors.ts');
  });

  it('answers a name set for a host that hands it the tree and the checkout alone, as the MCP server does', async () => {
    const tree = await readTree({ root });
    const asked = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, root });
    expect(asked({ declares: '^selectBalance$' })).toContain('src/old/selectors.ts\n  1: declares selectBalance');
    const text = asked({ imports: ['node:module'], exceptImports: ['./legacy.cjs'] });
    expect(text).toContain('3 files importing `node:module`');
    expect(text).toContain('3 files importing `./legacy.cjs`, taken out');
    expect(text.split('\n')[0]).toBe('No file is in all of them:');
  });

  it('asks the source index for no names when every import set names a name out of a repository file, which its edges answer', async () => {
    // A tree that names no index refuses any set the names filter answers, so a set it answers asked none.
    const { index: _, ...tree } = await readTree({ root });
    const asked = (input: Record<string, unknown>): string => discover.run(undefined, input, { tree, root });
    const named = { imports: ['src/store/selectors.ts#selectBalance'], exceptImports: ['src/lib/greet.ts#wave'] };
    expect(asked(named)).toContain('importing `selectBalance` from `src/store/selectors.ts`');
    expect(() => asked({ ...named, imports: [...named.imports, './store'] })).toThrow('names no source index');
    expect(() => asked({ ...named, exceptImports: ['react'] })).toThrow('names no source index');
  });

  it('finds a declaration the file does not export, which is where a context is made', async () => {
    const text = await ask({ declares: '^ThemeContext$', from: 'src/Nav.ts' });
    expect(text).toContain('\n1 src/theme.ts\n  1: declares ThemeContext');
  });

  it('answers from the names `variance index` published after a file is edited, and writes no index', async () => {
    const published = readFileSync(sourceIndexPath(root));
    const selectors = 'src/store/selectors.ts';
    const text = readFileSync(join(root, selectors), 'utf8');
    write(selectors, `// moved\n// down\n${text}`);
    try {
      expect(await declaresBalance()).toContain('\n2 src/store/selectors.ts\n  1: declares selectBalance');
    } finally {
      write(selectors, text);
    }
    expect(readFileSync(sourceIndexPath(root)).equals(published)).toBe(true);
  });

  it('dates its answer with the generation it read, as every other source answer is', async () => {
    const { code, out } = await run(['ask', 'discover', '--declares', '^selectBalance$']);
    expect(code).toBe(0);
    expect(out).toMatch(/^Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\.$/mu);
  });

  // Last in the block: it publishes a generation the cases above do not read.
  it('reads the names of a file `--changed-file` names into a new generation before it answers', async () => {
    write('src/store/selectors.ts', 'export const selectBalance = (state: { balance: number }) => state.balance;\nexport const selectDebt = () => 0;\n');
    write('changed.txt', 'src/store/selectors.ts\n');
    const { code, out } = await run(['ask', 'discover', '--declares', '^selectDebt$', '--changed-file', join(root, 'changed.txt')]);
    expect(code).toBe(0);
    expect(out).toContain('src/store/selectors.ts\n  2: declares selectDebt');
  });
});

describe('ask discover with nothing published', () => {
  it('refuses in a line that names `variance index`, and publishes nothing', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'ask-discover-bare-'));
    try {
      writeFileSync(join(bare, 'package.json'), '{"name":"bare","private":true}\n');
      writeFileSync(join(bare, 'a.ts'), 'export const a = 1;\n');
      process.chdir(bare);
      await expect(ask({ declares: '^a$' })).rejects.toThrow(/Run `variance index`/u);
      await expect(ask({ path: '^a' })).rejects.toThrow(/Run `variance index`/u);
      expect(existsSync(sourceIndexPath(bare))).toBe(false);
    } finally {
      process.chdir(root);
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('ask discover in a workspace whose member sits beside it', () => {
  it('reads the names of the index that workspace was published from, spelled as its tree spells them', async () => {
    const repository = mkdtempSync(join(tmpdir(), 'ask-discover-beside-'));
    const put = (file: string, text: string): void => {
      mkdirSync(dirname(join(repository, file)), { recursive: true });
      writeFileSync(join(repository, file), text);
    };
    try {
      put('app/package.json', '{"name":"app","private":true,"workspaces":["../lib"]}\n');
      put('app/src/a.ts', 'export const appThing = 1;\n');
      put('lib/package.json', '{"name":"lib","version":"1.0.0","exports":"./b.ts"}\n');
      put('lib/b.ts', 'export const libThing = 2;\n');
      const commit = (...args: string[]): void => void execFileSync('git', ['-C', repository, ...args]);
      commit('init', '--quiet');
      commit('add', '.');
      commit('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'fixture');
      process.chdir(join(repository, 'app'));
      expect((await run(['index'])).code).toBe(0);
      const text = await ask({ declares: 'Thing$' });
      expect(text).toContain('src/a.ts\n  1: declares appThing');
      expect(text).toContain('lib/b.ts\n  1: declares libThing');
    } finally {
      process.chdir(root);
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
