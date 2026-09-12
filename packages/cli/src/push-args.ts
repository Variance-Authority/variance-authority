import { resolve } from 'node:path';
import { type Flags } from './args.js';

/** What `variance push` files a build under, when the environment does not say. */
export interface ParsedPush {
  readonly command: 'push';
  readonly config: string;
  /** `--run <id>` / `--commit <sha>`, or the CI environment they are inside. */
  readonly run?: string;
  readonly commit?: string;
  /** `--branch <name>`: what the reviewer is deciding about. */
  readonly branch?: string;
  /** Reports to read instead of the configured one. More than one is merged. */
  readonly reports: readonly string[];
}

/**
 * Read the three identifiers a build is filed under.
 *
 * Outside the main parser for the reason `share-args.ts` is: every one of these
 * is more often written by a workflow than by a person, and a workflow supplies
 * an unset variable as the empty string rather than as nothing at all. What is
 * here is the rule for telling those two apart, which is a statement about CI
 * and not about this tool's flags.
 */
export function parsePushArgs(flags: Flags, config: string): ParsedPush {
  const runId = flags.values.get('--run');
  const commit = flags.values.get('--commit');
  const branch = flags.values.get('--branch');

  return {
    command: 'push',
    config,
    ...(runId !== undefined ? { run: runId } : {}),
    ...(commit !== undefined ? { commit } : {}),
    // An empty `--branch` is a workflow interpolating a variable that was not
    // set — a detached build, not a branch called ''.
    ...(branch !== undefined && branch !== '' ? { branch } : {}),
    reports: flags.positionals.map((path) => resolve(path)),
  };
}
