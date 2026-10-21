// compass: variance-authority/runtime/attention
import { saidAcross, type ExecutionIndex, type ExecutionTest } from '@variance-authority/sense/test-selection';

/** Validate the runner-independent execution JSON accepted by the CLI. */
export function parseExecutionIndex(value: unknown): ExecutionIndex {
  const root = object(value, 'execution index');
  if (!Array.isArray(root['tests']) || !Array.isArray(root['modules'])) {
    throw new Error('execution index tests and modules must be arrays');
  }
  const tests = root['tests'].map((value, at) => {
    const test = object(value, `execution test ${at}`);
    const stopped = test['stopped'];
    if (stopped !== undefined && typeof stopped !== 'boolean') throw new Error(`execution test ${at} stopped must be boolean`);
    return {
      id: string(test['id'], `execution test ${at} id`),
      file: string(test['file'], `execution test ${at} file`),
      name: string(test['name'], `execution test ${at} name`),
      // Absent is a case whose settling nobody saw, or that no runner timed; neither is `false` or `0`.
      ...(stopped === undefined ? {} : { stopped }),
      ...(test['duration'] === undefined ? {} : { duration: integer(test['duration'], `execution test ${at} duration`, true) }),
      // Empty is a case heard to say nothing; absent is one nobody listened to.
      ...(test['preconditions'] === undefined ? {} : { said: parsePreconditions(test['preconditions'], at) }),
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

/** The preconditions as a frame field spells them, `{"said":[[name, value, site, level], …]}` with each value as JSON text, joined by the addon as every writer joins them. */
function parsePreconditions(value: unknown, testAt: number): NonNullable<ExecutionTest['said']> {
  if (!Array.isArray(value)) throw new Error(`execution test ${testAt} preconditions must be an array`);
  const said = value.map((value, at) => {
    const where = `execution test ${testAt} precondition ${at}`;
    const item = object(value, where);
    const held = item['value'];
    if (held === undefined) throw new Error(`${where} value is missing`);
    return [
      string(item['name'], `${where} name`),
      JSON.stringify(held),
      string(item['site'], `${where} site`),
      integer(item['level'], `${where} level`, true),
    ];
  });
  return saidAcross(JSON.stringify({ said }), undefined).said!;
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
  const loaded = block['loaded'];
  if (loaded !== undefined && typeof loaded !== 'boolean') throw new Error(`${where} loaded must be boolean`);
  return {
    kind: string(block['kind'], `${where} kind`),
    // A module root is the one region with no declaration to be named after,
    // and every producer records it with an empty name.
    name: text(block['name'], `${where} name`),
    path: string(block['path'], `${where} path`),
    startLine,
    endLine,
    source: block['source'],
    // Only a region that ran during load says so; `false` and absent read alike.
    ...(loaded === true ? { loaded } : {}),
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

