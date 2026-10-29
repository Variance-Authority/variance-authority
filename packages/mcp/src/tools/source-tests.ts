import {
  coveringTests,
  coveringTestsInFile,
  functionsUnder,
  lostText,
  overwrittenOn,
  ranWhileLoading,
  unenteredSentence,
  type CoveringTest,
  type ExecutionIndex,
  type SourceTestTarget,
} from '@variance-authority/sense/test-selection';
import { stringArg, type Tool } from './tool.js';

/** Named tests that reached one source file, line, or function. */
export const sourceTests: Tool<ExecutionIndex> = {
  name: 'variance_source_tests',
  description:
    'Find named tests that reached a source file, line, or function. Tests are listed in ' +
    'identity order; nothing here ranks them by distance. To narrow the list to tests within ' +
    'a few imports of the file, or to tests in its own package, run `variance covering` with ' +
    '`--at-distance` or `--in-package`, which read the file graph this index does not carry.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Repository-relative source file.' },
      line: { type: 'integer', minimum: 1, description: 'Optional one-based source line.' },
      function: { type: 'string', description: 'Optional recorded function name, as `Cart/total`, or a scope such as a class, `Cart`, answered for every recorded function under it.' },
    },
    required: ['file'],
    additionalProperties: false,
  },
  run(index, input) {
    const file = stringArg(input, 'file');
    const line = optionalLine(input);
    const functionName = optionalFunction(input);
    if (line !== undefined && functionName !== undefined) {
      throw new Error('`line` and `function` are alternatives; provide at most one');
    }

    const module = index.modules.find((candidate) => candidate.file === file);
    if (module === undefined) return unknownFile(index, file);
    if (line !== undefined) {
      if (!module.blocks.some((block) =>
        block.source && block.startLine <= line && line <= block.endLine,
      )) return `Line ${line} is not indexed in ${file}.`;
      return focused(index, `line ${line}`, { file, line });
    }
    if (functionName !== undefined) {
      if (functionsUnder(module.blocks, functionName).length === 0) return `Function ${functionName} is not indexed in ${file}.`;
      return focused(index, `function ${functionName}`, { file, function: functionName });
    }
    return wholeFile(index, file);
  },
};

function optionalLine(input: Readonly<Record<string, unknown>>): number | undefined {
  const value = input['line'];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error('`line` must be a positive integer');
  }
  return value as number;
}

function optionalFunction(input: Readonly<Record<string, unknown>>): string | undefined {
  if (input['function'] === undefined) return undefined;
  return stringArg(input, 'function');
}

/**
 * The cases that called into a line or function, and, where a case ran it in
 * a text a later run wrote over, that which case ran it is not known: the
 * record measured neither that case's run there nor its absence, so it is
 * named by no case and read as no absence.
 */
function focused(index: ExecutionIndex, where: string, target: SourceTestTarget): string {
  // FIXME: say of each named test file whether it ran over the file as it is now, and when, as `covering` does (#817).
  const tests = coveringTests(index, target);
  const unknown = overwrittenOn(index, target) !== undefined;
  const lines = tests.length > 0
    ? [`${tests.length} named test(s) reached ${where} in ${target.file}:`, ...tests.map(formatTest), ...(unknown ? [`It is also ${lostText({ other: true, it: 'it' })}.`] : [])]
    : unknown
      ? [`${where.charAt(0).toUpperCase()}${where.slice(1)} in ${target.file} is ${lostText({ other: false, it: 'it' })}.`]
      : [`No named test called into ${where} in ${target.file}.`];
  if (ranWhileLoading(index, target)) lines.push(UNNAMED_LOADERS);
  return lines.join('\n');
}

/**
 * Said under a region that ran while its module evaluated.
 *
 * The record credits no case with that, because a module evaluates once per
 * realm for whichever case imported it first. The file graph names every case
 * whose file imports the module, and this host does not hold it, so the list
 * above is the callers alone.
 */
const UNNAMED_LOADERS =
  'It also ran while its module evaluated. The cases that loaded it are every case whose file ' +
  'imports the module, which the file graph answers and this index does not carry; ' +
  '`variance covering` reads the graph and names them wherever an import reaches the module.';

function wholeFile(index: ExecutionIndex, file: string): string {
  const ranges = coveringTestsInFile(index, file);
  if (ranges.length === 0) return `No source lines are indexed for ${file}.`;
  const identities = new Set(ranges.flatMap((range) => range.tests.map((test) => test.id)));
  const lines = [
    `${file} — ${ranges.length} source range(s), ${identities.size} named test(s)`,
  ];
  for (const range of ranges) {
    lines.push(range.startLine === range.endLine
      ? `line ${range.startLine}`
      : `lines ${range.startLine}-${range.endLine}`);
    lines.push(...(range.tests.length > 0
      ? [...range.tests.map((test) => `  ${formatTest(test)}`), ...(range.overwritten === undefined ? [] : [`  it is also ${lostText({ other: true, it: 'it' })}`])]
      : range.overwritten !== undefined
        ? [`  this range is ${lostText({ other: false, it: 'it' })}`]
        : [range.loaded === true ? '  no named test called into this range' : '  no named test reached this range']));
    if (range.loaded === true) lines.push('  ran while its module evaluated');
    // The range's cases are the ones an edit to its lines selects; a region with no line of its own would read as theirs.
    for (const region of range.unentered ?? []) {
      lines.push(`  ${unenteredSentence(region)}`);
    }
  }
  if (ranges.some((range) => range.loaded === true)) lines.push(UNNAMED_LOADERS);
  return lines.join('\n');
}

/**
 * One witness, with no distance beside it.
 *
 * `ExecutionCrossing.distance` is call-stack depth, ADR-0056 forecloses
 * recording one, and the collector writes zero everywhere — so a depth printed
 * here was a constant dressed as a measurement. Import hops are the quantity
 * that answers *how far away is this test*, and they are not in this index.
 */
function formatTest(test: CoveringTest): string {
  return `${test.name} — ${test.file} [${test.id}]`;
}

function unknownFile(index: ExecutionIndex, file: string): string {
  const files = index.modules.map((module) => module.file).sort(codeUnitOrder);
  return files.length === 0
    ? `Unknown source file: ${file}. The execution index contains no source files.`
    : `Unknown source file: ${file}. Indexed files:\n${files.map((candidate) => `  ${candidate}`).join('\n')}`;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
