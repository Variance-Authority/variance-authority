import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';
import { oneRecord } from './commands/suite-record.js';

export interface ParsedDistill {
  readonly command: 'distill';
  readonly test?: string;
  /** A part of the test file's path; with no `test`, the file's loads read against its cases. */
  readonly file?: string;
  /** With neither `test` nor `file`, the directory whose test files are read; absent, every test file. */
  readonly from?: string;
  /** The record to read, when it is not the checkout's own. */
  readonly execution?: string;
  /** The one declared suite whose record is read. */
  readonly suite?: string;
  /** The checkout whose record is read; defaults to the working directory. */
  readonly root: string;
  /** `jsonl` writes one row a test file of a scope, and reads no case and no single file. */
  readonly format: 'text' | 'json' | 'jsonl';
}

/** Parse the self-contained evidence reader outside the config-shaped command parser. */
export function parseDistill(flags: Flags): ParsedDistill {
  noPositionals(flags.positionals, 'distill');
  const test = flags.values.get('--test');
  const file = flags.values.get('--file');
  const from = flags.values.get('--from');
  if (from !== undefined && (test !== undefined || file !== undefined)) {
    throw new OperatorError('`--from` reads every test file under a directory; `--test` and `--file` read one case or one file. Pass one scope');
  }
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json' && format !== 'jsonl') {
    throw new OperatorError(`--format must be text, json or jsonl, not \`${format}\``);
  }
  if (format === 'jsonl' && (test !== undefined || file !== undefined)) {
    throw new OperatorError('`--format jsonl` writes one line for each test file of a scope; `--test` and `--file` read one case or one file. Pass `--format json`');
  }
  const execution = flags.values.get('--execution');
  const suite = flags.values.get('--suite');
  oneRecord(suite, execution, '--execution');
  return {
    command: 'distill',
    ...(test === undefined ? {} : { test }),
    ...(file === undefined ? {} : { file }),
    ...(from === undefined ? {} : { from }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    ...(suite === undefined ? {} : { suite }),
    format,
  };
}
