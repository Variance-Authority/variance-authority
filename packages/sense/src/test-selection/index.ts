import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { digestString } from '@variance-authority/core';
import { openTestCoverage } from './format.js';
import { selectTestFilesFromView } from './select.js';

export interface CoverageBlock {
  readonly ordinal: number;
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly testFiles: readonly string[];
}

export interface CoverageModule {
  readonly file: string;
  readonly blocks: readonly CoverageBlock[];
}

export interface TestCoverage {
  readonly version: 1;
  readonly modules: readonly CoverageModule[];
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
