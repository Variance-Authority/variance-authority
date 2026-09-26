import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { openImages, reportSource, type SharedReport } from './report-source.js';
import type { CliRunReport } from './run.js';

/**
 * What a reader does with a report it did not write: the configured one wins
 * whenever it is on disk, and an image is fetched only for a subject a question
 * names, only to a path inside the kept report's directory, and only when its
 * bytes are the ones its digest names.
 *
 * `share.test.ts` asks through `variance ask` against real lines; these are the
 * cases a line written by somebody else can present.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-report-source-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const digestOf = (text: string): string => createHash('sha256').update(text).digest('hex');

function sourceOf(images: Record<string, string>, held: Record<string, string>): SharedReport & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    path: join(home, 'kept', 'run.json'),
    line: { kind: 'mainline', name: 'main' },
    commit: 'c0ffee',
    images,
    image: (digest) => {
      asked.push(digest);
      const bytes = held[digest];
      return Promise.resolve(bytes === undefined ? { kind: 'absent' } : new TextEncoder().encode(bytes));
    },
    says: 'report: read from mainline main.',
    asked,
  };
}

function reportNaming(subject: string, images: Record<string, string>): CliRunReport {
  return { runVersion: 1, observations: [{ subject, verdict: 'changed', because: 'it changed', images }] } as unknown as CliRunReport;
}

describe('which report a reader reads', () => {
  it('is the configured one whenever it is on disk, and nothing is asked of the share', async () => {
    const report = join(home, 'run.json');
    await writeFile(report, '{}');
    // No share is configured, so asking one would throw.
    expect(await reportSource({ report } as Config)).toEqual({ local: report });
  });
});

describe('the images of a report read from a line', () => {
  it('fetches the named subject\'s images by digest, and none of any other subject\'s', async () => {
    const source = sourceOf(
      { 'images/a.png': digestOf('a'), 'images/b.png': digestOf('b') },
      { [digestOf('a')]: 'a', [digestOf('b')]: 'b' },
    );
    const a = reportNaming('page/a', { after: 'images/a.png' });
    const report = { ...a, observations: [...a.observations, ...reportNaming('page/b', { after: 'images/b.png' }).observations] };

    expect(await openImages(source, report, ['page/a'])).toEqual([]);
    expect(await readFile(join(home, 'kept', 'images', 'a.png'), 'utf8')).toBe('a');
    await expect(stat(join(home, 'kept', 'images', 'b.png'))).rejects.toMatchObject({ code: 'ENOENT' });

    // Kept, so asking again fetches nothing.
    await openImages(source, report, ['page/a']);
    expect(source.asked).toEqual([digestOf('a')]);
  });

  it('says why an image was not fetched: not published, outside the report, or not the bytes its digest names', async () => {
    const source = sourceOf(
      { 'images/forged.png': digestOf('real'), '../../escape.png': digestOf('x') },
      { [digestOf('real')]: 'forged', [digestOf('x')]: 'x' },
    );
    const report = reportNaming('page/a', { before: 'images/missing.png', after: 'images/forged.png', diff: '../../escape.png' });

    expect(await openImages(source, report, ['page/a'])).toEqual([
      'image images/missing.png: it was not published with the report.',
      'image images/forged.png: the bytes the line holds do not match their digest.',
      'image ../../escape.png: it names a path outside the report, so it is not fetched.',
    ]);
    await expect(stat(join(home, 'kept', 'images', 'forged.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(home, '..', 'escape.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('says what the line answered when it does not hold an image it tables', async () => {
    await mkdir(join(home, 'kept'), { recursive: true });
    const source = sourceOf({ 'images/a.png': digestOf('a') }, {});
    expect(await openImages(source, reportNaming('page/a', { after: 'images/a.png' }), ['page/a']))
      .toEqual(['image images/a.png: nothing is published there.']);
  });
});
