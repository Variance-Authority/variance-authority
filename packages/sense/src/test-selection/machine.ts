/**
 * The machine a run ran on, as a class of machines rather than one host.
 *
 * A duration is one reading on one machine: a file that takes 4 s on a
 * two-core runner may take 1 s on a laptop. A landing names its machine so a
 * reader compares figures within a class, never across one. It names the kind
 * of machine and no host, so two runners from one image are one class. This
 * file decides what a machine's fields mean and when two are one class; it
 * reads nothing. [`machine-read.ts`](machine-read.ts) reads them. Nothing here
 * enters a cache key, and selection never reads it.
 */

// compass: variance-authority.reach

import type { CommitRuns } from './commit-runs.js';
import type { ShardRuns } from './kept-install.js';

/** What a run's machine was, each field absent where it is not known. */
export interface Machine {
  /** The CPU model, as the OS names it. */
  readonly cpu?: string;
  readonly arch?: string;
  /** The platform and its kernel release. */
  readonly os?: string;
  /** The cores Node would use (`availableParallelism`), which a recent libuv rounds a cgroup quota into. */
  readonly cores?: number;
  /** The cores a cgroup's CPU quota grants, where one sets a quota. */
  readonly cpuQuota?: number;
  /** Total memory, in bytes. */
  readonly memory?: number;
  /** The memory a cgroup grants, in bytes, where one sets a limit. */
  readonly memoryLimit?: number;
  /** The Node version. */
  readonly node?: string;
  /** The CI runner's image, where the environment names one (`imageOf`). */
  readonly image?: string;
  /** The workers the runner ran test files in, where it said them. */
  readonly workers?: number;
}

const TEXTS = ['cpu', 'arch', 'os', 'node', 'image'] as const;
const COUNTS = ['cores', 'cpuQuota', 'memory', 'memoryLimit', 'workers'] as const;
/** Every field, in the order a class and a description name them. */
const FIELDS = ['cpu', 'arch', 'os', 'cores', 'cpuQuota', 'memory', 'memoryLimit', 'node', 'image', 'workers'] as const;

/** The workers a runner's configuration names, where it names a count. */
export function configuredWorkers(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The CI runner's image, where the environment names one: a hosted GitHub
 * Actions or Azure Pipelines runner's `ImageOS` and `ImageVersion`, or a GitLab
 * job's `CI_JOB_IMAGE`. A self-hosted runner names only itself, which is a
 * host, so it names no image.
 */
export function imageOf(env: NodeJS.ProcessEnv): string | undefined {
  if (env.ImageOS !== undefined && env.ImageOS !== '') return env.ImageVersion === undefined || env.ImageVersion === '' ? env.ImageOS : `${env.ImageOS} ${env.ImageVersion}`;
  if (env.CI_JOB_IMAGE !== undefined && env.CI_JOB_IMAGE !== '') return env.CI_JOB_IMAGE;
  return undefined;
}

/** The machine `value` holds as JSON a run wrote: each field that is what it says, and nothing when none is. */
export function machineOf(value: unknown): Machine | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Readonly<Record<string, unknown>>;
  const machine: Record<string, string | number> = {};
  for (const field of TEXTS) if (typeof fields[field] === 'string' && fields[field] !== '') machine[field] = fields[field];
  for (const field of COUNTS) {
    const count = fields[field];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) machine[field] = count;
  }
  return Object.keys(machine).length === 0 ? undefined : (machine as Machine);
}

/**
 * The class `machine` is of, as one string: two runs on one kind of machine
 * are one class, whatever wrote its fields. Memory counts to the tenth of a
 * GiB a reader is told, since two VMs of one size report it megabytes apart.
 */
export function machineClass(machine: Machine): string {
  return JSON.stringify(FIELDS.map((field) => {
    const value = machine[field];
    if (value === undefined) return null;
    return field === 'memory' || field === 'memoryLimit' ? gib(value as number) : value;
  }));
}

/** The class key of `machine`, or `''` where none is named: the key a reader groups figures under. */
export function classKey(machine: Machine | undefined): string {
  return machine === undefined ? '' : machineClass(machine);
}

/** `machine` as a reader says it, in one line. */
export function describeMachine(machine: Machine): string {
  const { cpu, arch, os, cores, cpuQuota, memory, memoryLimit, node, image, workers } = machine;
  const parts = [
    [cpu, arch].filter((part) => part !== undefined).join(' '),
    os ?? '',
    cores === undefined ? (cpuQuota === undefined ? '' : `quota ${String(cpuQuota)} cores`) : `${String(cores)} cores${cpuQuota === undefined ? '' : ` (quota ${String(cpuQuota)})`}`,
    memory === undefined ? (memoryLimit === undefined ? '' : `limit ${gib(memoryLimit)}`) : `${gib(memory)}${memoryLimit === undefined ? '' : ` (limit ${gib(memoryLimit)})`}`,
    node === undefined ? '' : `Node ${node}`,
    image === undefined ? '' : `image ${image}`,
    workers === undefined ? '' : `${String(workers)} worker${workers === 1 ? '' : 's'}`,
  ].filter((part) => part !== '');
  return parts.length === 0 ? 'an unnamed machine' : parts.join(', ');
}

function gib(bytes: number): string {
  return `${String(Math.round((bytes / 2 ** 30) * 10) / 10)} GiB`;
}

/**
 * The machine each file of a fold of `shards` ran on, as its shard's own
 * landing named it: only where that shard's record stands at the commit its
 * snapshot does and holds a run of its own, not one seeded from the base. A
 * file two shards, or two runs, name on two machines names none, and so does
 * one a shard ran whose record does not name it.
 */
export function shardsMachines(shards: readonly ShardRuns[]): (file: string) => Machine | undefined {
  const machines = new Map<string, Machine | undefined>();
  for (const { tests, runs } of shards) {
    const own = runs !== undefined && runs.runs > 0 && tests.commit !== undefined && runs.commit === tests.commit;
    const named = own ? agreedMachines(runs.landings) : new Map<string, Machine | undefined>();
    // A file this shard ran that its record does not name was run on a
    // machine nobody knows, and the fold's figures for it are partly its.
    for (const { file } of tests.tests) agree(machines, file, named.get(file));
  }
  return (file) => machines.get(file);
}

/** `one`, where `other` is of its class; none where either names none or the two differ. */
function sameMachine(one: Machine | undefined, other: Machine | undefined): Machine | undefined {
  return one !== undefined && other !== undefined && machineClass(one) === machineClass(other) ? one : undefined;
}

/**
 * The machine each file of `runs` ran on: the one class every landing and
 * stand that ran it, whole or in part, agrees on. Its figures may be of any
 * of those runs, and the record does not say which, so a file two of them
 * ran on two machines names none, whatever order they are listed in, and so
 * does a file a run that named no machine ran.
 */
export function filesMachines(runs: Pick<CommitRuns, 'landings' | 'standing'>): ReadonlyMap<string, Machine | undefined> {
  return agreedMachines([...(runs.standing ?? []), ...runs.landings]);
}

function agreedMachines(entries: readonly { readonly files: readonly string[]; readonly partly?: readonly string[]; readonly machine?: Machine }[]): Map<string, Machine | undefined> {
  const machines = new Map<string, Machine | undefined>();
  for (const { files, partly = [], machine } of entries) {
    for (const file of [...files, ...partly]) agree(machines, file, machine);
  }
  return machines;
}

/** Names `file` on `machine` in `machines`, or on none where it already names another. */
function agree(machines: Map<string, Machine | undefined>, file: string, machine: Machine | undefined): void {
  machines.set(file, machines.has(file) ? sameMachine(machines.get(file), machine) : machine);
}
