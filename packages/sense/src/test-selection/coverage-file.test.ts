import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askCoverageFile, openCoverageFile } from './coverage-file.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { selectTestFilesFromView } from './select.js';
import type { Bytes } from './columns.js';
import type { TestCoverage } from './index.js';

/**
 * A snapshot whose columns are stored as runs.
 *
 * Which is the whole point of reading one where it lies: a section under
 * `PACK_ABOVE` is written plain and answers a row by materializing, so a
 * fixture small enough to be quick is a fixture that cannot show the thing.
 * A thousand modules of twenty regions puts the dictionary and the offsets that
 * cut it well over the threshold, and takes about a second to encode.
 */
function runCodedCoverage(): TestCoverage {
  const testFiles = Array.from({ length: 200 }, (_, index) =>
    `packages/application/src/feature-${String(index).padStart(3, '0')}.test.ts`,
  ).sort();
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: testFiles.map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
    })),
    modules: Array.from({ length: 1_000 }, (_, module) => ({
      file: `packages/application/src/wide-${String(module).padStart(4, '0')}/implementation.ts`,
      sourceDigest: `source:module:${module}`,
      instrumented: true,
      blocks: Array.from({ length: 20 }, (_, ordinal) => ({
        ordinal,
        kind: ordinal === 0 ? 'module' as const : 'branch' as const,
        ...(ordinal === 0 ? {} : { owner: 0 }),
        digest: `block:${module}:${ordinal}`,
        name: `wide${module}/decide`,
        path: ordinal === 0 ? 'module' : `if#${ordinal}/then`,
        startLine: ordinal * 3 + 1,
        endLine: ordinal * 3 + 3,
        source: true,
        testFiles: Array.from(
          { length: 4 },
          (_, offset) => testFiles[(module * 7 + ordinal * 3 + offset) % testFiles.length]!,
        ).sort(),
      })),
    })),
  };
}

interface Section {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  /** Present when the section is stored as runs, absent when it is stored plain. */
  readonly rows?: number;
}

/** The index at the head of the file: what each section is called, where it lies, how it is stored. */
function stored(bytes: Uint8Array): ReadonlyArray<Section> {
  const length = Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0);
  const header = JSON.parse(
    Buffer.from(bytes.buffer, bytes.byteOffset, 4 + length).toString('utf8', 4).replace(/\0+$/, ''),
  ) as { sections: ReadonlyArray<Section> };

  return header.sections
    .filter((section) => section.length > 0)
    .map((section) => ({ ...section, offset: section.offset + 4 + length }))
    .sort((first, second) => first.offset - second.offset);
}

/**
 * The file's bytes behind the same door a descriptor answers, counting what is
 * asked for: in total, and against the section each read lands in, so a test can
 * say which column a read came out of and not only how much of the file it was.
 */
const counted = (
  bytes: Uint8Array,
): Bytes & {
  readonly asked: () => number;
  readonly askedOf: (name: string) => number;
  /** The sections stored as runs, which are the ones a query must not materialize. */
  readonly coded: () => ReadonlyArray<Section>;
} => {
  const sections = stored(bytes);
  const askedOf = new Map<string, number>();
  let asked = 0;

  const holding = (at: number): string => {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      const section = sections[index]!;
      if (at >= section.offset && at < section.offset + section.length) return section.name;
    }
    return '(the index)';
  };

  return {
    length: bytes.length,
    read: (from, to) => {
      const section = holding(from);
      asked += to - from;
      askedOf.set(section, (askedOf.get(section) ?? 0) + (to - from));
      return Uint8Array.from(bytes.subarray(from, to));
    },
    asked: () => asked,
    askedOf: (name) => askedOf.get(name) ?? 0,
    coded: () => sections.filter((section) => section.rows !== undefined),
  };
};

describe('a snapshot read where it lies', () => {
  let directory: string;
  let file: string;
  let bytes: Uint8Array;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-coverage-file-'));
    file = resolve(directory, 'coverage.bin');
    bytes = await encodeTestCoverage(runCodedCoverage());
    await writeFile(file, bytes);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('is stored as runs, which is what makes the question worth asking', () => {
    const coded = stored(bytes)
      .filter((section) => section.rows !== undefined)
      .map((section) => section.name);

    expect(coded).toContain('strings.blob');
    expect(coded).toContain('strings.off');
  });

  it('answers what the same snapshot in memory answers', async () => {
    const held = openTestCoverage(await readFile(file));
    const open = openCoverageFile(file);

    try {
      expect(open.view.instrumentation).toBe(held.instrumentation);
      expect(open.view.strings).toBe(held.strings);
      expect(open.view.modulePath.length).toBe(held.modulePath.length);
      expect(open.view.string(open.view.modulePath.at(500))).toBe(
        held.string(held.modulePath.at(500)),
      );
      expect(open.view.blockSet.all()).toEqual(held.blockSet.all());
      expect([...open.view.crossings.members(open.view.blockSet.at(17))])
        .toEqual([...held.crossings.members(held.blockSet.at(17))]);
    } finally {
      open.close();
    }
  });

  it('selects the same tests as the snapshot read into memory', async () => {
    const diff = [
      'diff --git a/packages/application/src/wide-0500/implementation.ts b/packages/application/src/wide-0500/implementation.ts',
      '--- a/packages/application/src/wide-0500/implementation.ts',
      '+++ b/packages/application/src/wide-0500/implementation.ts',
      '@@ -4,1 +4,1 @@',
      '-  was();',
      '+  is();',
      '',
    ].join('\n');
    const held = selectTestFilesFromView(openTestCoverage(await readFile(file)), diff);

    const chosen = await askCoverageFile(file, (view) => selectTestFilesFromView(view, diff));

    expect(chosen).toEqual(held);
    expect(chosen.length).toBeGreaterThan(0);
  });

  it('does not decompress a column to read one name out of it', () => {
    // The regression this reader exists for. Reading one string used to ask the
    // offset column for its array, which decompressed every run of it: 7.6 MB of
    // `strings.off` to answer the first name of every query the format has.
    const section = counted(bytes);
    const view = openTestCoverage(section);

    view.string(view.modulePath.at(0));

    expect(section.asked()).toBeLessThan(bytes.length / 8);
  });

  it('reads a fraction of the file to answer what one changed module reaches', () => {
    const section = counted(bytes);
    const diff = [
      'diff --git a/packages/application/src/wide-0007/implementation.ts b/packages/application/src/wide-0007/implementation.ts',
      '--- a/packages/application/src/wide-0007/implementation.ts',
      '+++ b/packages/application/src/wide-0007/implementation.ts',
      '@@ -4,1 +4,1 @@',
      '-  was();',
      '+  is();',
      '',
    ].join('\n');

    const chosen = selectTestFilesFromView(openTestCoverage(section), diff);

    expect(chosen.length).toBeGreaterThan(0);
    // The claim is about the run coded columns, and a query naming one of a
    // thousand modules must not materialize one of them. The rest of a fixture
    // this small is sections under `PACK_ABOVE`, which are stored plain and
    // answer a row by being read whole; at a repository's scale those are run
    // coded too, and the same query there reads under five percent of the file.
    const coded = section.coded();
    const read = coded.reduce((sum, column) => sum + section.askedOf(column.name), 0);
    const held = coded.reduce((sum, column) => sum + column.length, 0);

    expect(coded.length).toBeGreaterThan(4);
    expect(read).toBeLessThan(held / 4);
  });

  it('reads almost nothing to say where a snapshot was recorded', () => {
    const section = counted(bytes);

    void openTestCoverage(section).commit;

    // The header, the one column that holds it, and the run of the dictionary
    // the string sits in. Every other plain section stays unread.
    expect(section.asked()).toBeLessThan(bytes.length / 20);
  });

  it('holds the file open until an answer that is still being computed arrives', async () => {
    // `deviationOfTests` reads the working tree between two columns, so its
    // answer is a promise and the descriptor it reads through outlives the call
    // that opened it.
    const answer = await askCoverageFile(file, async (view) => {
      await Promise.resolve();
      return view.string(view.modulePath.at(900));
    });

    expect(answer).toBe('packages/application/src/wide-0900/implementation.ts');
  });

  it('releases the descriptor, and says so rather than answering from a closed one', () => {
    const open = openCoverageFile(file);
    const path = open.view.modulePath;

    open.close();

    expect(() => path.at(0)).toThrow(/EBADF|bad file descriptor/);
  });

  it('refuses a file that is not a snapshot, without leaving it open', async () => {
    const wrong = resolve(directory, 'not-coverage.bin');
    await writeFile(wrong, Buffer.alloc(64));

    expect(() => openCoverageFile(wrong)).toThrow();
  });
});
