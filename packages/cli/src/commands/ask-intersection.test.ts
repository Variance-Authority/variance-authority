import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
import { askSource } from './ask.js';

/**
 * `variance ask intersection` takes whole questions, each typed as it would be
 * asked alone, and answers the files all of them answer. The checkout declares
 * `selectBalance` twice, and only one of the two is reached from the wallet
 * that uses it — so a question about the name and a question about the wallet
 * agree on exactly one file, and an answer holding the other dropped one of
 * them.
 */

const RG = spawnSync('rg', ['--version']).error === undefined;

const cwd = process.cwd();
let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ask-intersection-'));
  write('package.json', '{"name":"ask-intersection-fixture","private":true}\n');
  write('src/Wallet.ts', "import { selectBalance } from './store';\nexport const balance = selectBalance;\n");
  write('src/store/index.ts', "import { selectBalance } from './selectors';\nexport { selectBalance };\n");
  write('src/store/selectors.ts', 'export const selectBalance = (state: { balance: number }) => state.balance;\n');
  write('src/old/selectors.ts', 'export const selectBalance = () => 0;\n');
  const commit = (...args: string[]): void => void execFileSync('git', ['-C', root, ...args]);
  commit('init', '--quiet');
  commit('add', '.');
  commit('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'fixture');
  process.chdir(root);
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

const ask = (...reports: string[]): Promise<string> => askSource({ question: 'intersection', reports });

describe('ask intersection over a checkout', () => {
  it('finds the declaration of a name among every one, by what a file reaches', async () => {
    const text = await ask('symbol --name selectBalance', 'discover --from src/Wallet.ts');
    expect(text).toContain('1. `symbol --name selectBalance`: 2 files');
    expect(text).toContain('1 file in all of them.');
    expect(text).toContain('src/store/selectors.ts — 1: line 1 · 2: the file');
    expect(text).not.toContain('src/old/selectors.ts —');
  });

  it('crosses the files that import a name, at the lines that do', async () => {
    const text = await ask('uses --name selectBalance', 'discover --path ^src/Wallet');
    expect(text).toContain('1 file in all of them.');
    expect(text).toContain('src/Wallet.ts — 1: line 1 · 2: the file');
  });

  it('crosses the files a search finds, and spells each question back so it can be pasted', async () => {
    const text = await ask('search --query balance', "discover --path '^src/' --except-path old");
    expect(text).toContain('2. `discover --path ^src/ --except-path old`: 3 files');
    expect(text).toContain('3 files in all of them.');
    expect(text).toContain('src/store/selectors.ts — 1: line 1 · 2: the file');
    expect(text).not.toContain('src/old/selectors.ts —');
  });

  it.skipIf(!RG)('reads the names a question needs, and the tree another needs', async () => {
    const text = await ask("discover --declares '^selectBalance$'", 'grep --query state --from src/Wallet.ts');
    expect(text).toContain('1 file in all of them.');
    expect(text).toContain('src/store/selectors.ts — 1: line 1 · 2: line 1');
  });

  it.skipIf(!RG)('keeps every line a grep matched in one file', async () => {
    const text = await ask('grep --query selectBalance --from src/Wallet.ts', 'discover --path ^src/Wallet');
    expect(text).toContain('src/Wallet.ts — 1: lines 1, 2 · 2: the file');
  });

  it('reaches along a taint table while another question reads the names', async () => {
    const taintFile = join(root, 'loaders.json');
    writeFileSync(taintFile, JSON.stringify({ 'src/Wallet.ts': { '+': ['./old/selectors'] } }));
    const text = await askSource({
      question: 'intersection',
      reports: ["discover --declares '^selectBalance$'", 'discover --from src/Wallet.ts'],
      taintFile,
    });
    expect(text).toContain('2 files in all of them.');
    expect(text).toContain('src/old/selectors.ts — 1: line 1 · 2: the file');
  });

  it('takes `--limit` for itself', async () => {
    const text = await askSource({ question: 'intersection', reports: ['discover --path ^src/', 'discover --path selectors'], limit: 1 });
    expect(text).toContain('2 files in all of them.');
    expect(text).toContain('1 more not shown');
  });
});

describe('ask intersection over a name nothing declares', () => {
  it('answers that no file is in all of them, names the question that found nothing, and exits 0', async () => {
    let out = '';
    let err = '';
    const code = await main(['ask', 'intersection', 'symbol --name selectBalance', 'uses --name nothingByThisName'], {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    });
    expect({ code, err }).toEqual({ code: EXIT_CLEAN, err: '' });
    expect(out).toContain('1. `symbol --name selectBalance`: 2 files');
    expect(out).toMatch(/2\. `uses --name nothingByThisName`: 0 files — .*nothingByThisName/u);
    expect(out).toContain('No file is in all of them.');
  });
});

describe('ask intersection refuses what it cannot cross', () => {
  it('refuses fewer than two questions', async () => {
    await expect(ask('symbol --name selectBalance')).rejects.toThrow(/two or more questions/);
  });

  it('refuses a question that names nothing to ask', async () => {
    await expect(ask('', 'symbol --name selectBalance')).rejects.toThrow(/question 1, ``: a question names what it asks/);
  });

  it('refuses a question about a run', async () => {
    await expect(ask('summary', 'symbol --name selectBalance')).rejects.toThrow(/question 1, `summary`: .*about a run, not the source/);
  });

  it('refuses a question whose answer is not a set of files', async () => {
    await expect(ask('packages', 'symbol --name selectBalance')).rejects.toThrow(/`packages` answers no set of files; the questions that do: symbol, uses, search, grep, discover$/);
  });

  it('refuses a flag the question does not take, saying which question', async () => {
    await expect(ask('symbol --name selectBalance', 'discover --form src/Wallet.ts')).rejects.toThrow(/question 2, `discover --form src\/Wallet.ts`: .*`--form`/);
  });

  it('refuses a word left over inside a question', async () => {
    await expect(ask('symbol --name select Balance', 'discover --from src/Wallet.ts')).rejects.toThrow(/question 1, .*`Balance` is not an argument/);
  });

  it('refuses an intersection inside an intersection', async () => {
    await expect(ask("intersection 'symbol --name a' 'symbol --name b'", 'symbol --name selectBalance')).rejects.toThrow(/question 1, .*`intersection` answers no set of files/);
  });

  it.each(['--changed-file', '--taint-file', '--just-answer', '--format', '--at', '--claims', '--config'])(
    'refuses `%s` inside a question, which is said once for the reading',
    async (flag) => {
      await expect(ask(`symbol --name selectBalance ${flag} x`, 'discover --from src/Wallet.ts')).rejects.toThrow(
        new RegExp(`question 1, .*\`${flag}\` is said once, after \`intersection\` and outside the quotes`),
      );
    },
  );

  it('refuses a quote left open', async () => {
    await expect(ask("discover --declares '^select", 'symbol --name selectBalance')).rejects.toThrow(/question 1: .*never closes it/);
  });
});
