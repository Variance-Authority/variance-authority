import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { queryDependencyLexicon, readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('indexes every declared available package, including one no source file imports, and refreshes changed declarations', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-lexicon-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-lexicon-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  for (const [path, value] of Object.entries({
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'], dependencies: { 'state-kit': '0.3.1', 'fancy-lib': '1.0.0', react: '19.0.0', globbing: '1.0.0' } }),
    'src/page.ts': "import { pulse } from 'undocumented-kit';\nexport const page = pulse();\n",
    'packages/alpha/package.json': JSON.stringify({ name: 'alpha', dependencies: { 'state-kit': '0.4.0' } }),
    'packages/alpha/src/page.ts': 'export const alpha = 1;\n',
    'packages/beta/package.json': JSON.stringify({ name: 'beta', dependencies: { 'fancy-lib': '1.0.0' } }),
    'packages/beta/src/page.ts': 'export const beta = 1;\n',
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  const installed = join(root, 'node_modules', 'state-kit');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'state-kit', version: '0.3.1', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(installed, 'index.js'), 'export const makeStore = (value) => value;\n');
  writeFileSync(join(installed, 'index.d.ts'), '/** Keep local state. */\nexport declare function makeStore<T>(value: T): T;\n');
  const alphaInstall = join(root, 'packages', 'alpha', 'node_modules', 'state-kit');
  mkdirSync(alphaInstall, { recursive: true });
  writeFileSync(join(alphaInstall, 'package.json'), JSON.stringify({ name: 'state-kit', version: '0.4.0', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(alphaInstall, 'index.js'), 'export const makeStore = (value) => value;\n');
  writeFileSync(join(alphaInstall, 'index.d.ts'), '/** Keep feature state. */\nexport declare function makeStore<T>(value: T): T;\n');
  const unrelated = join(root, 'node_modules', 'fancy-lib');
  mkdirSync(unrelated, { recursive: true });
  writeFileSync(join(unrelated, 'package.json'), JSON.stringify({ name: 'fancy-lib', version: '1.0.0', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(unrelated, 'index.js'), 'export const flashy = () => {};\n');
  writeFileSync(join(unrelated, 'index.d.ts'), 'export declare function flashy(): void;\n');
  const react = join(root, 'node_modules', 'react');
  mkdirSync(react, { recursive: true });
  writeFileSync(join(react, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0', main: 'index.js' }));
  writeFileSync(join(react, 'index.js'), 'export const useState = (value) => value;\n');
  const types = join(root, 'node_modules', '@types', 'react');
  mkdirSync(types, { recursive: true });
  writeFileSync(join(types, 'package.json'), JSON.stringify({ name: '@types/react', version: '19.0.1', types: 'index.d.ts' }));
  writeFileSync(join(types, 'index.d.ts'), 'export = React;\ndeclare namespace React {\n/** Read state. */\nfunction useState<T>(value: T): T;\n}\n');
  const globbing = join(root, 'node_modules', 'globbing');
  mkdirSync(globbing, { recursive: true });
  writeFileSync(join(globbing, 'package.json'), JSON.stringify({ name: 'globbing', version: '1.0.0', main: 'index.js' }));
  writeFileSync(join(globbing, 'index.js'), 'module.exports = () => true;\n');
  const globbingTypes = join(root, 'node_modules', '@types', 'globbing');
  mkdirSync(join(globbingTypes, 'lib'), { recursive: true });
  writeFileSync(join(globbingTypes, 'package.json'), JSON.stringify({ name: '@types/globbing', version: '1.0.1', types: 'index.d.ts' }));
  writeFileSync(join(globbingTypes, 'index.d.ts'), 'import globbing = require("./lib/globbing");\nexport = globbing;\n');
  writeFileSync(join(globbingTypes, 'lib', 'globbing.d.ts'), '/** Match a path. */\ndeclare function globbing(value: string): boolean;\nexport = globbing;\n');
  const observed = join(root, 'node_modules', 'undocumented-kit');
  mkdirSync(observed, { recursive: true });
  writeFileSync(join(observed, 'package.json'), JSON.stringify({ name: 'undocumented-kit', version: '1.0.0', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(observed, 'index.js'), 'export const pulse = () => true;\n');
  writeFileSync(join(observed, 'index.d.ts'), 'export declare function pulse(): boolean;\n');
  const transitive = join(root, 'node_modules', 'transitive-only');
  mkdirSync(transitive, { recursive: true });
  writeFileSync(join(transitive, 'package.json'), JSON.stringify({ name: 'transitive-only', version: '1.0.0', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(transitive, 'index.js'), 'export const unused = true;\n');
  writeFileSync(join(transitive, 'index.d.ts'), 'export declare const unused: true;\n');
  await updateSourceIndex(root);
  const first = refreshDependencyLexicon(root);
  expect(first).toMatchObject({ packages: 7, entrypoints: 6, reused: 0, unavailable: 0 });
  const read = readDependencyLexicon(root).lexicon;
  expect(read?.version).toBe(4);
  expect(read?.availability.map((entry) => [entry.owner, entry.specifier, entry.imported])).toEqual([
    ['package.json', 'fancy-lib', false], ['package.json', 'globbing', false], ['package.json', 'react', false], ['package.json', 'state-kit', false],
    ['package.json', 'undocumented-kit', true],
    ['packages/alpha/package.json', 'state-kit', false], ['packages/beta/package.json', 'fancy-lib', false],
  ]);
  expect(read?.entries.flatMap((entry) => entry.api.names?.map((name) => name.name) ?? []).sort()).toEqual(['React', 'flashy', 'globbing', 'makeStore', 'makeStore', 'pulse', 'useState']);
  expect(read?.availability.find((entry) => entry.package === 'undocumented-kit')?.declared).toBe(false);
  expect(read?.availability.some((entry) => entry.package === 'transitive-only')).toBe(false);
  expect(read?.entries.find((entry) => entry.api.runtime?.name === 'react')?.api.declarations?.name).toBe('@types/react');
  expect(queryDependencyLexicon(root, 'makeStore', ['packages/alpha/src/page.ts'])?.shown.map((match) => `${match.specifier}@${match.version}`)).toEqual(['state-kit@0.4.0']);
  expect(queryDependencyLexicon(root, 'makeStore', ['packages/beta/src/page.ts'])?.total).toBe(0);
  expect(queryDependencyLexicon(root, 'makeStore')?.total).toBe(2);
  expect(queryDependencyLexicon(root, 'useState', undefined, true, 'react')?.shown[0]?.declarationProvider).toBe('@types/react@19.0.1');
  expect(queryDependencyLexicon(root, 'globbing', undefined, true, 'globbing')?.shown[0]?.signature).toContain('value: string');
  writeFileSync(readDependencyLexicon(root).path, JSON.stringify({ ...read, version: 3 }));
  expect(refreshDependencyLexicon(root).reused).toBe(0);
  expect(refreshDependencyLexicon(root).reused).toBe(6);
  writeFileSync(join(installed, 'index.d.ts'), '/** Use local state. */\nexport declare function makeStore<T>(value: T, id: string): T;\n');
  expect(refreshDependencyLexicon(root).reused).toBe(5);
  expect(readDependencyLexicon(root).lexicon?.entries.find((entry) => entry.api.runtime?.name === 'state-kit')?.api.names?.[0]?.signature).toContain('id: string');
});

it('does not read an installed dependency nested beneath a selected package wildcard', () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-lexicon-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-lexicon-wildcard-'));
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { wildcard: '1.0.0' } }));
  execFileSync('git', ['add', '.'], { cwd: root });
  const installed = join(root, 'node_modules', 'wildcard');
  mkdirSync(join(installed, 'node_modules', 'nested'), { recursive: true });
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'wildcard', version: '1.0.0', exports: { '.': './public.d.ts', './*': './*' } }));
  writeFileSync(join(installed, 'public.d.ts'), "export declare const publicName: true;\nexport { privateName } from 'nested';\n");
  writeFileSync(join(installed, 'node_modules', 'nested', 'package.json'), JSON.stringify({ name: 'nested', version: '1.0.0', types: 'private.d.ts' }));
  writeFileSync(join(installed, 'node_modules', 'nested', 'private.d.ts'), 'export declare const privateName: true;\n');
  refreshDependencyLexicon(root);
  const specifiers = readDependencyLexicon(root).lexicon?.availability.map((entry) => entry.specifier);
  expect(specifiers).toContain('wildcard/public.d.ts');
  expect(specifiers?.some((specifier) => specifier.includes('/node_modules/'))).toBe(false);
  expect(queryDependencyLexicon(root, 'privateName')?.total).toBe(0);
});
