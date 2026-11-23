/**
 * What the questions about one recorded test share: the checkout, file and
 * name they are asked with, and how one answer per declared suite is joined.
 */

// compass: variance-authority.report.agent-surface

import type { ToolInvocation } from '@variance-authority/mcp/tools';

/** The test a question about one recorded test is asked of. */
export interface AskedTest {
  readonly root: string;
  readonly file: string;
  readonly name?: string;
}

/** The checkout, file and name `question` was asked with, or the refusal of a call that names no checkout or file. */
export function askedTest(question: string, input: Record<string, unknown>, invocation: ToolInvocation<unknown> | undefined): AskedTest {
  const root = invocation?.root;
  if (root === undefined) {
    throw new Error(`\`${question}\` reads what a checkout published, and this host named no checkout to read`);
  }
  const file = typeof input['file'] === 'string' ? input['file'].trim() : '';
  if (file === '') throw new Error(`\`${question}\` takes \`--file\`, the test file that declares the test`);
  const name = typeof input['name'] === 'string' && input['name'].trim() !== '' ? input['name'].trim() : undefined;
  return { root, file, ...(name === undefined ? {} : { name }) };
}

/** The input both questions about one recorded test take. */
export const ASKED_TEST_INPUT = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'The test file that declares the test, from the root of the checkout or of the file system.' },
    name: { type: 'string', description: 'Optional when the file declares one recorded test. The test\'s name, or a word of it.' },
  },
  required: ['file'],
  additionalProperties: false,
} as const;

/** `suite x: ` before a suite's answer, nothing for the one suite a recording names no name for. */
export const ofSuite = (suite: string | undefined): string => (suite === undefined ? '' : `suite ${suite}: `);

/** One suite's answer, or why its recording cannot give one. */
export type SuiteAnswer = { readonly suite?: string } & ({ readonly answer: string } | { readonly refused: string });

/**
 * The answers of every declared suite, each named by its suite when it has
 * one, answers first; refused when no suite answers, and when there is none.
 */
export function suitesAnswer(root: string, suites: readonly SuiteAnswer[]): string {
  if (suites.length === 0) throw new Error(`the recording under ${root} holds no suite to read`);
  const answers = suites.flatMap((suite) => ('answer' in suite ? [`${ofSuite(suite.suite)}${suite.answer}`] : []));
  const refused = suites.flatMap((suite) => ('refused' in suite ? [`${ofSuite(suite.suite)}${suite.refused}`] : []));
  if (answers.length === 0) throw new Error(refused.join('\n'));
  return [...answers, ...refused].join('\n\n');
}
