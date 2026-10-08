import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readHelp } from '@variance-authority/package/help';
import { readDependencyLexicon, refreshDependencyLexicon, queryDependencyLexicon } from './dependency-lexicon.js';
import { HELP_TOOLS } from './tools.js';

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
let root = '';

beforeAll(async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-readme-cache-'));
  const untyped = (name: string, readme?: string) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '2.0.0', main: 'index.js' }),
    [`node_modules/${name}/index.js`]: 'module.exports = { spin() {} };\n',
    ...(readme === undefined ? {} : { [`node_modules/${name}/README.md`]: readme }),
  });
  root = await build(mkdtempSync(join(tmpdir(), 'va-readme-fixture-')), {
    'package.json': JSON.stringify({ name: 'fixture', dependencies: { 'bare-kit': '2.0.0', 'door-kit': '3.0.0', 'mute-kit': '2.0.0', 'note-kit': '2.0.0' } }),
    'src/page.ts': "import { spin } from 'bare-kit';\nimport { hush } from 'mute-kit';\nexport const page = [spin, hush];\n",
    'src/boot.ts': "import { wake } from 'door-kit';\nwake();\n",
    // A typed main entry beside subpaths that declare nothing: `./boot` and its
    // `.js` twin share one empty declaration file, `./cli` has none at all.
    'node_modules/door-kit/package.json': JSON.stringify({
      name: 'door-kit', version: '3.0.0',
      exports: { '.': { types: './index.d.ts', default: './index.js' }, './boot': './boot.js', './boot.js': './boot.js', './cli': './cli.js' },
    }),
    'node_modules/door-kit/index.js': 'exports.wake = () => {};\n',
    'node_modules/door-kit/index.d.ts': '/** Wakes the kit before anything else runs. */\nexport declare function wake(): void;\n',
    'node_modules/door-kit/boot.js': "require('./index.js').wake();\n",
    'node_modules/door-kit/boot.d.ts': 'export {};\n',
    'node_modules/door-kit/cli.js': 'module.exports = {};\n',
    'node_modules/door-kit/README.md': '# door-kit\n\nCall `wake` first, or import `door-kit/boot`.\n',
    ...untyped('bare-kit', '# bare-kit\n\nSmall helpers.\n\nCall `spin` to turn the wheel once.\nIt returns nothing.\n'),
    ...untyped('mute-kit'),
    ...untyped('note-kit', '# note-kit\n\nRun it once `wake` has returned.\n'),
  });
});

async function build(at: string, files: Record<string, string>): Promise<string> {
  execFileSync('git', ['init', '--quiet', at]);
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), value);
  }
  execFileSync('git', ['add', '.'], { cwd: at });
  await updateSourceIndex(at);
  await refreshDependencyLexicon(at);
  return at;
}

afterAll(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

function ask(args: Record<string, unknown>, at = root): string {
  const tool = HELP_TOOLS.find((candidate) => candidate.name === 'docs_symbol');
  if (tool === undefined) throw new Error('no docs_symbol tool');
  return tool.run(readHelp(at), args, { root: at });
}

it('records the README beside an unavailable package, and none beside one that ships none', () => {
  const entries = readDependencyLexicon(root).lexicon?.entries ?? [];
  const readmes = entries.map((entry) => [entry.api.runtime?.name, entry.api.readme?.at, entry.api.readme?.lines]);
  expect(readmes).toContainEqual(['bare-kit', 'node_modules/bare-kit/README.md', 6]);
  expect(readmes).toContainEqual(['mute-kit', undefined, undefined]);
});

it('says where the README is when the caller names the package, whether or not it names the symbol', () => {
  const text = ask({ name: 'hush', package: 'bare-kit' });
  expect(text).toContain('bare-kit@2.0.0 — the project resolver found no declarations for `bare-kit`');
  expect(text).toContain('README: node_modules/bare-kit/README.md (6 lines)');
  expect(text).not.toContain('names `hush`');
});

it('labels the passage as the package README and never as a doc comment', () => {
  const text = ask({ name: 'spin' });
  expect(text).toContain('node_modules/bare-kit/README.md:5 names `spin`:');
  expect(text).toContain('Call `spin` to turn the wheel once.');
  expect(text).not.toContain('mute-kit');
});

it('says a package with no README ships none, when asked about it by name', () => {
  expect(ask({ name: 'hush', package: 'mute-kit' })).toContain('It ships no README.md beside its manifest.');
});

it('answers a declared name from its declaration alone, not from the doors of the same package that declare nothing', () => {
  const text = ask({ name: 'wake', package: 'door-kit' });
  expect(text.startsWith('door-kit · wake [function] · door-kit@3.0.0')).toBe(true);
  expect(text).toContain('Wakes the kit before anything else runs.');
  expect(text).not.toMatch(/door-kit\/(boot|cli)/);
  expect(text).not.toContain('README');
});

it('puts a declared match before another package that falls back to its README', () => {
  const text = ask({ name: 'wake' });
  expect(text.startsWith('door-kit · wake [function] · door-kit@3.0.0')).toBe(true);
  expect(text).toContain('note-kit · note-kit@2.0.0 — the project resolver found no declarations for `note-kit`');
  expect(text).toContain('node_modules/note-kit/README.md:3 names `wake`:');
  expect(text).not.toMatch(/door-kit\/(boot|cli)/);
});

it('prints a silent package README once, under every door that falls back to it', () => {
  const text = ask({ name: 'sleep', package: 'door-kit' });
  expect(text.split('README: node_modules/door-kit/README.md').length - 1).toBe(1);
  expect(text).toContain('door-kit/boot · door-kit@3.0.0 — the declarations for `door-kit/boot` publish no names');
  expect(text).toContain('door-kit/boot.js · door-kit@3.0.0');
  expect(text).toContain('door-kit/cli · door-kit@3.0.0 — the project resolver found no declarations for `door-kit/cli`');
});

it('keeps the README of another installed copy of the same version, whose declarations are missing', async () => {
  // One `door-kit@3.0.0` declares `wake`; a second copy of that version, in a
  // sibling workspace, ships no declarations and only its README names it.
  const twin = await build(mkdtempSync(join(tmpdir(), 'va-readme-twin-')), {
    'package.json': JSON.stringify({ name: 'twin', workspaces: ['typed', 'legacy'] }),
    'typed/package.json': JSON.stringify({ name: 'typed', dependencies: { 'door-kit': '3.0.0' } }),
    'typed/boot.ts': "import { wake } from 'door-kit';\nwake();\n",
    'typed/node_modules/door-kit/package.json': JSON.stringify({ name: 'door-kit', version: '3.0.0', types: './index.d.ts', main: './index.js' }),
    'typed/node_modules/door-kit/index.js': 'exports.wake = () => {};\n',
    'typed/node_modules/door-kit/index.d.ts': 'export declare function wake(): void;\n',
    'legacy/package.json': JSON.stringify({ name: 'legacy', dependencies: { 'door-kit': '3.0.0' } }),
    'legacy/main.js': "require('door-kit').wake();\n",
    'legacy/node_modules/door-kit/package.json': JSON.stringify({ name: 'door-kit', version: '3.0.0', main: './index.js' }),
    'legacy/node_modules/door-kit/index.js': 'exports.wake = () => {};\n',
    'legacy/node_modules/door-kit/README.md': '# door-kit\n\nCall `wake` before anything else.\n',
  });
  const text = ask({ name: 'wake', package: 'door-kit' }, twin);
  expect(text.startsWith('door-kit · wake [function] · door-kit@3.0.0')).toBe(true);
  expect(text).toContain('README: legacy/node_modules/door-kit/README.md');
  expect(text).toContain('legacy/node_modules/door-kit/README.md:3 names `wake`:');
});

it('answers a lexicon written before READMEs were recorded as it did, and says nothing about one', () => {
  const path = readDependencyLexicon(root).path;
  const old = JSON.parse(readFileSync(path, 'utf8')) as { version: number; entries: { api: Record<string, unknown> }[] };
  old.version = 4;
  for (const entry of old.entries) delete entry.api['readme'];
  writeFileSync(path, JSON.stringify(old));

  const answer = queryDependencyLexicon(root, 'spin', undefined, true);
  expect(answer?.total).toBe(0);
  expect(answer?.silent?.every((one) => one.readme === undefined)).toBe(true);
  expect(() => ask({ name: 'spin' })).toThrow(/ask `search`/);
});
