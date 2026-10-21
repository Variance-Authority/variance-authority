import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spliced } from '../instrument/spliced.js';
import { CACHE_VARIABLE } from './cache-layers.js';
import { faultOf, faultReadIn, readFaulted, skippable } from './fault.js';

const SOURCE = 'export function f(a) {\n  if (a) {\n    a.x = 1;\n  }\n  return a;\n}\n';

/** The ordinal the walk gives the region named `path` in `f`. */
function ordinal(path: string): number {
  return spliced(SOURCE, 'a.js', 'presence')!.blocks.findIndex((block) => block.name === 'f' && block.path === path);
}

describe('a fault', () => {
  it('is read as the file it names and the region in it', () => {
    expect(faultOf('src/a.js#3')).toEqual({ file: 'src/a.js', ordinal: 3 });
    expect(faultOf('src/a#b.js#3')).toEqual({ file: 'src/a#b.js', ordinal: 3 });
    expect(faultOf(undefined)).toBeUndefined();
    expect(faultOf('')).toBeUndefined();
  });

  it('refuses an address that names no region', () => {
    expect(() => faultOf('src/a.js')).toThrow(/VARIANCE_AUTHORITY_FAULT/);
    expect(() => faultOf('src/a.js#x')).toThrow(/VARIANCE_AUTHORITY_FAULT/);
    expect(() => faultOf('#3')).toThrow(/VARIANCE_AUTHORITY_FAULT/);
  });

  it('skips the region it names in the file it names, on the same lines, for every reader of the file', () => {
    const { code, text } = readFaulted('a.js', SOURCE, SOURCE, { file: 'a.js', ordinal: ordinal('if#0/then') });

    expect(code).not.toContain('a.x = 1');
    expect(code).toContain('return a');
    expect(code.split('\n')).toHaveLength(SOURCE.split('\n').length);
    expect(text).toBe(code);
  });

  it('leaves a mark in the cache its run records into once the file is read skipped, and none for another file', () => {
    const cache = mkdtempSync(join(tmpdir(), 'fault-read-'));
    const was = process.env[CACHE_VARIABLE];
    process.env[CACHE_VARIABLE] = cache;
    try {
      readFaulted('b.js', SOURCE, SOURCE, { file: 'a.js', ordinal: ordinal('if#0/then') });
      expect(existsSync(faultReadIn(cache))).toBe(false);

      readFaulted('a.js', SOURCE, SOURCE, { file: 'a.js', ordinal: ordinal('if#0/then') });
      expect(readFileSync(faultReadIn(cache), 'utf8')).toBe(`a.js#${ordinal('if#0/then')}\n`);
    } finally {
      if (was === undefined) delete process.env[CACHE_VARIABLE];
      else process.env[CACHE_VARIABLE] = was;
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it('says which regions have a text of their own to skip', () => {
    expect(skippable(SOURCE, 'a.js', ordinal('if#0/then'))).toBe(true);
    expect(skippable(SOURCE, 'a.js', 0)).toBe(false);
  });

  it('leaves every other file as it is', () => {
    const fault = { file: 'b.js', ordinal: ordinal('if#0/then') };

    expect(readFaulted('a.js', SOURCE, SOURCE, fault)).toEqual({ code: SOURCE, text: SOURCE });
    expect(readFaulted('a.js', SOURCE, undefined, undefined)).toEqual({ code: SOURCE, text: undefined });
  });

  it('throws on a region with no text of its own, rather than skipping something near it', () => {
    expect(() => readFaulted('a.js', SOURCE, SOURCE, { file: 'a.js', ordinal: 0 })).toThrow(
      /a\.js#0 names a region with no text of its own/,
    );
  });

  it('throws on a file that reached the seam already changed', () => {
    expect(() => readFaulted('a.js', `${SOURCE}x;\n`, SOURCE, { file: 'a.js', ordinal: ordinal('if#0/then') })).toThrow(
      /already changed/,
    );
  });
});
