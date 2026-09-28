import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updateSourceIndex } from '@variance-authority/sense';
import { afterEach, expect, it } from 'vitest';
import { dependencyApisAround, refreshDependencyApis } from './dependency-api.js';

const before = process.env['XDG_CACHE_HOME'];
afterEach(() => {
  if (before === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = before;
});

it('refreshes public APIs separately from source imports and retains unchanged declarations', async () => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-api-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-api-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files = {
    'package.json': JSON.stringify({ name: 'fixture', dependencies: { 'state-kit': '0.3.1', 'fancy-lib': '1.0.0' } }),
    'src/page.ts': "import { makeStore } from 'state-kit';\nexport const page = makeStore(1);\n",
  };
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  await updateSourceIndex(root);

  const installed = join(root, 'node_modules', 'state-kit');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'state-kit', version: '0.3.1', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(installed, 'index.js'), 'export const makeStore = (value) => value;\n');
  writeFileSync(join(installed, 'index.d.ts'), '/** Keep local state. */\nexport declare function makeStore<T>(value: T): T;\n');
  const unrelated = join(root, 'node_modules', 'fancy-lib');
  mkdirSync(unrelated, { recursive: true });
  writeFileSync(join(unrelated, 'package.json'), JSON.stringify({ name: 'fancy-lib', version: '1.0.0', types: 'index.d.ts' }));
  writeFileSync(join(unrelated, 'index.d.ts'), 'export declare function flashy(): void;\n');

  expect(dependencyApisAround(root, ['src/page.ts']).missing).toHaveLength(1);
  const first = refreshDependencyApis(root, ['src/page.ts']);
  expect(first).toMatchObject({ requests: 1, reused: 0, unavailable: 0, unread: 0 });
  const answer = dependencyApisAround(root, ['src/page.ts']);
  expect(answer.entries).toHaveLength(1);
  expect(answer.entries[0]?.api).toMatchObject({
    runtime: { name: 'state-kit', version: '0.3.1' },
    names: [{ name: 'makeStore', doc: 'Keep local state.' }],
  });
  expect(refreshDependencyApis(root, ['src/page.ts']).reused).toBe(1);

  writeFileSync(join(installed, 'index.d.ts'), '/** Use local state. */\nexport declare function makeStore<T>(value: T, id: string): T;\n');
  const changed = refreshDependencyApis(root, ['src/page.ts']);
  expect(changed.reused).toBe(0);
  expect(dependencyApisAround(root, ['src/page.ts']).entries[0]?.api.names?.[0]?.signature).toContain('id: string');
  expect(readFileSync(changed.path, 'utf8')).toContain('Use local state.');
});
