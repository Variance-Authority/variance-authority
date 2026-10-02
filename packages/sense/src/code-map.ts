/**
 * The code map: the package graph folded into nested areas, a dozen or so to
 * a page, so a checkout of a thousand packages is read from the top down.
 *
 * Both halves are the addon's. `variance index` folds the map once, beside the
 * source index it is folded from, because the fold reads every record and a
 * question should not; a question then reads one page. Nothing here computes:
 * it finds the index, calls the addon, and returns what it answered.
 */

// compass: variance-authority.reach.relations

import { native, nativeRefusal } from './native.js';
import type { NativeDeclaredRoleCheck, NativeOrientLayers, NativeOrientMapAnswer, NativeOrientMapPrepared, NativeOrientShipped } from './native-orient.js';
import type { SourceUpdate } from './published.js';
import { sourceIndexPath } from './source-index.js';

export type {
  NativeOrientLayers as PackageLayers,
  NativeOrientPackageLayer as PackageLayer,
  NativeOrientMapAnswer as CodeMapAnswer,
  NativeOrientMapMade as CodeMapMade,
  NativeOrientMapPage as CodeMapPage,
  NativeOrientMapPrepared as CodeMapPrepared,
  NativeOrientMapRow as CodeMapRow,
  NativeOrientMapShare as CodeMapShare,
  NativeOrientShipped as ShippedFiles,
  NativeDeclaredRoleCheck as DeclaredRoleCheck,
  NativeDeclaredRoleFinding as DeclaredRoleFinding,
} from './native-orient.js';

function entry<Name extends 'prepareOrientMap' | 'orientMapPage' | 'orientLayers' | 'orientShipped' | 'checkDeclaredRoles'>(name: Name) {
  const scanner = native();
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(
      `the code map is made by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`,
    );
  }
  return call.bind(scanner) as NonNullable<typeof call>;
}

/** The code map prepared from the index at `index`; absent when there is no index. */
export interface PreparedCodeMap {
  readonly index: string;
  readonly prepared?: NativeOrientMapPrepared;
}

/**
 * Fold the checkout's source index into its code map and keep it beside the
 * index. A checkout with no package to fold keeps no map and says why.
 *
 * `scanned` is the update that published the index: its listing of the
 * checkout is carried, and when git could not give it one, git is not asked
 * again. Without it, git lists the checkout for the map, and the result says so.
 */
export async function prepareCodeMap(
  root: string,
  index: string = sourceIndexPath(root),
  scanned?: Pick<SourceUpdate, 'listing'>,
): Promise<PreparedCodeMap> {
  const carried = scanned?.listing?.prepareOrientMap?.bind(scanned.listing);
  const prepared = await (carried !== undefined
    ? carried(root, index)
    : entry('prepareOrientMap')(root, index, scanned !== undefined && scanned.listing === undefined ? true : null));
  return prepared === null ? { index } : { index, prepared };
}

/** One page of the code map, and the index it was folded from. */
export interface CodeMapRead {
  readonly index: string;
  /** Absent when no map is kept beside the index. */
  readonly answer?: NativeOrientMapAnswer;
}

/** The top page of the checkout's code map, or the page of `area` (`4.1`). */
export function codeMapPage(root: string, area?: string): CodeMapRead {
  const index = sourceIndexPath(root);
  const answer = entry('orientMapPage')(index, area ?? null);
  return answer === null ? { index } : { index, answer };
}

/**
 * Every package's dependency layer from the code map kept beside `index`,
 * which is the checkout's own when none is named. Absent when no map is kept
 * there, so a base that was never indexed is not read as a checkout in which
 * nothing moved.
 */
export function packageLayers(root: string, index: string = sourceIndexPath(root)): NativeOrientLayers | undefined {
  return entry('orientLayers')(index) ?? undefined;
}

/**
 * The files the code map read as shipped — every counted file its fold did
 * not put on the tests' side — kept beside `index`. Absent when no map is kept
 * there.
 */
export function shippedFiles(root: string, index: string = sourceIndexPath(root)): NativeOrientShipped | undefined {
  return entry('orientShipped')(index) ?? undefined;
}

/**
 * The roles docs declare with `@testOnly` and `@production`, checked against
 * the shipped files kept beside `index`. Absent when there is no index.
 */
export async function declaredRoles(root: string, index: string = sourceIndexPath(root)): Promise<NativeDeclaredRoleCheck | undefined> {
  return (await entry('checkDeclaredRoles')(index)) ?? undefined;
}
