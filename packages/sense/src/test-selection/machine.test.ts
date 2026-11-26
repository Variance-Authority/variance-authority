import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { cpuQuotaOf, describeMachine, filesMachines, imageOf, machineClass, machineOf, readMachine, shardsMachines, type Machine } from './machine.js';

/** A file system that holds `files` and nothing else. */
function files(held: Readonly<Record<string, string>>): (path: string) => string | undefined {
  return (path) => held[path];
}

describe('the CPU quota a Linux cgroup grants', () => {
  it('reads a cgroup v2 quota as cores, the tightest of the group and its ancestors', () => {
    const read = files({
      '/proc/self/cgroup': '0::/ci/job\n',
      '/sys/fs/cgroup/ci/job/cpu.max': 'max 100000\n',
      '/sys/fs/cgroup/ci/cpu.max': '150000 100000\n',
      '/sys/fs/cgroup/cpu.max': '400000 100000\n',
    });

    expect(cpuQuotaOf(read)).toBe(1.5);
  });

  it('reads a cgroup v1 quota from the cpu controller, from the container root when the host path is not mounted', () => {
    const read = files({
      '/proc/self/cgroup': '12:memory:/docker/abc\n4:cpu,cpuacct:/docker/abc\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us': '200000\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us': '100000\n',
    });

    expect(cpuQuotaOf(read)).toBe(2);
  });

  it('reads the cgroup v1 quota on a hybrid host, whose unified hierarchy holds no CPU controller', () => {
    const read = files({
      '/proc/self/cgroup': '4:cpu,cpuacct:/docker/abc\n0::/docker/abc\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us': '150000\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us': '100000\n',
    });

    expect(cpuQuotaOf(read)).toBe(1.5);
  });

  it('is absent where no group sets one, or no cgroup is mounted', () => {
    expect(cpuQuotaOf(files({ '/proc/self/cgroup': '0::/\n', '/sys/fs/cgroup/cpu.max': 'max 100000\n' }))).toBeUndefined();
    expect(cpuQuotaOf(files({
      '/proc/self/cgroup': '4:cpu,cpuacct:/\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us': '-1\n',
      '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us': '100000\n',
    }))).toBeUndefined();
    expect(cpuQuotaOf(files({}))).toBeUndefined();
  });
});

describe('the CI runner image', () => {
  it('names a hosted GitHub Actions image by its OS and version', () => {
    expect(imageOf({ GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24', ImageVersion: '20251117.1.0' })).toBe('ubuntu24 20251117.1.0');
  });

  it('names a GitLab job by its image', () => {
    expect(imageOf({ GITLAB_CI: 'true', CI_JOB_IMAGE: 'node:24-bookworm' })).toBe('node:24-bookworm');
  });

  it('is absent where the environment names none, a self-hosted runner among them', () => {
    expect(imageOf({ GITHUB_ACTIONS: 'true', RUNNER_NAME: 'box-17' })).toBeUndefined();
    expect(imageOf({})).toBeUndefined();
  });
});

describe('the machine a run ran on', () => {
  it('names the CPU, the OS, the cores, the memory, Node and the workers, and no host', () => {
    const machine = readMachine(3, { read: files({}), env: {} });

    expect(machine).toMatchObject({ arch: process.arch, node: process.version, workers: 3 });
    expect(machine.os).toMatch(new RegExp(`^${process.platform} `));
    expect(machine.cores).toBeGreaterThan(0);
    expect(machine.memory).toBeGreaterThan(0);
    expect(JSON.stringify(machine)).not.toContain(`"${hostname()}"`);
  });

  it('leaves out the workers where the runner did not say them', () => {
    expect(readMachine(undefined, { read: files({}), env: {} })).not.toHaveProperty('workers');
  });

  it('reads back from JSON only the fields that are what they say, and nothing when none is', () => {
    expect(machineOf({ arch: 'arm64', cores: 8, workers: 'four', memory: -1, host: 'box-17' })).toEqual({ arch: 'arm64', cores: 8 });
    expect(machineOf({ cores: 'eight' })).toBeUndefined();
    expect(machineOf('linux')).toBeUndefined();
  });

  it('is one class for two runs on the same kind of machine, whatever order its fields were written in', () => {
    const one: Machine = { arch: 'x64', cores: 4, node: 'v24.1.0' };
    const same: Machine = { node: 'v24.1.0', cores: 4, arch: 'x64' };

    expect(machineClass(one)).toBe(machineClass(same));
    expect(machineClass(one)).not.toBe(machineClass({ ...one, workers: 2 }));
  });

  it('is one class for two VMs of one size that report their memory a few megabytes apart', () => {
    const one: Machine = { arch: 'x64', memory: 16 * 2 ** 30 - 3 * 2 ** 20, memoryLimit: 8 * 2 ** 30 };
    const other: Machine = { arch: 'x64', memory: 16 * 2 ** 30 - 9 * 2 ** 20, memoryLimit: 8 * 2 ** 30 + 2 ** 20 };

    expect(machineClass(one)).toBe(machineClass(other));
    expect(machineClass(one)).not.toBe(machineClass({ ...one, memory: 32 * 2 ** 30 }));
  });

  it('names each file of a fold by the machine its shard\'s own landing ran it on, and none where a shard\'s record does not speak for it', () => {
    const runner: Machine = { arch: 'x64', cores: 4 };
    const laptop: Machine = { arch: 'arm64', cores: 12 };
    const machines = shardsMachines([
      { tests: { commit: 'C', tests: [{ file: 'a.test.ts' }, { file: 'b.test.ts' }] }, runs: { commit: 'C', runs: 1, landings: [{ files: ['a.test.ts', 'b.test.ts'], machine: runner }] } },
      { tests: { commit: 'C', tests: [{ file: 'c.test.ts' }] }, runs: { commit: 'C', runs: 1, landings: [{ files: ['c.test.ts'], machine: laptop }] } },
      { tests: { commit: 'C', tests: [{ file: 'd.test.ts' }] }, runs: { commit: 'B', runs: 1, landings: [{ files: ['d.test.ts'], machine: laptop }] } },
      { tests: { commit: 'C', tests: [{ file: 'e.test.ts' }] }, runs: undefined },
      // A seeded record: its landings are the base's, not this shard's.
      { tests: { commit: 'C', tests: [{ file: 'f.test.ts' }] }, runs: { commit: 'C', runs: 0, landings: [{ files: ['f.test.ts'], machine: laptop }] } },
      // A file one run finished on the runner and a later run on the laptop ran in part.
      { tests: { commit: 'C', tests: [{ file: 'g.test.ts' }] }, runs: { commit: 'C', runs: 2, landings: [{ files: ['g.test.ts'], machine: runner }, { files: [], partly: ['g.test.ts'], machine: laptop }] } },
    ]);

    expect(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts', 'f.test.ts', 'g.test.ts'].map(machines))
      .toEqual([runner, runner, laptop, undefined, undefined, undefined, undefined]);
  });

  it('names the machine a file last ran on, and none for a file a run on another machine ran in part', () => {
    const runner: Machine = { arch: 'x64', cores: 4 };
    const laptop: Machine = { arch: 'arm64', cores: 12 };
    const machines = filesMachines({
      standing: [
        // Stands are ordered by their keys, not by file: the run in part is listed before the one that finished the file.
        { commit: 'B', files: ['e.test.ts'], partly: ['d.test.ts'], machine: laptop },
        { commit: 'A', files: ['b.test.ts', 'c.test.ts', 'd.test.ts'], machine: runner },
      ],
      landings: [
        { files: ['a.test.ts'], partly: ['b.test.ts'], machine: laptop },
        { files: [], partly: ['c.test.ts'], machine: runner },
      ],
    });

    expect(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'].map((file) => machines.get(file))).toEqual([laptop, undefined, runner, undefined, laptop]);
  });

  it('says a machine in one line, its limits beside what they limit', () => {
    expect(describeMachine({
      cpu: 'AMD EPYC 7763',
      arch: 'x64',
      os: 'linux 6.8.0',
      cores: 4,
      cpuQuota: 2,
      memory: 16 * 2 ** 30,
      memoryLimit: 8 * 2 ** 30,
      node: 'v24.1.0',
      image: 'ubuntu24 20251117.1.0',
      workers: 3,
    })).toBe('AMD EPYC 7763 x64, linux 6.8.0, 4 cores (quota 2), 16 GiB (limit 8 GiB), Node v24.1.0, image ubuntu24 20251117.1.0, 3 workers');
    expect(describeMachine({})).toBe('an unnamed machine');
  });
});
