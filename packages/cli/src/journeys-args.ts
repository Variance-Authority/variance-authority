import { resolve } from 'node:path';
import { countOf, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import { oneRecord } from './commands/suite-record.js';

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
      /** `--file <path>`: the one recorded module at this path in the checkout. */
      readonly file?: string;
      readonly limit?: number;
      /** Shard snapshots to fold and land before reading, and `--into <path>`, where they land; this repository's cache otherwise. */
      readonly shards: readonly string[];
      readonly into?: string;
      /** `--suite <name>`: whose record is read, and where shards land, with no project config; beside `--into`, refused. */
      readonly suite?: string;
    }
  | {
      readonly command: 'journeys';
      readonly operation: 'inspect';
      readonly config: string;
      readonly record: string;
      readonly format: 'text' | 'json';
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
    }
  | {
      readonly command: 'journeys';
      readonly operation: 'combine';
      readonly config: string;
      readonly shards: readonly string[];
      readonly into: string;
    };

/** The journey readings and artifact operations, each with its own input. */
export function parseJourneysArgs(flags: Flags, config: string): ParsedJourneys {
  const file = flags.values.get('--file');
  const limit = countOf(flags.values.get('--limit'), 'modules to name');
  const into = flags.values.get('--into');
  const operation = flags.positionals[0];

  if (operation === 'inspect') {
    if (flags.positionals.length !== 2 || [...flags.present].some((flag) => flag !== '--format')) {
      throw new OperatorError('`variance journeys inspect` takes one record and optional `--format text|json`');
    }
    const format = flags.values.get('--format') ?? 'text';
    if (format !== 'text' && format !== 'json') throw new OperatorError('`journeys inspect --format` must be text or json');
    return { command: 'journeys', operation, config, record: resolve(flags.positionals[1]!), format };
  }
  if (flags.present.has('--format')) throw new OperatorError('`journeys --format` belongs to `journeys inspect`');

  if (operation === 'combine') {
    const otherFlags = [...flags.present].filter((flag) => flag !== '--into');
    if (otherFlags.length > 0 || into === undefined || flags.positionals.length < 2) {
      throw new OperatorError('`variance journeys combine` takes one or more shard records and `--into <record>`, a path nothing is at yet');
    }
    return {
      command: 'journeys', operation: 'combine', config,
      shards: flags.positionals.slice(1).map((path) => resolve(path)),
      into: resolve(into),
    };
  }

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
  };
}
