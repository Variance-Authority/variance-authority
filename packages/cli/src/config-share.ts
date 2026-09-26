import {
  declaredSecret,
  fail,
  kindOf,
  nonEmpty,
  object,
  optionalText,
  quote,
  resolveFrom,
  strings,
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
 * Three kinds, one layout: the latest record of each mainline and each branch,
 * and every image once by digest. `directory` is a path, which is what
 * `aws s3 sync`, an NFS mount and a laptop all are; `http` is a base URL and
 * optional credentials, which is what a bucket and a tribunal deployment are;
 * `git` is refs under `refs/variance/` in the repository that already hosts the
 * code.
 */
export type ShareConfig = DirectoryShare | HttpShare | GitShare;

interface SharedFields {
  /**
   * The branches whose latest record is kept, in order of priority.
   *
   * Unset, git answers: the branch `refs/remotes/<remote>/HEAD` names, then the
   * CI event's default branch. Never `main` by assumption.
   */
  readonly mainlines?: readonly string[];

  /** The remote that hosts the mainlines. Defaults to `origin`. */
  readonly remote?: string;
}

export interface DirectoryShare extends SharedFields {
  readonly kind: 'directory';
  readonly root: string;
}

export interface HttpShare extends SharedFields {
  readonly kind: 'http';
  readonly endpoint: string;
  /**
   * The bearer token, read from the environment when the share is used rather
   * than when the file is parsed — see {@link declaredSecret}. It throws a
   * `ConfigError` naming the variable when that variable is unset or empty, and
   * every caller turns that into a share miss: a share never fails a run, so a
   * missing share secret must not refuse the whole config.
   */
  readonly token?: () => string;
  /** The verb a write uses. `PUT` for a bucket, `POST` for a deployment that routes on it. */
  readonly method?: 'PUT' | 'POST';
}

export interface GitShare extends SharedFields {
  readonly kind: 'git';
  /** Where the refs sit. Defaults to `refs/variance`. */
  readonly namespace?: string;
}

const COMMON = ['kind', 'mainlines', 'remote'];

export function parseShare(value: unknown, options: ParseOptions): ShareConfig {
  const kind = kindOf(value, 'share', ['directory', 'http', 'git'], options);
  const common = (source: Record<string, unknown>): SharedFields => {
    const mainlines =
      source['mainlines'] === undefined ? undefined : strings(source['mainlines'], 'share.mainlines', options);
    if (mainlines?.length === 0) {
      fail('share.mainlines', 'must name at least one branch; leave it out to let git answer', options);
    }
    const remote = optionalText(source, 'remote', options, 'share.remote');
    return {
      ...(mainlines !== undefined ? { mainlines } : {}),
      ...(remote !== undefined ? { remote } : {}),
    };
  };

  if (kind === 'git') {
    const source = object(value, 'share', [...COMMON, 'namespace'], options);
    const namespace = optionalText(source, 'namespace', options, 'share.namespace');
    if (namespace !== undefined && !/^refs\/[^\s]+$/.test(namespace)) {
      fail('share.namespace', `must be a ref prefix under refs/, not ${quote(namespace)}`, options);
    }
    return { kind: 'git', ...(namespace !== undefined ? { namespace } : {}), ...common(source) };
  }

  if (kind === 'http') {
    const source = object(value, 'share', [...COMMON, 'endpoint', 'token', 'method'], options);
    // A declaration for the same reason the baseline store's token is one: the
    // value belongs to somebody's deployment and therefore to the environment,
    // while the decision to send it belongs in the file. Resolved late, because
    // a job with no such secret — a pull request from a fork — still runs.
    const token =
      source['token'] === undefined ? undefined : declaredSecret(source, 'token', options, 'share.token');
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

  const source = object(value, 'share', [...COMMON, 'root'], options);
  return {
    kind: 'directory',
    root: resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'share.root')),
    ...common(source),
  };
}
