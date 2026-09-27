import { createRequire } from 'node:module';
import type { ShareConfig } from './config-share.js';

/**
 * What this tool is, and what it expects the other end to be.
 *
 * A `variance push` that printed no version anywhere was the reason a mismatch
 * could run for weeks. The deployment was `0.1.1`, the CLI on the operator's
 * machine was newer, and the difference showed up only as symptoms nobody could
 * attribute: eight megabytes uploaded for a suite that had barely moved, thirty
 * seconds of silence for a body that takes under two on the wire, and an
 * approval that settled nothing. Each of those has a different-looking cause and
 * they all have the same one.
 *
 * So both ends say what they are, and the client says it out loud when they
 * differ. Not as an error — a mismatch is the ordinary state of a self-hosted
 * service, and refusing to talk to an older deployment would make upgrading this
 * package a breaking change for everybody who runs one. As a sentence, in front
 * of the wait it explains.
 */

/**
 * The tribunal wire contract this build of the CLI is written against.
 *
 * Restated rather than imported, for the reason `MAX_HAVE_DIGESTS` is: this
 * package does not depend on `@variance-authority/tribunal`, because a CLI that
 * compiled against its service could only talk to the one it shipped with. The
 * number is the contract, and the contract is the thing a deployment can be
 * older than.
 */
export const NEEDS_API = 3;

const require = createRequire(import.meta.url);

/** This package's own version, from the manifest rather than from a copy of it. */
export const CLI_VERSION: string =
  (require('../package.json') as { version?: string }).version ?? '0.0.0-unpublished';

/** What a deployment answered `GET /version` with, as much of it as this reads. */
export interface ServiceVersion {
  readonly api?: number;
  readonly schema?: number;
}

/** What this CLI knows about the far end, including that it knows nothing. */
export type Reached =
  | { readonly known: true; readonly api: number; readonly schema?: number }
  /**
   * No usable answer, which is itself the finding.
   *
   * A deployment older than `/version` answers 404 to it, so *unanswered* is not
   * an absence of information — it is the strongest available evidence that the
   * far end predates this route, and that is what `because` says.
   */
  | { readonly known: false; readonly because: string };

/**
 * Ask the deployment what it is, before sending it anything.
 *
 * Best-effort in every direction, like `/review/have`: a service that does not
 * answer, answers something else, or cannot be reached at all leaves the push
 * exactly as it was. The request that matters is the one after this, and its
 * failure is the one worth an exit code — a version probe that could fail a
 * build would mean a CLI that refuses to push to any deployment older than
 * itself, which is the opposite of the point.
 */
export async function reach(
  send: typeof globalThis.fetch,
  endpoint: string,
  token: string,
): Promise<Reached> {
  let answered: unknown;
  try {
    const response = await send(`${endpoint}/version`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return {
        known: false,
        because: `it answered ${String(response.status)} to GET /version, which is what a deployment older than that route does`,
      };
    }
    answered = await response.json();
  } catch {
    return { known: false, because: 'GET /version could not be reached' };
  }

  const api = (answered as ServiceVersion | null)?.api;
  if (typeof api !== 'number') {
    return { known: false, because: 'its answer to GET /version carried no `api` number' };
  }
  const schema = (answered as ServiceVersion).schema;
  return { known: true, api, ...(typeof schema === 'number' ? { schema } : {}) };
}

/**
 * What each API level added that a push from this CLI uses, said as the symptom
 * an operator sees on a deployment older than it. `share` marks the one that
 * matters only to a project whose share is stored at that deployment.
 */
const ADDED: readonly { readonly api: number; readonly share: boolean; readonly symptom: string }[] = [
  {
    api: 2,
    share: false,
    symptom: 'A push is a full upload of every image, because the deployment cannot say which images it already has',
  },
  {
    api: 2,
    share: false,
    symptom:
      'An approved baseline is stored under the run identity rather than the document one, so the subject can ' +
      'stay `new` after its approval',
  },
  {
    api: 3,
    share: true,
    symptom: 'The deployment answers 404 under /share/, so the share this project stores there holds nothing',
  },
];

/** Every symptom of a deployment at `api`, or of one that did not say, for this project. */
function missing(api: number | undefined, share: boolean): string {
  return ADDED.filter((added) => (api === undefined || api < added.api) && (share || !added.share))
    .map((added) => added.symptom)
    .join('. ');
}

/**
 * Whether `share` is an `http` share stored at the deployment `endpoint` names,
 * which is the one case where a deployment older than API 3 costs this project
 * its share. Scheme and host are compared as `URL` spells them, and trailing
 * slashes are ignored.
 */
export function shareAt(share: ShareConfig | undefined, endpoint: string): boolean {
  if (share?.kind !== 'http') return false;
  const base = normal(endpoint);
  const at = normal(share.endpoint);
  return at === base || at.startsWith(`${base}/`);
}

function normal(url: string): string {
  let spelled = url;
  try {
    spelled = new URL(url).href;
  } catch {
    // Not a URL: compared as written, which matches only the same string.
  }
  return spelled.replace(/\/+$/, '');
}

/**
 * The line an operator gets, or nothing when there is nothing to say.
 *
 * Silent when the two agree, and when the deployment is older but lacks nothing
 * this project uses: a tool that narrates its successes trains people to stop
 * reading it, and the push summary names both numbers either way. Otherwise it
 * names every symptom that applies, in both directions: a service behind this CLI
 * and a service ahead of it fail differently, and an operator deciding whether to
 * redeploy or to downgrade needs to know which one they have.
 *
 * `share` is {@link shareAt} for this project and this deployment.
 */
export function versionNote(reached: Reached, share: boolean): string | undefined {
  if (!reached.known) {
    return (
      `this deployment did not say which API version it serves — ${reached.because}. ` +
      `variance ${CLI_VERSION} speaks ${String(NEEDS_API)}, so expect what a deployment older ` +
      `than API 2 does. ${missing(undefined, share)}`
    );
  }
  if (reached.api === NEEDS_API) return undefined;
  if (reached.api < NEEDS_API) {
    const symptoms = missing(reached.api, share);
    if (symptoms === '') return undefined;
    return (
      `this deployment serves API ${String(reached.api)} and variance ${CLI_VERSION} speaks ` +
      `${String(NEEDS_API)}: it is the older half. ${symptoms}. Redeploy the tribunal from a ` +
      'matching release'
    );
  }
  return (
    `this deployment serves API ${String(reached.api)} and variance ${CLI_VERSION} speaks ` +
    `${String(NEEDS_API)}: this CLI is the older half. It will push correctly and will not use ` +
    'what that deployment added'
  );
}
