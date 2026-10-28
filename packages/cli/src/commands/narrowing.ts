/**
 * What a run narrows by, resolved: the refs it was given, the diff, files and
 * install behind each, and where the recorded index stands.
 *
 * Split from `since.ts`, which answers each of those questions alone. This asks
 * them together for one run, once per ref, so the file list, the install and
 * the hunks a ref names are all measured from the point that ref resolves to.
 */

import { installDiff, type InstallDiff } from './installed.js';
import type { MovedExports } from './reach.js';
import { changedSince, diffPoint, diffSince, indexPosition, movedSince } from './since.js';

/** What a run was asked to narrow by, before any of it has been resolved. */
export interface NarrowingRequest {
  /** `--since <ref>`. */
  readonly since?: string;
  /** `--against <ref>`. */
  readonly against?: string;
  /** Whether a file graph is configured, which is what makes `--since` imply `--against`. */
  readonly relations: boolean;
  /** `--suite <name>`: whose record's commit the diff is measured from. */
  readonly suite?: string;
}

/**
 * Resolve every ref a run was given, and the coordinate it was not.
 *
 * One fetch for both verbs when they name the same ref, and `--since` implies
 * `--against` wherever a graph is configured: the walk has already happened by
 * then, and a run that narrowed itself and could not say why is the one shape
 * worth avoiding.
 *
 * `index` is read whether or not the run narrows, because it is the answer to
 * *what would `--since` have cost* — and a run that never asks cannot put that
 * in the report, which leaves narrowing an option nobody reading the run knows
 * is there. Its commit is also where the journal's diff is measured from, since
 * the journal's line ranges are in that commit's coordinates and nothing else's;
 * beyond that it is carried and never acted on. Narrowing is the operator's
 * decision and stays one.
 */
export async function narrowingFor(
  request: NarrowingRequest,
  dirs: readonly string[],
): Promise<{
  readonly since?: {
    readonly ref: string;
    readonly changed: readonly string[];
    readonly install?: InstallDiff;
    readonly movedExports?: MovedExports;
    readonly diff?: string;
  };
  readonly against?: {
    readonly ref: string;
    readonly changed: readonly string[];
    readonly install?: InstallDiff;
    readonly movedExports?: MovedExports;
  };
  readonly index?: { readonly commit: string; readonly changed: number };
}> {
  const index = await indexPosition(process.cwd(), dirs, request.suite);
  const diff =
    request.since === undefined ? undefined : await diffSince(request.since, dirs, index?.commit);
  // The install is read at the same point the file list is measured from. A
  // diff of files against the merge base beside a diff of packages against
  // anything else would report bumps nobody made every time `main` moved.
  const changed = request.since === undefined ? undefined : await changedSince(request.since, dirs);
  // The changed files are read at that point too, from both texts.
  const point = request.since === undefined ? undefined : await diffPoint(request.since, dirs);
  const installed = changed === undefined ? undefined : await installDiff(point, changed);
  const movedExports = changed === undefined ? undefined : await movedSince(point, changed);
  const since =
    request.since === undefined || changed === undefined
      ? undefined
      : {
          ref: request.since,
          changed,
          ...(installed === undefined ? {} : { install: installed }),
          ...(movedExports === undefined ? {} : { movedExports }),
          ...(diff === undefined ? {} : { diff }),
        };
  const againstRef = request.against ?? (request.relations ? request.since : undefined);
  const against =
    againstRef === undefined
      ? undefined
      : againstRef === since?.ref
        ? {
            ref: againstRef,
            changed: since.changed,
            ...(installed === undefined ? {} : { install: installed }),
            ...(movedExports === undefined ? {} : { movedExports }),
          }
        : await (async () => {
            const changed = await changedSince(againstRef, dirs);
            // A second ref is a second install. Explaining a run by one diff's
            // packages while narrowing it by another's would put a bump in the
            // report that no selected subject was selected for.
            const at = await diffPoint(againstRef, dirs);
            const read = await installDiff(at, changed);
            const still = await movedSince(at, changed);
            return {
              ref: againstRef,
              changed,
              ...(read === undefined ? {} : { install: read }),
              ...(still === undefined ? {} : { movedExports: still }),
            };
          })();

  return {
    ...(since === undefined ? {} : { since }),
    ...(against === undefined ? {} : { against }),
    ...(index === undefined ? {} : { index }),
  };
}
