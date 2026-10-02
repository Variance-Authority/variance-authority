import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import { oneRecord } from './commands/suite-record.js';

export interface ParsedDistill {
  readonly command: 'distill';
  readonly test?: string;
  /** A fragment of the test file's path; with no `test`, the file's one test. */
  readonly file?: string;
  readonly eyes?: string;
  /** Absent, the index a recorded run left beside the record is read. */
  readonly execution?: string;
  /** The one declared suite whose recorded index is read. */
  readonly suite?: string;
  /** The project root both producers recorded against; defaults to the working directory. */
  readonly root: string;
  readonly format: 'text' | 'json';
}

/** Parse the self-contained evidence reader outside the config-shaped command parser. */
export function parseDistill(flags: Flags): ParsedDistill {
  noPositionals(flags.positionals, 'distill');
  const test = flags.values.get('--test');
  const file = flags.values.get('--file');
  if (test === undefined && file === undefined) {
    throw new OperatorError('distill needs `--test <name>`, `--file <path>`, or both');
  }
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const eyes = flags.values.get('--eyes');
  const execution = flags.values.get('--execution');
  const suite = flags.values.get('--suite');
  oneRecord(suite, execution, '--execution');
  return {
    command: 'distill',
    ...(test === undefined ? {} : { test }),
    ...(file === undefined ? {} : { file }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(eyes === undefined ? {} : { eyes: resolve(eyes) }),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    ...(suite === undefined ? {} : { suite }),
    format,
  };
}
