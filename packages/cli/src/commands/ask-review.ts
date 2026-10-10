import type { Reviewed, ReviewTool } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
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
  const query = tool.query(input);
  const deployment = attestedDeployment(config);
  const answer = (await readAttested(config, deployment, tool.route, query, send)) as Omit<Subject, 'from'>;
  return { ...answer, from: deployment } as Subject;
}
