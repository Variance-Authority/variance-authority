import { appendFileSync } from 'node:fs';

// Every evaluation of this module leaves a line, so the outer test can tell a
// module graph shared across files from one rebuilt for each.
const loads = process.env['FIXTURE_LOADS'];
if (loads !== undefined) appendFileSync(loads, 'counter\n');

// State no handler resets: the isolator's to give each test its own.
let count = 0;
const seen = new Set<number>();

export const next = (): number => {
  count += 1;
  seen.add(count);
  return count;
};

export const size = (): number => seen.size;
