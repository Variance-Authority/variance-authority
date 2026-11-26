// compass: variance-authority.reach.crossings
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheRootFor, decodeTestCoverage, encodeTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { viewOutput } from './view-command.js';

/** What `variance view` writes and prints: one file at a fixed place, carrying the record whole. */

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-view-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-view-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const COVERAGE = {
  version: 3,
  instrumentation: 'fixture',
  tests: [{ file: 'a.test.ts', duration: 5, start: 1_800_000_000_000, complete: true, preconditions: [] }],
  modules: [{ file: 'src/a.ts', sourceDigest: 'd', instrumented: true, blocks: [{ ordinal: 0, kind: 'module' as const, digest: 'b', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: ['a.test.ts'] }] }],
};

function record(): Buffer {
  const at = testCoverageFile(root, {});
  mkdirSync(dirname(at), { recursive: true });
  const bytes = Buffer.from(encodeTestCoverage(COVERAGE));
  writeFileSync(at, bytes);
  return bytes;
}

/** The record the page carries, inflated. */
function carried(html: string): Uint8Array {
  const base64 = /<script id="recording" type="application\/octet-stream">([^<]*)<\/script>/u.exec(html)![1]!;
  return new Uint8Array(gunzipSync(Buffer.from(base64, 'base64')));
}

describe('variance view', () => {
  it('writes the page at the cache path, prints that path, and carries the whole record', () => {
    const bytes = record();

    const { out, err } = viewOutput({ command: 'view' }, root);

    const path = `${cacheRootFor(root)}/variance-view.html`;
    expect(out).toBe(`${path}\n`);
    expect(err).toBe('');
    const html = readFileSync(path, 'utf8');
    expect(decodeTestCoverage(carried(html))).toEqual(decodeTestCoverage(bytes));
    expect(html).toContain(`${bytes.length.toLocaleString('en-US')} bytes`);
  });

  it('refuses, naming where it looked, when nothing is recorded', () => {
    expect(() => viewOutput({ command: 'view' }, root)).toThrow(OperatorError);
    expect(() => viewOutput({ command: 'view' }, root)).toThrow(/^view: nothing is recorded at /u);
  });
});
