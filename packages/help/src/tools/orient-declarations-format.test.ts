import { describe, expect, it } from 'vitest';
import { formatDeclarations } from './orient-declarations-format.js';

/**
 * The declarations part of `variance ask orient`, held without a repository:
 * what the addon would hand over for each file, and the line each file whose
 * declarations cannot be listed is said by, so an unread file is never shown
 * as one that declares nothing.
 */

describe('the declarations part of an orientation', () => {
  it('says a file whose declarations were not read apart from one that declares nothing, and marks none exported when no exports were kept', () => {
    expect(
      formatDeclarations([
        { file: 'src/data.json', read: false, declarations: [], more: 0 },
        { file: 'src/empty.ts', read: true, declarations: [], more: 0 },
        { file: 'src/script.js', read: true, declarations: [{ name: 'run', kind: 'function', line: 3, members: [], moreMembers: 0 }], more: 0 },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/data.json  its declarations were not read; `variance index` reads them',
      '  src/empty.ts  declares nothing at the top level',
      '  src/script.js  (the index kept no exports of it, so none is marked exported)',
      '    3  function run',
    ]);
  });

  it('counts the members a container could not show under it', () => {
    const members = [{ name: 'add', line: 12, text: '  add(line: string): void {' }];
    expect(
      formatDeclarations([
        { file: 'src/basket.ts', read: true, declarations: [{ name: 'Basket', kind: 'class', line: 9, exported: true, members, moreMembers: 4 }], more: 2 },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/basket.ts',
      '     9  exported class Basket',
      '        12  add(line: string): void {',
      '        4 more members not shown.',
      '    2 more top-level declarations not shown.',
    ]);
  });

  it('names a member that shares its line with its container or the member before it, rather than print the line again', () => {
    const line = 'type Streams = { out(text: string): void; err(text: string): void };';
    expect(
      formatDeclarations([
        {
          file: 'src/streams.ts',
          read: true,
          declarations: [{ name: 'Streams', kind: 'type', line: 3, exported: false, members: [{ name: 'out', line: 3, text: line }, { name: 'err', line: 3, text: line }], moreMembers: 0 }],
          more: 0,
        },
      ]),
    ).toEqual(['', 'Declared at the top level, from the source index:', '  src/streams.ts', '    3  type Streams', '       3  out', '       3  err']);
  });

  it('is left out when no file asked about is in the index, or no index is published', () => {
    expect(formatDeclarations([])).toEqual([]);
    expect(formatDeclarations(undefined)).toEqual([]);
  });
});
