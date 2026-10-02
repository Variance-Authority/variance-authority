import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedDistill {
  readonly command: 'distill';
  readonly test: string;
  /** The record to read, when it is not the checkout's own. */
  readonly execution?: string;
  /** The checkout whose record is read; defaults to the working directory. */
  readonly root: string;
  readonly format: 'text' | 'json';
}

/** Parse the self-contained evidence reader outside the config-shaped command parser. */
export function parseDistill(flags: Flags): ParsedDistill {
  noPositionals(flags.positionals, 'distill');
  const test = flags.values.get('--test');
  if (test === undefined) throw new OperatorError('distill needs `--test <id>`');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  const execution = flags.values.get('--execution');
  return {
    command: 'distill',
    test,
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    format,
  };
}
