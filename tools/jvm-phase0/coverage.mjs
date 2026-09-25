// Turns a presence record into the execution record sense's selector reads, at function grain.
//
// Phase 0 harness. Each source file is a module whose root spans the whole file, with one
// `function` region per method the record saw, spanning its line table. The blocks come
// from the bytecode, not from a walk of the source:
//   - a lambda body is not a region: it marks the method whose span holds it, because a
//     single-line lambda shares its line with the code around it;
//   - a method whose lines the enclosing method's line table also holds (an anonymous
//     class written on one line) is folded into that method, for the same reason;
//   - constructors and static initializers are not regions: their line tables carry field
//     initializers from anywhere in the class, so they mark the root;
//   - a method signature, a closing brace and every method no test entered lie outside all
//     regions, so a change there charges the root: every test that entered the file.
// Entering a region marks its owners up to the root. A row that named an unknown class is
// recorded incomplete, so no absence from it justifies a skip.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** sense's digest, from the build the variance bin belongs to. */
export async function loadSense(varianceBin) {
  const dist = join(varianceBin, '..', '..', '..', 'sense', 'dist');
  const { digestString } = await import(pathToFileURL(join(dist, 'digest.js')).href);
  const selection = await import(pathToFileURL(join(dist, 'test-selection', 'index.js')).href);
  return { digestString, ...selection };
}

const contains = (a, b) => a.first <= b.first && b.last <= a.last;
const width = (m) => m.last - m.first;

/**
 * @param rows      record.jsonl rows ({owner, methods, unknown?}); `between` rows are skipped
 * @param textOf    file -> its text at the recorded commit, or undefined
 * @param testFile  test class name -> its source path
 */
export function toCoverage({ rows, textOf, testFile, commit, digestString }) {
  const tests = [];
  const byFile = new Map();
  for (const row of rows) {
    if (row.owner.startsWith('between')) continue;
    const file = testFile(row.owner);
    const text = textOf(file);
    tests.push({
      file,
      complete: !row.unknown?.length,
      preconditions: text === undefined ? [] : [{ name: file, digest: digestString(text) }],
    });
    for (const m of row.methods) {
      let methods = byFile.get(m.file);
      if (!methods) byFile.set(m.file, (methods = new Map()));
      const key = `${m.class}.${m.method}`;
      const seen = methods.get(key) ?? { ...m, tests: new Set() };
      seen.tests.add(file);
      methods.set(key, seen);
    }
  }

  const modules = [];
  for (const [file, methods] of byFile) {
    const text = textOf(file);
    if (text === undefined) throw new Error(`recorded file ${file} is not in the checkout`);
    const lines = text.split('\n');
    const all = [...methods.values()];
    const rooted = (m) => m.lines.length === 0 || m.method.startsWith('<init>') || m.method.startsWith('<clinit>');
    const lambda = (m) => m.method.startsWith('lambda$');

    // Widest first, so a method is compared with every region that could hold it.
    const candidates = all.filter((m) => !rooted(m) && !lambda(m)).sort((a, b) => width(b) - width(a) || a.first - b.first);
    const regions = [];
    const target = new Map();
    const innermost = (m) => regions.filter((r) => r !== m && contains(r, m)).sort((a, b) => width(a) - width(b))[0];
    for (const m of candidates) {
      const parent = innermost(m);
      if (parent && m.lines.some((l) => parent.lines.includes(l))) target.set(m, parent);
      else regions.push(m);
    }
    for (const m of all) {
      if (target.has(m) || regions.includes(m)) continue;
      target.set(m, rooted(m) ? null : innermost({ first: m.first, last: m.first }) ?? null);
    }

    // Pre-order: by first line, the wider region first.
    regions.sort((a, b) => a.first - b.first || b.last - a.last);
    const ordinal = new Map(regions.map((r, i) => [r, i + 1]));
    const owner = new Map(regions.map((r) => [r, innermost(r) ?? null]));
    const entered = new Map(regions.map((r) => [r, new Set()]));
    const root = new Set();
    for (const m of all) {
      let region = regions.includes(m) ? m : target.get(m);
      for (; region; region = owner.get(region)) for (const t of m.tests) entered.get(region).add(t);
      for (const t of m.tests) root.add(t);
    }

    const simple = (cls) => cls.slice(cls.lastIndexOf('/') + 1).replaceAll('$', '/');
    const blocks = [{
      ordinal: 0, kind: 'module', digest: digestString(`module\0${text}`), name: '', path: 'module',
      startLine: 1, endLine: lines.length, source: true, testFiles: [...root].sort(),
    }];
    for (const r of regions) {
      const parent = owner.get(r);
      blocks.push({
        ordinal: ordinal.get(r),
        kind: 'function',
        owner: parent ? ordinal.get(parent) : 0,
        digest: digestString(`function\0${lines.slice(r.first - 1, r.last).join('\n')}`),
        name: `${simple(r.class)}/${r.method}`,
        path: 'entry',
        startLine: r.first,
        endLine: r.last,
        source: true,
        testFiles: [...entered.get(r)].sort(),
      });
    }
    modules.push({ file, sourceDigest: digestString(text), instrumented: true, blocks });
  }
  return { version: 3, instrumentation: 'sense:instrument/entries-v2', ...(commit ? { commit } : {}), tests, modules };
}
