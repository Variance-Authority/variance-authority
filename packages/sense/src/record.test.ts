import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from './digest.js';
import { native } from './addon.js';
import { nativeIndexGraph } from './native-index-graph.js';
import { decodeSourceIndex } from './test-support/source-index-format.js';
import { realPath } from './resolve.js';
import type { Digest } from '@variance-authority/core/format';

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((at) => rm(at, { recursive: true, force: true })));
});

const subject = (root: string, file: string, digest?: Digest) => ({
  root: realPath(root), file, largestFile: 8,
  ...(digest === undefined ? {} : { digest }),
});

function nativeRecord(input: ReturnType<typeof subject>) {
  const { root, file, largestFile, digest } = input;
  const graph = nativeIndexGraph(native()!.sourceTree(root, [file], [file]), {
    root, seeds: [file], largestFile, remembering: false, follow: false,
    aliases: undefined, directories: new Map(),
    ...(digest === undefined ? {} : { identities: { [file]: digest } }),
  });
  return decodeSourceIndex(graph.encode([])).records.get(file)!;
}

describe('native source records', () => {
  it('names the bytes of a stylesheet it declined for its size, and nothing when it could not read one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    await writeFile(join(root, 'wide.css'), '.a { color: red; }\n', 'utf8');
    const digest = digestString('the object name git gave wide.css');

    const declined = (await nativeRecord(subject(root, 'wide.css', digest))).record;
    expect(declined.digest).toBe(digest);
    expect(declined.unknown).toContain('over the 8 this scan opens');
    expect(declined.unknown).not.toContain('Raise `largestFile`');

    // Unknown to git, the bytes were never hashed, so there is nothing to name.
    expect((await nativeRecord(subject(root, 'wide.css'))).record.digest).toBeUndefined();

    const missing = (await nativeRecord(subject(root, 'gone.css', digest))).record;
    expect(missing.digest).toBeUndefined();
    expect(missing.unknown).toContain('could not be read');
  });

  it('parses a stylesheet of exactly the limit, and an empty one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    await writeFile(join(root, 'exact.css'), '.a{}/**/', 'utf8');
    await writeFile(join(root, 'empty.css'), '', 'utf8');

    for (const file of ['exact.css', 'empty.css']) {
      const record = (await nativeRecord(subject(root, file))).record;
      expect(record.unknown).toBeUndefined();
      expect(record.unknown).toBeUndefined();
    }
  });

  it('declares the components a module\'s code declares, and none its comments spell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    const source = '/*\nexport function Retired() { return null; }\n*/\nexport function Button() { return null; }\n';
    await writeFile(join(root, 'Button.tsx'), source, 'utf8');

    const record = (await nativeRecord({ ...subject(root, 'Button.tsx'), largestFile: 1024 })).record;
    expect(record.declares).toEqual(['Button']);
  });

  it('records no declares for a module the parser cannot read, and says why', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    const source = '// @flow\ntype Props = {| label: string |};\nexport function Button(props: Props) { return null; }\n';
    await writeFile(join(root, 'Button.js'), source, 'utf8');

    const record = (await nativeRecord({ ...subject(root, 'Button.js'), largestFile: 1024 })).record;
    expect(record).not.toHaveProperty('declares');
    expect(record.unknown).toContain('parse error');
  });

  it.skipIf(process.platform === 'win32')('names no bytes for a stylesheet it declined through a link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
    made.push(root);
    await writeFile(join(root, 'wide.css'), '.a { color: red; }\n', 'utf8');
    await symlink(join(root, 'wide.css'), join(root, 'linked.css'));
    const digest = digestString('the object name git gave the link');

    const declined = (await nativeRecord(subject(root, 'linked.css', digest))).record;
    expect(declined.digest).toBeUndefined();
    expect(declined.unknown).toContain('over the 8 this scan opens');

    await writeFile(join(root, 'wide.css'), '.a{}\n', 'utf8');
    expect(nativeRecord(subject(root, 'linked.css')).record.unknown).toBeUndefined();
  });
});
