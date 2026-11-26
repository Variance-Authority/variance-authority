/**
 * The machine a run ran on, as a class of machines rather than one host.
 *
 * A duration is one reading on one machine: a file that takes 4 s on a
 * two-core runner may take 1 s on a laptop. A landing names its machine so a
 * reader compares figures within a class, never across one. It names the kind
 * of machine and no host, so two runners from one image are one class. The
 * engine answers what it can (`availableParallelism`, `constrainedMemory`);
 * only the cgroup CPU quota, which Node does not expose, is read from Linux's
 * files. Nothing here enters a cache key, and selection never reads it.
 */

// compass: variance-authority.reach

import { readFileSync } from 'node:fs';
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { posix } from 'node:path';
import type { CommitRuns } from './commit-runs.js';
import type { ShardRuns } from './kept-install.js';
import type { RanTests } from './landings.js';

/** What a run's machine was, each field absent where it is not known. */
export interface Machine {
  /** The CPU model, as the OS names it. */
  readonly cpu?: string;
  readonly arch?: string;
  /** The platform and its kernel release. */
  readonly os?: string;
  /** The cores Node would use (`availableParallelism`). */
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

type Read = (path: string) => string | undefined;

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // A file the machine does not have is a limit it does not set.
    return undefined;
  }
}

/** The machine this process runs on, with the `workers` its runner said. `read` and `env` stand in for the file system and the environment. */
export function readMachine(
  workers: number | undefined,
  { read = readText, env = process.env }: { readonly read?: Read; readonly env?: NodeJS.ProcessEnv } = {},
): Machine {
  const cpu = cpus()[0]?.model.trim();
  const limit = process.constrainedMemory();
  const quota = platform() === 'linux' ? cpuQuotaOf(read) : undefined;
  const image = imageOf(env);
  return {
    ...(cpu === undefined || cpu === '' ? {} : { cpu }),
    arch: process.arch,
    os: `${platform()} ${release()}`,
    cores: availableParallelism(),
    ...(quota === undefined ? {} : { cpuQuota: quota }),
    memory: totalmem(),
    // Node reads no limit as 0 or as the largest unsigned 64-bit number.
    ...(limit > 0 && limit < Number.MAX_SAFE_INTEGER ? { memoryLimit: limit } : {}),
    node: process.version,
    ...(image === undefined ? {} : { image }),
    ...(workers === undefined ? {} : { workers }),
  };
}

/** The workers a runner's configuration names, where it names a count. */
export function workersOf(value: unknown): number | undefined {
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

/**
 * The cores this process's cgroup grants, the tightest quota of its group and
 * every ancestor: cgroup v2's `cpu.max`, else v1's `cpu.cfs_quota_us` over
 * `cpu.cfs_period_us`. A container mounts its own group at the root, so a
 * host path `/proc/self/cgroup` names that is not mounted is walked up to it.
 */
export function cpuQuotaOf(read: Read): number | undefined {
  const groups = read('/proc/self/cgroup')?.split('\n') ?? [];
  const unified = groups.find((line) => line.startsWith('0::'));
  if (unified !== undefined) return tightest('/sys/fs/cgroup', unified.slice(3), (dir) => quotaV2(read(posix.join(dir, 'cpu.max'))));
  const cpu = groups.map((line) => line.split(':')).find(([, controllers]) => controllers?.split(',').includes('cpu') === true);
  if (cpu === undefined) return undefined;
  const [, controllers, path = '/'] = cpu;
  const v1 = (dir: string): number | undefined =>
    quotaV1(read(posix.join(dir, 'cpu.cfs_quota_us')), read(posix.join(dir, 'cpu.cfs_period_us')));
  return tightest(`/sys/fs/cgroup/${controllers!}`, path, v1) ?? tightest('/sys/fs/cgroup/cpu', path, v1);
}

/** The smallest quota `of` reads in `mount` joined with `path`, and in each directory above it up to `mount`. */
function tightest(mount: string, path: string, of: (dir: string) => number | undefined): number | undefined {
  let least: number | undefined;
  for (let dir = posix.join(mount, path); ; dir = posix.dirname(dir)) {
    const quota = of(dir);
    if (quota !== undefined && (least === undefined || quota < least)) least = quota;
    if (dir === mount || !dir.startsWith(`${mount}/`)) return least;
  }
}

function quotaV2(text: string | undefined): number | undefined {
  const [quota, period] = text?.trim().split(/\s+/) ?? [];
  return quota === undefined || quota === 'max' ? undefined : ratio(quota, period);
}

function quotaV1(quota: string | undefined, period: string | undefined): number | undefined {
  return quota === undefined ? undefined : ratio(quota.trim(), period?.trim());
}

function ratio(quota: string, period: string | undefined): number | undefined {
  const cores = Number(quota) / Number(period);
  return Number.isFinite(cores) && cores > 0 ? cores : undefined;
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

/** The class `machine` is of, as one string: two runs on one kind of machine are one class, whatever wrote its fields. */
export function machineClass(machine: Machine): string {
  return JSON.stringify(FIELDS.map((field) => machine[field] ?? null));
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

/** The `machines` of a run that ran every file on `machine` (`RanTests`), or nothing when it names none. */
export function ranMachines(machine: Machine | undefined): Pick<RanTests, 'machines'> {
  return machine === undefined ? {} : { machines: () => machine };
}

/**
 * The machine each file of a fold of `shards` ran on, as its shard's own
 * landing named it: only where that shard's record stands at the commit its
 * snapshot does, as `shardsInstall` reads the install. A file two shards
 * name on two machines names none.
 */
export function shardsMachines(shards: readonly ShardRuns[]): (file: string) => Machine | undefined {
  const machines = new Map<string, Machine | undefined>();
  for (const { tests, runs } of shards) {
    if (runs === undefined || tests.commit === undefined || runs.commit !== tests.commit) continue;
    const ran = new Set(tests.tests.map((test) => test.file));
    for (const landing of runs.landings) {
      for (const file of landing.files) {
        if (!ran.has(file)) continue;
        const named = machines.get(file);
        const differs = machines.has(file) && (named === undefined || landing.machine === undefined || machineClass(named) !== machineClass(landing.machine));
        machines.set(file, differs ? undefined : landing.machine);
      }
    }
  }
  return (file) => machines.get(file);
}

/**
 * The machine each file of `runs` last ran on: where the run it stands on
 * landed, the latest landing at the record's commit over where it stood
 * before. A file whose run named no machine names none.
 */
export function filesMachines(runs: Pick<CommitRuns, 'landings' | 'standing'>): ReadonlyMap<string, Machine | undefined> {
  const machines = new Map<string, Machine | undefined>();
  for (const { files, machine } of [...(runs.standing ?? []), ...runs.landings]) {
    for (const file of files) machines.set(file, machine);
  }
  return machines;
}
