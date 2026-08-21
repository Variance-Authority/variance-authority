import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readHelp } from './help.js';
import { opening, writeGaps, writeIndex, writeLlms } from './write.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');
const HELP = readHelp(WORKSPACE);
const PAGE = { title: 'Fixture workspace', summary: 'Three packages, read from disk.' };

describe('the short page', () => {
  const text = writeLlms(HELP, PAGE);

  it('opens the way the convention says to open', () => {
    expect(text.startsWith('# Fixture workspace\n\n> Three packages, read from disk.\n')).toBe(true);
  });

  it('is one section per package and one link per door', () => {
    expect(text).toContain('## alpha\n');
    expect(text).toContain('- [alpha/widget](packages/alpha/src/widget.tsx)');
  });

  it('says how busy each door is, because that is what a reader chooses on', () => {
    expect(text).toMatch(/- \[alpha\]\(.+\): \d+ names, \d+ used across a package boundary, \d+ documented/);
  });

  it('spends its length on doors rather than on the first package', () => {
    // A page that listed every name of `alpha` and then ran out would read like
    // a workspace with one package. Every door, or the count is a lie.
    for (const published of HELP.packages) expect(text).toContain(`## ${published.name}`);
  });

  it('links the file the manifest points at, not whichever name came first', () => {
    // The link is the door. A link to the most-imported name's file would move
    // whenever the ranking did, which is a link that describes a moment.
    expect(text).toContain('- [alpha](packages/alpha/src/index.ts)');
  });

  it('puts a base in front of every path when a page will be read away from the checkout', () => {
    const linked = writeLlms(HELP, { ...PAGE, base: 'https://example.test/blob/main/' });
    expect(linked).toContain('(https://example.test/blob/main/packages/alpha/src/index.ts)');
  });
});

describe('the long page', () => {
  const text = writeIndex(HELP, PAGE);

  it('gives every name its place, its kind and its audience', () => {
    expect(text).toContain('#### `measure`');
    expect(text).toContain('`function` — [packages/alpha/src/values.ts:12](packages/alpha/src/values.ts#L12) — used by beta (1 import)');
  });

  it('prints the head as code, because that is what a caller copies', () => {
    expect(text).toContain('```ts\nfunction measure(): number\n```');
  });

  it('prints the doc block as written', () => {
    expect(text).toContain('Measures the thing, and says how much of it there was.');
  });

  it('says outright when a name says nothing about itself', () => {
    expect(text).toContain('_Nothing is written above this declaration._');
  });

  it('says when a name is imported by nothing, rather than leaving the line blank', () => {
    expect(text).toContain('used nowhere else');
  });

  it('lists every name it was handed', () => {
    const names = HELP.packages.flatMap((held) => held.openings.flatMap((door) => door.entries));
    for (const held of names) expect(text).toContain(`#### \`${held.name}\``);
  });
});

describe('the gap page', () => {
  it('lists the names another package imports and which are silent', () => {
    const text = writeGaps(HELP, { title: 'Undocumented' });
    expect(text).toContain('1 name crosses a package boundary');
    expect(text).toContain('- `already` (`const`) — [packages/alpha/src/direct.ts:1]');
  });

  it('says so plainly when there is no gap', () => {
    const closed = { ...HELP, packages: [] };
    expect(writeGaps(closed, { title: 'Undocumented' })).toContain(
      'Every name imported across a package boundary carries a doc block.',
    );
  });
});

describe('the first paragraph of a doc', () => {
  it('is what the name is, before the reasons', () => {
    expect(opening('What it is.\n\nWhy it is that, at length.')).toBe('What it is.');
  });

  it('is one line, whatever the source wrapped at', () => {
    expect(opening('What it is,\nwrapped at eighty.\n\nThen a reason.')).toBe('What it is, wrapped at eighty.');
  });
});
