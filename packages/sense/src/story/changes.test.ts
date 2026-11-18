import { describe, expect, it } from 'vitest';
import type { Route } from './read.js';
import { pageChanges } from './changes.js';

const stop = (name: string, said?: string[]) =>
  ({ token: { place: { file: 'src/app.test.tsx', name, kind: 'function' as const, at: `src/app.test.tsx#${name}/entry`, startLine: 1, endLine: 9 }, entered: 1, arms: [], ...(said === undefined ? {} : { said }) } });

const ROUTE: Route = {
  file: 'src/app.test.tsx',
  name: 'opens the dialog',
  before: [],
  opening: { route: ['test line 10', 'dom + main "Open" in App at commit 1', 'page +1 −0 nodes, 0 attributes, 0 text'] },
  route: [
    stop('render'),
    stop('Dialog', ['test line 11', 'dom + div role="dialog" "Confirm order" in Dialog at commit 2', 'dom + button "Yes" in Dialog at commit 2', 'page +1 −0 nodes, 0 attributes, 0 text']),
    stop('close', ['test line 12', 'dom @aria-busy main absent→"true"', 'dom − div role="dialog" "Confirm order" at commit 3', 'page +0 −1 nodes, 1 attribute, 0 text']),
  ],
  files: ['src/app.test.tsx'],
  unresolved: [],
  untaken: [],
  untaped: 0,
  interleaved: 0,
};

describe('what a story says changed on the page', () => {
  it('finds each change a pattern matches, as appeared, disappeared or changed, at its step, test line and commit', () => {
    expect(pageChanges(ROUTE, 'role="dialog"')).toEqual({
      searched: 5,
      found: [
        { kind: 'appeared', step: 2, line: 11, commit: 2, change: '+ div role="dialog" "Confirm order" in Dialog' },
        { kind: 'disappeared', step: 3, line: 12, commit: 3, change: '− div role="dialog" "Confirm order"' },
      ],
    });
    expect(pageChanges(ROUTE, 'aria-busy').found).toEqual([{ kind: 'changed', step: 3, line: 12, change: '@aria-busy main absent→"true"' }]);
  });

  it('places what changed before the first step on the line that made it, with no step', () => {
    expect(pageChanges(ROUTE, '+ main').found).toEqual([{ kind: 'appeared', line: 10, commit: 1, change: '+ main "Open" in App' }]);
  });

  it('finds what a case changed when it reached no step at all', () => {
    expect(pageChanges({ ...ROUTE, route: [] }, 'main')).toEqual({
      searched: 1,
      found: [{ kind: 'appeared', line: 10, commit: 1, change: '+ main "Open" in App' }],
    });
  });

  it('finds nothing for a pattern no change holds, and still counts the changes it searched', () => {
    expect(pageChanges(ROUTE, 'toast')).toEqual({ searched: 5, found: [] });
  });

  it('matches a pattern as whole words, so a row is not found by a longer name that starts like it', () => {
    const rows = (sign: string, count: number) => Array.from({ length: count }, (_, at) => `dom ${sign} li "Item C${at}" in List at commit 1`);
    const big: Route = {
      ...ROUTE,
      opening: { route: ['test line 10', ...rows('+', 2000)] },
      route: [stop('remove', ['test line 14', 'dom − li "Item C3" in List at commit 2', 'dom − li "Item C30" in List at commit 2'])],
    };
    expect(pageChanges(big, 'Item C3').found).toEqual([
      { kind: 'appeared', line: 10, commit: 1, change: '+ li "Item C3" in List' },
      { kind: 'disappeared', step: 1, line: 14, commit: 2, change: '− li "Item C3" in List' },
    ]);
    // An end of the pattern that is a mark is matched where it stands.
    expect(pageChanges(ROUTE, 'role="dia').found).toEqual([]);
    expect(pageChanges(ROUTE, 'dialog"').found).toHaveLength(2);
  });
});
