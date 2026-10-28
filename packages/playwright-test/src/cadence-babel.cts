/**
 * The Babel plugin that cuts a Playwright spec, so each case records which of
 * its statements first reached each region of the application.
 *
 * Playwright compiles every spec through Babel, and `babelPlugins` under
 * `'@playwright/test'` in the configuration is the one place it lets a project
 * add to that, which is where `withTestSelection` puts this. The cut is the one
 * every runner's seam makes ([`cadence`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/sense/src/instrument/cadence.ts)),
 * awaited: the page is outside the test's realm, so each statement of an async
 * body waits while the `context` fixture drains what the statement before it
 * reached ([`documents.ts`](./documents.ts)).
 *
 * The cut has to happen before Babel parses, because it is a walk of the text
 * and not of Babel's tree, so this overrides the parser rather than visiting:
 * it parses the cut text and moves every position back to the text the project
 * wrote. Lines never move; a column inside an inserted call names the place it
 * was inserted at. That keeps Babel's map, and so every stack frame Playwright
 * reads a location from, naming the file as written — an inline aria snapshot
 * is written back by that location.
 *
 * CommonJS, because Playwright `require`s each plugin by its path.
 */

import instrument = require('@variance-authority/sense/instrument');
import path = require('node:path');

/** Babel's parser, as `parserOverride` is handed it. */
type Parse = (code: string, options: ParserOptions) => object;

interface ParserOptions {
  readonly sourceFileName?: string;
}

interface Position {
  line: number;
  column: number;
  index?: number;
}

// FIXME: Playwright keys its compile cache on the plugin's path and not on its
// version, so a spec compiled under an older cut is read from the cache after
// an upgrade until the spec or Playwright changes; `--clear-cache` drops it.
export = function cadenceBabel(): { readonly name: string; readonly parserOverride: (code: string, options: ParserOptions, parse: Parse) => object | undefined } {
  return {
    name: 'variance-authority-cadence',
    parserOverride(code, options, parse) {
      const file = options.sourceFileName;
      // The fixture tells a cut of the running spec from one of a file it
      // imported by this name, against `testInfo.file`, which is absolute.
      if (file === undefined || !path.isAbsolute(file)) return undefined;
      const cut = instrument.cadence(code, file, { awaited: true });
      if (cut === undefined) return undefined;
      return written(parse(cut.code, options), code, cut.code, cut.shifts);
    },
  };
};

/** Babel's tree of `cut`, with every position moved back to `code`. */
function written(tree: object, code: string, cut: string, shifts: readonly number[]): object {
  const back = instrument.columnBehindCut(shifts);
  const writtenStarts = lineStarts(code);
  const cutStarts = lineStarts(cut);
  // Babel shares a position between a node and the first of its children, and
  // a comment between the file's list and the node it is attached to.
  const moved = new WeakSet<object>();

  const index = (at: number): number => {
    let low = 0;
    let high = cutStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (cutStarts[middle]! <= at) low = middle;
      else high = middle - 1;
    }
    return writtenStarts[low]! + back(low, at - cutStarts[low]!);
  };
  const position = (at: Position): void => {
    if (moved.has(at)) return;
    moved.add(at);
    at.column = back(at.line - 1, at.column);
    if (typeof at.index === 'number') at.index = writtenStarts[at.line - 1]! + at.column;
  };
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || moved.has(value)) return;
    moved.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    for (const [key, field] of Object.entries(node)) {
      if ((key === 'start' || key === 'end') && typeof field === 'number') node[key] = index(field);
      else if (key === 'loc' && typeof field === 'object' && field !== null) {
        const loc = field as { start?: Position; end?: Position };
        if (loc.start !== undefined) position(loc.start);
        if (loc.end !== undefined) position(loc.end);
      } else if (key === 'range' && Array.isArray(field)) node[key] = field.map((at: number) => index(at));
      else if (key === 'extra' && typeof field === 'object' && field !== null) {
        const extra = field as { parenStart?: number };
        if (typeof extra.parenStart === 'number') extra.parenStart = index(extra.parenStart);
      } else visit(field);
    }
  };
  visit(tree);
  return tree;
}

/** Where each line of `text` starts, by Babel's line terminators. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (const found of text.matchAll(/\r\n?|[\n\u2028\u2029]/gu)) starts.push(found.index + found[0].length);
  return starts;
}
