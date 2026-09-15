// compass: variance-authority/runtime/attention
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';

/** Validate the runner-independent execution JSON accepted by the CLI. */
export function parseExecutionIndex(value: unknown): ExecutionIndex {
  const root = object(value, 'execution index');
  if (!Array.isArray(root['tests']) || !Array.isArray(root['modules'])) {
    throw new Error('execution index tests and modules must be arrays');
  }
  const tests = root['tests'].map((value, at) => {
    const test = object(value, `execution test ${at}`);
    return {
      id: string(test['id'], `execution test ${at} id`),
      file: string(test['file'], `execution test ${at} file`),
      name: string(test['name'], `execution test ${at} name`),
    };
  });
  const modules = root['modules'].map((value, at) => {
    const module = object(value, `execution module ${at}`);
    if (!Array.isArray(module['blocks'])) throw new Error(`execution module ${at} blocks must be an array`);
    return {
      file: string(module['file'], `execution module ${at} file`),
      blocks: module['blocks'].map((value, blockAt) => parseBlock(value, at, blockAt, tests.length)),
    };
  });
  return { tests, modules };
}

function parseBlock(
  value: unknown,
  moduleAt: number,
  at: number,
  tests: number,
): ExecutionIndex['modules'][number]['blocks'][number] {
  const where = `execution module ${moduleAt} block ${at}`;
  const block = object(value, where);
  if (!Array.isArray(block['crossings'])) throw new Error(`${where} crossings must be an array`);
  const startLine = integer(block['startLine'], `${where} startLine`);
  const endLine = integer(block['endLine'], `${where} endLine`);
  if (typeof block['source'] !== 'boolean') throw new Error(`${where} source must be boolean`);
  return {
    kind: string(block['kind'], `${where} kind`),
    // A module root is the one region with no declaration to be named after,
    // and every producer records it with an empty name.
    name: text(block['name'], `${where} name`),
    path: string(block['path'], `${where} path`),
    startLine,
    endLine,
    source: block['source'],
    crossings: block['crossings'].map((value, crossingAt) => {
      const crossing = object(value, `${where} crossing ${crossingAt}`);
      const test = integer(crossing['test'], `${where} crossing ${crossingAt} test`, true);
      if (test >= tests) throw new Error(`${where} crossing ${crossingAt} names missing test ${test}`);
      const loaded = crossing['loaded'];
      if (loaded !== undefined && typeof loaded !== 'boolean') {
        throw new Error(`${where} crossing ${crossingAt} loaded must be boolean`);
      }
      return {
        test,
        distance: integer(crossing['distance'], `${where} crossing ${crossingAt} distance`, true),
        ...(loaded === undefined ? {} : { loaded }),
      };
    }),
  };
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${where} must be a non-empty string`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`${where} must be a string`);
  return value;
}

function integer(value: unknown, where: string, allowZero = false): number {
  if (!Number.isInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new Error(`${where} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return value as number;
}

