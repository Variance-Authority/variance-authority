import { describe, expect, it } from 'vitest';
import { native } from './addon.js';
import type { Read } from './read.js';

/**
 * Two syntaxes over one resolution algorithm.
 *
 * Nothing in a JVM import separates this repository's packages from the
 * platform's, so every request is a guess and a miss is silence. What a file
 * does say for certain is its own package, and the edges that come from it are
 * the majority of a JVM codebase's real ones: two classes in one package see
 * each other with no import at all, and a reader that only reads `import`
 * statements reports them as unrelated.
 */

describe('what a JVM file asks for', () => {
  it('asks for its own package, which nothing in the file imports', () => {
    const java = readJava('package a.b;\nclass Thing {}\n');
    const kotlin = readKotlin('package a.b\n\nclass Thing\n');

    expect(java.requests[0]?.value).toBe('a.b.*');
    expect(kotlin.requests[0]?.value).toBe('a.b.*');
  });

  it('marks every import a guess, because the syntax cannot say whose it is', () => {
    const read = readJava('package a.b;\nimport java.util.List;\nimport a.c.Other;\nclass Thing {}\n');

    expect(read.requests.every((request) => request.guessed === true)).toBe(true);
  });

  it('reads a wildcard import as the package rather than as a name', () => {
    const java = readJava('import a.c.*;\nclass Thing {}\n');
    const kotlin = readKotlin('import a.c.*\nimport a.d.Named\n');

    expect(java.requests.map((request) => request.value)).toEqual(['a.c.*']);
    expect(kotlin.requests.map((request) => request.value)).toEqual(['a.c.*', 'a.d.Named']);
  });

  it('binds a Kotlin import under its alias', () => {
    const read = readKotlin('import a.c.Other as Renamed\n');

    expect(read.requests[0]?.bindings[0]?.local).toBe('Renamed');
  });

  it('publishes the top-level declarations of either language', () => {
    const java = readJava('package a;\npublic class Thing {}\ninterface Seen {}\n');
    const kotlin = readKotlin(
      'package a\n\nclass Thing\nfun parse() {}\nobject Registry\ntypealias Name = String\nval version = 1\n',
    );

    expect((java.exports ?? []).map((entry) => entry.exported)).toEqual(['Thing', 'Seen']);
    expect((kotlin.exports ?? []).map((entry) => entry.exported))
      .toEqual(['Thing', 'parse', 'Registry', 'Name', 'version']);
  });

  it('publishes a top-level Java class whatever its modifiers, since none keeps one to its file', () => {
    const read = readJava('package a;\n\nfinal class Thing {}\nabstract class Other {}\n');

    expect((read.exports ?? []).map((entry) => entry.exported)).toEqual(['Thing', 'Other']);
    expect(read.symbols?.map(({ reach }) => reach)).toEqual([undefined, undefined]);
  });

  it('keeps a top-level Kotlin `private` to its file, and publishes an `internal` one to its module', () => {
    const read = readKotlin('package a\n\nprivate fun helper() {}\nprivate val cache = 1\ninternal class Thing\n');

    expect((read.exports ?? []).map((entry) => entry.exported)).toEqual(['Thing']);
    expect(read.symbols?.map(({ name, reach }) => ({ name, reach }))).toEqual([
      { name: 'helper', reach: 'file' },
      { name: 'cache', reach: 'file' },
      { name: 'Thing', reach: undefined },
    ]);
  });

  it('says so when the parser stopped where an import could have been', () => {
    expect(readJava('import a.B;\n@ ~ !\n').unknown).toBe('did not parse cleanly as java, so what it imports may be incomplete.');
  });

  it('reads a file whose only error is inside a body, rather than marking it unknown', () => {
    const read = readJava('import a.B;\nclass Thing { void ( }\n');

    expect(read.requests.map((request) => request.value)).toEqual(['a.B']);
    expect(read.unknown).toBeUndefined();
  });
});

describe('what a Java or Kotlin file declares', () => {
  it('records a Java class with its signature and the doc block above it', () => {
    const contents = ['package a;', '', '/** Start again. */', 'class Relaunch {', '}', ''].join('\n');

    expect(spelled(contents, readJava(contents))).toEqual([
      { name: 'Relaunch', kind: 'class', line: 4, signature: 'class Relaunch', doc: '* Start again. ' },
    ]);
  });

  it('records a Kotlin function with its signature and the doc block above it', () => {
    const contents = ['package a', '', '/** Start again. */', 'fun relaunch(argv: List<String>): Int {', '    return 0', '}', ''].join('\n');

    expect(spelled(contents, readKotlin(contents))).toEqual([
      { name: 'relaunch', kind: 'function', line: 4, signature: 'fun relaunch(argv: List<String>): Int', doc: '* Start again. ' },
    ]);
  });
});

/** A symbol's signature and doc, as the spans it carries cut them from `contents`. */
function spelled(contents: string, read: Read) {
  const cut = (span: { readonly start: number; readonly end: number } | undefined) => span && contents.slice(span.start, span.end);
  return (read.symbols ?? []).map(({ name, kind, line, signature, doc }) => ({ name, kind, line, signature: cut(signature), doc: cut(doc) }));
}

/** What the addon's Java reader answers, which is the only reader there is. */
function readJava(contents: string): Read {
  const answer = native()?.readLanguage('java', contents);
  if (answer == null) throw new Error('these tests read Java through the native addon, built with its grammars');
  return JSON.parse(answer) as Read;
}

/** What the addon's Kotlin reader answers, which is the only reader there is. */
function readKotlin(contents: string): Read {
  const answer = native()?.readLanguage('kotlin', contents);
  if (answer == null) throw new Error('these tests read Kotlin through the native addon, built with its grammars');
  return JSON.parse(answer) as Read;
}
