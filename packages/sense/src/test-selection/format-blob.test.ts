import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gitBlob } from '../digest.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { layCoverage } from './format-layer.js';
import { BLOB, FORMAT, NO_BLOB, PHASES, UNKEYED_FORMAT, sections, type Header, type Stored } from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import type { CoverageModule, TestCoverage } from './index.js';

const TEST = 'test/alpha.test.ts';

function module(file: string, sourceBlob?: string): CoverageModule {
  return {
    file,
    sourceDigest: `source:${file}`,
    ...(sourceBlob === undefined ? {} : { sourceBlob }),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module', digest: `block:${file}`, name: '', path: 'module',
      startLine: 1, endLine: 3, source: true, testFiles: [TEST],
    }],
  };
}

function coverage(modules: readonly CoverageModule[]): TestCoverage {
  return { version: 3, instrumentation: 'fixture', tests: [{ file: TEST, complete: true, preconditions: [] }], modules };
}

function relaid(bytes: Buffer, version: number, without: readonly string[]): Buffer {
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + length).replace(/\0+$/, '')) as Header;
  const kept: Record<string, Stored> = {};
  for (const section of header.sections) {
    if (without.includes(section.name)) continue;
    const plain = bytes.subarray(4 + length + section.offset, 4 + length + section.offset + section.length);
    kept[section.name] = { plain, rows: section.length / section.width, width: section.width };
  }
  return sections(kept, version);
}

describe('the git name of the text a module row was cut from', () => {
  it('is the name git gives the same bytes', () => {
    const text = 'export const a = 1;\n// é\n';

    expect(gitBlob(text)).toBe(`git:${execFileSync('git', ['hash-object', '--stdin'], { input: text }).toString().trim()}`);
  });

  it('is stored a module, and a module recorded without one reads back without one', () => {
    const written = encodeTestCoverage(coverage([module('src/a.ts', 'git:aa'), module('src/b.ts')]));

    expect(decodeTestCoverage(written).modules.map((each) => each.sourceBlob)).toEqual(['git:aa', undefined]);
    const view = openTestCoverage(written);
    expect(view.moduleBlob?.at(1)).toBe(NO_BLOB);
    expect(view.string(view.moduleBlob!.at(0))).toBe('git:aa');
  });

  it('opens a snapshot written before the key was recorded, as one with no key anywhere', () => {
    const unkeyed = relaid(encodeTestCoverage(coverage([module('src/a.ts', 'git:aa')])), UNKEYED_FORMAT, [BLOB]);

    expect(openTestCoverage(unkeyed).moduleBlob).toBeUndefined();
    expect(decodeTestCoverage(unkeyed).modules.map((each) => each.sourceBlob)).toEqual([undefined]);
  });

  it('refuses a current-layout snapshot that lacks the key section', () => {
    const lacking = relaid(encodeTestCoverage(coverage([module('src/a.ts')])), FORMAT, [BLOB]);

    expect(() => openTestCoverage(lacking)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('is carried by a layer over a module the run did not reach, and taken from the run where it did', () => {
    const held = encodeTestCoverage(coverage([module('src/a.ts', 'git:aa'), module('src/b.ts', 'git:bb')]));

    const layered = layCoverage(held, coverage([module('src/b.ts', 'git:b2')]));

    expect(decodeTestCoverage(layered).modules.map((each) => [each.file, each.sourceBlob])).toEqual([
      ['src/a.ts', 'git:aa'],
      ['src/b.ts', 'git:b2'],
    ]);
  });

  it('layers a run over an unkeyed snapshot into the current layout, keyed only where the run keyed it', () => {
    const unkeyed = relaid(encodeTestCoverage(coverage([module('src/a.ts'), module('src/b.ts')])), UNKEYED_FORMAT, [BLOB]);

    const layered = layCoverage(unkeyed, coverage([module('src/b.ts', 'git:b2')]));

    expect(decodeTestCoverage(layered).modules.map((each) => [each.file, each.sourceBlob])).toEqual([
      ['src/a.ts', undefined],
      ['src/b.ts', 'git:b2'],
    ]);
  });

  it('lets the unphased layout keep lacking both', () => {
    expect(UNKEYED_FORMAT).toBe(FORMAT - 1);
    expect(PHASES).not.toBe(BLOB);
  });
});
