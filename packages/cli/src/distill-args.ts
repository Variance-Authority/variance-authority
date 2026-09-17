import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedDistill {
  readonly command: 'distill';
  readonly test: string;
  readonly eyes?: string;
  readonly execution?: string;
  /** The project root both producers recorded against; defaults to the working directory. */
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
  const eyes = flags.values.get('--eyes');
  const execution = flags.values.get('--execution');
  if (eyes === undefined && execution === undefined) {
    throw new OperatorError('distill needs --eyes <path>, --execution <path>, or both');
  }
  return {
    command: 'distill',
    test,
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    ...(eyes === undefined ? {} : { eyes: resolve(eyes) }),
    ...(execution === undefined ? {} : { execution: resolve(execution) }),
    format,
  };
}
