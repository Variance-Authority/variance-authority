/**
 * The half of an instrumented run that a page cannot hold: what the blocks *are*.
 *
 * A probe in a realm the recorder does not own can only report an ordinal. The names, the source spans
 * and the digests that make an ordinal mean something are produced by the
 * transform, in whichever Node process ran the bundler — and for a reported run
 * that process is not the one that later drives the code. A Storybook is built
 * on Monday and read on Tuesday; a Playwright suite runs against a dev server
 * that started before the test did.
 *
 * So the transform writes its inventory down, keyed by the same repository the
 * coverage index is keyed by, and the run that drains the counters joins the two.
 * That join is the only thing this transport adds to
 * [spec 0028](../../../../docs/specs/0028-the-instrument.md): the probes and the
 * block ids are the ones Vitest already uses.
 */

import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { digestString } from '@variance-authority/core';
import { INSTRUMENTATION_ID, type Block } from '../instrument/index.js';
import type { CoverageBlock, CoverageModule } from './index.js';

/** One module the transform saw, whether or not it could read it. */
export interface CapturedModule {
  /** Repository-relative, forward-slashed: the same path a coverage row carries. */
  readonly file: string;
  readonly sourceDigest: string;
  /** False records module-level unknown evidence; consumers widen without consulting blocks. */
  readonly instrumented: boolean;
  readonly blocks: readonly CoverageBlock[];
}

/** The inventory one bundler process produced, as it is persisted. */
export interface InstrumentedModules {
  readonly version: 1;
  /** Probe recipe. An inventory from another recipe is discarded, never mixed. */
  readonly instrumentation: string;
  readonly modules: readonly CapturedModule[];
}

/**
 * Where one bundler's inventory lives, beside the coverage index it feeds.
 *
 * `label` separates two bundlers over one repository — a Storybook preview and
 * the application a Playwright suite drives are different builds of overlapping
 * source, and an inventory that mixed them would answer a block ordinal with
 * whichever build wrote last.
 */
export function instrumentedModulesFile(
  root: string,
  label = 'build',
  cacheRoot = process.env['XDG_CACHE_HOME'] ?? resolve(homedir(), '.cache'),
): string {
  const repository = digestString(resolve(root)).replace(/^[^:]+:/, '');
  return resolve(
    cacheRoot,
    'variance-authority',
    'test-selection',
    repository,
    `modules-${label}.json`,
  );
}

/** Replace one inventory atomically, so a reader never sees half a build. */
export async function writeInstrumentedModules(
  file: string,
  modules: readonly CapturedModule[],
): Promise<void> {
  const inventory: InstrumentedModules = {
    version: 1,
    instrumentation: INSTRUMENTATION_ID,
    modules: [...modules].sort((left, right) => codeUnitOrder(left.file, right.file)),
  };
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(inventory)}\n`, 'utf8');
  await rename(temporary, file);
}

/**
 * Read one inventory, or `undefined` when there is nothing to join against.
 *
 * A missing file and an inventory from another probe recipe are the same answer
 * on purpose: both mean this run has no block universe it may attribute to, and
 * [spec 0027](../../../../docs/specs/0027-a-test-is-selected-by-what-it-executed.md)
 * spends that as a full run rather than as a partial index.
 */
export async function readInstrumentedModules(
  file: string,
): Promise<InstrumentedModules | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const inventory = JSON.parse(text) as InstrumentedModules;
  if (inventory.version !== 1 || inventory.instrumentation !== INSTRUMENTATION_ID) return undefined;
  return inventory;
}

/** The coverage row a captured module makes once its crossings are known. */
export function coverageModule(
  module: CapturedModule,
  testFilesFor: (block: CoverageBlock) => readonly string[],
): CoverageModule {
  return {
    file: module.file,
    sourceDigest: module.sourceDigest,
    instrumented: module.instrumented,
    blocks: module.blocks.map((block) => ({
      ...block,
      testFiles: [...testFilesFor(block)].sort(codeUnitOrder),
    })),
  };
}

/**
 * One block as coverage records it: ordinals and offsets become lines.
 *
 * `lineOf` is how the offsets get back to the file the author edited. Absent, it
 * counts newlines in whatever text the block was cut from — right for a
 * transform that moved nothing, and a different number line for one that did.
 * The seams supply the bundler's own map; see `source-lines.ts`.
 */
export function coverageBlock(
  source: string,
  block: Block,
  lineOf: (offset: number) => number = (offset) => lineAt(source, offset),
): CoverageBlock {
  return {
    ordinal: block.ordinal,
    kind: block.kind,
    ...(block.owner === undefined ? {} : { owner: block.owner }),
    digest: block.digest,
    name: block.name,
    path: block.path,
    startLine: lineOf(block.start),
    endLine: lineOf(block.end > block.start ? block.end - 1 : block.end),
    source: block.end > block.start,
    testFiles: [],
  };
}

export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/** Strip a bundler's query suffix: `Button.tsx?v=1` is `Button.tsx`. */
export function cleanId(id: string): string {
  return id.split('?')[0] ?? id;
}

/** Product source, as every runner seam defaults to reading it. */
export function defaultInclude(file: string): boolean {
  return (
    isAbsolute(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !file.split(sep).includes('node_modules') &&
    !file.split(sep).includes('dist')
  );
}

export function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
