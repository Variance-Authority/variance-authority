import type { Reviewed, ReviewTool } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { attestedDeployment, readAttested } from './attested.js';

/**
 * What one review tool's call asked for, read from the deployment this config
 * stores its share at, with the share token.
 *
 * The call's input is read once, by the tool's own `query`, so the window
 * fetched here and the window the answer narrows to are the same one. The
 * route is the tool's too: every question about review is read here, the same
 * way, and none has a reader of its own.
 */
export async function reviewSubject<Subject extends Reviewed>(
  config: Pick<Config, 'review' | 'baselines' | 'share'>,
  tool: ReviewTool<Subject>,
  input: Readonly<Record<string, unknown>>,
  send: typeof globalThis.fetch = globalThis.fetch,
): Promise<Subject> {
  const query = queryOf(tool, input);
  const deployment = attestedDeployment(config);
  const answer = (await readAttested(config, deployment, tool.route, query, send)) as Omit<Subject, 'from'>;
  return { ...answer, from: deployment } as Subject;
}

/**
 * The tool's reading of a call. A call it cannot ask, such as one naming neither
 * subject nor build, is the operator's to fix, not a defect in the tool.
 */
function queryOf<Subject extends Reviewed>(
  tool: ReviewTool<Subject>,
  input: Readonly<Record<string, unknown>>,
): ReturnType<ReviewTool<Subject>['query']> {
  try {
    return tool.query(input);
  } catch (refusal) {
    throw new OperatorError(refusal instanceof Error ? refusal.message : String(refusal), { cause: refusal });
  }
}
