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
import { keepsCases } from './test-selection/case-record.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
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

function entry<Name extends 'orientPackages' | 'orientAround' | 'externalDependencies' | 'casesEntered'>(name: Name) {
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

/**
 * `packagesAround` and `dependenciesAround` over one read of the chain and one listing of the tree, which is
 * what either costs: where the repository leaves `core.fsmonitor` off, `git status` is 2.2 s on seven copies
 * of Material UI, and a question that made it twice paid 4.4 s.
 */
export function orientAround(root: string, files: readonly string[], packages: OrientLimits, external: OrientLimits): {
  readonly packages: PackagesAround;
  readonly external: DependenciesAround;
} {
  const index = sourceIndexPath(root);
  const both = entry('orientAround')(root, index, [...files], packages.rows, packages.names, external.rows, external.names);
  return both === null
    ? { packages: { index }, external: { index } }
    : { packages: { index, orientation: both.packages }, external: { index, orientation: both.external } };
}

/** The external requests part of an answer. */
export interface DependenciesAround {
  readonly index: string;
  readonly orientation?: NativeExternalOrientation;
}

/** External packages requested by the indexed local import closure of `files`. */
export function dependenciesAround(root: string, files: readonly string[], limits: OrientLimits): DependenciesAround {
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
 * `files`, with the first `titles` of them named; for a file that also ran as
 * its module loaded, which the recording credits to no case, the cases whose
 * test files import it over the source index at `root`; and, for a test file,
 * the cases it declares.
 *
 * The case index the nearest snapshot carries answers, the way every reader of
 * a recording finds one. A suite with none says where it looked, and so does
 * one the addon could not read, so the caller can say why that suite is absent
 * rather than print it as a suite that ran nothing.
 */
export function recordedCases(root: string, files: readonly string[], titles: number): readonly RecordedCases[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const recording = nearestTestCoverage(root, { suite });
    if (!keepsCases(recording)) return { ...named, recording, unread: 'no run kept its cases there' };
    const cases = entry('casesEntered');
    try {
      return { ...named, recording, files: cases(recording, [...files], titles, sourceIndexPath(root)) };
    } catch (error) {
      return { ...named, recording, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}
