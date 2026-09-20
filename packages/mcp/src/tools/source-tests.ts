import {
  coveringTests,
  coveringTestsInFile,
  type CoveringTest,
  type ExecutionIndex,
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
      function: { type: 'string', description: 'Optional exact indexed function name.' },
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
      return focused(file, `line ${line}`, coveringTests(index, { file, line }));
    }
    if (functionName !== undefined) {
      if (!module.blocks.some((block) =>
        block.source && block.kind === 'function' && block.name === functionName,
      )) return `Function ${functionName} is not indexed in ${file}.`;
      return focused(file, `function ${functionName}`, coveringTests(index, {
        file,
        function: functionName,
      }));
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

function focused(file: string, target: string, tests: readonly CoveringTest[]): string {
  if (tests.length === 0) return `No named test reached ${target} in ${file}.`;
  return [
    `${tests.length} named test(s) reached ${target} in ${file}:`,
    ...tests.map(formatTest),
  ].join('\n');
}

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
    lines.push(...(range.tests.length === 0
      ? ['  no named test reached this range']
      : range.tests.map((test) => `  ${formatTest(test)}`)));
  }
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
