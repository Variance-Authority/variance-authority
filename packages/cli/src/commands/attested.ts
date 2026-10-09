import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { shareAt } from '../version.js';

/**
 * Reading what a review deployment settled — its changelog and its decision
 * history — with the share token, which reads and never decides.
 *
 * The CLI holds two of a deployment's three tokens and sends each for one
 * thing: `review.token` is the ingest token and only `push` sends it, and
 * `share.token` reads. Neither can approve, and the review token, which can,
 * never appears in a config. So a machine — a laptop, an agent — asks what
 * reviewers decided with the token it already holds for the share, and the
 * deployment refuses that token at every route that decides.
 *
 * The deployment is the one the share is stored at, among those this config
 * names: the review surface `push` sends to and a `remote` baseline store. A
 * share stored anywhere else holds a token for somewhere else, and sending it
 * here would be sending a credential to the wrong service.
 */

type Reading = Pick<Config, 'review' | 'baselines' | 'share'>;

/** The deployments this config names, trailing slashes dropped, review surface first. */
export function deploymentsOf(config: Reading): readonly string[] {
  return [
    ...(config.review === undefined ? [] : [config.review.endpoint]),
    ...(config.baselines?.kind === 'remote' ? [config.baselines.endpoint] : []),
  ].map((endpoint) => endpoint.replace(/\/+$/, ''));
}

/**
 * The deployment whose share this config stores at, among `among`, or the
 * refusal naming what to declare.
 */
export function attestedDeployment(config: Reading, among: readonly string[] = deploymentsOf(config)): string {
  const found = among.find((endpoint) => shareAt(config.share, endpoint));
  if (found !== undefined) return found;
  const where = among.length === 0 ? 'a review deployment, and this config names none' : among.join(' or ');
  throw new OperatorError(
    `what reviewers decided is read from ${where} with that deployment's share token, and this ` +
      'config stores no `http` share there to hold one: a share kept anywhere else holds no token this ' +
      'deployment accepts. Store the share there, as `"share": { "kind": "http", ' +
      `"endpoint": "${among[0] ?? 'https://<deployment>'}/share", "token": { "env": "VARIANCE_SHARE_TOKEN" } }\``,
  );
}

/**
 * `GET` one route on `deployment` with the share token, and its JSON answer.
 *
 * Every failure is an operator error naming the URL: a reading that could not
 * be made is never an empty history, because an empty history is an answer.
 */
export async function readAttested(
  config: Reading,
  deployment: string,
  path: string,
  query: Readonly<Record<string, string | number | undefined>>,
  send: typeof globalThis.fetch = globalThis.fetch,
): Promise<unknown> {
  const share = config.share;
  if (share?.kind !== 'http' || share.token === undefined) {
    throw new OperatorError(
      `${deployment}${path} is read with the share token, and the share stored there declares none. ` +
        'Add `"token": { "env": "VARIANCE_SHARE_TOKEN" }` to `share`',
    );
  }
  const token = share.token();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
  const url = `${deployment}${path}${search.size === 0 ? '' : `?${search.toString()}`}`;

  let response: Response;
  try {
    response = await send(url, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  } catch (failure) {
    throw new OperatorError(`${url} could not be reached: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  if (!response.ok) {
    const said = await response.text().then(errorOf, () => '');
    throw new OperatorError(`${url} answered ${String(response.status)}${said === '' ? '' : `: ${said}`}. ${hintFor(response.status)}`);
  }
  return response.json();
}

function errorOf(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: unknown } | null)?.error;
    return typeof error === 'string' ? error : body.trim();
  } catch {
    return body.trim();
  }
}

function hintFor(status: number): string {
  if (status === 401 || status === 403) {
    return (
      'What review settled is read with the share token, from a deployment at API 4 or later: an older ' +
      'one refuses the share token here, and every one refuses the ingest token, which CI often sets ' +
      'the share variable to'
    );
  }
  if (status === 404) {
    return 'Nothing there serves this route: the endpoint is not a review deployment, or it is one older than API 4';
  }
  return 'The deployment refused the reading; its answer above says why';
}
