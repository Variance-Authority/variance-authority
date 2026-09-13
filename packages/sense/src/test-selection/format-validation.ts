/**
 * What makes a snapshot well formed, and when each part of it is established.
 *
 * The shape is settled when the file is opened: the row counts the section
 * index states have to agree with each other, and they are read from the index
 * rather than from the columns. Values are settled when the column holding them
 * is read — ids when it materializes, the crossings of a run when that run
 * decompresses — because a column nothing reads cannot turn corruption into an
 * answer, and reading every column to prove it intact is the decode this format
 * exists to avoid.
 *
 * Every check is one a query would otherwise answer from: an id past the end of
 * the dictionary, a CSR bound that runs backwards, a module that claims to be
 * instrumented with no regions behind it. Each returns an empty list rather
 * than an error, and an empty list is what a selector reads as "nothing to run".
 */

/** Rows per section, keyed by the section's own name. */
export type CoverageRows = Readonly<Record<string, number>>;

const BLOCK_COLUMNS = [
  'blocks.kind',
  'blocks.owner',
  'blocks.digest',
  'blocks.name',
  'blocks.path',
  'blocks.start',
  'blocks.end',
  'blocks.source',
] as const;

/** The row counts agree with each other, before a single column is decoded. */
export function validateCoverageShape(rows: CoverageRows): void {
  const strings = (rows['strings.off'] ?? 0) - 1;
  const tests = rows['tests.path'];
  const modules = rows['modules.path'];
  const blocks = rows['blocks.ordinal'];
  if (
    strings < 0 ||
    tests === undefined ||
    modules === undefined ||
    blocks === undefined ||
    rows['snapshot.instrumentation'] !== 1 ||
    (rows['snapshot.commit'] ?? 1) > 1 ||
    rows['tests.complete'] !== tests ||
    rows['tests.preconditions'] !== tests + 1 ||
    rows['preconditions.name'] !== rows['preconditions.digest'] ||
    rows['modules.source'] !== modules ||
    rows['modules.instrumented'] !== modules ||
    rows['modules.blocks'] !== modules + 1 ||
    rows['blocks.tests'] !== blocks + 1 ||
    rows['crossings.test'] === undefined ||
    rows['blocks.loaded'] !== blocks + 1 ||
    rows['loaded.test'] === undefined
  ) fail();
  for (const name of BLOCK_COLUMNS) if (rows[name] !== blocks) fail();
}

/**
 * Offsets into a dense run of values: zero first, the total last, never
 * backwards.
 *
 * For the columns a reader materializes. A CSR column read by the row — the
 * crossings of one region, out of the hundreds of millions a repository has —
 * is not checked this way and does not need to be: a bound past the end of the
 * column it indexes fails on the read, and a pair that runs backwards is a loop
 * that does not execute, which is an absence rather than an answer.
 */
export function csr(offsets: Uint32Array, values: number): void {
  if (offsets.length === 0 || offsets[0] !== 0 || offsets[offsets.length - 1] !== values) fail();
  for (let index = 1; index < offsets.length; index += 1) {
    if (offsets[index]! < offsets[index - 1]!) fail();
  }
}

/** Every value names a row of a table `count` long. */
export function ids(values: Uint32Array, count: number): void {
  for (const value of values) if (value >= count) fail();
}

/** A column that carries one bit carries nothing else. */
export function bits(values: Uint8Array): void {
  for (const value of values) if (value > 1) fail();
}

/** Every kind is one this build has a name for. */
export function kinds(values: Uint8Array, count: number): void {
  for (const value of values) if (value >= count) fail();
}

/**
 * A region ends no earlier than it starts, over the rows of one run.
 *
 * An end before its start is the corruption that answers: the region matches
 * only the line it opens on, so an edit inside it selects the tests of whatever
 * wider region is around it and not its own.
 */
export function extents(end: Uint32Array, from: number, start: (block: number) => number): void {
  for (let row = 0; row < end.length; row += 1) {
    if (start(from + row) > end[row]!) fail();
  }
}

/**
 * A module has regions exactly when the build says it instrumented one.
 *
 * The two disagreeing is the one corruption a reader cannot see: a module with
 * no regions selects nobody, and read as instrumented that is an answer rather
 * than an absence.
 */
export function presence(
  instrumented: Uint8Array,
  from: number,
  blocks: (module: number) => number,
): void {
  for (let row = 0; row < instrumented.length; row += 1) {
    const module = from + row;
    if ((instrumented[row] === 1) !== (blocks(module + 1) > blocks(module))) fail();
  }
}

/**
 * Every region of a module is rooted in the module's own, through owners that
 * were written before it.
 *
 * Ordinals are checked here rather than on their own column because this is
 * what they are for: an owner names an ordinal, and an ordinal that appears
 * twice names two regions.
 */
export function owners(value: {
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockOwner: Uint32Array;
  readonly noOwner: number;
}): void {
  for (let module = 0; module + 1 < value.moduleBlocks.length; module += 1) {
    const first = value.moduleBlocks[module]!;
    const end = value.moduleBlocks[module + 1]!;
    if (end === first) continue;
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

export function invalid(): Error {
  return new Error('not a variance-authority test coverage artifact');
}

export function fail(): never {
  throw invalid();
}
