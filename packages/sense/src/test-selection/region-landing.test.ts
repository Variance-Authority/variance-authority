import { describe, expect, it } from 'vitest';
import type { SetExecutionModule } from './execution-set-format.js';
import { NO_OWNER } from './format-layout.js';
import { relined } from './region-landing.js';

/** A module of named regions, each `[name, startLine, owner]`, the owner a position among them. */
function module(regions: readonly (readonly [name: string, line: number, owner: number])[], owned = true): SetExecutionModule {
  return {
    file: 'src/held.ts',
    blocks: regions.map(([name, line]) => ({ kind: 'function', name, path: name, startLine: line, endLine: line + 1, source: true })),
    called: new Uint32Array(regions.length),
    loaded: new Uint8Array(regions.length),
    ...(owned ? { owner: Uint32Array.from(regions, ([, , owner]) => owner) } : {}),
  };
}

describe('a held module re-lined onto the lines recorded now', () => {
  it('keeps each kept region\'s owner, walking past one the recorded cut left out', () => {
    const held = module([['top', 1, NO_OWNER], ['kept', 2, 0], ['gone', 4, 0], ['inner', 5, 2]]);
    const recorded = module([['top', 11, NO_OWNER], ['kept', 12, 0], ['inner', 15, 0]]);
    const lined = relined(held, recorded)!;
    expect(lined.blocks.map((block) => [block.name, block.startLine])).toEqual([['top', 11], ['kept', 12], ['inner', 15]]);
    expect([...lined.owner!]).toEqual([NO_OWNER, 0, 0]);
  });

  it('names no owner where the held one is left out and nothing holds it', () => {
    const held = module([['gone', 1, NO_OWNER], ['inner', 2, 0]]);
    const recorded = module([['inner', 12, NO_OWNER]]);
    expect([...relined(held, recorded)!.owner!]).toEqual([NO_OWNER]);
  });

  it('lays no owners where the held module recorded none', () => {
    const held = module([['top', 1, NO_OWNER], ['kept', 2, 0]], false);
    const recorded = module([['top', 11, NO_OWNER], ['kept', 12, 0]]);
    expect(relined(held, recorded)!.owner).toBeUndefined();
  });
});
