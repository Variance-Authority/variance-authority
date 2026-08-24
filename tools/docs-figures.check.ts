import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './markdown.js';

/** Test selection consumes coverage data; probes alone are not a result. */
const pages = [
  'packages/sense/README.md',
  'docs/source.md',
  'docs/specs/0028-the-instrument.md',
] as const;

describe('test selection documentation', () => {
  it.each(pages)('%s keeps coverage data between instrumentation and selection', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');

    expect(text).toMatch(/coverage data/);
    expect(text).toMatch(/diff/);
  });
});
