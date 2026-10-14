import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { landCases, lastCaseRunOf, type LastCaseRun } from './case-landing.js';
import { recordOfCases, type CaseSections } from './case-record.js';
import { encodeExecutionIndex, decodeExecutionIndex } from './execution-format.js';
import { encodeRecordedEyes, decodeRecordedEyes } from './eyes-record.js';
import { writeCoverageBytes } from './record-location.js';
import { writeTestCoverage } from './index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const index = (id: string, file = `${id}.test.ts`) => encodeExecutionIndex({ tests: [{ id, file, name: id }], modules: [] });
const eyes = (attempt: number) => encodeRecordedEyes({ watched: ['a'], journals: [{ case: 'a', attempt, journal: { attempt } }] });
const last = (id: string, before = 'base'): LastCaseRun => ({ commit: 'head', before, at: `2020-01-0${id === 'a' ? 1 : 2}T00:00:00.000Z`, files: [`${id}.test.ts`], cases: [id], beforeTexts: { [`${id}.ts`]: 'recorded' } });
async function combine(parts: readonly CaseSections[]) {
  const root = await mkdtemp(join(tmpdir(), 'variance-artifact-sections-')); roots.push(root);
  const shards = [];
  for (const [at, sections] of parts.entries()) { const path = join(root, `${at}.bin`); await writeCoverageBytes(path, recordOfCases(sections)); shards.push({ path }); }
  return landCases(join(root, 'combined.bin'), {}, root, shards, undefined, undefined, undefined, () => true, true).sections;
}

it.each([false, true])('keeps explicit Eyes when another artifact did not collect it, in either order: %s', async (reverse) => {
  const parts = [{ index: index('a'), eyes: eyes(1) }, { index: index('a') }];
  const sections = await combine(reverse ? parts.reverse() : parts);
  expect(decodeRecordedEyes(sections.eyes!)).toEqual(decodeRecordedEyes(eyes(1)));
});
it('combines every recorded Eyes attempt through its existing deterministic encoder', async () => {
  const sections = await combine([{ index: index('a'), eyes: eyes(1) }, { index: index('a'), eyes: eyes(2) }]);
  expect(decodeRecordedEyes(sections.eyes!).journals.map((row) => row.attempt)).toEqual([1, 2]);
});
it('preserves a single recorded last run and its before provenance without synthesizing history', async () => {
  const named = last('a');
  const sections = await combine([{ index: index('a'), before: index('old', 'a.test.ts'), last: Buffer.from(JSON.stringify(named)) }]);
  expect(lastCaseRunOf(sections)).toEqual(named);
});
it('unions explicitly recorded last-run rows with compatible before provenance', async () => {
  const sections = await combine(['a', 'b'].map((id) => ({ index: index(id), before: index(`old-${id}`, `${id}.test.ts`), last: Buffer.from(JSON.stringify(last(id))) })));
  expect(lastCaseRunOf(sections)).toEqual({ commit: 'head', before: 'base', at: last('b').at, files: ['a.test.ts', 'b.test.ts'], cases: ['a', 'b'], beforeTexts: { 'a.ts': 'recorded', 'b.ts': 'recorded' } });
});
it('leaves absent last-run metadata absent', async () => {
  expect((await combine([{ index: index('a') }, { index: index('b') }])).last).toBeUndefined();
});
it('refuses contradictory recorded before commits instead of guessing a shared base', async () => {
  await expect(combine(['a', 'b'].map((id) => ({ index: index(id), before: index(`old-${id}`, `${id}.test.ts`), last: Buffer.from(JSON.stringify(last(id, id))) })))).rejects.toThrow('before commit');
});
it.each(['eyes', 'last'] as const)('refuses unreadable explicitly collected %s metadata', async (part) => {
  await expect(combine([{ index: index('a'), [part]: Uint8Array.of(1, 2, 3) }])).rejects.toThrow();
});
it('does not invalidate collected case sections when a complete coverage shard collected no cases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-artifact-uncased-')); roots.push(root);
  const first = join(root, 'cases.bin'), second = join(root, 'coverage.bin');
  await writeCoverageBytes(first, recordOfCases({ index: index('a'), eyes: eyes(1) }));
  const coverage = { version: 3 as const, instrumentation: 'fixture', tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }], modules: [] };
  await writeTestCoverage(second, coverage);
  const { sections } = landCases(join(root, 'combined.bin'), {}, root, [{ path: first }, { path: second, coverage }], undefined, undefined, undefined, () => true, true);
  expect(decodeExecutionIndex(sections.index!).tests.map((row) => row.id)).toEqual(['a']);
  expect(decodeRecordedEyes(sections.eyes!).journals).toHaveLength(1);
});
