import type { Config } from '../config.js';
import { attestedDeployment, readAttested } from './attested.js';
import type { ChangelogViewOptions } from './changelog.js';

/**
 * `variance changelog` for a `remote` store: the history its deployment
 * recorded, read with the share token.
 *
 * The deployment groups approvals by the change that caused them, as `accept`
 * groups them into a commit message, so the two histories read in the same
 * columns. The filters are the deployment's: it narrows before it answers, and
 * this prints what came back.
 */

/** One change the deployment recorded approvals for, across every build that carried it. */
export interface RemoteChange {
  readonly fingerprint: string;
  readonly component?: string;
  readonly file?: string;
  readonly subjects: readonly string[];
  readonly builds: readonly string[];
  readonly by: readonly string[];
  readonly at: string;
  readonly intent?: string;
  readonly note?: string;
}

/** One approved subject no change could explain. */
export interface RemoteUngrouped {
  readonly build: string;
  readonly subject: string;
  readonly commit: string;
  readonly intent?: string;
  readonly by: string;
  readonly note?: string;
  readonly at: string;
}

/** `GET /review/changelog`, as the deployment answers it. */
export interface RemoteChangelog {
  readonly changes: readonly RemoteChange[];
  readonly ungrouped: readonly RemoteUngrouped[];
}

export interface RemoteChangelogOptions extends ChangelogViewOptions {
  readonly config: Pick<Config, 'review' | 'baselines' | 'share'>;
  readonly deployment: string;
  readonly limit?: number;
  /** An instant: the deployment's history is ordered by time, not by commit. */
  readonly since?: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** The deployment's changelog, narrowed there, or an operator error naming why it could not be read. */
export async function readRemoteChangelog(options: RemoteChangelogOptions): Promise<RemoteChangelog> {
  const deployment = attestedDeployment(options.config, [options.deployment]);
  const answer = await readAttested(
    options.config,
    deployment,
    '/review/changelog',
    { component: options.component, subject: options.subject, limit: options.limit, since: options.since },
    options.fetch,
  );
  return answer as RemoteChangelog;
}

/**
 * The deployment's history in the git history's columns: the change, how many
 * subjects it reached, when, under which builds, and who approved it.
 *
 * Ends on where it was read, always, as the git reading ends on what bounded it:
 * a reader who knows the record came from a deployment knows that a reviewer's
 * approval is in it and a commit to the baseline root is not.
 */
export function formatRemoteChangelog(
  changelog: RemoteChangelog,
  deployment: string,
  view: ChangelogViewOptions & { readonly since?: string } = {},
): string {
  const blocks = changelog.changes.map((change) => {
    const where = [change.component, change.file].filter((part) => part !== undefined).join(' ');
    return [
      `${change.fingerprint} ${where === '' ? 'unattributed' : where} ${String(change.subjects.length)}  ` +
        `${change.at}  builds ${change.builds.join(', ')}  by ${change.by.join(', ')}`,
      ...(change.intent === undefined ? [] : [`  ${change.intent}`]),
      ...(change.note === undefined ? [] : [`  note: ${change.note}`]),
    ].join('\n');
  });

  if (changelog.ungrouped.length > 0) {
    blocks.push(
      [
        `${String(changelog.ungrouped.length)} approved subject(s) no shape could group:`,
        ...changelog.ungrouped.map(
          (entry) =>
            `  ${entry.at}  ${entry.subject}  build ${entry.build} @ ${entry.commit.slice(0, 12)}  by ${entry.by}` +
            (entry.note === undefined ? '' : `  note: ${entry.note}`),
        ),
      ].join('\n'),
    );
  }

  if (blocks.length === 0) {
    const filtered = view.component !== undefined || view.subject !== undefined || view.since !== undefined;
    blocks.push(filtered ? 'no recorded approval matches that filter' : `${deployment} records no approval`);
  }

  return [...blocks, `note: read from ${deployment}, which recorded these approvals when a reviewer made them`].join(
    '\n\n',
  );
}
