/**
 * The two readings an orientation is made of, asked of the addon.
 *
 * Both are one call each and both are the addon's alone. The package graph is
 * folded out of a source index of a hundred megabytes on a large repository,
 * and a recording's cases are sets over every test the suite has; either one
 * handed across as objects would cost more than the question. So nothing here
 * computes: it finds the files the addon reads, calls it, and returns what it
 * answered. A scanner without the entries is refused, naming why, because no
 * other copy of either reading exists to answer instead.
 *
 * Orientation reads what earlier runs published and never runs anything
 * itself: no index is scanned here and no suite is recorded, so a checkout that
 * has neither gets an answer that says so rather than one that waits.
 */

// compass: variance-authority.reach.relations

import { native, nativeRefusal } from './native.js';
import type { NativeCasesEntered, NativeExternalOrientation, NativeOrientation } from './native-orient.js';
import { sourceIndexPath } from './source-index.js';
import { layeredFiles, repositoryLayers } from './test-selection/cache-layers.js';
import { recordPath, richestCaseIndex } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

export type {
  NativeCasesEntered as CasesEntered,
  NativeOrientation as Orientation,
  NativeExternalOrientation as ExternalOrientation,
  NativeOrientFlow as OrientFlow,
  NativeOrientFlows as OrientFlows,
  NativeOrientPackage as OrientPackage,
  NativeOrientShare as OrientShare,
} from './native-orient.js';

/** How many rows and names per row one side of a package shows; the rest are counted. */
export interface OrientLimits {
  readonly rows: number;
  readonly names: number;
}

/** The package graph around some files, and the index it was read from. */
export interface PackagesAround {
  readonly index: string;
  /** Absent when no source index was ever published at `index`. */
  readonly orientation?: NativeOrientation;
}

function entry<Name extends 'orientPackages' | 'externalDependencies' | 'casesEntered'>(name: Name) {
  const scanner = native();
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(
      `orientation is read by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`,
    );
  }
  return call.bind(scanner) as NonNullable<typeof call>;
}

/**
 * The packages `files` belong to, what each takes from every other package and
 * what every other package takes from it, from the source index this checkout
 * published. `files` are paths from `root`.
 */
export function packagesAround(root: string, files: readonly string[], limits: OrientLimits): PackagesAround {
  const orient = entry('orientPackages');
  const index = sourceIndexPath(root);
  const orientation = orient(root, index, [...files], limits.rows, limits.names);
  return orientation === null ? { index } : { index, orientation };
}

/** External packages requested by the indexed local import closure of `files`. */
export function dependenciesAround(root: string, files: readonly string[], limits: OrientLimits): {
  readonly index: string;
  readonly orientation?: NativeExternalOrientation;
} {
  const inspect = entry('externalDependencies');
  const index = sourceIndexPath(root);
  const orientation = inspect(root, index, [...files], limits.rows, limits.names);
  return orientation === null ? { index } : { index, orientation };
}

/** One suite's recording, or why there is none to read. */
export type RecordedCases =
  | { readonly suite?: string; readonly recording: string; readonly files: readonly NativeCasesEntered[] }
  | { readonly suite?: string; readonly recording: string; readonly unread: string };

/**
 * For each suite the root config declares, or the one record of a repository
 * that declares none: the cases its latest recording says entered each of
 * `files`, with the first `titles` of them named; whether the file also ran as
 * its module loaded, which the recording credits to no case; and, for a test
 * file, the cases it declares.
 *
 * The layer holding the most cases answers, the nearest on a tie, the way every reader of
 * a recording finds one. A suite with none says where it looked, and so does
 * one the addon could not read, so the caller can say why that suite is absent
 * rather than print it as a suite that ran nothing.
 */
export function recordedCases(root: string, files: readonly string[], titles: number): readonly RecordedCases[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  const layers = repositoryLayers(root);
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const candidates = layeredFiles(layers, `${recordPath(root, suite)}.cases.bin`);
    const recording = richestCaseIndex(candidates);
    if (recording === undefined) return { ...named, recording: candidates[0]!, unread: 'nothing is recorded there' };
    const cases = entry('casesEntered');
    try {
      return { ...named, recording, files: cases(recording, [...files], titles) };
    } catch (error) {
      return { ...named, recording, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}
