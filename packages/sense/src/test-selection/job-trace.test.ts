import { describe, expect, it } from 'vitest';
import { readJobTrace } from './job-trace.js';

const read = (...lines: string[]) => {
  const { reads, writes, absent } = readJobTrace(lines);
  return { reads: [...reads], writes: [...writes], absent: [...absent] };
};

describe('reading a job trace', () => {
  it('reads an open for reading, by the path the kernel resolved', () => {
    expect(read('144   openat(AT_FDCWD</r/sub>, "../read.txt", O_RDONLY) = 3</r/read.txt>').reads).toEqual(['/r/read.txt']);
  });

  it('counts a program a job ran as read', () => {
    expect(read('144   execve("/r/bin/tool", ["tool", "a b"], 0x7ffd /* 3 vars */) = 0').reads).toEqual(['/r/bin/tool']);
  });

  it('writes an open for writing, and reads none of it', () => {
    expect(read('146   openat(AT_FDCWD</r/sub>, "../gen.txt", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3</r/gen.txt>')).toEqual({
      reads: [],
      writes: ['/r/gen.txt'],
      absent: [],
    });
  });

  it('holds a file written before it was read as an output alone', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "gen.txt", O_WRONLY|O_CREAT, 0666) = 3</r/gen.txt>',
      '2 openat(AT_FDCWD</r>, "gen.txt", O_RDONLY) = 4</r/gen.txt>',
    )).toEqual({ reads: [], writes: ['/r/gen.txt'], absent: [] });
  });

  it('holds a file read before it was written as both', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "a.txt", O_RDONLY) = 3</r/a.txt>',
      '1 openat(AT_FDCWD</r>, "a.txt", O_WRONLY) = 3</r/a.txt>',
    )).toEqual({ reads: ['/r/a.txt'], writes: ['/r/a.txt'], absent: [] });
  });

  it('follows a rename from its directories, and what it wrote moves with it', () => {
    expect(read(
      '147 openat(AT_FDCWD</r/sub>, "\\303\\251 q.tmp", O_WRONLY|O_CREAT|O_TRUNC, 0666) = 3</r/sub/\\303\\251 q.tmp>',
      '147 renameat2(AT_FDCWD</r/sub>, "\\303\\251 q.tmp", AT_FDCWD</r/sub>, "final.txt", RENAME_NOREPLACE) = 0',
      '147 openat(AT_FDCWD</r/sub>, "final.txt", O_RDONLY) = 3</r/sub/final.txt>',
    )).toEqual({ reads: [], writes: ['/r/sub/final.txt', '/r/sub/é q.tmp'], absent: [] });
  });

  it('counts a file moved away that the job did not write as read', () => {
    expect(read('1 rename("/r/a.txt", "/r/b.txt") = 0')).toEqual({ reads: ['/r/a.txt'], writes: ['/r/a.txt', '/r/b.txt'], absent: [] });
  });

  it('joins a call the trace split across another process', () => {
    expect(read(
      '10 openat(AT_FDCWD</r>, "a.txt", O_RDONLY <unfinished ...>',
      '11 openat(AT_FDCWD</r>, "b.txt", O_RDONLY) = 3</r/b.txt>',
      '10 <... openat resumed>) = 4</r/a.txt>',
    ).reads).toEqual(['/r/a.txt', '/r/b.txt']);
  });

  it('holds a path it looked for and did not find as absent', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "x.json", O_RDONLY) = -1 ENOENT (No such file or directory)',
      '1 newfstatat(AT_FDCWD</r/sub>, "../y.json", 0x7ffd, 0) = -1 ENOENT (No such file or directory)',
      '1 statx(AT_FDCWD</r>, "z.json", AT_STATX_SYNC_AS_STAT, STATX_ALL, 0x7ffd) = -1 ENOENT (No such file or directory)',
      '1 access("/r/w.json", R_OK) = -1 ENOENT (No such file or directory)',
    ).absent).toEqual(['/r/w.json', '/r/x.json', '/r/y.json', '/r/z.json']);
  });

  it('holds nothing absent that the job went on to write', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "x", O_RDONLY) = -1 ENOENT (No such file or directory)',
      '1 openat(AT_FDCWD</r>, "x", O_WRONLY|O_CREAT, 0666) = 3</r/x>',
    )).toEqual({ reads: [], writes: ['/r/x'], absent: [] });
  });

  it('reads nothing from a call that failed any other way, a stat that found the file, a descriptor that only names one, or a line that is no call', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "x", O_RDONLY) = -1 EACCES (Permission denied)',
      '1 openat(AT_FDCWD</r>, "p", O_RDONLY|O_PATH) = 3</r/p>',
      '1 newfstatat(AT_FDCWD</r>, "y", {st_mode=S_IFREG|0644, st_size=1, ...}, 0) = 0',
      '1 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=2} ---',
      '1 +++ exited with 0 +++',
      '',
    )).toEqual({ reads: [], writes: [], absent: [] });
  });

  it('keeps a quote, a parenthesis and a comma inside a path', () => {
    expect(read('1 openat(AT_FDCWD</r>, "a\\"(b), c.txt", O_RDONLY) = 3</r/a"(b), c.txt>').reads).toEqual(['/r/a"(b), c.txt']);
  });
});
