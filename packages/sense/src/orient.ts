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

import { native, nativeRefusal } from './addon.js';
import type { ContainerMember } from './help-reading.js';
import type { NativeCasesEntered, NativeExternalOrientation, NativeOrientation } from './native-orient.js';
import { sourceIndexPath } from './source-index.js';
import { eachSuiteCases } from './suite-cases.js';

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

/** One top-level declaration of a file, from its parse in the source index. */
export interface FileDeclaration {
  readonly name: string;
  /** The word the reader of its language gave it: `function`, `class`, `const`, … */
  readonly kind: string;
  readonly line: number;
  /** Whether an export of the file binds the name; absent when the parse kept no exports to tell by. */
  readonly exported?: boolean | null;
  /** The members declared on it, by line, as many as the line budget left. */
  readonly members: readonly ContainerMember[];
}

/** What one asked file declares at its top level. */
export interface FileDeclarations {
  readonly file: string;
  /** False when the index holds the file and no parse of its declarations: whether it declares anything is unknown. */
  readonly read: boolean;
  readonly declarations: readonly FileDeclaration[];
  /** The top-level declarations the budget left out. */
  readonly more: number;
  /** The member lines the budget left out, those of a declaration it cut included; a line that declares several members is one. */
  readonly moreMembers: number;
  /** The top-level names the file binds, does not declare and is not known to export: none is listed. */
  readonly bound: number;
  /** False when the index kept no exports of the file, or no parse: whether a name is exported is unknown, the bound ones included. */
  readonly exportsKept: boolean;
}

/** A line of a file, asked about as `<path>:<line>`; lines count from one. */
export interface AskedLine {
  readonly file: string;
  readonly line: number;
}

/** A declaration whose first and last lines enclose an asked line. */
export interface LineHolder {
  readonly name: string;
  /** `function`, `class`, `const`, … for a declaration; `property`, `method`, `getter`, `setter` or `accessor` for a member. */
  readonly kind: string;
  /** Its first line: a member's is the line of its name. */
  readonly line: number;
  /** Its last line. */
  readonly end: number;
}

/** The declarations an asked line is in, from the file's parse in the source index. */
export interface LineHeld {
  readonly file: string;
  readonly line: number;
  /** False when the index holds the file and no parse of its declarations: which declarations the line is in is unknown. */
  readonly read: boolean;
  /** Outermost first; none when the line is at the top level of the module. Names one statement declares on the same lines are one holder, joined by `, `. */
  readonly holders: readonly LineHolder[];
}

/**
 * `packagesAround` and `dependenciesAround` over one read of the chain and one listing of the tree, which is
 * what either costs: where the repository leaves `core.fsmonitor` off, `git status` is 2.2 s on seven copies
 * of Material UI, and a question that made it twice paid 4.4 s. The same read gives what each file the index
 * holds declares at its top level, in the order asked, each within `declarationLines` lines: top-level
 * declarations first, then the members of a class, an interface or a type alias while lines are left. A name
 * the file only binds is counted, unless an export binds it. For each of `lines`, it gives the declarations
 * whose first and last lines enclose the line, whether or not any case ran it; a line of a file the index does
 * not hold is left out.
 */
export function orientAround(
  root: string,
  files: readonly string[],
  packages: OrientLimits,
  external: OrientLimits,
  declarationLines: number,
  lines: readonly AskedLine[],
): {
  readonly packages: PackagesAround;
  readonly external: DependenciesAround;
  /** Absent when no source index was ever published. */
  readonly declarations?: readonly FileDeclarations[];
  /** Absent when no source index was ever published. */
  readonly lines?: readonly LineHeld[];
} {
  const index = sourceIndexPath(root);
  const asked = lines.map(({ file, line }) => ({ file, line }));
  const all = entry('orientAround')(root, index, [...files], packages.rows, packages.names, external.rows, external.names, declarationLines, asked);
  return all === null
    ? { packages: { index }, external: { index } }
    : {
        packages: { index, orientation: all.packages },
        external: { index, orientation: all.external },
        declarations: all.declarations,
        lines: all.lines,
      };
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
  return eachSuiteCases(root, (recording) => ({ files: entry('casesEntered')(recording, [...files], titles, sourceIndexPath(root)) }));
}
