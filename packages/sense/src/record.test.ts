import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryParseCache } from './cache.js';
import { digestString } from './digest.js';
import { recordFor, type RecordSubject } from './record.js';
import { resolversFor } from './resolve.js';

/**
 * `recordFor` builds the records the native batch does not: every language that
 * is not a module. A file it declines for its size is declined for its bytes, so
 * the record names them when the caller already knows them, and the next update
 * keeps it rather than opening the file to decline it again.
 */

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((at) => rm(at, { recursive: true, force: true })));
});

const subject = (root: string, file: string, digest?: RecordSubject['digest']): RecordSubject => ({
  absolute: join(root, file),
  file,
  root,
  resolvers: resolversFor({}),
  cache: memoryParseCache(),
  aliases: undefined,
  directories: new Map(),
  largestFile: 8,
  remembering: false,
  ...(digest === undefined ? {} : { digest }),
});

describe('recordFor', () => {
  it('names the bytes of a stylesheet it declined for its size, and nothing when it could not read one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    await writeFile(join(root, 'wide.css'), '.a { color: red; }\n', 'utf8');
    const digest = digestString('the object name git gave wide.css');

    const declined = (await recordFor(subject(root, 'wide.css', digest))).record;
    expect(declined.digest).toBe(digest);
    expect(declined.unknown).toContain('over the 8 this scan opens');

    // Unknown to git, the bytes were never hashed, so there is nothing to name.
    expect((await recordFor(subject(root, 'wide.css'))).record.digest).toBeUndefined();

    const missing = (await recordFor(subject(root, 'gone.css', digest))).record;
    expect(missing.digest).toBeUndefined();
    expect(missing.unknown).toContain('could not be read');
  });
});
