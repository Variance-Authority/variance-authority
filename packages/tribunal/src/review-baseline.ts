import { identityDigest, intersectionArea, type RenderIdentity } from '@variance-authority/core/format';
import type { RasterStore } from '@variance-authority/raster';
import type { RegionRecord } from '@variance-authority/report';
import type { D1Like, D1PreparedLike } from './bindings.js';
import { BaselineMoved, optionalText, ReviewError, text, type Row } from './review-rows.js';
import { buildIdentity, promotedIdentity } from './review-write.js';

/**
 * Which baseline a decision about a subject is taken against.
 *
 * The answer is the `baselines` row an approval would overwrite: same subject,
 * no label, and the identity {@link promotedIdentity} picks. Its document digest
 * is the version, because the store already keeps it and replaces it on every
 * promotion — from this build, from another one, or from a run's own
 * `baseline/put`. Decisions are not the owner: an approval recorded against
 * another build says nothing about what `variance accept` wrote since.
 */

/**
 * Every unlabelled baseline of the subjects in one build, for the build page.
 *
 * All identities, filtered in {@link standingVersions}: the identity is a JSON
 * column per subject, and the batch it rides in cannot read it first. Read here
 * rather than through `RasterStore.describe`, which answers the same question for
 * one subject at the cost of a query and an R2 `head`; a build page asks it of
 * every subject at once, and needs the digest, not proof the bytes are there.
 */
export function standingStatement(db: D1Like, project: string, build: string): D1PreparedLike {
  return db
    .prepare(
      `SELECT subject, identity_digest, document_digest FROM baselines
        WHERE project = ? AND label = ''
          AND subject IN (SELECT subject FROM build_subjects WHERE project = ? AND build = ?)`,
    )
    .bind(project, project, build);
}

/**
 * The version for each subject row of a build, from {@link standingStatement}'s
 * rows and the identity the build's summary already read back.
 */
export function standingVersions(
  rows: readonly Row[],
  identity: RenderIdentity,
): (subject: Row) => { readonly baselineVersion: string | null } {
  const standing = new Map<string, string>();
  for (const row of rows) {
    const key = `${text(row, 'subject', 'a baseline')}\n${text(row, 'identity_digest', 'a baseline')}`;
    standing.set(key, text(row, 'document_digest', 'a baseline'));
  }

  return (subject) => {
    const digest = identityDigest(promotedIdentity(subject, identity));
    const key = `${text(subject, 'subject', 'a build subject')}\n${digest}`;
    return { baselineVersion: standing.get(key) ?? null };
  };
}

/**
 * Refuse an approval whose baseline moved where it changed too.
 *
 * Read the way a merge reads code: a baseline that moved is not a conflict by
 * itself. The approvals that moved it since this build ran each froze the
 * regions they changed, and when none of them meets one of this build's the
 * approval goes through. It is refused when one does, when what stands now was
 * written by something that names no regions — a run's own `baseline/put` —
 * and when there was no baseline when the page was read, since then both sides
 * added the whole image.
 *
 * Asked of the baseline store, under the identity the approval would write, so
 * the answer is the one the promotion that follows acts on. Checked before
 * anything is promoted or recorded. The check and the write are not one
 * transaction, so two decisions landing in the same instant can both pass; what
 * it closes is the reviewer who read the page minutes ago.
 */
export async function refuseMoved(
  baselines: RasterStore,
  db: D1Like,
  project: string,
  build: string,
  subject: Row,
  read: string | null,
): Promise<void> {
  const name = text(subject, 'subject', 'a build subject');
  const buildRow = await db
    .prepare('SELECT identity FROM builds WHERE project = ? AND build = ?')
    .bind(project, build)
    .first<Row>();
  const identity = buildRow === null ? null : buildIdentity(buildRow);
  if (identity === null) {
    throw new ReviewError(
      `build "${build}" does not carry a renderer identity that can be read back, so there is no ` +
        `telling which baseline a decision about "${name}" would replace`,
    );
  }

  // `describe` answers under any identity and says whether it was this one; a
  // baseline another machine wrote is not the one this approval replaces.
  const now = await baselines.describe({ subject: name }, promotedIdentity(subject, identity));
  const current = now?.comparable === true ? now.documentDigest : null;
  if (current === read) return;
  // Somebody approved this build's image first; promoting it again moves nothing.
  if (current !== null && current === optionalText(subject, 'candidate_document_digest', 'a build subject')) return;

  const clash =
    read === null || current === null
      ? 'there is no telling where the two differ'
      : await clashSince(db, project, build, subject, current);
  if (clash === null) return;

  const was = read === null ? 'no baseline' : `the one painted from document ${read}`;
  const is = current === null ? 'now there is none' : `it is now the one painted from document ${current}`;
  throw new BaselineMoved(
    `the baseline for "${name}" moved while you were reviewing: you read ${was}, and ${is}; ${clash}. ` +
      'Nothing was recorded. The images are still the ones the run compared; reload the subject to ' +
      'decide against the baseline standing now',
    read,
    current,
  );
}

/**
 * Where the approvals since this build ran changed the subject in the same
 * place it did, or `null` when none did.
 *
 * Every approval after the build counts, not only the one standing now: a
 * baseline moved twice carries both changes. The last of them must be the image
 * standing now; anything else wrote it after, and said no regions.
 */
async function clashSince(
  db: D1Like,
  project: string,
  build: string,
  subject: Row,
  current: string,
): Promise<string | null> {
  const name = text(subject, 'subject', 'a build subject');
  const { results } = await db
    .prepare(
      `SELECT changelog.build, changelog.regions, build_subjects.candidate_document_digest AS promoted
         FROM changelog
         LEFT JOIN build_subjects ON build_subjects.project = changelog.project
          AND build_subjects.build = changelog.build AND build_subjects.subject = changelog.subject
        WHERE changelog.project = ? AND changelog.subject = ? AND changelog.build <> ?
          AND changelog.at_ms >= (SELECT at_ms FROM builds WHERE project = ? AND build = ?)
        ORDER BY changelog.seq`,
    )
    .bind(project, name, build, project, build)
    .all<Row>();

  const last = results.at(-1);
  if (last === undefined || optionalText(last, 'promoted', 'a changelog entry') !== current) {
    return 'what wrote it was not an approval here, and says nothing about where it changed';
  }

  const ours = regionsOf(subject, 'a build subject');
  for (const entry of results) {
    const theirs = regionsOf(entry, 'a changelog entry');
    const met = theirs.find((region) => ours.some((mine) => intersectionArea(mine, region) > 0));
    if (met !== undefined) {
      return (
        `build "${text(entry, 'build', 'a changelog entry')}" changed it at ` +
        `${met.x},${met.y} ${met.width}×${met.height}, where this build changed it too`
      );
    }
  }
  return null;
}

function regionsOf(row: Row, what: string): readonly RegionRecord[] {
  const regions: unknown = JSON.parse(text(row, 'regions', what));
  if (!Array.isArray(regions)) throw new ReviewError(`${what} has a \`regions\` that is not a list`);
  return regions as readonly RegionRecord[];
}
