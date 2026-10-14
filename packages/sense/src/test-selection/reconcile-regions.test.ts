import { describe, expect, it } from 'vitest';
import { reconcileRegions, type RegionShape } from './reconcile-regions.js';

const module = { kind: 'module', name: '', path: '', startLine: 1, endLine: 20, source: true } as const;
const outer = { kind: 'function', name: 'outer', path: 'outer', startLine: 2, endLine: 10, source: true } as const;
const inner = { kind: 'function', name: 'inner', path: 'inner', startLine: 12, endLine: 15, source: true } as const;
const branch = { kind: 'branch', name: '', path: 'outer', startLine: 4, endLine: 6, source: true } as const;

describe('reconcileRegions', () => {
  it('keeps one inventory as it is', () => {
    const only: RegionShape[] = [module, outer];
    expect(reconcileRegions([only])).toEqual({ blocks: only, lands: [[0, 1]] });
  });

  it('reads a file two builds cut apart at the regions both hold, whatever order they come in', () => {
    const plain: RegionShape[] = [module, outer, inner];
    const split: RegionShape[] = [module, outer, branch, inner];
    expect(reconcileRegions([plain, split])).toEqual({ blocks: [module, outer, inner], lands: [[0, 1, 2], [0, 1, 1, 2]] });
    expect(reconcileRegions([split, plain])).toEqual({ blocks: [module, outer, inner], lands: [[0, 1, 1, 2], [0, 1, 2]] });
  });

  it('reads a region no shared region encloses at one region spanning the file', () => {
    const short: RegionShape[] = [{ ...module, endLine: 20 }, outer];
    const long: RegionShape[] = [{ ...module, endLine: 22 }, outer];
    expect(reconcileRegions([short, long])).toEqual({
      blocks: [outer, { ...module, endLine: 22 }],
      lands: [[1, 0], [1, 0]],
    });
  });
});
