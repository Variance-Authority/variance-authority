/**
 * How a run's greps are spelled in the record's checks scope: a project's as
 * the pattern Playwright compiled, the command line's as it was typed, because
 * Playwright keeps the command line's from every reporter and only the
 * arguments still say them.
 */

/** A grep as its pattern reads, absent where it lets every case through. */
export function grepOf<Key extends string>(key: Key, grep: RegExp | readonly RegExp[] | undefined): Partial<Record<Key, string>> {
  const patterns = (grep === undefined ? [] : Array.isArray(grep) ? grep : [grep]) as readonly RegExp[];
  const said = patterns.filter((pattern) => pattern.source !== '.*').map(String);
  return said.length === 0 ? {} : ({ [key]: said.join(' | ') } as Partial<Record<Key, string>>);
}

/** What the command line gave under `flags`, as typed: Playwright decides the pattern it becomes, and `--` ends its own arguments. */
export function commandLineGrep<Key extends string>(key: Key, flags: readonly string[], argv: readonly string[]): Partial<Record<Key, string>> {
  let said: string | undefined;
  for (const [at, argument] of argv.entries()) {
    if (argument === '--') break;
    const short = flags.find((one) => !one.startsWith('--') && argument.length > one.length && argument.startsWith(one));
    const [flag, inline] = argument.startsWith('--') ? argument.split(/=(.*)/s, 2) : short === undefined ? [argument, undefined] : [short, argument.slice(short.length)];
    if (flag !== undefined && flags.includes(flag)) said = inline ?? argv[at + 1];
  }
  if (said === undefined) return {};
  return { [key]: said } as Partial<Record<Key, string>>;
}
