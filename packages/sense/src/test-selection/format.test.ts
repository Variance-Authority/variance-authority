import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { BlockKind, TestCoverage } from './index.js';

describe('the persisted coverage format', () => {
  it('round-trips without storing repeated test paths in every block', async () => {
    const coverage = representativeCoverage();
    const expandedJson = Buffer.byteLength(JSON.stringify(coverage));
    const encoded = await encodeTestCoverage(coverage);

    expect(await decodeTestCoverage(encoded)).toEqual(coverage);
    expect(encoded.byteLength).toBeLessThan(expandedJson / 8);
  });

  it('canonicalizes sets and code-unit orders before encoding', () => {
    const coverage = representativeCoverage();
    const shuffled: TestCoverage = {
      ...coverage,
      tests: [...coverage.tests].reverse().map((test) => ({
        ...test,
        preconditions: [...test.preconditions].reverse(),
      })),
      modules: [...coverage.modules].reverse().map((module) => ({
        ...module,
        blocks: [...module.blocks].reverse().map((block) => ({
          ...block,
          testFiles: [...block.testFiles].reverse(),
        })),
      })),
    };

    expect(encodeTestCoverage(shuffled)).toEqual(encodeTestCoverage(coverage));
  });

  it('represents instrumentation refusal instead of an empty module observation', () => {
    const coverage = representativeCoverage();
    const unavailable: TestCoverage = {
      ...coverage,
      modules: [...coverage.modules, {
        file: 'src/unavailable.ts',
        sourceDigest: 'source:unavailable',
        instrumented: false,
        blocks: [],
      }],
    };

    expect(decodeTestCoverage(encodeTestCoverage(unavailable)).modules.at(-1)).toEqual({
      file: 'src/unavailable.ts',
      sourceDigest: 'source:unavailable',
      instrumented: false,
      blocks: [],
    });
  });

  it('carries the commit a snapshot was recorded at, and its absence', () => {
    // The whole of an index's position. A file that has one can be diffed
    // against; a file that has none says so rather than naming a commit a
    // reader would then diff against and be wrong about.
    const positioned: TestCoverage = {
      ...representativeCoverage(),
      commit: '9b6a1f2e4c8d0a35b7e9f1c3d5a7b9e1f3c5a7b9',
    };

    expect(decodeTestCoverage(encodeTestCoverage(positioned)).commit).toBe(
      '9b6a1f2e4c8d0a35b7e9f1c3d5a7b9e1f3c5a7b9',
    );
    expect(decodeTestCoverage(encodeTestCoverage(representativeCoverage()))).not.toHaveProperty(
      'commit',
    );
  });

  it('rejects invalid state columns before they can answer a query', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: Array<{ name: string; offset: number }>;
    };
    const section = header.sections.find((candidate) => candidate.name === 'modules.instrumented')!;
    const corrupt = Buffer.from(encoded);
    corrupt[4 + headerLength + section.offset] = 2;

    expect(() => decodeTestCoverage(corrupt)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('rejects a section that aliases bytes outside the artifact payload', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: Array<{ name: string; offset: number }>;
    };
    header.sections[0]!.offset = -8;
    const corrupt = Buffer.from(encoded);
    const changed = Buffer.from(JSON.stringify(header), 'utf8');
    corrupt.fill(0, 4, 4 + headerLength);
    changed.copy(corrupt, 4);

    expect(() => decodeTestCoverage(corrupt)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('refuses a snapshot from the previous block universe', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      version: number;
    };
    const prior = Buffer.from(encoded);
    const oldHeader = Buffer.from(JSON.stringify({ ...header, version: 1 }), 'utf8');
    prior.fill(0, 4, 4 + headerLength);
    oldHeader.copy(prior, 4);

    expect(() => decodeTestCoverage(prior)).toThrow(/unsupported test coverage version: 1/);
  });

  it('round-trips every kind the instrument can put on a block', () => {
    // The format numbers kinds by position and writes the number, so a kind the
    // encoder cannot place throws and one the decoder misplaces comes back as a
    // different region. Neither shows up in a fixture that only ever uses
    // `module` and `branch`, which is what every other case here holds.
    const encoded = encodeTestCoverage(coverageOfEveryKind());

    expect(decodeTestCoverage(encoded).modules[0]?.blocks.map((block) => block.kind))
      .toEqual(everyBlockKind());
  });

  it('settles a column when the column is read, not when the file is opened', () => {
    // Opening the file is a parse of the section index, so a column nobody asks
    // about costs nothing — including the cost of proving it intact. Ownership
    // is the one check that reads a column whole, and only a full decode asks
    // for it: a query that names no region's owner reads a snapshot whose
    // owners are nonsense, and is right to.
    const corrupt = patched('blocks.owner', (section) => {
      section.writeUInt32LE(0xff_ff_fe, 4);
    });
    const view = openTestCoverage(corrupt);

    expect(view.string(view.modulePath.at(0))).toBe(
      'packages/application/src/feature-0/implementation.ts',
    );
    expect(() => view.blockOwner.all()).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('rejects a run of a column that is not the run it was written as', () => {
    const corrupt = patched('crossings.test', (section) => {
      section[section.length - 1] ^= 0xff;
    });
    const view = openTestCoverage(corrupt);

    // The run is the unit: the rows before the damaged one answer, and the rows
    // inside it are refused rather than read as a test that never entered.
    expect(view.crossingTest.length).toBe(20_000);
    expect(view.crossingTest.at(0)).toBeLessThan(200);
    expect(() => view.crossingTest.at(view.crossingTest.length - 1)).toThrow(
      /not a variance-authority test coverage artifact/,
    );
  });

  it('rejects JSON instead of mistaking it for a coverage artifact', async () => {
    expect(() => decodeTestCoverage(Buffer.from('{"version":1}'))).toThrow(
      /not a variance-authority test coverage artifact/,
    );
  });
});

/** One section of an encoded snapshot, rewritten where it sits. */
function patched(name: string, change: (section: Buffer) => void): Buffer {
  const encoded = encodeTestCoverage(representativeCoverage());
  const headerLength = encoded.readUInt32LE(0);
  const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
    sections: Array<{ name: string; offset: number; length: number }>;
  };
  const section = header.sections.find((candidate) => candidate.name === name)!;
  const corrupt = Buffer.from(encoded);
  const at = 4 + headerLength + section.offset;
  change(corrupt.subarray(at, at + section.length));
  return corrupt;
}

function representativeCoverage(): TestCoverage {
  const testFiles = Array.from({ length: 200 }, (_, index) =>
    `packages/application/src/feature-${index}/feature-${index}.test.ts`,
  ).sort();
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: testFiles.map((file) => ({
      file,
      complete: true,
      preconditions: [
        { name: file, digest: `source:${file}` },
        { name: 'vitest.config.ts', digest: 'source:config' },
      ],
    })),
    modules: Array.from({ length: 50 }, (_, module) => ({
      file: `packages/application/src/feature-${module}/implementation.ts`,
      sourceDigest: `source:module:${module}`,
      instrumented: true,
      blocks: Array.from({ length: 20 }, (_, ordinal) => ({
        ordinal,
        kind: ordinal === 0 ? 'module' : 'branch',
        ...(ordinal === 0 ? {} : { owner: 0 }),
        digest: `block:${module}:${ordinal}`,
        name: `feature${module}/decide`,
        path: ordinal === 0 ? 'module' : `if#${ordinal}/then`,
        startLine: ordinal * 3 + 1,
        endLine: ordinal * 3 + 3,
        source: true,
        testFiles: Array.from(
          { length: 20 },
          (_, offset) => testFiles[(module * 7 + ordinal * 3 + offset) % testFiles.length]!,
        ).sort(),
      })),
    })).sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  };
}

/**
 * Every member of `BlockKind`, `module` first.
 *
 * A record keyed by the union rather than a list of names, so that a member added
 * to `BlockKind` is a missing property here and not a case this quietly stops
 * covering. What stops the build is in `format.ts`, where `kindId` takes a
 * `BlockKind`; this is only the enumeration that walks it. `module` leads because
 * the format requires the ordinal-zero block of a module to be its root.
 */
function everyBlockKind(): readonly BlockKind[] {
  const kinds: Record<BlockKind, true> = {
    module: true,
    function: true,
    branch: true,
    continuation: true,
    resume: true,
    loop: true,
    case: true,
    handler: true,
  };
  const named = Object.keys(kinds) as readonly BlockKind[];
  return ['module', ...named.filter((kind) => kind !== 'module')];
}

/** One module carrying one block of each kind, rooted at the module block. */
function coverageOfEveryKind(): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{ file: 'src/every-kind.test.ts', complete: true, preconditions: [] }],
    modules: [{
      file: 'src/every-kind.ts',
      sourceDigest: 'source:every-kind',
      instrumented: true,
      blocks: everyBlockKind().map((kind, ordinal) => ({
        ordinal,
        kind,
        ...(ordinal === 0 ? {} : { owner: 0 }),
        digest: `block:${kind}`,
        name: `everyKind/${kind}`,
        path: ordinal === 0 ? 'module' : `${kind}#${ordinal}`,
        startLine: ordinal * 2 + 1,
        endLine: ordinal * 2 + 2,
        source: true,
        testFiles: ['src/every-kind.test.ts'],
      })),
    }],
  };
}
