/**
 * How long ago a time was, as an answer says it to a reader weighing what it read.
 */

// compass: variance-authority.report.agent-surface

/**
 * A time against `now`, floored to the unit a reader acts on: minutes in the
 * first hour, hours in the first two days, days after. A time later than `now`
 * is given as itself, since its age would be negative.
 */
export function ago(iso: string, now: number): string {
  const age = now - Date.parse(iso);
  if (age < 0) return `at ${iso}, later than this machine's clock`;
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'under a minute ago';
  if (minutes < 60) return `${unit(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours < 48 ? unit(hours, 'hour') : unit(Math.floor(hours / 24), 'day')} ago`;
}

function unit(of: number, noun: string): string {
  return `${String(of)} ${noun}${of === 1 ? '' : 's'}`;
}
