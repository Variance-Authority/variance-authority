import { resolve } from 'node:path';
import { countOf, type Flags } from './args.js';
import { oneRecord } from './commands/suite-record.js';
import { OperatorError } from './exit.js';

/** What `variance journeys` was asked: a reading, with shards landed first, or one of the journey file's two operations. */
export type ParsedJourneys =
  | {
      readonly command: 'journeys';
      readonly operation?: undefined;
      readonly config: string;
      /**
       * `--all`: read every whole observation the snapshot holds.
       *
       * The default pool is the subjects the configured report names, because
       * the snapshot accumulates across runs and a subject deleted two commits
       * ago is still a party to every parting it was recorded in. This asks for
       * that record on purpose, which is a different question and has to look
       * like one.
       */
      readonly all: boolean;
      /** `--file <text>`: substring, case-insensitive, over the recorded module path. */
      readonly file?: string;
      readonly limit?: number;
      /** Shard snapshots to fold and land before reading, and `--into <path>`, where they land; this repository's cache otherwise. */
      readonly shards: readonly string[];
      readonly into?: string;
      /** `--suite <name>`: whose record is read, and where shards land, with no project config; beside `--into`, refused. */
      readonly suite?: string;
      /**
       * `--collected <file>`: the test files the suite's runner collects at the
       * shards' commit, one per line, as `vitest list --filesOnly` prints them.
       * A test file the landing's record holds that the shards did not run and
       * the list does not name leaves the record.
       */
      readonly collected?: string;
    }
  | {
      readonly command: 'journeys';
      readonly operation: 'finalize';
      readonly config: string;
      readonly journeyFile: string;
    }
  | {
      readonly command: 'journeys';
      readonly operation: 'stitch';
      readonly config: string;
      readonly shards: readonly string[];
      readonly into: string;
    };

/** `variance journeys`, its `finalize` and its `stitch`. */
export function parseJourneysArgs(flags: Flags, config: string): ParsedJourneys {
  const file = flags.values.get('--file');
  const limit = countOf(flags.values.get('--limit'), 'modules to name');
  const into = flags.values.get('--into');
  const operation = flags.positionals[0];

  if (operation === 'finalize') {
    if (flags.present.size > 0 || flags.positionals.length !== 2) {
      throw new OperatorError('`variance journeys finalize` takes one journey file and no flags');
    }
    return {
      command: 'journeys',
      operation: 'finalize',
      config,
      journeyFile: resolve(flags.positionals[1]!),
    };
  }

  if (operation === 'stitch') {
    const otherFlags = [...flags.present].filter((flag) => flag !== '--into');
    if (otherFlags.length > 0 || into === undefined || flags.positionals.length < 2) {
      throw new OperatorError(
        '`variance journeys stitch` takes one or more shard files and `--into <journey-file>`',
      );
    }
    return {
      command: 'journeys',
      operation: 'stitch',
      config,
      shards: flags.positionals.slice(1).map((path) => resolve(path)),
      into: resolve(into),
    };
  }

  if (into !== undefined && flags.positionals.length === 0) {
    throw new OperatorError('`--into` says where a fold lands, and nothing was named to fold');
  }
  const collected = flags.values.get('--collected');
  if (collected !== undefined && flags.positionals.length === 0) {
    throw new OperatorError('`--collected` says which test files a fold keeps, and nothing was named to fold');
  }
  const suite = flags.values.get('--suite');
  oneRecord(suite, into, '--into');
  if (suite !== undefined && flags.values.has('--config'))
    throw new OperatorError('`journeys --suite` reads the suite from the root variance.config.json, so it takes no `--config`');

  return {
    command: 'journeys',
    config,
    all: flags.present.has('--all'),
    ...(file !== undefined ? { file } : {}),
    ...(limit !== undefined ? { limit } : {}),
    shards: flags.positionals.map((path) => resolve(path)),
    ...(into !== undefined ? { into: resolve(into) } : {}),
    ...(suite !== undefined ? { suite } : {}),
    ...(collected !== undefined ? { collected } : {}),
  };
}
