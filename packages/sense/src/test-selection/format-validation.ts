interface CoverageColumns {
  readonly stringOffsets: Uint32Array;
  readonly stringBytes: number;
  readonly instrumentation: Uint32Array;
  readonly testPath: Uint32Array;
  readonly testComplete: Uint8Array;
  readonly testPreconditions: Uint32Array;
  readonly preconditionName: Uint32Array;
  readonly preconditionDigest: Uint32Array;
  readonly modulePath: Uint32Array;
  readonly moduleSource: Uint32Array;
  readonly moduleInstrumented: Uint8Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockOwner: Uint32Array;
  readonly blockDigest: Uint32Array;
  readonly blockName: Uint32Array;
  readonly blockPath: Uint32Array;
  readonly blockStart: Uint32Array;
  readonly blockEnd: Uint32Array;
  readonly blockSource: Uint8Array;
  readonly blockTests: Uint32Array;
  readonly crossingTest: Uint32Array;
  readonly kindCount: number;
  readonly noOwner: number;
}

/** Refuse malformed snapshots before a query can turn corrupt absence into an empty answer. */
export function validateCoverageColumns(value: CoverageColumns): void {
  const strings = value.stringOffsets.length - 1;
  if (
    strings < 0 ||
    value.stringOffsets[0] !== 0 ||
    value.stringOffsets[strings] !== value.stringBytes ||
    !ordered(value.stringOffsets) ||
    value.instrumentation.length !== 1 ||
    value.testComplete.length !== value.testPath.length ||
    value.testPreconditions.length !== value.testPath.length + 1 ||
    value.preconditionName.length !== value.preconditionDigest.length ||
    value.moduleSource.length !== value.modulePath.length ||
    value.moduleInstrumented.length !== value.modulePath.length ||
    value.moduleBlocks.length !== value.modulePath.length + 1
  ) fail();

  const blocks = value.blockOrdinal.length;
  for (const column of [
    value.blockKind, value.blockOwner, value.blockDigest, value.blockName,
    value.blockPath, value.blockStart, value.blockEnd, value.blockSource,
  ]) {
    if (column.length !== blocks) fail();
  }
  if (value.blockTests.length !== blocks + 1) fail();
  csr(value.testPreconditions, value.preconditionName.length);
  csr(value.moduleBlocks, blocks);
  csr(value.blockTests, value.crossingTest.length);

  for (const column of [
    value.instrumentation, value.testPath, value.preconditionName,
    value.preconditionDigest, value.modulePath, value.moduleSource,
    value.blockDigest, value.blockName, value.blockPath,
  ]) ids(column, strings);
  bits(value.testComplete);
  bits(value.moduleInstrumented);
  bits(value.blockSource);

  for (const kind of value.blockKind) if (kind >= value.kindCount) fail();
  for (const test of value.crossingTest) if (test >= value.testPath.length) fail();
  for (let block = 0; block < blocks; block += 1) {
    if (value.blockStart[block]! > value.blockEnd[block]!) fail();
  }

  for (let module = 0; module < value.modulePath.length; module += 1) {
    const first = value.moduleBlocks[module]!;
    const end = value.moduleBlocks[module + 1]!;
    const instrumented = value.moduleInstrumented[module] === 1;
    if (instrumented !== (end > first)) fail();
    if (!instrumented) continue;
    const ordinals = new Map<number, number>();
    for (let block = first; block < end; block += 1) {
      const ordinal = value.blockOrdinal[block]!;
      if (ordinals.has(ordinal)) fail();
      ordinals.set(ordinal, block);
    }
    if (value.blockKind[first] !== 0) fail();
    for (let block = first; block < end; block += 1) {
      const owner = value.blockOwner[block]!;
      const ownerBlock = ordinals.get(owner);
      if (block === first ? owner !== value.noOwner : owner === value.noOwner || ownerBlock === undefined) fail();
      if (ownerBlock !== undefined && ownerBlock >= block) fail();
    }
  }
}

function csr(offsets: Uint32Array, values: number): void {
  if (offsets.length === 0 || offsets[0] !== 0 || offsets[offsets.length - 1] !== values || !ordered(offsets)) fail();
}

function ordered(values: Uint32Array): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! < values[index - 1]!) return false;
  }
  return true;
}

function ids(values: Uint32Array, count: number): void {
  for (const value of values) if (value >= count) fail();
}

function bits(values: Uint8Array): void {
  for (const value of values) if (value > 1) fail();
}

function fail(): never {
  throw new Error('not a variance-authority test coverage artifact');
}
