import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseEdgesOf } from './base-edges.js';

/**
 * At the checkout `src/a.ts` imports `./c` and `src/new.ts`, which the change
 * created; at the merge base it imported `./b`, and `./gone`, which the change
 * deleted. `src/same.ts` respelled its import of `./b` with an extension,
 * `src/two.ts` added a second import of `./b` beside the one it kept, and
 * `src/effect.ts` dropped a bare `import './c'`.
 */
const HEAD: Record<string, string> = {
  'src/a.ts': "import { c } from './c';\nimport { n } from './new';\nexport const a = c + n;\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/c.ts': 'export const c = 1;\n',
  'src/new.ts': 'export const n = 1;\n',
  'src/same.ts': "import { b } from './b.ts';\nexport const s = b;\n",
  'src/two.ts': "import { b } from './b';\nimport { b as again } from './b.ts';\nexport const t = b + again;\n",
  'src/effect.ts': 'export const e = 1;\n',
};
const BASE: Record<string, string> = {
  'src/a.ts': "import { b } from './b';\nimport { g } from './gone';\nexport const a = b + g;\n",
  'src/same.ts': "import { b } from './b';\nexport const s = b;\n",
  'src/gone.ts': 'export const g = 1;\n',
  'src/two.ts': "import { b } from './b';\nexport const t = b;\n",
  'src/effect.ts': "import './c';\nexport const e = 1;\n",
};
const RELATIONS = relationsOfFiles([
  { file: 'src/a.ts', edges: [{ to: 'src/c.ts', kind: 'imports' as const }, { to: 'src/new.ts', kind: 'imports' as const }] },
  { file: 'src/b.ts' },
  { file: 'src/c.ts' },
  { file: 'src/new.ts' },
  { file: 'src/same.ts', edges: [{ to: 'src/b.ts', kind: 'imports' as const }] },
  { file: 'src/two.ts', edges: [{ to: 'src/b.ts', kind: 'imports' as const }] },
  { file: 'src/effect.ts' },
]);
const id = (name: string) => RELATIONS.index.get(`file:${name}`)!;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-authority-base-edges-'));
  for (const [file, text] of Object.entries(HEAD)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the merge base walk, as the checkout with the change undone', () => {
  it('undoes an added import, restores a removed one and a bare one, leaves a respelling and a second import of a kept target alone, and names what it cannot read', () => {
    const edges = baseEdgesOf(root, RELATIONS, [
      { file: 'src/a.ts', before: BASE['src/a.ts']!, after: HEAD['src/a.ts']! },
      { file: 'src/new.ts', after: HEAD['src/new.ts']! },
      { file: 'src/gone.ts', before: BASE['src/gone.ts']! },
      { file: 'src/same.ts', before: BASE['src/same.ts']!, after: HEAD['src/same.ts']! },
      { file: 'src/two.ts', before: BASE['src/two.ts']!, after: HEAD['src/two.ts']! },
      { file: 'src/effect.ts', before: BASE['src/effect.ts']!, after: HEAD['src/effect.ts']! },
    ]);

    expect(edges.added).toEqual(new Map([[id('src/a.ts'), new Set([id('src/c.ts'), id('src/new.ts')])]]));
    expect(edges.removed).toEqual(new Map([[id('src/a.ts'), [id('src/b.ts')]], [id('src/effect.ts'), [id('src/c.ts')]]]));
    expect(edges.created).toEqual(new Set([id('src/new.ts')]));
    expect(edges.unknown).toEqual(new Set(['src/a.ts', 'src/gone.ts']));
  });
});
