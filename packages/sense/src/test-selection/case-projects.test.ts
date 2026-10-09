import { describe, expect, it } from 'vitest';
import { reportedCases, taskCases } from './case-durations.js';
import { caseProjects } from './case-projects.js';
import { caseIds, caseKey, type CaseCoordinate } from './cases.js';

function idsOf(cases: readonly CaseCoordinate[]): string[] {
  const ids = caseIds(cases);
  return cases.map((coordinate) => ids.get(caseKey(coordinate))!);
}

describe('the copies of a case two projects ran, told apart by project', () => {
  it('names every copy by the project that ran it', () => {
    expect(idsOf([
      { file: 'test/a.test.ts', name: 'pays', id: 'h1', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h2', project: 'compiled' },
    ])).toEqual(['|plain| test/a.test.ts > pays', '|compiled| test/a.test.ts > pays']);
  });

  it('numbers a repeat inside one project, and leaves a case one project ran bare', () => {
    expect(idsOf([
      { file: 'test/a.test.ts', name: 'pays', id: 'h1', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h2', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h3', project: 'compiled' },
      { file: 'test/a.test.ts', name: 'owes', id: 'h4', project: 'plain' },
    ])).toEqual([
      '|plain| test/a.test.ts > pays',
      '|plain| test/a.test.ts > pays#1',
      '|compiled| test/a.test.ts > pays',
      'test/a.test.ts > owes',
    ]);
  });

  it('refuses a repeat inside one project numbered onto a case literally named so', () => {
    expect(() => caseIds([
      { file: 'test/a.test.ts', name: 'pays', id: 'h1', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h2', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h3', project: 'compiled' },
      { file: 'test/a.test.ts', name: 'pays#1', id: 'h4', project: 'plain' },
      { file: 'test/a.test.ts', name: 'pays#1', id: 'h5', project: 'compiled' },
    ])).toThrow('"pays#1" is the name of one case and the number of a repeated "pays"');
  });

  it('numbers copies when the runner named no project', () => {
    expect(idsOf([
      { file: 'test/a.test.ts', name: 'pays', id: 'h1' },
      { file: 'test/a.test.ts', name: 'pays', id: 'h2' },
    ])).toEqual(['test/a.test.ts > pays', 'test/a.test.ts > pays#1']);
  });
});

describe('the project the runner reported, joined to the case by its id', () => {
  it('carries the project from either report shape, and names none for an empty one', () => {
    expect(taskCases({ projectName: 'plain', tasks: [{ name: 'pays', id: 't1' }] } as never).cases)
      .toEqual([{ name: 'pays', id: 't1', project: 'plain' }]);
    expect(taskCases({ projectName: '', tasks: [{ name: 'pays', id: 't1' }] } as never).cases)
      .toEqual([{ name: 'pays', id: 't1' }]);
    const module = {
      project: { name: 'compiled' },
      children: { allTests: () => [{ fullName: 'pays', id: 't2', diagnostic: () => undefined }] },
    };
    expect(reportedCases(module as never).cases).toMatchObject([{ id: 't2', project: 'compiled' }]);
  });

  it('looks a case up by its file and the runner\'s id', () => {
    const projects = caseProjects([{
      filepath: '/repo/test/a.test.ts',
      cases: [{ name: 'pays', id: 't1', project: 'plain' }, { name: 'owes', id: 't2' }],
    }], '/repo');

    expect([projects('test/a.test.ts', 't1'), projects('test/a.test.ts', 't2'), projects('test/b.test.ts', 't1')])
      .toEqual(['plain', undefined, undefined]);
  });
});
