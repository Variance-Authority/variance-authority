import {
  fail,
  integer,
  kindOf,
  nonEmpty,
  object,
  optionalText,
  quote,
  resolveFrom,
  secret,
  url,
  type ParseOptions,
} from './config-values.js';

/**
 * The `share` section: where a run leaves what it derived, and where it looks first.
 *
 * Its own module rather than a section among the others because it is the only
 * one that configures no *observation*. Every other section decides what the run
 * sees or what it compares against; this one decides how long the run takes to
 * find out, and a reader auditing what a config can change about a verdict can
 * skip this file entirely.
 */

/**
 * Where a run leaves what it derived, so the next machine does not derive it again.
 *
 * Optional in a way `baselines` is not, and the difference is the whole design.
 * A baseline is what a comparison is *against*: it cannot be recomputed, so
 * where it lives is a decision with no safe default. Everything a share holds
 * was derived from a tree and can be derived again, so the default is *nowhere*,
 * turning it on costs a rebuild at worst, and an operator who misconfigures it
 * gets a slow run rather than a wrong one
 * ([`sharing.md`](../../../docs/sharing.md)).
 *
 * Two kinds, because the transports collapse into two. `directory` is a path,
 * which is what `actions/cache`, `aws s3 sync`, an NFS mount and a laptop all
 * are; `http` is a base URL and optional credentials, which is what a bucket, a
 * signed URL and a tribunal deployment all are.
 */
export type ShareConfig = DirectoryShare | HttpShare;

interface SharedFields {
  /**
   * The ref whose lineage a lookup walks, newest first. Defaults to `origin/main`.
   *
   * A ref rather than a commit because the operator is naming a *line*, and a
   * ref rather than a branch name because a runner's checkout may have no local
   * branch at all. What is actually asked for is the commits, so a ref that
   * moves between two runs costs nothing: the lookup names the commit it found.
   */
  readonly mainline?: string;

  /**
   * How many commits back a lookup will ask for. Defaults to 50.
   *
   * A bound rather than a policy. A branch that has been open for six months is
   * a branch whose mainline evaluation is wrong in every interesting way, and
   * three hundred round trips to discover that is worse than deriving it.
   */
  readonly depth?: number;
}

export interface DirectoryShare extends SharedFields {
  readonly kind: 'directory';
  readonly root: string;
}

export interface HttpShare extends SharedFields {
  readonly kind: 'http';
  readonly endpoint: string;
  readonly token?: string;
  /** The verb a write uses. `PUT` for a bucket, `POST` for a deployment that routes on it. */
  readonly method?: 'PUT' | 'POST';
}
export function parseShare(value: unknown, options: ParseOptions): ShareConfig {
  const kind = kindOf(value, 'share', ['directory', 'http'], options);
  const common = (source: Record<string, unknown>): SharedFields => {
    const mainline = optionalText(source, 'mainline', options, 'share.mainline');
    const depth =
      source['depth'] === undefined ? undefined : integer(source, 'depth', 'share.depth', options);
    return {
      ...(mainline !== undefined ? { mainline } : {}),
      ...(depth !== undefined ? { depth } : {}),
    };
  };

  if (kind === 'http') {
    const source = object(
      value,
      'share',
      ['kind', 'endpoint', 'token', 'method', 'mainline', 'depth'],
      options,
    );
    // Through `secret` for the same reason the baseline store's is: the value
    // belongs to somebody's deployment and therefore to the environment, while
    // the decision to send it belongs in the file.
    const token =
      source['token'] === undefined ? undefined : secret(source, 'token', options, 'share.token');
    const method = source['method'];
    if (method !== undefined && method !== 'PUT' && method !== 'POST') {
      fail('share.method', `must be "PUT" or "POST", not ${quote(method)}`, options);
    }

    return {
      kind: 'http',
      endpoint: url(source, 'endpoint', 'share.endpoint', options),
      ...(token !== undefined ? { token } : {}),
      ...(method === undefined ? {} : { method: method as 'PUT' | 'POST' }),
      ...common(source),
    };
  }

  const source = object(value, 'share', ['kind', 'root', 'mainline', 'depth'], options);
  return {
    kind: 'directory',
    root: resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'share.root')),
    ...common(source),
  };
}
