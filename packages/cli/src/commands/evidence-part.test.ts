import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectEvidence } from './collect.js';
import { collecting, planOf, rendered } from './evidence-fixture.js';
import { malformed, readEvidencePart, recipeOf, writeEvidencePart, type EvidencePart } from './evidence-part.js';
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

/** `value` with `change` laid over it, as JSON would hold it. */
function altered(value: EvidencePart, change: (json: Record<string, unknown>) => void): unknown {
  const json = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  change(json);
  return json;
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

  it('says what is wrong with a value that is not a whole part', async () => {
    const valid = await part();
    expect(malformed(valid)).toBeUndefined();

    const cases: [string, (json: Record<string, unknown>) => void, RegExp][] = [
      ['a newer version', (json) => (json['version'] = 99), /it is version 99, and this reads \d+/],
      ['a build that is not strings', (json) => (json['build'] = { commit: 1 }), /its build is malformed/],
      ['a recipe with no digest', (json) => (json['recipe'] = { reads: {} }), /its recipe is malformed/],
      ['a recipe edited after it was digested', (json) => ((json['recipe'] as { reads: unknown }).reads = { cli: 'other' }), /its recipe does not match its digest/],
      ['a plan with no subjects', (json) => delete (json['plan'] as Record<string, unknown>)['subjects'], /its plan is malformed/],
      ['a plan entry with no id', (json) => ((json['plan'] as { subjects: unknown[] }).subjects[0] = {}), /its plan holds an entry with no id/],
      ['an exclusion with no reason', (json) => ((json['plan'] as { excluded: unknown[] }).excluded = [{ subject: 'x' }]), /its plan holds an exclusion with no reason/],
      ['a plan edited after it was digested', (json) => ((json['plan'] as { subjects: unknown[] }).subjects.pop()), /its plan does not match its digest/],
      ['a shard past its total', (json) => (json['shard'] = { index: 3, total: 2 }), /its shard .* is not k\/n with 1 ≤ k ≤ n/],
      ['an assignment by cost', (json) => (json['assignment'] = { by: 'cost' }), /its assignment is not one this version reads/],
      ['a scope that is not a string', (json) => (json['scope'] = 7), /its scope is malformed/],
      ['an outcome past the plan', (json) => ((json['outcomes'] as { position: number }[])[0]!.position = 9), /it holds a malformed outcome/],
      ['a failure with no reason', (json) => delete (json['outcomes'] as Record<string, unknown>[])[1]!['because'], /it holds a malformed outcome/],
      ['a row with no instances', (json) => delete (json['subjects'] as Record<string, unknown>[])[0]!['instances'], /it holds a malformed subject/],
      ['a field this version does not know', (json) => (json['fields'] = ['colour']), /its fields are malformed/],
      ['a declaring file that is not a list', (json) => (json['declaredIn'] = { Button: 'src/Button.tsx' }), /its declaredIn is malformed/],
      ['a diagnostic with no severity', (json) => (json['diagnostics'] = [{ code: 'x', message: 'y' }]), /its diagnostics are malformed/],
      ['no timings', (json) => delete json['acquisition'], /its timings are malformed/],
    ];
    for (const [name, change, expected] of cases) expect(malformed(altered(valid, change)), name).toMatch(expected);
  });
});
