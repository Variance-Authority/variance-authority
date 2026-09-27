import { dirname, resolve } from 'node:path';
import { CARRIERS, type Carrier, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import { fail, object, path, quote, resolveFrom, type ParseOptions } from './config-values.js';

export type { Carrier };

/**
 * Where the run's artifacts live, and who carries each one off the machine.
 *
 * Before this, the config said where two artifacts lived on disk and nothing
 * about how any of them reached the next machine, so every workflow said it
 * again with literals: the baseline root, a cache key that restated the renderer
 * from an image tag, the report directory minus its baselines. Each literal was
 * a second owner of a path this file owns, and a config that moved one restored
 * into a directory the run never read. `carry` is the one place the answer is
 * written, and `variance carry` hands the host the path and key it implies.
 *
 * `carry` names who moves the bytes. `actions-cache` is the host, job to job;
 * `share` is `variance` itself, through the `share` section, where a checkout
 * can reach it. An artifact without `carry` stays on the machine that wrote it.
 */

/** Where the run's own report is written when the config does not say. */
export const DEFAULT_REPORT_PATH = '.variance/report.json';

export interface Placement {
  readonly report: string;
  readonly images: string;
  readonly reportCarry?: Carrier;
}

/**
 * `report` and `images`, resolved.
 *
 * `report` is a path, or `{ "path", "carry" }` once it is carried. The string
 * form stays, and means a report that is not carried. The images have no
 * `carry` of their own: the report names them, so they go where it goes.
 */
export function parsePlacement(root: Record<string, unknown>, options: ParseOptions): Placement {
  const value = root['report'];
  const carried = typeof value === 'object' && value !== null && !Array.isArray(value);
  const source = carried ? object(value, 'report', ['path', 'carry'], options) : root;
  const at = path(source, carried ? 'path' : 'report', options);
  if (carried && at === undefined) fail('report.path', 'is required when `report` is an object', options);
  const report = resolveFrom(options.baseDir, at ?? DEFAULT_REPORT_PATH);
  const carry = carried ? carrierOf(source['carry'], 'report.carry', options) : undefined;
  const images = path(root, 'images', options);

  return {
    report,
    // Beside the *report* rather than beside the config: `ObservationRecord.images`
    // paths are relative to the report, so an image directory anchored anywhere
    // else produces links that resolve to nothing on the machine reading them.
    images: images === undefined ? resolve(dirname(report), 'images') : resolveFrom(options.baseDir, images),
    ...(carry === undefined ? {} : { reportCarry: carry }),
  };
}

/**
 * A `carry` value: absent, or one of {@link CARRIERS}.
 *
 * `field` is the whole dotted name, because the refusal points at the one line
 * the operator edits.
 */
export function carrierOf(value: unknown, field: string, options: ParseOptions): Carrier | undefined {
  if (value === undefined) return undefined;
  if (!CARRIERS.includes(value as Carrier)) {
    fail(field, `must be one of ${CARRIERS.join(', ')}, not ${quote(value)}`, options);
  }

  return value as Carrier;
}

/**
 * The baselines' carrier, which is the host's or nobody's.
 *
 * A share keeps one record per mainline and nothing older, and a baseline is
 * keyed by subject, label and identity, not by a run. The ones a reviewer
 * approved stay where the review flow puts them. So `share` is refused, with
 * the reason, instead of accepted and carried under the wrong rule.
 */
export function baselineCarrierOf(value: unknown, options: ParseOptions): 'actions-cache' | undefined {
  const carry = carrierOf(value, 'baselines.carry', options);
  if (carry === 'share') {
    fail(
      'baselines.carry',
      'must be "actions-cache": a share keeps the latest record per mainline, and baselines are ' +
        'kept by subject and identity, with approved ones where the review flow puts them',
      options,
    );
  }

  return carry;
}

/**
 * Refuse a `share` carrier the file gives no share to carry it.
 *
 * Checked once every section is read, because the carrier is named on the
 * artifact and the share it needs is a section of its own. A `share` carrier
 * with no `share` section would save nothing and say nothing.
 */
export function checkCarriers(
  carried: {
    readonly share: unknown;
    readonly reportCarry: Carrier | undefined;
    readonly suites: readonly DeclaredSuite[] | undefined;
  },
  options: ParseOptions,
): void {
  if (carried.share !== undefined) return;
  if (carried.reportCarry === 'share') {
    fail('report.carry', 'is "share", and the file has no `share` section to carry it; add one', options);
  }
  const suite = carried.suites?.find((one) => one.carry === 'share');
  if (suite !== undefined) {
    fail(`suites.${suite.name}.carry`, 'is "share", and the file has no `share` section to carry it; add one', options);
  }
}
