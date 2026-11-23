import assert from 'node:assert/strict';
import { test } from 'vitest';
import { stringify } from 'yaml';
import { candidateCatalog } from './catalog.mjs';

const evidence = (files, extra = {}) => ({ step: 'seed', observation: {
  status: 'answered', membershipStatus: 'complete',
  ...(files === undefined ? {} : { files: files.map(file => ({ file, lines: [1] })) }), ...extra,
} });
const bytes = value => Buffer.byteLength(stringify(value));

test('catalog exposes recorded paths independently of canonical answer admission', () => {
  const rows = [evidence(['src/Panel.ts'], { answer: 'detail'.repeat(2000) }),
    evidence(['src/Panel.ts', 'src/state.mock.ts'], { membershipStatus: 'incomplete',
      unread: ['an import was not resolved'], qualifications: { 'src/Panel.ts': ['partial'] } })];
  const original = structuredClone(rows);
  const result = candidateCatalog(rows, 2000);
  assert.deepEqual(result.payload.files, [
    { file: 'src/Panel.ts', evidence: [0, 1] }, { file: 'src/state.mock.ts', evidence: [1] },
  ]);
  assert.equal(result.payload.observations[1].membershipStatus, 'incomplete');
  assert.deepEqual(result.payload.observations[1].unread, rows[1].observation.unread);
  assert.deepEqual(result.payload.observations[1].qualifications, rows[1].observation.qualifications);
  assert.equal(result.payloadBytes, bytes(result.payload));
  assert.equal(result.omittedFiles, 0);
  assert.equal(result.omittedObservations, 0);
  assert.deepEqual(rows, original);
  assert.ok(!stringify(result).includes('detail'));
});

test('unknown membership, measured empty membership and reader refusal stay distinct', () => {
  const result = candidateCatalog([
    evidence(undefined, { membershipStatus: 'unknown', membershipError: { message: 'unavailable' } }),
    evidence([]), evidence(undefined, { status: 'error', membershipStatus: 'unknown', error: { message: 'refused' } }),
  ], 2000);
  assert.equal(result.payload.observations[0].fileCount, undefined);
  assert.equal(result.payload.observations[1].fileCount, 0);
  assert.deepEqual(result.payload.observations[0].membershipError, { message: 'unavailable' });
  assert.deepEqual(result.payload.observations[2].error, { message: 'refused' });
  assert.equal(result.payloadBytes, bytes(result.payload));
});

test('catalog omits whole paths and admits a later smaller row with exact UTF-8 YAML accounting', () => {
  const rows = [evidence(['src/' + '長'.repeat(500) + '.ts', 'src/é.ts'])];
  const full = candidateCatalog(rows, 10000);
  const limit = bytes({ observations: full.payload.observations,
    files: [{ file: 'src/é.ts', evidence: [0] }] });
  const result = candidateCatalog(rows, limit);
  assert.deepEqual(result.payload.files, [{ file: 'src/é.ts', evidence: [0] }]);
  assert.equal(result.omittedFiles, 1);
  assert.equal(result.totalFiles, 2);
  assert.equal(result.payloadBytes, limit);
  assert.equal(result.budgetBytes, limit);
});

test('an insufficient metadata budget omits the payload instead of discarding qualifications', () => {
  const rows = [evidence(['src/Panel.ts'], { membershipStatus: 'incomplete', unread: ['x'.repeat(1000)] })];
  for (const limit of [0, 100]) {
    const result = candidateCatalog(rows, limit);
    assert.equal(result.payload, undefined);
    assert.equal(result.payloadBytes, 0);
    assert.equal(result.omittedFiles, 1);
    assert.equal(result.omittedObservations, 1);
  }
});
