/**
 * Which imports a set of rules forbids, decided over the edges the source
 * index already holds.
 *
 * A rule names a `from` and a `to`, each a folder, a glob or `*`, and is either
 * `allowed` or `restricted`. For one import the first rule that matches both
 * ends decides; no match means the import is unrestricted. Rules live in
 * `.relations.json` files, and a file's paths are written relative to its own
 * directory (`.` is the directory itself). Every file in or above either end of
 * an import applies, the deepest first, so a folder's own rules override the
 * ones above it. This is the model of `eslint-plugin-relations`, over a graph
 * that was read once instead of a lint pass that opens each file.
 *
 * It performs no I/O: it takes the rule files as read and the records as
 * published, so the same edges that answer every other question answer this one.
 */

// compass: variance-authority.reach.relations

import type { FileRecord } from '@variance-authority/core/relate';
import { matchesGlob } from './source-scope.js';

/** One rule as written in a `.relations.json` file. */
export interface RelationRule {
  /** Where the import is written. Absent: anywhere. */
  readonly from?: string;
  /** Where it points. Absent: anywhere. */
  readonly to?: string;
  readonly type: 'allowed' | 'restricted';
  /** Why, said to whoever broke the rule. */
  readonly message?: string;
}

/** A ceiling on the layer of the packages `for` names, as written in a `.relations.json` file. */
export interface LayerCap {
  /** A folder or a glob holding the packages, written like `from` and `to`. */
  readonly for: string;
  readonly maxLayer: number;
  /** Why, said to whoever crossed it. */
  readonly message?: string;
}

/** The rules of one `.relations.json`, and the repository-relative directory it sits in (empty for the root). */
export interface RuleFile {
  readonly directory: string;
  readonly rules: readonly RelationRule[];
  /** The layer ceilings the file states. Absent: none. */
  readonly caps?: readonly LayerCap[];
}

/** One package above the tightest ceiling that names it. */
export interface CapViolation {
  readonly package: string;
  readonly layer: number;
  readonly maxLayer: number;
  readonly message?: string;
  /** The directory of the rule file that states the ceiling. */
  readonly directory: string;
}

/** The rule that decided one import, and the file it was written in. */
export interface Decision {
  readonly rule: RelationRule;
  readonly directory: string;
}

/** One import a restricting rule decided. */
export interface Violation {
  readonly from: string;
  readonly to: string;
  readonly message?: string;
  readonly directory: string;
}

function depth(directory: string): number {
  return directory === '' ? 0 : directory.split('/').length;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function inside(directory: string, path: string): boolean {
  return directory === '' || path === directory || path.startsWith(`${directory}/`);
}

/** Whether `pattern`, written in `directory`, holds `path`: a folder holds what is under it, a glob holds a path or any folder above it. */
function holds(directory: string, pattern: string | undefined, path: string): boolean {
  if (pattern === undefined || pattern === '*') return true;
  const written = pattern === '.' ? '' : pattern.replace(/^\.\//u, '').replace(/\/+$/u, '');
  const resolved = directory === '' ? written : written === '' ? directory : `${directory}/${written}`;
  if (!/[*?[{]/u.test(resolved)) return inside(resolved, path);
  const parts = path.split('/');
  for (let count = 1; count <= parts.length; count += 1) {
    if (matchesGlob(resolved, parts.slice(0, count).join('/'))) return true;
  }
  return false;
}

/** The rule files that apply to an import: those in or above either end, deepest first. */
function applying(files: readonly RuleFile[], from: string, to: string): RuleFile[] {
  return files
    .filter((file) => inside(file.directory, from) || inside(file.directory, to))
    .sort((a, b) => depth(b.directory) - depth(a.directory) || byCodeUnit(a.directory, b.directory));
}

/** The first rule that matches an import, or nothing when it is unrestricted. */
export function relationBetween(files: readonly RuleFile[], from: string, to: string): Decision | undefined {
  for (const file of applying(files, from, to)) {
    for (const rule of file.rules) {
      if (holds(file.directory, rule.from, from) && holds(file.directory, rule.to, to)) {
        return { rule, directory: file.directory };
      }
    }
  }
  return undefined;
}

/** Every import between files a `restricted` rule decides, in code-unit order of importer and then target. */
export function restrictedImports(records: readonly FileRecord[], files: readonly RuleFile[]): Violation[] {
  if (files.length === 0) return [];
  const found: Violation[] = [];
  for (const record of records) {
    const seen = new Set<string>();
    for (const edge of record.edges ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      const decision = relationBetween(files, record.file, edge.to);
      if (decision?.rule.type !== 'restricted') continue;
      found.push({
        from: record.file,
        to: edge.to,
        directory: decision.directory,
        ...(decision.rule.message === undefined ? {} : { message: decision.rule.message }),
      });
    }
  }
  return found.sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to));
}

// TODO: a floor on the layer of what a package may import (`toLayerBelow`) is not written; the layer of a
// target moves when the target's own imports change, so it would fail a build for an edit elsewhere.

/**
 * Every package above a ceiling that names it, in code-unit order. Every file
 * counts, wherever it sits: a ceiling names the packages it holds, not the
 * imports that cross it. Where several ceilings hold one package the lowest
 * decides, so a folder's cap cannot be loosened by a cap written below it.
 */
export function cappedLayers(
  layers: readonly { readonly package: string; readonly directory: string; readonly layer: number }[],
  files: readonly RuleFile[],
): CapViolation[] {
  const found: CapViolation[] = [];
  for (const entry of layers) {
    let tightest: CapViolation | undefined;
    for (const file of files) {
      for (const cap of file.caps ?? []) {
        if (!holds(file.directory, cap.for, entry.directory)) continue;
        if (tightest !== undefined && tightest.maxLayer <= cap.maxLayer) continue;
        tightest = {
          package: entry.package,
          layer: entry.layer,
          maxLayer: cap.maxLayer,
          directory: file.directory,
          ...(cap.message === undefined ? {} : { message: cap.message }),
        };
      }
    }
    if (tightest !== undefined && entry.layer > tightest.maxLayer) found.push(tightest);
  }
  return found.sort((a, b) => byCodeUnit(a.package, b.package));
}
