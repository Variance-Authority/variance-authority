import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import * as sense from '@variance-authority/sense';
import { afterEach, expect, it, vi } from 'vitest';
import { readHelp } from '../walk.js';
import { FoundNothing } from './find.js';
import { symbol } from './symbol.js';
import { uses } from './uses.js';

// compass: variance-authority.report.agent-surface

const temporary: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function fixture(extra: Readonly<Record<string, string>> = {}, published = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-member-files-')));
  const cache = mkdtempSync(join(tmpdir(), 'va-member-files-cache-'));
  temporary.push(root, cache);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', cache);
  execFileSync('git', ['init', '--quiet', root]);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'member-files', private: !published, exports: { '.': './src/widget.ts' } }));
  for (const [file, text] of Object.entries({
    'widget.ts': 'export interface Widget { completed: boolean; }\nexport const ready = true;\n',
    ...extra,
  })) writeFileSync(join(root, 'src', file), text);
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  return { root, help: readHelp(root) };
}

for (const tool of [symbol, uses]) {
  it(`${tool.name} keeps unread member languages beside the declarations it found`, async () => {
    const { root, help } = await fixture({ 'widget.rs': 'pub struct Widget { pub completed: bool }\n' });
    const input = { name: 'Widget.completed' };
    const answer = tool.run(help, input, { root });
    const membership = tool.files!(help, input, { root });
    expect([...membership.files]).toEqual([['src/widget.ts', [1]]]);
    const warning = membership.unread?.find((line) => line.includes("Rust files were not read"));
    expect(warning).toBeDefined();
    expect(answer).toContain(warning);
  });

  it(`${tool.name} leaves fully read TypeScript member coverage complete`, async () => {
    const { root, help } = await fixture();
    const membership = tool.files!(help, { name: 'Widget.completed' }, { root });
    expect([...membership.files]).toEqual([['src/widget.ts', [1]]]);
    expect(membership.unread).toBeUndefined();
    expect(() => tool.files!(help, { name: 'Missing.member' }, { root })).toThrow(FoundNothing);
  });

  it(`${tool.name} carries declarations the index did not read`, async () => {
    const { root, help } = await fixture();
    const read = sense.declaredOf;
    vi.spyOn(sense, 'declaredOf').mockImplementation((...args) => {
      const result = read(...args);
      return result === undefined ? undefined : { ...result, unread: ['src/unread.ts'] };
    });
    const input = { name: 'Widget.completed' };
    expect(tool.run(help, input, { root })).toContain('src/unread.ts');
    expect(tool.files!(help, input, { root }).unread?.join('\n')).toContain('src/unread.ts');
  });
}

it('symbol retains a known export while qualifying the source index it could not read', async () => {
  const { root, help } = await fixture();
  rmSync(sourceIndexPath(root));
  const membership = symbol.files!(help, { name: 'ready' }, { root });
  expect(membership.files.get('src/widget.ts')).toEqual([2]);
  expect(membership.unread?.join('\n')).toContain('no source index is published');
  // An unpublished export's import lookup already refuses the unread index.
  expect(() => uses.files!(help, { name: 'ready' }, { root })).toThrow('no source index is published');
});

it('a batched symbol membership keeps the member coverage and all positive files', async () => {
  const { root, help } = await fixture({
    'widget.rs': 'pub struct Widget { pub completed: bool }\n',
    'other.ts': 'export const other = true;\n',
  });
  const membership = symbol.files!(help, { name: ['other', 'Widget.completed'], limit: 1 }, { root });
  expect([...membership.files.keys()].sort()).toEqual(['src/other.ts', 'src/widget.ts']);
  expect(membership.unread?.join('\n')).toContain('Rust files were not read');
  expect(new Set(membership.unread).size).toBe(membership.unread?.length);
});

for (const published of [true, false]) {
  for (const selected of [true, false]) {
    it(`uses qualifies unread declarations beside an unused ${published ? 'published' : 'unpublished'} export${selected ? ' selected by file' : ''}`, async () => {
      const name = published ? 'ready' : 'other';
      const file = published ? 'src/widget.ts' : 'src/other.ts';
      const { root, help } = await fixture({
        'other.ts': 'export const other = true;\n',
        'opaque.ts': `const ${name} = false; export {};\n${'// filler line\n'.repeat(80_000)}`,
      }, published);
      const input = { name, ...(selected ? { file } : {}) };
      const membership = uses.files!(help, input, { root });
      expect([...membership.files]).toEqual([]);
      expect(membership.unread?.join('\n')).toContain('src/opaque.ts');
      const answer = uses.run(help, input, { root });
      expect(answer).toContain('src/opaque.ts');
      expect(answer).toContain(published ? 'is published' : 'without being published');
    });
  }
}
