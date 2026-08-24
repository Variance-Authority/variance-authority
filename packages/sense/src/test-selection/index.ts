import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { digestString, type FileRecord } from '@variance-authority/core';
import { deviationFromView } from './deviation.js';
import { openTestCoverage } from './format.js';
import { selectTestFilesFromView } from './select.js';

export interface CoverageBlock {
  readonly ordinal: number;
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** False for a synthesized control-flow region with no source of its own. */
  readonly source: boolean;
  readonly testFiles: readonly string[];
}

export interface CoverageModule {
  readonly file: string;
  readonly blocks: readonly CoverageBlock[];
}

export interface TestCoverage {
  readonly version: 1;
  readonly testFiles: readonly string[];
  readonly modules: readonly CoverageModule[];
}

export interface CodeExtent {
  readonly files: number;
  readonly loc: number;
}

export interface TestDeviation {
  readonly testFile: string;
  /** Absent when the test is missing from Sense or its closure contains an opaque file. */
  readonly baseline?: CodeExtent;
  readonly slice: CodeExtent;
  readonly sensitivity?: number;
  readonly deviation?: number;
  readonly unknown?: readonly string[];
}

export interface VariationDeviation {
  /** Union of every test baseline. Absent if any baseline is indeterminate. */
  readonly baseline?: CodeExtent;
  /** Union of source lines entered by at least one test file. */
  readonly coverage: CodeExtent;
  readonly coverageRatio?: number;
  /** Arithmetic mean of per-test sensitivity. */
  readonly sensitivity?: number;
  readonly tests: readonly TestDeviation[];
}

export interface DeviationOptions {
  readonly root: string;
  /** Base Sense records including the test files and their product dependencies. */
  readonly records: readonly FileRecord[];
}

/** The repository-keyed cache location shared by the runner and CI selector. */
export function testCoverageFile(
  root: string,
  cacheRoot = process.env['XDG_CACHE_HOME'] ?? resolve(homedir(), '.cache'),
): string {
  const repository = digestString(resolve(root)).replace(/^[^:]+:/, '');
  return resolve(cacheRoot, 'variance-authority', 'test-selection', repository, 'coverage.bin');
}

/**
 * Query one persisted coverage snapshot and return whole test-file paths.
 * Only the section index and strings present in the result are decoded.
 */
export async function selectTestFiles(file: string, diff: string): Promise<readonly string[]> {
  return selectTestFilesFromView(openTestCoverage(await readFile(file)), diff);
}

/** Compare per-test execution slices with the static code each test can reach. */
export async function deviationOfTests(
  file: string,
  options: DeviationOptions,
): Promise<VariationDeviation> {
  return deviationFromView(openTestCoverage(await readFile(file)), options);
}
