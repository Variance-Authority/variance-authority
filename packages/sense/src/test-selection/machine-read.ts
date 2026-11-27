/**
 * Reads the machine this process runs on: the engine answers what it can
 * (`availableParallelism`, `constrainedMemory`); only the cgroup CPU quota,
 * which Node does not expose, is read from Linux's files. What the fields
 * mean, and when two machines are one class, is [`machine.ts`](machine.ts)'s.
 */

// compass: variance-authority.reach

import { readFileSync } from 'node:fs';
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { posix } from 'node:path';
import { imageOf, type Machine } from './machine.js';

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

/**
 * The cores this process's cgroup grants, the tightest quota of its group and
 * every ancestor: cgroup v2's `cpu.max`, else v1's `cpu.cfs_quota_us` over
 * `cpu.cfs_period_us`. A hybrid host lists both, and its unified hierarchy
 * holds no CPU controller, so v1 answers there. A container mounts its own
 * group at the root, so a host path `/proc/self/cgroup` names that is not
 * mounted is walked up to it.
 */
export function cpuQuotaOf(read: Read): number | undefined {
  const groups = read('/proc/self/cgroup')?.split('\n') ?? [];
  const unified = groups.find((line) => line.startsWith('0::'));
  const v2 = unified === undefined ? undefined : tightest('/sys/fs/cgroup', unified.slice(3), (dir) => quotaV2(read(posix.join(dir, 'cpu.max'))));
  if (v2 !== undefined) return v2;
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
