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
        { file: 'src/data.json', read: false, declarations: [], more: 0, moreMembers: 0, bound: 0, exportsKept: true },
        { file: 'src/empty.ts', read: true, declarations: [], more: 0, moreMembers: 0, bound: 0, exportsKept: true },
        { file: 'src/script.js', read: true, declarations: [{ name: 'run', kind: 'function', line: 3, members: [] }], more: 0, moreMembers: 0, bound: 0, exportsKept: false },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/data.json  the index holds no parse of its declarations',
      '  src/empty.ts  declares nothing at the top level',
      '  src/script.js  (the index kept no exports of it, so none is marked exported)',
      '    3  function run',
    ]);
  });

  it('counts what the budget cut from a file on one line, members of the declarations it cut included', () => {
    const members = [{ name: 'add', line: 12, text: '  add(line: string): void {' }];
    expect(
      formatDeclarations([
        { file: 'src/basket.ts', read: true, declarations: [{ name: 'Basket', kind: 'class', line: 9, exported: true, members }], more: 2, moreMembers: 4, bound: 0, exportsKept: true },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/basket.ts',
      '     9  exported class Basket',
      '        12  add(line: string): void {',
      '    2 more top-level declarations and 4 more member lines not shown.',
    ]);
  });

  it('counts the names a file binds and does not declare on a line of their own, after what the budget cut', () => {
    const run = { name: 'run', kind: 'function', line: 41, exported: true, members: [] };
    expect(
      formatDeclarations([
        { file: 'src/child.js', read: true, declarations: [run], more: 0, moreMembers: 0, bound: 39, exportsKept: true },
        { file: 'src/one.js', read: true, declarations: [run], more: 2, moreMembers: 0, bound: 1, exportsKept: true },
        { file: 'src/binds.js', read: true, declarations: [], more: 0, moreMembers: 0, bound: 2, exportsKept: true },
        { file: 'src/unknown.js', read: true, declarations: [], more: 0, moreMembers: 0, bound: 2, exportsKept: false },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/child.js',
      '    41  exported function run',
      '    Not listed: 39 names it binds and does not declare.',
      '  src/one.js',
      '    41  exported function run',
      '    2 more top-level declarations not shown.',
      '    Not listed: 1 name it binds and does not declare.',
      '  src/binds.js  declares nothing at the top level',
      '    Not listed: 2 names it binds and does not declare.',
      '  src/unknown.js  declares nothing at the top level  (the index kept no exports of it, so none is marked exported)',
      '    Not listed: 2 names it binds and does not declare.',
    ]);
  });

  it('shows a line that declares several members once, as `symbol` does, the container\'s line included', () => {
    const line = 'type Streams = { out(text: string): void; err(text: string): void };';
    expect(
      formatDeclarations([
        {
          file: 'src/streams.ts',
          read: true,
          declarations: [{ name: 'Streams', kind: 'type', line: 3, exported: false, members: [{ name: 'out', line: 3, text: line }, { name: 'err', line: 3, text: line }] }],
          more: 0,
          moreMembers: 0,
          bound: 0,
          exportsKept: true,
        },
      ]),
    ).toEqual(['', 'Declared at the top level, from the source index:', '  src/streams.ts', '    3  type Streams', `       3  ${line}`]);
  });

  it('says a file in a language whose members the index does not read lists none of them', () => {
    expect(
      formatDeclarations([
        { file: 'src/Basket.java', read: true, declarations: [{ name: 'Basket', kind: 'class', line: 4, exported: true, members: [] }], more: 0, moreMembers: 0, bound: 0, exportsKept: true },
      ]),
    ).toEqual([
      '',
      'Declared at the top level, from the source index:',
      '  src/Basket.java  (the index reads members from JavaScript and TypeScript only, so none of this Java file is listed)',
      '    4  exported class Basket',
    ]);
  });

  it('is left out when no file asked about is in the index, or no index is published', () => {
    expect(formatDeclarations([])).toEqual([]);
    expect(formatDeclarations(undefined)).toEqual([]);
  });
});
