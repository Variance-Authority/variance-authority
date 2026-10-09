import { decisionsQuery, type ReviewDecisionEntry, type ReviewSubject } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
import { attestedDeployment, readAttested } from './attested.js';

/**
 * The decisions one `variance_decisions` call asked for, read from the
 * deployment this config stores its share at, with the share token.
 *
 * The call's input is read once, by the tool's own `decisionsQuery`, so the
 * window fetched here and the window the answer narrows to are the same one.
 */
export async function decisionsSubject(
  config: Pick<Config, 'review' | 'baselines' | 'share'>,
  input: Readonly<Record<string, unknown>>,
  send: typeof globalThis.fetch = globalThis.fetch,
): Promise<ReviewSubject> {
  const query = decisionsQuery(input);
  const deployment = attestedDeployment(config);
  const answer = (await readAttested(
    config,
    deployment,
    '/review/decisions',
    { subject: query.subject, build: query.build, limit: query.limit },
    send,
  )) as { readonly decisions: readonly ReviewDecisionEntry[] };
  return { from: deployment, decisions: answer.decisions };
}
