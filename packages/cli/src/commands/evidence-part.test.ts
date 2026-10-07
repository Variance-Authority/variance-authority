import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectEvidence } from './collect.js';
import { collecting, planOf, rendered } from './evidence-fixture.js';
import { readEvidencePart, recipeOf, writeEvidencePart, type EvidencePart } from './evidence-part.js';
import { configOf } from './run-fixture.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evidence-part-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function part(): Promise<EvidencePart> {
  const plan = planOf([['button--primary', 'src/Button.stories.tsx'], ['card--default']]);
  const answer = (id: string) => (id === 'card--default' ? { ok: false as const, because: 'no theme' } : rendered(id, [{ owner: 'Button', text: 'Go' }]));
  return collectEvidence({
    collector: collecting(plan, answer).collector,
    config: configOf(),
    shard: { index: 1, total: 1 },
    build: { commit: 'c0ffee', storybook: 'sb' },
    recipe: recipeOf({ cli: 'test' }),
  });
}

describe('readEvidencePart: a part from disk, or why it is not one', () => {
  it('reads back the part it wrote', async () => {
    const written = await part();
    const path = join(root, 'evidence-1.json');
    await writeEvidencePart(path, written);

    expect(await readEvidencePart(path)).toEqual(written);
  });

  it('names the file it could not open, and the file that is not JSON', async () => {
    expect(await readEvidencePart(join(root, 'absent.json'))).toBe(`${join(root, 'absent.json')} could not be read (ENOENT)`);
    await writeFile(join(root, 'torn.json'), '{"format":');
    expect(await readEvidencePart(join(root, 'torn.json'))).toBe(`${join(root, 'torn.json')} is not JSON`);
  });

  it('refuses a file that is not a collection part', async () => {
    const path = join(root, 'suite-part.json');
    await writeFile(path, JSON.stringify({ version: 1, planned: 0, subjects: [] }));
    expect(await readEvidencePart(path)).toBe(`${path} is not a collection part this version reads`);
  });
});
