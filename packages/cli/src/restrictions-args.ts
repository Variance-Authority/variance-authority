import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type RestrictionsFormat = 'text' | 'json';

export interface ParsedRestrictions {
  readonly command: 'restrictions';
  readonly root: string;
  readonly format: RestrictionsFormat;
}

export function parseRestrictionsArgs(flags: Flags): ParsedRestrictions {
  noPositionals(flags.positionals, 'restrictions');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new OperatorError(`--format must be text or json, not \`${format}\``);
  }
  return {
    command: 'restrictions',
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
