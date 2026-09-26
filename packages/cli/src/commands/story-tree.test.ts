import { describe, expect, it } from 'vitest';
import { armTree } from './story-tree.js';

describe('the arms of one step, drawn as the code is nested', () => {
  it('pairs the arms of an `if`, draws what sits inside one arm under it, and leaves the code after a loop undrawn', () => {
    const taken = [
      { path: 'for#0/body', startLine: 5, endLine: 20, times: 6 },
      { path: 'for#0/body/if#0/then', startLine: 6, endLine: 8, times: 2 },
      { path: 'for#0/body/if#0/else', startLine: 8, endLine: 10, times: 4 },
      { path: 'for#0/body/if#0/then/if#0/then', startLine: 7, endLine: 7, times: 2 },
      { path: 'for#0/after', startLine: 21, endLine: 22, times: 1 },
    ];
    const never = [{ path: 'for#0/body/if#0/then/if#0/else', startLine: 7, endLine: 7 }, { path: 'while#0/body', startLine: 30, endLine: 31 }];
    expect(armTree(taken, never, new Map())).toEqual([
      'for 5 ×6',
      '  if 6  then ×2  else ×4',
      '    in 6 then: if 7  then ×2  else ✗',
      'while 30 ✗',
    ]);
  });

  it('names the cases of a `switch` and the handlers of a `try` by the line they start on, and an `await` as its own', () => {
    const taken = [
      { path: 'switch#0/case#1', startLine: 12, endLine: 13, times: 3 },
      { path: 'try#0/try', startLine: 20, endLine: 22, times: 1 },
      { path: 'try#0/catch', startLine: 23, endLine: 24, times: 1 },
      { path: 'await#0', startLine: 30, endLine: 30, times: 2 },
    ];
    const never = [{ path: 'switch#0/default', startLine: 15, endLine: 16 }, { path: 'try#0/finally', startLine: 25, endLine: 26 }];
    expect(armTree(taken, never, new Map())).toEqual(['switch  case 12 ×3  default 15 ✗', 'try  catch 23 ×1  finally 25 ✗', 'await 30 ×2']);
  });

  it('marks an arm entered at an earlier step with ↑, named by the line it starts on there', () => {
    const taken = [{ path: 'for#0/body/if#0/else', startLine: 8, endLine: 10, times: 1 }];
    const never = [{ path: 'for#0/body/if#0/then', startLine: 6, endLine: 8 }];
    expect(armTree(taken, never, new Map([['for#0/body', 5]]))).toEqual(['for 5 ↑', '  if 6  then ✗  else ×1']);
  });
});
