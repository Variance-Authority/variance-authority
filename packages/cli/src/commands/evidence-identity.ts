// compass: variance-authority.report.shard-merge
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { CanonicalValue } from '@variance-authority/core/format';
import type { Config } from '../config.js';
import { CLI_VERSION } from '../version.js';
import { sourceFiles } from './source-graph.js';
import { recipeOf, sha256Hex, type EvidenceBuild, type EvidenceDiagnostic, type EvidenceRecipe } from './evidence-part.js';

/**
 * Which bytes a collection read, and how — the two things every part of one
 * collection must agree on before a merge counts any of them.
 *
 * The build is the commit, the built Storybook file by file, and the source
 * the scan reads as it is on disk, so two jobs on one commit with different
 * edits in their checkouts are two builds. The recipe is everything in the
 * config that changes what a subject yields, with paths relative to where the
 * job ran, so the same checkout on two machines reads one recipe.
 */

const run = promisify(execFile);

/** The lexicon a part's rows are written in; a row's reading changes when this does. */
const LEXICON_VERSION = 1;

export interface Identity {
  readonly build: EvidenceBuild;
  readonly recipe: EvidenceRecipe;
  readonly diagnostics: readonly EvidenceDiagnostic[];
}

export async function evidenceIdentity(config: Config, cwd: string): Promise<Identity> {
  const diagnostics: EvidenceDiagnostic[] = [];
  const [commit, storybook, source] = await Promise.all([
    commitOf(cwd),
    config.subjects.kind === 'storybook' ? directoryDigest(dirname(config.subjects.index)) : undefined,
    sourceDigest(cwd, config.source?.dirs ?? []),
  ]);
  if (commit === undefined) {
    diagnostics.push({ severity: 'warn', code: 'build', message: `${cwd} is not a git checkout; the parts name no commit` });
  }
  return {
    build: {
      ...(commit === undefined ? {} : { commit }),
      ...(storybook === undefined ? {} : { storybook }),
      ...(source === undefined ? {} : { source }),
    },
    recipe: recipeOf(readsOf(config, cwd)),
    diagnostics,
  };
}

/** What in the config changes what a subject yields. Paths relative to `cwd`, in `/` form. */
export function readsOf(config: Config, cwd: string): CanonicalValue {
  const at = (path: string): string => relative(cwd, path).split(sep).join('/');
  const subjects = config.subjects;
  return {
    cli: CLI_VERSION,
    lexicon: LEXICON_VERSION,
    profile: config.profile,
    // The viewport the semantic key reads: the pixel ratio reaches only pixels.
    viewport: { width: config.viewport.width, height: config.viewport.height, colorScheme: config.viewport.colorScheme },
    browser: config.browser ?? null,
    fonts: [...config.fonts],
    subjects: {
      kind: subjects.kind,
      collector: at(subjects.collector),
      ...(subjects.kind === 'storybook' ? { excludeTags: [...(subjects.excludeTags ?? [])] } : {}),
    },
    source: (config.source?.dirs ?? []).map(at),
    names: (config.names ?? null) as unknown as CanonicalValue,
    blank: (config.blank ?? null) as unknown as CanonicalValue,
    ignore: (config.ignore ?? null) as unknown as CanonicalValue,
  };
}

async function commitOf(cwd: string): Promise<string | undefined> {
  try {
    return (await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd })).stdout.trim();
  } catch {
    return undefined;
  }
}

/** sha256 over every file under `root`, path and contents, in code-unit order of path. */
export async function directoryDigest(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const lines: string[] = [];
  for (const file of files) lines.push(`${file}\0${sha256Hex((await readFile(join(root, file))).toString('latin1'))}`);
  return sha256Hex(lines.join('\n'));
}

/** The digest of the files the source scan reads, as they are on disk, edits and git-ignored files included. */
async function sourceDigest(cwd: string, dirs: readonly string[]): Promise<string | undefined> {
  if (dirs.length === 0) return undefined;
  const files = [...new Set(sourceFiles(cwd, dirs))]
    .map((file) => [relative(cwd, file).split(sep).join('/'), file] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const lines: string[] = [];
  for (const [path, file] of files) lines.push(`${path}\0${sha256Hex((await readFile(file)).toString('latin1'))}`);
  return sha256Hex(lines.join('\n'));
}
