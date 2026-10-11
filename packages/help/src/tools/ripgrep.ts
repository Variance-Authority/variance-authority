import { spawnSync } from 'node:child_process';

/**
 * ripgrep, over a list of files the caller already chose.
 *
 * The questions that search text — `grep` over a closure, `intersection` over
 * the files its other sets kept — own the choice of files and nothing else; the
 * pattern language, encodings and binary detection are ripgrep's. This is the
 * one place that hands a file list to `rg` and reads its JSON back.
 */

/** Longer lines are cut: one match in a minified bundle is a megabyte of line. */
const WIDEST = 240;

/**
 * Bytes of paths per `rg` call. macOS allows 1 MiB of argv and environment
 * together, so a closure of tens of thousands of files is several calls.
 */
const ARGV_BYTES = 256 * 1024;

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** What ripgrep said about one batch of paths. */
export interface Searched {
  readonly hits: readonly Hit[];
  readonly errors: readonly string[];
}

/** The closure, in batches that fit on a command line. */
function batches(files: readonly string[]): readonly (readonly string[])[] {
  const out: string[][] = [];
  let bytes = ARGV_BYTES;
  for (const file of files) {
    if (bytes + file.length + 1 > ARGV_BYTES) {
      out.push([]);
      bytes = 0;
    }
    out[out.length - 1]!.push(file);
    bytes += file.length + 1;
  }
  return out;
}

/** One `rg --json` over one batch, read back as hits and complaints. */
function rg(root: string, pattern: string, files: readonly string[]): Searched {
  const ran = spawnSync('rg', ['--json', `--regexp=${pattern}`, '--', ...files], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (ran.error !== undefined) {
    const missing = (ran.error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new Error(
      missing
        ? '`grep` and `intersection` run ripgrep on the files, and `rg` is not on PATH. Install ripgrep and ask again.'
        : `ripgrep could not be run: ${ran.error.message}`,
    );
  }
  // 0 is a match, 1 is none, 2 is an error — which ripgrep also gives when it
  // matched in some files and could not read others, so 2 is not a refusal
  // unless nothing came back with it.
  const errors = ran.stderr.split('\n').filter((line) => line.trim() !== '');
  if (ran.status === 2 && ran.stdout === '') throw new Error(`ripgrep refused the pattern: ${errors.join(' ')}`);

  const hits: Hit[] = [];
  for (const line of ran.stdout.split('\n')) {
    if (line === '') continue;
    const message = JSON.parse(line) as {
      type: string;
      data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
    };
    if (message.type !== 'match') continue;
    const file = message.data?.path?.text;
    const at = message.data?.line_number;
    if (file === undefined || at === undefined) continue;
    const text = (message.data?.lines?.text ?? '(not UTF-8)').replace(/\r?\n$/, '');
    hits.push({ file, line: at, text: text.length > WIDEST ? `${text.slice(0, WIDEST)}…` : text });
  }
  return { hits, errors };
}

/** Every matching line in these files, in ripgrep's order, and what it could not read. */
export function ripgrep(root: string, pattern: string, files: readonly string[]): Searched {
  const hits: Hit[] = [];
  const errors: string[] = [];
  for (const batch of batches(files)) {
    const searched = rg(root, pattern, batch);
    hits.push(...searched.hits);
    errors.push(...searched.errors);
  }
  return { hits, errors };
}
