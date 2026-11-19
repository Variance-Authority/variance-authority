import { describe, expect, it } from 'vitest';
import { grainOf } from './language.js';
import { native } from './addon.js';
import type { Read } from './read.js';

/**
 * The language with no file-grain edge, answered at the grain it has.
 *
 * `import Core` names a target of tens or hundreds of files, and within a target
 * files see each other with no statement at all. So a Swift file names none of
 * the files it depends on, and the honest answer is the target projected onto
 * its files: over-reaching in the direction selection is allowed to over-reach,
 * rather than reporting a file as depending on nothing.
 */

describe('what a Swift file asks for', () => {
  it('asks for the files beside it, which it imports nothing to see', () => {
    expect(readSwift('struct Lens {}\n').requests[0]?.value).toBe('*');
  });

  it('takes the module from an import that names a symbol inside it', () => {
    // `import struct Answer.Lens` depends on `Answer`; there is no grain below.
    const read = readSwift('import Foundation\nimport struct Answer.Lens\n');

    expect(read.requests.map((request) => request.value)).toEqual(['*', 'Foundation', 'Answer']);
  });

  it('marks every import a guess, because a module name is not a path', () => {
    const read = readSwift('import Core\n');

    expect(read.requests.every((request) => request.guessed === true)).toBe(true);
  });

  it('publishes the types, functions and values declared at the top level', () => {
    const read = readSwift('struct Lens {}\nprotocol Seen {}\nfunc read() {}\nlet version = 1\n');

    expect((read.exports ?? []).map((entry) => entry.exported))
      .toEqual(['Lens', 'Seen', 'read', 'version']);
  });

  it('keeps a `private` or `fileprivate` declaration to its file, and publishes one whose setter alone is private', () => {
    const read = readSwift(
      'private func helper() {}\nfileprivate struct Cache {}\nprivate (set) var count = 0\npublic let version = 1\n',
    );

    expect((read.exports ?? []).map((entry) => entry.exported)).toEqual(['count', 'version']);
    expect(read.symbols?.map(({ name, reach }) => ({ name, reach }))).toEqual([
      { name: 'helper', reach: 'file' },
      { name: 'Cache', reach: 'file' },
      { name: 'count', reach: undefined },
      { name: 'version', reach: undefined },
    ]);
  });

  it('says so when the parser stopped where an import could have been', () => {
    expect(readSwift('import Core\n@ ~ !\n').unknown).toBe('did not parse cleanly as Swift, so what it imports may be incomplete.');
  });

  it('reads a file whose only error is inside a body, rather than marking it unknown', () => {
    const read = readSwift('import Core\nstruct Lens { func ( }\n');

    expect(read.requests.map((request) => request.value)).toEqual(['*', 'Core']);
    expect(read.unknown).toBeUndefined();
  });

  it('is the one language whose edges are coarser than a file', () => {
    // Nothing downstream should report a Swift edge as though the file it
    // reaches is the file the symbol came from.
    expect(grainOf('swift')).toBe('target');
    expect(grainOf('rust')).toBe('file');
  });
});

describe('what a Swift file declares', () => {
  it('records each top-level declaration with its signature and the doc above it', () => {
    const contents = [
      'import Foundation',
      '',
      '/// Start again.',
      'func relaunch(argv: [String]) -> Int {',
      '    return 0',
      '}',
      '',
      'struct Lens {}',
      '',
    ].join('\n');
    const read = readSwift(contents);

    expect(spelled(contents, read)).toEqual([
      { name: 'relaunch', kind: 'function', line: 4, signature: 'func relaunch(argv: [String]) -> Int', doc: '/// Start again.' },
      { name: 'Lens', kind: 'struct', line: 8, signature: 'struct Lens', doc: undefined },
    ]);
  });
});

/** A symbol's signature and doc, as the spans it carries cut them from `contents`. */
function spelled(contents: string, read: Read) {
  const cut = (span: { readonly start: number; readonly end: number } | undefined) => span && contents.slice(span.start, span.end);
  return (read.symbols ?? []).map(({ name, kind, line, signature, doc }) => ({ name, kind, line, signature: cut(signature), doc: cut(doc) }));
}

/** What the addon's Swift reader answers, which is the only reader there is. */
function readSwift(contents: string): Read {
  const answer = native()?.readLanguage('swift', contents);
  if (answer == null) throw new Error('these tests read Swift through the native addon, built with its grammars');
  return JSON.parse(answer) as Read;
}
