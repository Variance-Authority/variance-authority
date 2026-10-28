import { describe, expect, it } from 'vitest';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { handle, SOURCE_TESTS } from '../protocol.js';
import { sourceTests } from './source-tests.js';

const INDEX: ExecutionIndex = {
  tests: [
    { id: 'guest', file: 'test/cart.test.ts', name: 'uses the guest price' },
    { id: 'staff', file: 'test/cart.test.ts', name: 'applies the staff discount' },
  ],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [
      {
        kind: 'function',
        name: 'priceOf',
        path: 'entry',
        startLine: 1,
        endLine: 8,
        source: true,
        crossings: [{ test: 0, distance: 4 }, { test: 1, distance: 2 }],
      },
      {
        kind: 'branch',
        name: 'priceOf',
        path: 'if#0/then',
        startLine: 3,
        endLine: 4,
        source: true,
        crossings: [{ test: 1, distance: 3 }],
      },
      {
        kind: 'statement',
        name: 'unreached',
        path: 'statement#0',
        startLine: 10,
        endLine: 10,
        source: true,
        crossings: [],
      },
    ],
  }],
};

describe('variance_source_tests', () => {
  it('is callable through the MCP protocol', () => {
    const listed = handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      () => INDEX,
      SOURCE_TESTS,
    );
    expect((listed!.result as { tools: { name: string }[] }).tools).toEqual([
      expect.objectContaining({ name: 'variance_source_tests' }),
      expect.objectContaining({ name: 'variance_changed_tests' }),
      expect.objectContaining({ name: 'variance_diff' }),
    ]);

    const called = handle(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'variance_source_tests',
          arguments: { file: 'src/cart/total.ts', line: 3 },
        },
      },
      () => INDEX,
      SOURCE_TESTS,
    );
    const result = called!.result as { content: { text: string }[] };
    expect(result.content[0]!.text).toContain('applies the staff discount');
  });

  it('answers one line with named tests, and prints no depth beside them', () => {
    const text = sourceTests.run(INDEX, { file: 'src/cart/total.ts', line: 2 });

    expect(text).toContain('2 named test(s) reached line 2');
    expect(text.indexOf('applies the staff discount')).toBeLessThan(text.indexOf('uses the guest price'));
    expect(text).not.toContain('depth');
  });

  it('answers one function by its exact indexed name', () => {
    const text = sourceTests.run(INDEX, { file: 'src/cart/total.ts', function: 'priceOf' });

    expect(text).toContain('function priceOf');
    expect(text).toContain('test/cart.test.ts [staff]');
  });

  it('answers a scope with the cases that entered a recorded function under it', () => {
    const scoped: ExecutionIndex = {
      ...INDEX,
      modules: [{
        file: 'src/cart/total.ts',
        blocks: [{ ...INDEX.modules[0]!.blocks[0]!, name: 'Cart/priceOf' }],
      }],
    };

    expect(sourceTests.run(scoped, { file: 'src/cart/total.ts', function: 'Cart' })).toContain('2 named test(s) reached function Cart');
    expect(sourceTests.run(scoped, { file: 'src/cart/total.ts', function: 'Car' })).toBe('Function Car is not indexed in src/cart/total.ts.');
  });

  it('answers a whole file as compact source ranges', () => {
    const text = sourceTests.run(INDEX, { file: 'src/cart/total.ts' });

    expect(text).toContain('4 source range(s), 2 named test(s)');
    // Line 3 opens the branch and holds `priceOf`'s condition, so it is both.
    expect(text).toContain('lines 1-3');
    expect(text).toContain('line 4\n  applies the staff discount');
    expect(text).toContain('lines 5-8');
    expect(text).toContain('line 10\n  no named test reached this range');
  });

  describe('a region on a range no case entered, when the range names cases', () => {
    const branch = { kind: 'branch', name: 'priceOf', path: 'if#1/then', startLine: 6, endLine: 6, source: true, crossings: [] };
    const hidden = (stopped: readonly boolean[]): ExecutionIndex => ({
      tests: INDEX.tests.map((test, at) => ({ ...test, stopped: stopped[at]! })),
      modules: [{ ...INDEX.modules[0]!, blocks: [INDEX.modules[0]!.blocks[0]!, branch] }],
    });
    const cases = 'line 6\n  applies the staff discount — test/cart.test.ts [staff]\n  uses the guest price — test/cart.test.ts [guest]\n';

    it('is unwalked when every case that could have reached it finished', () => {
      expect(sourceTests.run(hidden([false, false]), { file: 'src/cart/total.ts' })).toContain(
        `${cases}  no case entered the branch on line 6, and every case that could have reached it finished: unwalked.\n`,
      );
    });

    it('says neither when a case stopped, since without the file graph nobody can tell whether it could have reached it', () => {
      expect(sourceTests.run(hidden([true, false]), { file: 'src/cart/total.ts' })).toContain(`${cases}  no case entered the branch on line 6.\n`);
    });
  });

  it('names indexed files when the requested path is unknown', () => {
    expect(sourceTests.run(INDEX, { file: 'src/missing.ts' })).toContain(
      'Indexed files:\n  src/cart/total.ts',
    );
  });

  it('keeps absent source distinct from source no test reached', () => {
    expect(sourceTests.run(INDEX, { file: 'src/cart/total.ts', line: 9 })).toBe(
      'Line 9 is not indexed in src/cart/total.ts.',
    );
    expect(sourceTests.run(INDEX, { file: 'src/cart/total.ts', line: 10 })).toBe(
      'No named test called into line 10 in src/cart/total.ts.',
    );
    expect(sourceTests.run(INDEX, {
      file: 'src/cart/total.ts',
      function: 'missing',
    })).toBe('Function missing is not indexed in src/cart/total.ts.');
  });

  it('refuses ambiguous and malformed targets', () => {
    expect(() => sourceTests.run(INDEX, {
      file: 'src/cart/total.ts',
      line: 2,
      function: 'priceOf',
    })).toThrow(/alternatives/);
    expect(() => sourceTests.run(INDEX, { file: 'src/cart/total.ts', line: 0 })).toThrow(
      /positive integer/,
    );
  });
});
