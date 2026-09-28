import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it } from 'vitest';
import { readDependencyApi } from './dependency.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('reads the installed package version, its public declaration names and JSDoc from the importer', () => {
  const root = mkdtempSync(join(tmpdir(), 'variance-dependency-api-'));
  roots.push(root);
  const site = join(root, 'src');
  const packageRoot = join(root, 'node_modules', 'state-kit');
  mkdirSync(site, { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(site, 'page.ts'), "import { makeStore } from 'state-kit';\n");
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'state-kit', version: '0.3.1', main: 'index.js', types: 'index.d.ts',
  }));
  writeFileSync(join(packageRoot, 'index.js'), 'export const makeStore = () => ({});\n');
  writeFileSync(join(packageRoot, 'index.d.ts'), "export { makeStore } from './store.js';\n");
  writeFileSync(join(packageRoot, 'store.d.ts'), '/** Keep state in the local store. */\nexport declare function makeStore<T>(value: T): T;\n');

  const first = readDependencyApi(root, 'src/page.ts', 'state-kit');
  assert.deepEqual(first.runtime && [first.runtime.name, first.runtime.version], ['state-kit', '0.3.1']);
  assert.deepEqual(first.declarations && [first.declarations.name, first.declarations.version], ['state-kit', '0.3.1']);
  assert.deepEqual(first.names?.map((name) => [name.name, name.signature, name.doc]), [
    ['makeStore', 'declare function makeStore<T>(value: T): T', 'Keep state in the local store.'],
  ]);
  assert.equal(readDependencyApi(root, 'src/page.ts', 'state-kit', first), first);

  writeFileSync(join(packageRoot, 'store.d.ts'), '/** Return a stateful value. */\nexport declare function makeStore<T>(value: T, id: string): T;\n');
  const changed = readDependencyApi(root, 'src/page.ts', 'state-kit', first);
  assert.notEqual(changed, first);
  assert.match(changed.names?.[0]?.signature ?? '', /id: string/u);
});

it('states when an imported package has no installed identity or declarations', () => {
  const root = mkdtempSync(join(tmpdir(), 'variance-dependency-api-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'page.ts'), "import { missing } from 'missing-package';\n");
  const reading = readDependencyApi(root, 'src/page.ts', 'missing-package');
  assert.equal(reading.runtime, undefined);
  assert.match(reading.unavailable ?? '', /could not resolve/u);
});
