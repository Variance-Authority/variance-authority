// compass: variance-authority/runtime/attention
import type { ShadowReach } from '@variance-authority/sense/taint';

/**
 * A mock a test file writes that the import graph argues against: one of a
 * module the file does not load, which replaces nothing, or one past its
 * subject's imports, which replaces an internal of code the file never names.
 */
export type MisplacedMock =
  | { readonly module: string; readonly kind: 'unloaded' }
  | { readonly module: string; readonly kind: 'beyond'; readonly hops: number; readonly importer: string };

/**
 * How far a mock may reach: the test file's own imports at one, its subject's
 * imports at two: the line a file reading draws for the factory it offers.
 */
const SUBJECT_IMPORTS = 2;

/** The mocks past the subject's imports, or of what the file does not load: errors first, then nearest. */
export function misplacedOf(reach: readonly ShadowReach[]): readonly MisplacedMock[] {
  const unloaded = reach.filter(({ hops }) => hops === undefined).map(({ module }) => ({ module, kind: 'unloaded' as const }));
  const beyond = reach
    .filter(({ hops }) => hops !== undefined && hops > SUBJECT_IMPORTS)
    .map(({ module, hops, importer }) => ({ module, kind: 'beyond' as const, hops: hops!, importer: importer! }))
    .sort((left, right) => left.hops - right.hops);
  return [...unloaded, ...beyond];
}

/** One line per misplaced mock, each naming its fix. */
export function misplacedLines(file: string, mocks: readonly MisplacedMock[]): readonly string[] {
  return mocks.map((mock) =>
    mock.kind === 'unloaded'
      ? `error: ${file} mocks ${mock.module}, which it does not load, directly or through anything it imports: ` +
        'the mock replaces nothing. Delete it.'
      : `warning: ${file} mocks ${mock.module}, ${mock.hops} imports away; ${mock.importer} imports it, and ${file} does not ` +
        `import ${mock.importer}. Mock the import of the subject that loads it, or fix ${mock.importer}.`);
}
