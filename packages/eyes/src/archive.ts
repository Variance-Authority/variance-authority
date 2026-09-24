import { readFile } from 'node:fs/promises';
import type {
  Commit,
  CommitUpdater,
  CommitUpdaterFrame,
  TapRefusal,
} from '@variance-authority/react';
import {
  createEyesArchive,
  type ArgumentSnapshot,
  type Attention,
  type EyesArchive,
  type EyesTestAttention,
  type LocatorStep,
  type TargetSnapshot,
} from './access.js';

/** Read and validate portable Eyes evidence before an external reader trusts it. */
export async function readEyesArchive(path: string): Promise<EyesArchive> {
  return parseEyesArchive(JSON.parse(await readFile(path, 'utf8')));
}

/** Validate an untyped JSON value at the process boundary. */
export function parseEyesArchive(value: unknown): EyesArchive {
  const archive = object(value, 'eyes archive');
  if (archive['eyesVersion'] !== 1) throw new Error('unsupported eyes archive version');
  if (!Array.isArray(archive['tests'])) throw new Error('eyes archive tests must be an array');

  const tests = archive['tests'].map((candidate, at): EyesTestAttention => {
    const test = object(candidate, `eyes test ${at}`);
    const id = requiredString(test['id'], `eyes test ${at} id`);
    const title = requiredString(test['title'], `eyes test ${id} title`);
    const file = optionalString(test['file'], `eyes test ${id} file`);
    const attempt = test['attempt'] === undefined
      ? undefined
      : nonNegativeInteger(test['attempt'], `eyes test ${id} attempt`);
    if (typeof test['complete'] !== 'boolean') {
      throw new Error(`eyes test ${id} complete must be boolean`);
    }
    if (!Array.isArray(test['attention'])) {
      throw new Error(`eyes test ${id} attention must be an array`);
    }
    const attention = test['attention'].map((entry, index) =>
      checkedAttention(entry, `eyes test ${id} attention ${index}`));
    if (test['complete']) {
      return {
        id,
        ...(attempt === undefined ? {} : { attempt }),
        title,
        ...(file === undefined ? {} : { file }),
        complete: true,
        attention,
      };
    }
    return {
      id,
      ...(attempt === undefined ? {} : { attempt }),
      title,
      ...(file === undefined ? {} : { file }),
      complete: false,
      because: requiredString(test['because'], `eyes test ${id} partial reason`),
      attention,
    };
  });
  return createEyesArchive(tests);
}

function checkedAttention(value: unknown, where: string): Attention {
  const attention = object(value, where);
  const sequence = nonNegativeInteger(attention['sequence'], `${where} sequence`);
  const kind = attention['kind'];
  if (kind === 'eyes-phase') {
    const phase = attention['phase'];
    if (phase !== 'arrange' && phase !== 'act' && phase !== 'assert') {
      throw new Error(`${where} has unknown phase`);
    }
    return { kind, phase, sequence };
  }
  if (kind === 'react-commit') {
    return { kind, commit: checkedCommit(attention['commit'], `${where} commit`), sequence };
  }
  if (kind === 'react-tap-refused') {
    return { kind, reason: checkedRefusal(attention['reason'], `${where} reason`), sequence };
  }
  if (kind === 'document-event') {
    if (typeof attention['trusted'] !== 'boolean') throw new Error(`${where} trusted must be boolean`);
    return {
      kind,
      event: requiredString(attention['event'], `${where} event`),
      trusted: attention['trusted'],
      target: checkedTarget(attention['target'], `${where} target`),
      sequence,
    };
  }
  if (kind === 'rtl-query') return checkedRtl(attention, where, sequence);
  if (kind === 'playwright-locator') return checkedLocator(attention, where, sequence);
  throw new Error(`${where} has unknown kind`);
}

function checkedRefusal(value: unknown, where: string): TapRefusal {
  // Listed rather than passed through. A reason a newer producer invented is one
  // this reader cannot interpret, and the return type is what keeps the list
  // honest when the producing union changes.
  if (value !== 'react-already-loaded' && value !== 'unrecognised-hook' && value !== 'no-hook') {
    throw new Error(`${where} has unknown tap refusal`);
  }
  return value;
}

function checkedCommit(value: unknown, where: string): Commit {
  const commit = object(value, where);
  const at = finiteNonNegative(commit['at'], `${where} at`);
  const components = strings(commit['components'], `${where} components`);
  const updaters = commit['updaters'] === undefined
    ? undefined
    : checkedUpdaters(commit['updaters'], `${where} updaters`);
  const truncated = optionalBoolean(commit['truncated'], `${where} truncated`);
  const updatersTruncated = optionalBoolean(
    commit['updatersTruncated'],
    `${where} updatersTruncated`,
  );
  return {
    at,
    components,
    ...(updaters === undefined ? {} : { updaters }),
    ...(truncated === undefined ? {} : { truncated }),
    ...(updatersTruncated === undefined ? {} : { updatersTruncated }),
  };
}

function checkedUpdaters(value: unknown, where: string): readonly CommitUpdater[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((candidate, at) => {
    const updater = object(candidate, `${where} ${at}`);
    if (!Array.isArray(updater['path']) || updater['path'].length === 0) {
      throw new Error(`${where} ${at} path must be a non-empty array`);
    }
    const path = updater['path'].map((frame, index) =>
      checkedUpdaterFrame(frame, `${where} ${at} path ${index}`));
    const source = updater['source'] === undefined
      ? undefined
      : checkedSource(updater['source'], `${where} ${at} source`);
    return { path, ...(source === undefined ? {} : { source }) };
  });
}

function checkedUpdaterFrame(value: unknown, where: string): CommitUpdaterFrame {
  const frame = object(value, where);
  const key = frame['key'];
  if (key !== null && typeof key !== 'string') {
    throw new Error(`${where} key must be string or null`);
  }
  return {
    name: requiredString(frame['name'], `${where} name`),
    key,
    propsDigest: requiredString(
      frame['propsDigest'],
      `${where} propsDigest`,
    ) as CommitUpdaterFrame['propsDigest'],
  };
}

function checkedRtl(
  attention: Record<string, unknown>,
  where: string,
  sequence: number,
): Attention {
  const base = {
    kind: 'rtl-query' as const,
    query: requiredString(attention['query'], `${where} query`),
    arguments: checkedArguments(attention['arguments'], `${where} arguments`),
    sequence,
  };
  if (attention['outcome'] === 'absent') return { ...base, outcome: 'absent' };
  if (attention['outcome'] === 'threw') {
    return { ...base, outcome: 'threw', error: requiredString(attention['error'], `${where} error`) };
  }
  if (attention['outcome'] === 'resolved') {
    return {
      ...base,
      outcome: 'resolved',
      targets: checkedTargets(attention['targets'], `${where} targets`),
    };
  }
  throw new Error(`${where} has unknown RTL outcome`);
}

function checkedLocator(
  attention: Record<string, unknown>,
  where: string,
  sequence: number,
): Attention {
  const operation = attention['operation'];
  const locator = checkedLocatorSteps(attention['locator'], `${where} locator`);
  if (operation === 'planned') return { kind: 'playwright-locator', operation, locator, sequence };
  if (operation !== 'action' && operation !== 'read' && operation !== 'assertion') {
    throw new Error(`${where} has unknown Locator operation`);
  }
  const member = requiredString(attention['member'], `${where} member`);
  const before = optionalTargets(attention['before'], `${where} before`);
  const base = {
    kind: 'playwright-locator' as const,
    operation,
    member,
    locator,
    ...(before === undefined ? {} : { before }),
    sequence,
  } as const;
  if (attention['outcome'] === 'threw') {
    return { ...base, outcome: 'threw', error: requiredString(attention['error'], `${where} error`) };
  }
  if (attention['outcome'] === 'resolved') {
    const after = optionalTargets(attention['after'], `${where} after`);
    return { ...base, outcome: 'resolved', ...(after === undefined ? {} : { after }) };
  }
  throw new Error(`${where} has unknown Locator outcome`);
}

function checkedLocatorSteps(value: unknown, where: string): readonly LocatorStep[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((candidate, at) => {
    const step = object(candidate, `${where} ${at}`);
    return {
      member: requiredString(step['member'], `${where} ${at} member`),
      arguments: checkedArguments(step['arguments'], `${where} ${at} arguments`),
    };
  });
}

function checkedArguments(value: unknown, where: string): readonly ArgumentSnapshot[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((argument, at) => checkedArgument(argument, `${where} ${at}`));
}

function checkedArgument(value: unknown, where: string): ArgumentSnapshot {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, at) => checkedArgument(item, `${where} ${at}`));
  const candidate = object(value, where);
  return Object.fromEntries(
    Object.entries(candidate).map(([key, item]) => [key, checkedArgument(item, `${where}.${key}`)]),
  );
}

function checkedTargets(value: unknown, where: string): readonly TargetSnapshot[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((target, at) => checkedTarget(target, `${where} ${at}`));
}

function optionalTargets(value: unknown, where: string): readonly TargetSnapshot[] | undefined {
  return value === undefined ? undefined : checkedTargets(value, where);
}

function checkedTarget(value: unknown, where: string): TargetSnapshot {
  const target = object(value, where);
  const provenanceResult = object(target['provenance'], `${where} provenance`);
  const provenance = provenanceResult['status'] === 'no-fiber'
    ? checkedNoFiber(provenanceResult, `${where} provenance`)
    : checkedResolved(provenanceResult, `${where} provenance`);
  return {
    nodeName: requiredString(target['nodeName'], `${where} nodeName`),
    ...optionalFields(target, where, ['id', 'role', 'testId', 'ariaLabel', 'name', 'type']),
    provenance,
  };
}

function checkedNoFiber(value: Record<string, unknown>, where: string): TargetSnapshot['provenance'] {
  const reason = value['reason'];
  if (reason !== 'no-client-fiber' && reason !== 'unmounted') {
    throw new Error(`${where} has unknown no-Fiber reason`);
  }
  return { status: 'no-fiber', reason };
}

function checkedResolved(value: Record<string, unknown>, where: string): TargetSnapshot['provenance'] {
  if (value['status'] !== 'resolved') throw new Error(`${where} has unknown status`);
  const source = object(value['provenance'], `${where} value`);
  if (!Array.isArray(source['owners'])) throw new Error(`${where} owners must be an array`);
  const owners = source['owners'].map((candidate, at) => {
    const owner = object(candidate, `${where} owner ${at}`);
    const createdBy = optionalString(owner['createdBy'], `${where} owner ${at} createdBy`);
    return {
      name: requiredString(owner['name'], `${where} owner ${at} name`),
      propsDigest: requiredString(owner['propsDigest'], `${where} owner ${at} propsDigest`),
      ...(createdBy === undefined ? {} : { createdBy }),
    };
  });
  const createdBy = optionalString(source['createdBy'], `${where} createdBy`);
  const location = source['source'] === undefined ? undefined : checkedSource(source['source'], `${where} source`);
  return {
    status: 'resolved',
    provenance: {
      owners,
      ...(createdBy === undefined ? {} : { createdBy }),
      ...(location === undefined ? {} : { source: location }),
    },
  };
}

function checkedSource(value: unknown, where: string): { file: string; line: number; column: number } {
  const source = object(value, where);
  return {
    file: requiredString(source['file'], `${where} file`),
    line: positiveInteger(source['line'], `${where} line`),
    // React 18 and the recording JSX runtime use zero when the transform did
    // not supply a column. It is a known absence inside a present location.
    column: nonNegativeInteger(source['column'], `${where} column`),
  };
}

function optionalFields(
  value: Record<string, unknown>,
  where: string,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(names.flatMap((name) => {
    const found = optionalString(value[name], `${where} ${name}`);
    return found === undefined ? [] : [[name, found]];
  }));
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} is required`);
  return value;
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, where);
}

function nonNegativeInteger(value: unknown, where: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${where} must be a non-negative integer`);
  }
  return value as number;
}

function finiteNonNegative(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where} must be a finite non-negative number`);
  }
  return value;
}

function strings(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value.map((item, at) => requiredString(item, `${where} ${at}`));
}

function optionalBoolean(value: unknown, where: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${where} must be boolean`);
  return value;
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${where} must be a positive integer`);
  }
  return value as number;
}
