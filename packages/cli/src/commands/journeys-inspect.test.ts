import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { encodeTestCoverage, withCaseSections } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'variance-record-inspect-'));
  temporary.push(root);
  const file = join(root, 'coverage.bin');
  // A directory-only reading must not decode or judge a section's payload.
  const last = Buffer.from('run metadata is opaque to a storage reading');
  await writeFile(file, withCaseSections(encodeTestCoverage({
    version: 3, instrumentation: 'fixture', tests: [], modules: [],
  }), { last }));
  return { file, last };
}

it('inspects section sizes without project configuration, a source index, or decoding case metadata', async () => {
  const { file, last } = await fixture();
  let out = '';
  let err = '';
  const code = await main(['journeys', 'inspect', file, '--format', 'json'], {
    out: (text) => { out += text; }, err: (text) => { err += text; },
  });

  expect({ code, err }).toEqual({ code: 0, err: '' });
  const reading = JSON.parse(out);
  expect(reading).toMatchObject({ record: file, bytes: (await stat(file)).size });
  expect(reading.sections).toContainEqual({
    name: 'cases.last', bytes: last.length, rows: last.length, width: 1, packed: false,
  });
  expect(reading.overheadBytes).toBeGreaterThan(0);
  expect(reading.sections.reduce((total: number, section: { bytes: number }) => total + section.bytes, reading.overheadBytes)).toBe(reading.bytes);
});

it('refuses reading options that do not belong to inspection', async () => {
  let err = '';
  expect(await main(['journeys', 'inspect', 'coverage.bin', '--all'], {
    out: () => {}, err: (text) => { err += text; },
  })).toBe(2);
  expect(err).toContain('journeys inspect');
});

it('labels physical storage elements in the default text reading', async () => {
  const { file, last } = await fixture();
  let out = '';
  expect(await main(['journeys', 'inspect', file], { out: (text) => { out += text; }, err: () => {} })).toBe(0);
  expect(out).toContain(`cases.last: ${last.length} bytes, ${last.length} storage elements of width 1`);
});
